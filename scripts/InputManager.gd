extends Node
## Singleton service that handles global OS keyboard shortcuts.
## Compiles and runs a localized background Swift daemon to intercept macOS hotkeys while Godot runs unfocused.

## Emitted when the global interaction toggle hotkey is triggered.
signal hotkey_pressed
## Emitted when the global interaction toggle hotkey is released.
signal hotkey_released

## Controls whether the background swift daemon process should be compiled and launched.
@export var enable_daemon: bool = true

# Networking configs for daemon communication
const PORT := 9999
const DEBOUNCE_TIME: float = 0.2 # Seconds to wait between valid triggers
var _udp_peer := PacketPeerUDP.new()
var _daemon_pid: int = -1
var _last_trigger_time: float = 0.0
var _current_keycode := 126
var _current_modifiers := 512



func _ready() -> void:
	print("InputManager: Initialising — OS is '", OS.get_name(), "'.")

	# Bind loopback UDP socket to catch signal packets from the hotkey daemon
	var err := _udp_peer.bind(PORT, "127.0.0.1")
	if err != OK:
		printerr("InputManager: ERROR — failed to bind UDP port ", PORT,
				 " (code ", err, "). Another process may be using it.")
	else:
		print("InputManager: UDP socket bound on port ", PORT, ". Ready to receive hotkey packets.")

	if has_node("/root/SettingsManager"):
		var sm = get_node("/root/SettingsManager")
		sm.settings_updated.connect(_on_settings_updated)
		_current_keycode = sm.get_setting("hotkey_keycode", 49)
		_current_modifiers = sm.get_setting("hotkey_modifiers", 6656)

	# Compile and run the daemon binary on macOS platforms
	if OS.get_name() == "macOS":
		if enable_daemon:
			_start_daemon()
		else:
			print("InputManager: enable_daemon=false — daemon is disabled.")
	else:
		print("InputManager: Not macOS — skipping daemon launch.")


func _on_settings_updated() -> void:
	if not has_node("/root/SettingsManager"):
		return
	var sm = get_node("/root/SettingsManager")
	var new_keycode = sm.get_setting("hotkey_keycode", 49)
	var new_modifiers = sm.get_setting("hotkey_modifiers", 6656)
	if new_keycode != _current_keycode or new_modifiers != _current_modifiers:
		print("InputManager: Hotkey settings changed. Restarting daemon.")
		_current_keycode = new_keycode
		_current_modifiers = new_modifiers
		_cleanup_daemon()
		if OS.get_name() == "macOS" and enable_daemon:
			_start_daemon()


func _process(_delta: float) -> void:
	# Poll UDP packets
	while _udp_peer.get_available_packet_count() > 0:
		var packet := _udp_peer.get_packet().get_string_from_utf8()
		
		if packet == "hotkey" or packet == "hotkey_down":
			var current_time = Time.get_ticks_msec() / 1000.0
			
			# Check if enough time has passed since the last trigger
			if current_time - _last_trigger_time > DEBOUNCE_TIME:
				_last_trigger_time = current_time
				print("InputManager: ✅ Hotkey down packet processed.")
				hotkey_pressed.emit()
			else:
				# Optionally log that we dropped a redundant packet
				pass 
		elif packet == "hotkey_up":
			print("InputManager: ✅ Hotkey released packet processed.")
			hotkey_released.emit()
		else:
			print("InputManager: Unknown packet type ignored: '", packet, "'.")

