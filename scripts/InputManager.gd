extends Node
## Singleton service that handles global OS keyboard shortcuts.
## Compiles and runs a localized background Swift daemon to intercept macOS hotkeys while Godot runs unfocused.

## Emitted when the global interaction toggle hotkey is triggered.
signal hotkey_pressed

## Controls whether the background swift daemon process should be compiled and launched.
@export var enable_daemon: bool = true

# Networking configs for daemon communication
const PORT := 9999
var _udp_peer := PacketPeerUDP.new()
var _daemon_pid: int = -1


func _ready() -> void:
	print("InputManager: Initialising — OS is '", OS.get_name(), "'.")

	# Bind loopback UDP socket to catch signal packets from the hotkey daemon
	var err := _udp_peer.bind(PORT, "127.0.0.1")
	if err != OK:
		printerr("InputManager: ERROR — failed to bind UDP port ", PORT,
				 " (code ", err, "). Another process may be using it.")
	else:
		print("InputManager: UDP socket bound on port ", PORT, ". Ready to receive hotkey packets.")

	# Compile and run the daemon binary on macOS platforms
	if OS.get_name() == "macOS":
		if enable_daemon:
			_start_daemon()
		else:
			print("InputManager: enable_daemon=false — daemon is disabled.")
	else:
		print("InputManager: Not macOS — skipping daemon launch.")


func _process(_delta: float) -> void:
	# Poll UDP packets checking for hotkey event triggers
	if _udp_peer.get_available_packet_count() > 0:
		var packet := _udp_peer.get_packet().get_string_from_utf8()
		print("InputManager: UDP packet received — '", packet, "'.")
		if packet == "hotkey":
			print("InputManager: ✅ Hotkey packet confirmed — emitting hotkey_pressed signal.")
			hotkey_pressed.emit()
		else:
			print("InputManager: Unknown packet type ignored: '", packet, "'.")


# Private helper that handles source compilation and daemon execution
func _start_daemon() -> void:
	var source_path := ProjectSettings.globalize_path("res://scripts/hotkey_daemon.swift")
	var dest_dir   := ProjectSettings.globalize_path("user://")
	var dest_path  := dest_dir + "hotkey_daemon"

	print("InputManager: source  = ", source_path)
	print("InputManager: binary  = ", dest_path)

	# Delete previous binary to force fresh compilation on every launch
	if FileAccess.file_exists(dest_path):
		DirAccess.remove_absolute(dest_path)
		print("InputManager: Removed stale binary.")

	# Compile Swift code via local swiftc utility
	print("InputManager: Compiling hotkey_daemon.swift via swiftc...")
	var compile_output: Array = []
	var exit_code := OS.execute("swiftc", [source_path, "-o", dest_path],
								compile_output, true)

	if exit_code != 0:
		printerr("InputManager: ERROR — swiftc compilation failed (exit code ", exit_code, ").")
		for line in compile_output:
			printerr("  swiftc: ", line)
		return

	print("InputManager: Compilation successful.")

	# Launch compiled binary as a detached OS background process
	print("InputManager: Launching daemon process...")
	_daemon_pid = OS.create_process(dest_path, [])
	if _daemon_pid == -1:
		printerr("InputManager: ERROR — OS.create_process failed. Check binary permissions.")
	else:
		print("InputManager: Daemon running with PID ", _daemon_pid, ".")
		print("InputManager: Press Ctrl+Shift+Option+Space to trigger.")


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
