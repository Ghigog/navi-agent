extends Control
## Controls the translucent glassmorphic chat interface, including prompt inputs and streaming responses.
## Automatically repositions itself relative to the fairy's coordinate, switching screen sides when close to screen boundaries.

# UI Node References
@onready var input_panel: PanelContainer = $InputPanel
@onready var response_panel: PanelContainer = $ResponsePanel
@onready var input_edit: LineEdit = $InputPanel/InputBar/InputEdit
@onready var response_label: RichTextLabel = $ResponsePanel/ResponseLabel
@onready var preview_texture: TextureRect = $ResponsePanel/PreviewTexture
@onready var send_button: Button = $InputPanel/InputBar/SendButton
@onready var pointer: Polygon2D = $ResponsePanel/Pointer
@onready var _resize_handle: Control = $ResizeHandle

# Local Context Variables
var _current_screenshot: Image = null
var _fairy_pos: Vector2 = Vector2.ZERO
var _window_size: Vector2 = Vector2.ZERO
var _ai_service: Node
var _settings_mgr: Node
var _is_start_of_paragraph: bool = true
var _response_active: bool = false
var _visual_history: String = ""
var _current_response_text: String = ""
# Accumulated thought steps for the current turn (committed permanently on response end)
var _thought_trail: Array = []

var _voice_button: Button = null
var _mute_button: Button = null

# Interactive guide/step-by-step state
var _interactive_steps: Array[Dictionary] = []
var _current_step_idx: int = 0
var _is_interactive_mode: bool = false

# Resize handle drag state
var _is_resizing: bool = false
var _resize_start_mouse: Vector2 = Vector2.ZERO
var _resize_start_size: Vector2 = Vector2.ZERO
var _resize_start_panel_pos: Vector2 = Vector2.ZERO
const _RESIZE_MIN_W: float = 250.0
const _RESIZE_MIN_H: float = 80.0
const _RESIZE_HANDLE_SIZE: float = 20.0


func _ready() -> void:
	# Hide panel initially
	visible = false
	
	# Fetch reference to SettingsManager Autoload if present in the scene tree
	if has_node("/root/SettingsManager"):
		_settings_mgr = get_node("/root/SettingsManager")

	# Bind event listeners
	input_edit.text_submitted.connect(_on_prompt_submitted)
	send_button.pressed.connect(func(): _on_prompt_submitted(input_edit.text))
	input_edit.text_changed.connect(func(_new_text): _update_send_button_ui())

	# Bind resize handle drag
	if _resize_handle:
		_resize_handle.gui_input.connect(_on_resize_handle_input)
	
	# Bind to global AIService signals
	if has_node("/root/AIService"):
		_ai_service = get_node("/root/AIService")
		_ai_service.request_started.connect(_on_ai_request_started)
		_ai_service.response_received.connect(_on_ai_response_received)
		_ai_service.request_failed.connect(_on_ai_request_failed)
		if _ai_service.has_signal("thinking_update"):
			_ai_service.thinking_update.connect(_on_ai_thinking_update)
		if _ai_service.has_signal("response_chunk"):
			_ai_service.response_chunk.connect(_on_ai_response_chunk)
			
	# Enable auto-scrolling to bottom on new text content
	if response_label:
		response_label.scroll_following = true

	# Programmatically spawn and add Voice and Mute buttons to the InputBar HBoxContainer
	var input_bar = get_node_or_null("InputPanel/InputBar")
	if input_bar:
		_voice_button = Button.new()
		_voice_button.name = "VoiceButton"
		_voice_button.text = "🎙️"
		_voice_button.tooltip_text = "Toggle to record audio (STT)"
		_voice_button.toggle_mode = true
		_voice_button.toggled.connect(_on_voice_toggled)
		input_bar.add_child(_voice_button)
		
		_mute_button = Button.new()
		_mute_button.name = "MuteButton"
		_mute_button.text = "🔊"
		_mute_button.tooltip_text = "Mute/Unmute response reader (TTS)"
		_mute_button.pressed.connect(_on_mute_pressed)
		input_bar.add_child(_mute_button)


