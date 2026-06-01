class_name WindowController
extends Node
## Core orchestrator node that configures borderless window parameters and manages transition states.
## Swaps viewport scale states between compact mouse-follow mode and fullscreen interaction screens.

# Internal Node Mappings
@onready var _follow_ctrl: Node = $FollowController
@onready var _chat_ui: Control = $ChatUI
@onready var _fairy: FairyVisuals = $FairyVisuals
@onready var _settings_ui: SettingsUI = $SettingsUI

# Visual state tracking configurations
enum _ActivePanel { NONE, CHAT, SETTINGS }
var _active_panel: _ActivePanel = _ActivePanel.NONE

# Font size cache: maps node instance_id -> Dictionary of { property -> original_size }
var _font_size_cache: Dictionary = {}


func _ready() -> void:
	# Enforce alpha-transparency rendering in viewport canvas layers
	get_viewport().transparent_bg = true

	# Set up Godot's OS Window parameters via DisplayServer layer
	var window := get_window()
	window.transparent = true
	window.borderless = true
	window.always_on_top = true

	# Set the initial compact window dimensions for mouse-follow mode
	window.size = Vector2i(200, 200)

	# Establish global background hotkey trigger connections
	if has_node("/root/InputManager"):
		get_node("/root/InputManager").hotkey_pressed.connect(_on_hotkey_pressed)

	# Wire fairy visual signals (right click trigger) -> Settings UI overlay open trigger
	if _fairy and _fairy.has_signal("fairy_clicked"):
		_fairy.fairy_clicked.connect(_on_fairy_clicked)

	# Wire dynamic drag signals from fairy body -> real-time chat repositioning
	if _fairy:
		if _fairy.has_signal("fairy_dragged"):
			_fairy.fairy_dragged.connect(_on_fairy_dragged)
		if _fairy.has_signal("fairy_drag_finished"):
			_fairy.fairy_drag_finished.connect(_on_fairy_drag_finished)

	# Connect settings close event to revert the application layout to compact follow state
	if _settings_ui and _settings_ui.has_signal("settings_closed"):
		_settings_ui.settings_closed.connect(_reset_to_follow_mode)

	# Pass settings changes through to live modulate the fairy's color
	if _settings_ui and _settings_ui.has_signal("color_changed") and _fairy:
		_settings_ui.color_changed.connect(_fairy.set_fairy_color)
	# Connect to the Manager
	if has_node("/root/SettingsManager"):
		var manager = get_node("/root/SettingsManager")
		manager.settings_updated.connect(_on_settings_manager_updated)
		# Apply initial settings once immediately
		_apply_global_settings(manager)

func _on_settings_manager_updated() -> void:
	_apply_global_settings(get_node("/root/SettingsManager"))
	
func _apply_global_settings(manager: Node) -> void:
	# 1. Update Fairy Visuals
	var color_hex = manager.get_setting("fairy_color", "66b2ff")
	if _fairy:
		_fairy.set_fairy_color(Color.html(color_hex))
	
	# 2. Update AI Service (Assuming it's an Autoload)
	if has_node("/root/AIService"):
		var ai = get_node("/root/AIService")
		# Ensure your AI Service has a method to update its cache
		if ai.has_method("update_config"):
			ai.update_config({
				"system_prompt": manager.get_setting("system_prompt"),
				"personality": manager.get_setting("personality"),
				"llm_provider": manager.get_setting("llm_provider"),
				"fast_model": manager.get_setting("cloud_model" if manager.get_setting("llm_provider") == "cloud" else "local_model"),
				"heavy_model": manager.get_setting("cloud_thinking_model" if manager.get_setting("llm_provider") == "cloud" else "local_thinking_model")
			})

	# 3. Apply global font size offset across all UI nodes
	var font_offset: int = manager.get_setting("font_size_offset", 0)
	_apply_font_size_offset(get_tree().get_root(), font_offset)

	print("WindowController: All settings applied successfully.")


## Recursively walks [param root] and adjusts all theme font_size overrides.
## Original sizes are cached on first visit, so subsequent calls always compute
## from the original design values rather than accumulating drift.
func _apply_font_size_offset(root: Node, offset: int) -> void:
	var font_props: Array[String] = [
		"theme_override_font_sizes/font_size",
		"theme_override_font_sizes/bold_font_size",
		"theme_override_font_sizes/italics_font_size",
		"theme_override_font_sizes/bold_italics_font_size",
		"theme_override_font_sizes/normal_font_size",
		"theme_override_font_sizes/mono_font_size",
	]

	if root is Control:
		var node_id := root.get_instance_id()
		if not _font_size_cache.has(node_id):
			# First visit: snapshot current (original) values for all relevant props
			var snapshot: Dictionary = {}
			for prop in font_props:
				var val = root.get(prop)
				if val != null and (val is int or val is float) and val > 0:
					snapshot[prop] = val
			_font_size_cache[node_id] = snapshot

		# Apply offset relative to original cached values
		var cached: Dictionary = _font_size_cache[node_id]
		for prop in cached.keys():
			root.set(prop, max(6, cached[prop] + offset))

	for child in root.get_children():
		_apply_font_size_offset(child, offset)