# Private helper that handles source compilation and daemon execution
func _start_daemon() -> void:
	var source_path := ProjectSettings.globalize_path("res://scripts/hotkey_daemon.swift")
	var dest_dir   := ProjectSettings.globalize_path("user://")
	var dest_path  := dest_dir + "hotkey_daemon"
	var precompiled_res := "res://bin/hotkey_daemon"
	var precompiled_path := _get_actual_path(precompiled_res)

	print("InputManager: source  = ", source_path)
	print("InputManager: binary  = ", dest_path)
	print("InputManager: precompiled = ", precompiled_path)

	var use_precompiled := false
	
	if FileAccess.file_exists(source_path):
		var source_time := FileAccess.get_modified_time(source_path)
		var dest_time := 0
		if FileAccess.file_exists(dest_path):
			dest_time = FileAccess.get_modified_time(dest_path)
		
		if source_time > dest_time or not FileAccess.file_exists(dest_path):
			print("InputManager: Source code is newer than current binary. Compiling from source...")
			# Delete previous binary to force fresh compilation
			if FileAccess.file_exists(dest_path):
				DirAccess.remove_absolute(dest_path)
				
			var compile_output: Array = []
			var exit_code := OS.execute("swiftc", [source_path, "-o", dest_path],
										compile_output, true)
			if exit_code != 0:
				ErrorBus.report("InputManager: ERROR — swiftc compilation failed (exit code " + str(exit_code) + ").")
				for line in compile_output:
					ErrorBus.report("  swiftc: " + str(line))
				use_precompiled = true
			else:
				print("InputManager: Compilation successful.")
		else:
			print("InputManager: Binary is up-to-date with source code.")
	else:
		print("InputManager: Source code not found. Will use precompiled binary.")
		use_precompiled = true

	if use_precompiled:
		if FileAccess.file_exists(precompiled_path):
			var precompiled_time := FileAccess.get_modified_time(precompiled_path)
			var dest_time := 0
			if FileAccess.file_exists(dest_path):
				dest_time = FileAccess.get_modified_time(dest_path)
			
			if precompiled_time > dest_time or not FileAccess.file_exists(dest_path):
				print("InputManager: Copying newer precompiled binary...")
				var copy_success := _copy_precompiled_binary(precompiled_path, dest_path, dest_dir)
				if not copy_success:
					ErrorBus.report("InputManager: Failed to copy precompiled binary.")
					return
			else:
				print("InputManager: Current binary is up-to-date with precompiled binary.")
		else:
			ErrorBus.report("InputManager: ERROR — neither precompiled binary nor source code exists.")
			return

	# Launch compiled/copied binary as a detached OS background process
	print("InputManager: Launching daemon process with keycode: ", _current_keycode, " modifiers: ", _current_modifiers)
	_daemon_pid = OS.create_process(dest_path, [str(_current_keycode), str(_current_modifiers)])
	if _daemon_pid == -1:
		ErrorBus.report("InputManager: ERROR — OS.create_process failed. Check binary permissions.")
	else:
		print("InputManager: Daemon running with PID ", _daemon_pid, ".")


func _copy_precompiled_binary(precompiled_path: String, dest_path: String, dest_dir: String) -> bool:
	if FileAccess.file_exists(dest_path):
		DirAccess.remove_absolute(dest_path)
	var dir := DirAccess.open(dest_dir)
	if dir:
		var err := dir.copy(precompiled_path, dest_path)
		if err != OK:
			ErrorBus.report("InputManager: ERROR — failed to copy precompiled binary to user directory (code " + str(err) + ").")
			return false
		else:
			print("InputManager: Copied precompiled binary successfully.")
			# Make sure it's executable
			OS.execute("chmod", ["+x", dest_path])
			return true
	return false


func _get_actual_path(path: String) -> String:
	if path.begins_with("res://bin/"):
		var rel := path.substr("res://bin/".length())
		if OS.has_feature("editor"):
			return ProjectSettings.globalize_path(path)
		else:
			var exe_dir := OS.get_executable_path().get_base_dir()
			return exe_dir.path_join("bin").path_join(rel)
	return ProjectSettings.globalize_path(path)


func _notification(what: int) -> void:
	# Terminate background daemon when the application is closed or cleaned up
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_PREDELETE:
		_cleanup_daemon()


# Private helper to terminate daemon process tree
func _cleanup_daemon() -> void:
	if _daemon_pid != -1:
		print("InputManager: Stopping hotkey daemon PID: ", _daemon_pid)
		OS.kill(_daemon_pid)
		_daemon_pid = -1