## Opens the chat panel with a scale-in/fade-in animation, populating screenshot context.
func open_chat(screenshot: Image = null, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO) -> void:
	_current_screenshot = screenshot
	_fairy_pos = fairy_pos
	_window_size = window_size
	
	# Update audio buttons visibility and mute icons based on active configurations
	_update_voice_buttons_visibility()
	_update_mute_button_ui()
	
	# Display preview texture of screenshot if available
	if screenshot and screenshot.get_width() > 0:
		preview_texture.texture = ImageTexture.create_from_image(screenshot)
	else:
		preview_texture.texture = null
	# Keep the preview texture hidden in visual layouts (used purely for reference/GUT verification)
	preview_texture.visible = false
		
	# Initialize text fields
	input_edit.text = ""
	input_edit.editable = true
	_visual_history = "[color=#66b2ff]Hello! How can I help you?[/color]"
	_current_response_text = ""
	_thought_trail = []
	response_label.text = _visual_history
	
	# Setup initial tween states
	visible = true
	modulate.a = 0.0
	input_panel.scale = Vector2(0.9, 0.9)
	response_panel.scale = Vector2(0.9, 0.9)
	input_panel.pivot_offset = input_panel.size / 2.0
	response_panel.pivot_offset = response_panel.size / 2.0
	
	# Animate panels into view using TRANS_BACK and EASE_OUT for a modern feel
	var tween := create_tween().set_parallel(true)
	tween.tween_property(self, "modulate:a", 1.0, 0.2)
	tween.tween_property(input_panel, "scale", Vector2(1.0, 1.0), 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.tween_property(response_panel, "scale", Vector2(1.0, 1.0), 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	
	# Show and position the resize handle after layout has settled
	if _resize_handle:
		_resize_handle.visible = true
		_position_resize_handle()
	
	# Grab text editor focus deferredly to ensure input fields are ready
	input_edit.grab_focus.call_deferred()


func close_chat() -> void:
	if _is_interactive_mode:
		print("ChatUI: [MOVEMENT] closing/preempting guidance sequence.")
		_is_interactive_mode = false
		_interactive_steps.clear()
		_update_send_button_ui()
		var main_node = get_parent()
		var follow_ctrl = main_node.get_node_or_null("FollowController") if main_node else null
		if follow_ctrl:
			follow_ctrl.call("abort_navigation", true)
		var fairy = main_node.get_node_or_null("FairyVisuals") if main_node else null
		if fairy and fairy.has_method("clear_status_light"):
			fairy.clear_status_light()

	# Hide handle immediately so it doesn't linger during fade
	if _resize_handle:
		_resize_handle.visible = false
	
	# Stop vocalization when chat ends
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").stop()

	if _voice_button and _voice_button.button_pressed:
		_voice_button.set_pressed_no_signal(false)
		_voice_button.text = "🎙️"
		input_edit.editable = true
		if has_node("/root/STTService"):
			var _discard = get_node("/root/STTService").stop_recording()

	var tween := create_tween().set_parallel(true)
	tween.tween_property(self, "modulate:a", 0.0, 0.15)
	tween.tween_property(input_panel, "scale", Vector2(0.9, 0.9), 0.15)
	tween.tween_property(response_panel, "scale", Vector2(0.9, 0.9), 0.15)
	
	await tween.finished
	visible = false
	_current_screenshot = null


# Triggered when prompt input is submitted (via Enter or click)
func _on_prompt_submitted(text: String) -> void:
	if not input_edit.editable:
		return
		
	var prompt := text.strip_edges()
	
	if _is_interactive_mode and prompt == "":
		_current_step_idx += 1
		input_edit.text = ""
		_update_send_button_ui()
		_execute_current_interactive_step()
		return
		
	if _is_interactive_mode:
		print("ChatUI: [MOVEMENT] closing/preempting guidance sequence.")
		_is_interactive_mode = false
		_interactive_steps.clear()
		_update_send_button_ui()
		
	var main_node = get_parent()
	var follow_ctrl = main_node.get_node_or_null("FollowController") if main_node else null
	if follow_ctrl:
		follow_ctrl.call("abort_navigation", false)
	var fairy = main_node.get_node_or_null("FairyVisuals") if main_node else null
	if fairy and fairy.has_method("clear_status_light"):
		fairy.clear_status_light()

	if prompt == "":
		return
		
	# Halt vocalization when a new prompt is sent
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").stop()

	# Append the user's prompt to the visual history thread
	if _visual_history == "":
		_visual_history = "[color=#e0e0e0]> " + prompt + "[/color]"
	else:
		_visual_history += "\n\n[color=#e0e0e0]> " + prompt + "[/color]"
		
	_current_response_text = ""
	response_label.text = _visual_history + "\n\n[color=#888888]Thinking...[/color]"
	
	# Trigger LLM dispatch via AIService Autoload
	if _ai_service:
		input_edit.editable = false
		_ai_service.send_prompt(prompt, _current_screenshot, _fairy_pos, _window_size)


# Callback triggered when AIService starts processing
func _on_ai_request_started() -> void:
	_thought_trail = []
	_current_response_text = ""
	_is_start_of_paragraph = true
	_response_active = false
	_render_display()
	
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").start_speech_stream()


# Callback triggered when response is returned
func _on_ai_response_received(response_text: String) -> void:
	input_edit.editable = true
	input_edit.text = ""

	var final_reply := _current_response_text
	if response_text != "":
		final_reply = response_text

	var think_regex := RegEx.new()
	think_regex.compile("(?s)<think>.*?</think>")
	var clean_reply := think_regex.sub(final_reply, "", true)

	_interactive_steps = _parse_interactive_steps(clean_reply)

	if _interactive_steps.size() > 1:
		_is_interactive_mode = true
		_current_step_idx = 0
		
		if _thought_trail.size() > 0:
			var trail_text := ""
			for i in _thought_trail.size():
				if i > 0:
					trail_text += "\n"
				trail_text += _thought_trail[i]
			if _visual_history == "":
				_visual_history = trail_text
			else:
				_visual_history += "\n\n" + trail_text
				
		_thought_trail = []
		_current_response_text = ""
		
		if has_node("/root/TTSService"):
			get_node("/root/TTSService").end_speech_stream()
			
		_execute_current_interactive_step()
	else:
		_is_interactive_mode = false
		_interactive_steps.clear()
		_update_send_button_ui()
		
		var committed := ""
		if _thought_trail.size() > 0:
			var trail_text := ""
			for i in _thought_trail.size():
				if i > 0:
					trail_text += "\n"
				trail_text += _thought_trail[i]
			committed = trail_text
			if final_reply != "":
				committed += "\n\n" + _strip_skill_and_pause_tags(final_reply)
		else:
			committed = _strip_skill_and_pause_tags(final_reply)

		if committed != "":
			if _visual_history == "":
				_visual_history = committed
			else:
				_visual_history += "\n\n" + committed

		_thought_trail = []
		_current_response_text = ""
		response_label.text = _visual_history

		if has_node("/root/TTSService"):
			get_node("/root/TTSService").end_speech_stream()

		input_edit.grab_focus.call_deferred()


# Callback triggered when thinking model has intermediate thought updates
func _on_ai_thinking_update(update_text: String) -> void:
	if update_text.strip_edges() == "":
		return
	# Ignore late thinking updates if we are not actively awaiting a response,
	# or if the response streaming has already started.
	if input_edit.editable or _response_active:
		return
	_thought_trail.append(update_text)
	_render_display()


# Callback triggered when a streaming chunk of response is received
func _on_ai_response_chunk(chunk: String) -> void:
	_response_active = true
	_current_response_text += chunk
	_render_display()
	
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").add_speech_chunk(chunk)


# Callback triggered when request errors out
func _on_ai_request_failed(error_message: String) -> void:
	input_edit.editable = true
	_response_active = false
	_thought_trail = []
	_current_response_text = ""
	if _visual_history == "":
		response_label.text = "[color=#ff6666]Error: " + error_message + "[/color]"
	else:
		response_label.text = _visual_history + "\n\n[color=#ff6666]Error: " + error_message + "[/color]"
	input_edit.grab_focus.call_deferred()


## Rebuilds the response label from the current visual history, live thought trail,
## and any in-progress streaming response. This is the single source of truth for display.
func _render_display() -> void:
	var text := _visual_history

	# Append thought trail — each step on its own line, faded italic with a 💭 prefix
	if _thought_trail.size() > 0:
		if text != "":
			text += "\n\n"
		for i in _thought_trail.size():
			if i > 0:
				text += "\n"
			text += _thought_trail[i]

	# Append streaming response below the trail
	if _current_response_text != "":
		if text != "":
			text += "\n\n"
		text += _current_response_text

	# Show placeholder only when the turn has just started (no trail, no response yet)
	if _thought_trail.is_empty() and _current_response_text == "":
		if text != "":
			text += "\n\n"
		text += "[color=#888888]Thinking...[/color]"

	response_label.text = text


## Manually updates the cached screenshot image context.
func set_screenshot(screenshot: Image) -> void:
	_current_screenshot = screenshot
	if screenshot and screenshot.get_width() > 0:
		preview_texture.texture = ImageTexture.create_from_image(screenshot)
	else:
		preview_texture.texture = null


## Dynamically repositions input and response panels, placing them adjacent to the fairy.
## Performs edge checks and switches layout sides if the fairy is too close to screen edges.
func reposition_ui(fairy_pos: Vector2) -> void:
	var screen_rect := DisplayServer.screen_get_usable_rect(
		DisplayServer.window_get_current_screen()
	)
	
	# Defaults for sizing if DisplayServer is headless or returns zero dimensions
	var screen_width := 1920.0
	var screen_height := 1080.0
	if screen_rect.size.x > 0:
		screen_width = float(screen_rect.size.x)
	if screen_rect.size.y > 0:
		screen_height = float(screen_rect.size.y)
	
	# Determine whether to place panels on the left or right of the fairy.
	# If the fairy is close to the right edge (less than 350px of space), flip to the left side.
	var right_space := screen_width - fairy_pos.x
	var use_left_side := right_space < 350.0
	
	var resp_size := response_panel.size
	if resp_size.x <= 0:
		resp_size = response_panel.custom_minimum_size
	var input_size := input_panel.size
	if input_size.x <= 0:
		input_size = input_panel.custom_minimum_size
		
	var target_resp_pos := Vector2.ZERO
	var target_input_pos := Vector2.ZERO
	
	if use_left_side:
		# Place on the left side of the fairy
		target_resp_pos.x = fairy_pos.x - resp_size.x - 30.0
		target_input_pos.x = fairy_pos.x - input_size.x - 30.0
		
		# Draw the indicator pointer triangle pointing to the right (toward the fairy)
		pointer.position = Vector2(resp_size.x, resp_size.y - 10.0)
		pointer.polygon = PackedVector2Array([
			Vector2(0, -10),
			Vector2(30, 20),
			Vector2(-15, -15)
		])
	else:
		# Place on the right side of the fairy
		target_resp_pos.x = fairy_pos.x + 30.0
		target_input_pos.x = fairy_pos.x + 30.0
		
		# Draw the indicator pointer triangle pointing to the left (toward the fairy)
		pointer.position = Vector2(0, resp_size.y - 10.0)
		pointer.polygon = PackedVector2Array([
			Vector2(0, -10),
			Vector2(-30, 20),
			Vector2(15, -15)
		])
		
	# Vertical placement: Response bubble floats above fairy center, prompt bar sits below it.
	target_resp_pos.y = fairy_pos.y - resp_size.y - 10.0
	target_input_pos.y = fairy_pos.y + 10.0
	
	# Clamp positions inside window margins to prevent rendering offscreen
	var margin := 10.0
	target_resp_pos.x = clamp(target_resp_pos.x, margin, screen_width - resp_size.x - margin)
	target_resp_pos.y = clamp(target_resp_pos.y, margin, screen_height - resp_size.y - margin)
	
	target_input_pos.x = clamp(target_input_pos.x, margin, screen_width - input_size.x - margin)
	target_input_pos.y = clamp(target_input_pos.y, margin, screen_height - input_size.y - margin)

	# Apply new positions to the control panel objects
	response_panel.position = target_resp_pos
	input_panel.position = target_input_pos

	# Keep the resize handle pinned to the top-right corner of the response panel
	_position_resize_handle()


## Utility helper to verify if a given screen coordinate lies within either the input panel or the response panel.
## Used to dismiss the UI when the user clicks outside.
func is_position_inside_ui(local_pos: Vector2) -> bool:
	if not visible:
		return false
	# Treat any active resize drag as "inside" to prevent accidental dismissal
	if _is_resizing:
		return true
	var in_input := input_panel.get_rect().has_point(local_pos)
	var in_response := response_panel.get_rect().has_point(local_pos)
	return in_input or in_response


## Pins the resize handle to the top-right corner of the response panel.
func _position_resize_handle() -> void:
	if not _resize_handle:
		return
	var resp_size: Vector2 = response_panel.size
	if resp_size.x <= 0:
		resp_size = response_panel.custom_minimum_size
	_resize_handle.size = Vector2(_RESIZE_HANDLE_SIZE, _RESIZE_HANDLE_SIZE)
	_resize_handle.position = response_panel.position + Vector2(resp_size.x - _RESIZE_HANDLE_SIZE, 0.0)


## Handles drag-to-resize interactions on the top-right corner handle of the response panel.
## Dragging right increases width; dragging up increases height (bottom edge stays anchored).
func _on_resize_handle_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_is_resizing = true
				_resize_start_mouse = get_global_mouse_position()
				_resize_start_size = response_panel.size
				if _resize_start_size.x <= 0:
					_resize_start_size = response_panel.custom_minimum_size
				_resize_start_panel_pos = response_panel.position
			else:
				_is_resizing = false
	elif event is InputEventMouseMotion and _is_resizing:
		var delta: Vector2 = get_global_mouse_position() - _resize_start_mouse
		# Right drag → wider; up drag (negative delta.y) → taller, bottom edge stays fixed
		var new_w: float = maxf(_RESIZE_MIN_W, _resize_start_size.x + delta.x)
		var new_h: float = maxf(_RESIZE_MIN_H, _resize_start_size.y - delta.y)
		# Adjust top-left Y so the bottom edge of the panel remains in place
		var new_y: float = _resize_start_panel_pos.y + (_resize_start_size.y - new_h)
		response_panel.custom_minimum_size = Vector2(new_w, new_h)
		response_panel.size = Vector2(new_w, new_h)
		response_panel.position = Vector2(_resize_start_panel_pos.x, new_y)
		# Repin the handle to follow the new top-right corner
		_position_resize_handle()


func _on_voice_toggled(toggled_on: bool) -> void:
	if not _settings_mgr or not _settings_mgr.get_setting("enable_stt", true):
		return

	if toggled_on:
		# Stop active speech playback when user starts talking
		if has_node("/root/TTSService"):
			get_node("/root/TTSService").stop()

		_voice_button.text = "🔴"
		input_edit.editable = false
		if has_node("/root/STTService"):
			get_node("/root/STTService").start_recording()
	else:
		_voice_button.text = "🎙️"
		if has_node("/root/STTService"):
			var recording = get_node("/root/STTService").stop_recording()
			if recording:
				_voice_button.disabled = true
				_voice_button.text = "⏳"
				var text = await get_node("/root/STTService").transcribe_audio(recording)
				_voice_button.disabled = false
				_voice_button.text = "🎙️"
				input_edit.editable = true
				if text != "":
					_on_prompt_submitted(text)
			else:
				input_edit.editable = true


func _on_mute_pressed() -> void:
	if not _settings_mgr:
		return
	var is_muted = _settings_mgr.get_setting("tts_mute", false)
	_settings_mgr.set_setting("tts_mute", not is_muted)
	_update_mute_button_ui()


func _update_mute_button_ui() -> void:
	if not _mute_button or not _settings_mgr:
		return
	var is_muted = _settings_mgr.get_setting("tts_mute", false)
	var enable_tts = _settings_mgr.get_setting("enable_tts", true)
	if not enable_tts:
		_mute_button.text = "🔇"
		_mute_button.disabled = true
	else:
		_mute_button.disabled = false
		_mute_button.text = "🔇" if is_muted else "🔊"


func _update_voice_buttons_visibility() -> void:
	if not _settings_mgr:
		return
	if _voice_button:
		_voice_button.visible = _settings_mgr.get_setting("enable_stt", true)
	if _mute_button:
		_mute_button.visible = _settings_mgr.get_setting("enable_tts", true)


func _parse_interactive_steps(text: String) -> Array[Dictionary]:
	var steps: Array[Dictionary] = []
	
	var regex := RegEx.new()
	regex.compile("\\[PAUSE\\]|\\[SKILL:\\s*point_to:\\s*(.*?)\\]")
	
	var matches := regex.search_all(text)
	
	var last_idx := 0
	var current_point: Variant = null
	
	for m in matches:
		var start := m.get_start()
		var segment := text.substr(last_idx, start - last_idx).strip_edges()
		
		if segment != "" or steps.is_empty():
			steps.append({
				"text": segment,
				"point": current_point
			})
		
		var matched_str := m.get_string(0)
		if matched_str.begins_with("[SKILL:"):
			var args := m.get_string(1).strip_edges()
			var coords := args.split(",")
			if coords.size() >= 2:
				current_point = Vector2(float(coords[0].strip_edges()), float(coords[1].strip_edges()))
			else:
				current_point = null
		else:
			current_point = null
			
		last_idx = m.get_end()
		
	var final_segment := text.substr(last_idx).strip_edges()
	if final_segment != "" or steps.is_empty():
		steps.append({
			"text": final_segment,
			"point": current_point
		})
		
	return steps


func _update_send_button_ui() -> void:
	if _is_interactive_mode and input_edit.text.strip_edges() == "":
		send_button.text = "Next"
	else:
		send_button.text = "Send"


func _execute_current_interactive_step() -> void:
	var step = _interactive_steps[_current_step_idx]
	var text: String = _strip_skill_and_pause_tags(step["text"])
	var point = step["point"]
	
	if point == null:
		if _current_step_idx == 0 and _interactive_steps.size() > 1:
			if _visual_history == "":
				_visual_history = text
			else:
				_visual_history += "\n\n" + text
			_current_step_idx = 1
			_execute_current_interactive_step()
			return
			
	if _current_step_idx == 0:
		if _visual_history == "":
			_visual_history = text
		else:
			_visual_history += "\n\n" + text
	else:
		_visual_history += "\n\n" + text
		
	response_label.text = _visual_history
	
	var main_node = get_parent()
	var fairy = main_node.get_node_or_null("FairyVisuals") if main_node else null
	var follow_ctrl = main_node.get_node_or_null("FollowController") if main_node else null
	
	if point != null:
		print("ChatUI: [MOVEMENT] Moving to step coordinate: ", point)
		if fairy and fairy.has_method("set_status_light"):
			fairy.set_status_light(Color(0.2, 0.8, 0.2, 1.0), true) # Pulsing Green
		if follow_ctrl:
			follow_ctrl.call("fly_to_screen_coordinate", point)
	else:
		print("ChatUI: [MOVEMENT] Step has no coordinate; maintaining position.")
		if fairy and fairy.has_method("clear_status_light"):
			fairy.clear_status_light()
		if follow_ctrl:
			follow_ctrl.call("abort_navigation", false)
			
	if _current_step_idx < _interactive_steps.size() - 1:
		input_edit.editable = true
		input_edit.placeholder_text = "Press Enter or click Next to continue..."
		_update_send_button_ui()
	else:
		_is_interactive_mode = false
		_interactive_steps.clear()
		_update_send_button_ui()
		input_edit.editable = true
		input_edit.placeholder_text = "Ask Navi..."
		
		if point == null:
			if follow_ctrl:
				follow_ctrl.call("abort_navigation", true)
			if fairy and fairy.has_method("clear_status_light"):
				fairy.clear_status_light()
		
		input_edit.grab_focus.call_deferred()


func _strip_skill_and_pause_tags(input_text: String) -> String:
	var think_regex := RegEx.new()
	think_regex.compile("(?s)<think>.*?</think>")
	var no_think := think_regex.sub(input_text, "", true)
	
	var tag_regex := RegEx.new()
	tag_regex.compile("\\[PAUSE\\]|\\[(SKILL|SCREEN_CONTEXT|TOOL):[^\\]]*\\]")
	var cleaned := tag_regex.sub(no_think, "", true)
	return cleaned.strip_edges()