func _input(event: InputEvent) -> void:
	# Dismiss active overlays and return to compact follow mode when Escape is pressed
	if event is InputEventKey and event.keycode == KEY_ESCAPE and event.pressed:
		_reset_to_follow_mode()
		get_viewport().set_input_as_handled()
		return

	# Dismiss chat overlay if user left-clicks the background outside the panels and fairy body
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if _active_panel == _ActivePanel.CHAT:
			var local_mouse_pos: Vector2 = get_viewport().get_mouse_position()
			
			var clicked_ui := false
			if _chat_ui and _chat_ui.has_method("is_position_inside_ui"):
				clicked_ui = _chat_ui.call("is_position_inside_ui", local_mouse_pos)
				
			var clicked_fairy := false
			if _fairy:
				if local_mouse_pos.distance_to(_fairy.position) < 30.0:
					clicked_fairy = true
					
			if not clicked_ui and not clicked_fairy:
				_reset_to_follow_mode()


# ---------------------------------------------------------------------------
# Interaction Overlay State: Chat UI Setup
# ---------------------------------------------------------------------------

func _on_hotkey_pressed() -> void:
	if _active_panel != _ActivePanel.NONE:
		return

	# Freeze window follow updates and flag chat overlay state
	_set_following(false)
	_active_panel = _ActivePanel.CHAT

	if has_node("/root/AIService"):
		var ai_service = get_node("/root/AIService")
		if ai_service.has_method("clear_history"):
			ai_service.call("clear_history")

	var window := get_window()
	var fairy_screen_pos := window.position + Vector2i(_fairy.position)

	# Expand the transparent Godot window to cover the screen's usable region
	var screen_rect := DisplayServer.screen_get_usable_rect(
		DisplayServer.window_get_current_screen()
	)
	window.position = screen_rect.position
	window.size = screen_rect.size

	# Place the fairy body back onto its correct screen coordinate relative to the enlarged window offset
	_fairy.position = Vector2(fairy_screen_pos - screen_rect.position)

	# Yield for two frames to ensure the OS window manager applies resizing
	await get_tree().process_frame
	await get_tree().process_frame

	# Open the Chat panel next to the fairy's new coordinates without initial screenshot
	if _chat_ui and _chat_ui.has_method("reposition_ui") and _chat_ui.has_method("open_chat"):
		_chat_ui.call("reposition_ui", _fairy.position)
		_chat_ui.call("open_chat", null, _fairy.position, Vector2(screen_rect.size))

	# Request focus on the Godot window to intercept typing events
	DisplayServer.window_move_to_foreground()
	print("WindowController: Chat opened — window full screen at ", screen_rect, ".")


# ---------------------------------------------------------------------------
# Interaction Overlay State: Settings UI Setup
# ---------------------------------------------------------------------------

func _on_fairy_clicked() -> void:
	if _active_panel == _ActivePanel.SETTINGS:
		return

	# If the chat overlay is active, end the session (saves history for summarization)
	# then close the chat UI before opening settings.
	if _active_panel == _ActivePanel.CHAT:
		if has_node("/root/AIService"):
			var ai_service = get_node("/root/AIService")
			if ai_service.has_method("end_chat_session"):
				ai_service.call("end_chat_session")
		if _chat_ui and _chat_ui.has_method("close_chat"):
			_chat_ui.call("close_chat")

	_set_following(false)
	_active_panel = _ActivePanel.SETTINGS

	var window := get_window()
	var fairy_screen_pos := window.position + Vector2i(_fairy.position)

	# Expand the transparent window fullscreen
	var screen_rect := DisplayServer.screen_get_usable_rect(
		DisplayServer.window_get_current_screen()
	)
	window.position = screen_rect.position
	window.size = screen_rect.size
	_fairy.position = Vector2(fairy_screen_pos - screen_rect.position)

	# Position the settings panel container adjacent to the stationary fairy
	const SET_W := 400
	const SET_H := 510
	var desired := _fairy.position - Vector2(SET_W / 2.0, SET_H / 2.0)
	var clamped := Vector2(
		clamp(desired.x, 20.0, screen_rect.size.x - SET_W - 20.0),
		clamp(desired.y, 20.0, screen_rect.size.y - SET_H - 20.0)
	)

	if _settings_ui:
		_settings_ui.position = clamped
		_settings_ui.open_settings()

	DisplayServer.window_move_to_foreground()
	print("WindowController: Settings opened — window full screen, panel at ", clamped, ".")


# ---------------------------------------------------------------------------
# Interactive dragging hooks
# ---------------------------------------------------------------------------

func _on_fairy_dragged(new_pos: Vector2) -> void:
	# Update adjacent UI panel position in real-time as the fairy moves
	if _active_panel == _ActivePanel.CHAT and _chat_ui and _chat_ui.has_method("reposition_ui"):
		_chat_ui.call("reposition_ui", new_pos)


func _on_fairy_drag_finished(new_pos: Vector2) -> void:
	if _active_panel != _ActivePanel.CHAT or not _chat_ui:
		return

	# Re-align panel positions around the new drag release coordinates
	if _chat_ui.has_method("reposition_ui"):
		_chat_ui.call("reposition_ui", new_pos)


## Capture a clean screenshot by temporarily hiding the UI.
func capture_clean_screenshot() -> Image:
	var was_chat_visible := false
	if _active_panel == _ActivePanel.CHAT and _chat_ui:
		was_chat_visible = _chat_ui.visible
		_chat_ui.visible = false

	# Await frames for visibility state to update in window manager
	await get_tree().process_frame
	await get_tree().process_frame

	var screenshot: Image = null
	if has_node("/root/ScreenCaptureService"):
		screenshot = await get_node("/root/ScreenCaptureService").capture_screen()

	# Restore chat visibility
	if was_chat_visible and _chat_ui:
		_chat_ui.visible = true
		if _chat_ui.has_method("set_screenshot"):
			_chat_ui.call("set_screenshot", screenshot)

	return screenshot


## Captures a cropped screenshot centered around Navi's current body position.
func capture_crop_screenshot() -> Image:
	var img: Image = await capture_clean_screenshot()
	if not img:
		return null
		
	# Compute pixel coordinates of the fairy on the captured image
	var window := get_window()
	var w_size := Vector2(window.size)
	if w_size.x == 0 or w_size.y == 0:
		return img
		
	var rel_x := _fairy.position.x / w_size.x
	var rel_y := _fairy.position.y / w_size.y
	var px_x := int(rel_x * img.get_width())
	var px_y := int(rel_y * img.get_height())
	
	var crop_size := 600
	var crop_x: int = clamp(px_x - crop_size / 2, 0, img.get_width() - crop_size)
	var crop_y: int = clamp(px_y - crop_size / 2, 0, img.get_height() - crop_size)
	var rect_w: int = min(crop_size, img.get_width())
	var rect_h: int = min(crop_size, img.get_height())
	
	var crop_rect := Rect2i(crop_x, crop_y, rect_w, rect_h)
	return img.get_region(crop_rect)


# ---------------------------------------------------------------------------
# Shared Transition Revert Method
# ---------------------------------------------------------------------------

func _reset_to_follow_mode() -> void:
	if _active_panel == _ActivePanel.NONE:
		return

	# Run close/fade sequences on overlays
	match _active_panel:
		_ActivePanel.CHAT:
			if _chat_ui and _chat_ui.has_method("close_chat"):
				await _chat_ui.call("close_chat")
			if has_node("/root/AIService"):
				var ai_service = get_node("/root/AIService")
				if ai_service.has_method("end_chat_session"):
					ai_service.call("end_chat_session")
		_ActivePanel.SETTINGS:
			if _settings_ui:
				await _settings_ui.close_settings()

	_active_panel = _ActivePanel.NONE

	# Retrieve the fairy's current screen position coordinates prior to shrinking the viewport window
	var window := get_window()
	var fairy_screen_pos := window.position + Vector2i(_fairy.position)
	var follow_start_pos := fairy_screen_pos - Vector2i(100, 100)

	# Shrink the Godot Window back to a compact 200x200 pixel bounds centered around the fairy body
	window.size = Vector2i(200, 200)
	_fairy.position = Vector2(100, 100)

	# Warm starting coordinates in follow manager to prevent visual jumping upon layout transitions
	if _follow_ctrl and _follow_ctrl.has_method("reset_position"):
		_follow_ctrl.call("reset_position", Vector2(follow_start_pos))

	# Enable follow mode and disable input pickable filters on the fairy
	_set_following(true)
	print("WindowController: Returned to follow mode — window 200×200.")


func _set_following(enabled: bool) -> void:
	if _follow_ctrl:
		_follow_ctrl.is_following = enabled
	if _fairy and _fairy.has_method("set"):
		_fairy.click_enabled = not enabled
