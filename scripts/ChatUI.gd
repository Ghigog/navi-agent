extends Control
## Controls the translucent glassmorphic chat interface, including prompt inputs and streaming responses.
## Automatically repositions itself relative to the fairy's coordinate, switching screen sides when close to screen boundaries.

# UI Node References
@onready var main_panel: PanelContainer = $MainPanel
@onready var input_panel: PanelContainer = $MainPanel
@onready var response_panel: PanelContainer = $MainPanel
@onready var input_edit: LineEdit = $MainPanel/VBox/InputBar/InputEdit
@onready var response_label: RichTextLabel = $MainPanel/VBox/ResponseLabel
@onready var preview_texture: TextureRect = $MainPanel/PreviewTexture
@onready var send_button: Button = $MainPanel/VBox/InputBar/SendButton
@onready var pointer: Polygon2D = $MainPanel/Pointer
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
var _is_transcribing: bool = false
var _initial_input_text: String = ""
var _live_transcribe_active: bool = false
var _has_spoken_in_chunk: bool = false
var _silence_duration: float = 0.0
var _voice_session_text: String = ""
var _space_held := false
var _hotkey_press_start_time := 0.0
var _abort_recording := false
var _navi_was_open_on_press := false

# Predictive auto-trigger typing state
var _predictive_token: int = 0

# Interactive guide/step-by-step state
var _is_interactive_mode: bool = false
var _disable_stream_tts: bool = false
var _use_step_playback: bool = false
var _stream_is_running: bool = false
var _guidance_controller: Node
var _is_greeting_mode: bool = false
var _greeting_tween: Tween = null

# Resize handle drag state
var _is_resizing: bool = false
var _resize_start_mouse: Vector2 = Vector2.ZERO
var _resize_start_size: Vector2 = Vector2.ZERO
var _resize_start_panel_pos: Vector2 = Vector2.ZERO
const _RESIZE_MIN_W: float = 320.0
const _RESIZE_MIN_H: float = 140.0
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
	input_edit.text_changed.connect(_on_input_text_changed)
	
	# Hide the Send Button from the visual layout
	send_button.visible = false

	if main_panel:
		main_panel.gui_input.connect(_on_main_panel_gui_input)

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
		if _ai_service.has_signal("response_cleared"):
			_ai_service.response_cleared.connect(_on_ai_response_cleared)
		if _ai_service.has_signal("skill_confirmation_requested"):
			_ai_service.skill_confirmation_requested.connect(_on_skill_confirmation_requested)
			
	# Enable auto-scrolling to bottom on new text content
	if response_label:
		response_label.scroll_following = true

	# Programmatically spawn and add Voice button to the InputBar HBoxContainer
	var input_bar = get_node_or_null("MainPanel/VBox/InputBar")
	if input_bar:
		_voice_button = Button.new()
		_voice_button.name = "VoiceButton"
		_voice_button.text = "🎙️"
		_voice_button.tooltip_text = "Toggle to record audio (STT)"
		_voice_button.toggle_mode = true
		_voice_button.toggled.connect(_on_voice_toggled)
		_voice_button.visible = false # Always invisible/hidden!
		input_bar.add_child(_voice_button)

	# Initialize GuidanceController
	var GC_script := load("res://scripts/GuidanceController.gd")
	_guidance_controller = GC_script.new()
	_guidance_controller.name = "GuidanceController"
	add_child(_guidance_controller)
	_guidance_controller.guidance_started.connect(_on_guidance_started)
	_guidance_controller.step_started.connect(_on_guidance_step_started)
	_guidance_controller.guidance_finished.connect(_on_guidance_finished)


## Opens the chat panel with a scale-in/fade-in animation, populating screenshot context.
func open_chat(screenshot: Image = null, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO) -> void:
	_current_screenshot = screenshot
	_fairy_pos = fairy_pos
	_window_size = window_size
	
	# Update audio buttons visibility based on active configurations
	_update_voice_buttons_visibility()
	
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
	response_label.text = NaviUtils.markdown_to_bbcode(_visual_history)
	
	# Setup initial tween states
	visible = true
	modulate.a = 0.0
	main_panel.scale = Vector2(0.9, 0.9)
	main_panel.pivot_offset = main_panel.size / 2.0
	
	# Animate panels into view using TRANS_BACK and EASE_OUT for a modern feel
	var tween := create_tween().set_parallel(true)
	tween.tween_property(self, "modulate:a", 1.0, 0.2)
	tween.tween_property(main_panel, "scale", Vector2(1.0, 1.0), 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	
	# Show and position the resize handle after layout has settled
	if _resize_handle:
		_resize_handle.visible = true
		_position_resize_handle()
	
	# Grab text editor focus deferredly to ensure input fields are ready
	input_edit.grab_focus.call_deferred()

	# Automatically trigger STT recording if enabled by default (NAV-57)
	# DEPRECATED: With voice detection deprecated, we do not auto-trigger recording on open.
	# if _settings_mgr and _settings_mgr.get_setting("enable_stt", true) and _voice_button:
	# 	if not _settings_mgr.get_setting("enable_push_to_talk", true):
	# 		_voice_button.button_pressed = true


func close_chat() -> void:
	_is_greeting_mode = false
	if _greeting_tween:
		_greeting_tween.kill()
		_greeting_tween = null
	
	var input_bar = get_node_or_null("MainPanel/VBox/InputBar")
	if input_bar:
		input_bar.visible = true

	if _is_interactive_mode:
		print("ChatUI: [MOVEMENT] closing/preempting guidance sequence.")
		_guidance_controller.abort_guidance(true)

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
		var fairy := _get_fairy()
		if fairy and fairy.has_method("clear_status_light"):
			fairy.clear_status_light()
		if has_node("/root/STTService"):
			var _discard = get_node("/root/STTService").stop_recording()

	var tween := create_tween().set_parallel(true)
	tween.tween_property(self, "modulate:a", 0.0, 0.15)
	tween.tween_property(main_panel, "scale", Vector2(0.9, 0.9), 0.15)
	
	await tween.finished
	visible = false
	_current_screenshot = null


## Opens the chat panel in greeting/notification mode.
func open_chat_greeting(text: String, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO) -> void:
	_fairy_pos = fairy_pos
	_window_size = window_size
	_is_greeting_mode = true
	
	# Hide input bar container and resize handle
	var input_bar = get_node_or_null("MainPanel/VBox/InputBar")
	if input_bar:
		input_bar.visible = false
	if _resize_handle:
		_resize_handle.visible = false
		
	# Show greeting text in ResponseLabel
	input_edit.text = ""
	_visual_history = text
	_current_response_text = ""
	_thought_trail = []
	response_label.text = NaviUtils.markdown_to_bbcode(_visual_history)
	
	# Setup initial tween states
	visible = true
	modulate.a = 0.0
	main_panel.scale = Vector2(0.9, 0.9)
	main_panel.pivot_offset = main_panel.size / 2.0
	
	# Animate panels into view
	var tween := create_tween().set_parallel(true)
	tween.tween_property(self, "modulate:a", 1.0, 0.2)
	tween.tween_property(main_panel, "scale", Vector2(1.0, 1.0), 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	
	# Reposition UI near the fairy
	if has_method("reposition_ui"):
		call("reposition_ui", fairy_pos)
		
	# Cancel any active greeting timer
	if _greeting_tween:
		_greeting_tween.kill()
		
	# Start a 5-second timer to auto-dismiss the greeting
	_greeting_tween = create_tween()
	_greeting_tween.tween_interval(5.0)
	_greeting_tween.tween_callback(func():
		_is_greeting_mode = false
		var main_loop = Engine.get_main_loop() as SceneTree
		if main_loop:
			# Resets to follow mode
			for child in main_loop.root.get_children():
				if child.name == "Main" or child.has_method("capture_clean_screenshot"):
					child.call("_reset_to_follow_mode")
	)


func _transition_from_greeting_to_interactive() -> void:
	if not _is_greeting_mode:
		return
	
	_is_greeting_mode = false
	
	if _greeting_tween:
		_greeting_tween.kill()
		_greeting_tween = null
		
	# Restore input bar container
	var input_bar = get_node_or_null("MainPanel/VBox/InputBar")
	if input_bar:
		input_bar.visible = true
		_update_voice_buttons_visibility()
		
	# Restore resize handle
	if _resize_handle:
		_resize_handle.visible = true
		_position_resize_handle()
		
	# Clear ResponseLabel with default greeting/instructions or just make it interactive
	_visual_history = "[color=#66b2ff]Hello! How can I help you?[/color]"
	response_label.text = NaviUtils.markdown_to_bbcode(_visual_history)
	
	# Focus the LineEdit so the user can start typing immediately
	input_edit.grab_focus.call_deferred()
	
	# Move the Godot window to foreground so it intercepts typing
	DisplayServer.window_move_to_foreground()


func _on_main_panel_gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		if _is_greeting_mode:
			accept_event()
			_transition_from_greeting_to_interactive()


# Triggered when prompt input is submitted (via Enter or click)
func _on_prompt_submitted(text: String) -> void:
	if not input_edit.editable:
		return

	var was_recording := false
	# If currently recording, stop STT and wait for transcription first
	if _voice_button and _voice_button.button_pressed:
		was_recording = true
		_voice_button.button_pressed = false
		while _is_transcribing:
			await get_tree().process_frame
		text = input_edit.text
		
	var prompt := text.strip_edges()
	
	if _is_interactive_mode and prompt == "":
		input_edit.text = ""
		_guidance_controller.advance_step()
		return
		
	if _is_interactive_mode:
		print("ChatUI: [MOVEMENT] closing/preempting guidance sequence.")
		_guidance_controller.abort_guidance(false)

	if prompt == "":
		if not was_recording and _settings_mgr and _settings_mgr.get_setting("enable_stt", true) and _voice_button:
			_voice_button.button_pressed = true
		return
		
	# Preemptively disable stream TTS if prompt is classified as visual or complex
	_disable_stream_tts = false
	# Preemptive disabling of stream TTS is commented out to allow simultaneous streaming by default.
	# It will dynamically transition if/when a step/pause tag is encountered in the stream chunks.
	# if _ai_service and _ai_service.has_method("_classify_prompt"):
	# 	var classification: Dictionary = _ai_service.call("_classify_prompt", prompt)
	# 	if not classification.is_empty():
	# 		_disable_stream_tts = true
			
	# Halt vocalization when a new prompt is sent
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").stop()

	# Append the user's prompt to the visual history thread
	if _visual_history == "":
		_visual_history = "[color=#e0e0e0]> " + prompt + "[/color]"
	else:
		_visual_history += "\n\n[color=#e0e0e0]> " + prompt + "[/color]"
		
	_current_response_text = ""
	response_label.text = NaviUtils.markdown_to_bbcode(_visual_history + "\n\n[color=#888888]Thinking...[/color]")
	
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
	_stream_is_running = true
	
	if _guidance_controller.has_method("reset"):
		_guidance_controller.reset()
	else:
		_guidance_controller.is_active = false
		_guidance_controller.stream_is_running = true
		_guidance_controller.steps.clear()
		_guidance_controller.current_step_idx = 0
		_guidance_controller._unprocessed_stream_idx = 0
		_guidance_controller._current_point = null
	
	_use_step_playback = _disable_stream_tts
	_render_display()


# Callback triggered when response is returned
func _on_ai_response_received(response_text: String) -> void:
	input_edit.editable = true
	input_edit.text = ""
	_stream_is_running = false

	var final_reply := _current_response_text
	if response_text != "":
		final_reply = response_text

	if _use_step_playback:
		_guidance_controller.finish_stream(final_reply)
	else:
		_is_interactive_mode = false
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
				committed += "\n\n" + NaviUtils.strip_skill_and_pause_tags(final_reply)
		else:
			committed = NaviUtils.strip_skill_and_pause_tags(final_reply)

		if committed != "":
			if _visual_history == "":
				_visual_history = committed
			else:
				_visual_history += "\n\n" + committed

		_thought_trail = []
		_current_response_text = ""
		response_label.text = NaviUtils.markdown_to_bbcode(_visual_history)

		if has_node("/root/TTSService"):
			get_node("/root/TTSService").end_speech_stream()

		input_edit.grab_focus.call_deferred()

		# Automatically trigger STT recording if enabled by default (deferred until speaking finishes)
		_resume_stt_recording_when_done_speaking()


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
	var is_first_chunk := not _response_active
	_response_active = true
	_current_response_text += chunk
	
	if is_first_chunk and not _use_step_playback and not _disable_stream_tts:
		if has_node("/root/TTSService"):
			get_node("/root/TTSService").start_speech_stream()
			
	# if is_first_chunk:
		# Enable recording/VAD monitoring during playback to support voice interruption
		# DEPRECATED: Voice detection is deprecated.
		# if _settings_mgr and _settings_mgr.get_setting("enable_stt", true) and _voice_button:
		# 	_voice_button.button_pressed = true
	
	if _use_step_playback:
		_guidance_controller.parse_and_append_new_steps(_current_response_text)
	else:
		if not _disable_stream_tts:
			var has_step_tag := _current_response_text.contains("[PAUSE]") or _current_response_text.contains("[SKILL: point_to:") or _current_response_text.contains("[ESCALATE]")
			if has_step_tag:
				_disable_stream_tts = true
				if has_node("/root/TTSService"):
					get_node("/root/TTSService").stop()
				
				# Transition dynamically to step playback and initialize/feed GuidanceController
				_use_step_playback = true
				if _guidance_controller:
					if _guidance_controller.has_method("reset"):
						_guidance_controller.reset()
					else:
						_guidance_controller.is_active = false
						_guidance_controller.stream_is_running = true
						_guidance_controller.steps.clear()
						_guidance_controller.current_step_idx = 0
						_guidance_controller._unprocessed_stream_idx = 0
						_guidance_controller._current_point = null
					_guidance_controller.parse_and_append_new_steps(_current_response_text)
			else:
				if has_node("/root/TTSService"):
					get_node("/root/TTSService").add_speech_chunk(chunk)
	_render_display()


func _on_ai_response_cleared() -> void:
	_current_response_text = ""
	_response_active = false
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").stop()
	_render_display()


# Callback triggered when request errors out
func _on_ai_request_failed(error_message: String) -> void:
	input_edit.editable = true
	_response_active = false
	_stream_is_running = false
	_guidance_controller.abort_guidance(false)
	_thought_trail = []
	_current_response_text = ""
	if _visual_history == "":
		response_label.text = NaviUtils.markdown_to_bbcode("[color=#ff6666]Error: " + error_message + "[/color]")
	else:
		response_label.text = NaviUtils.markdown_to_bbcode(_visual_history + "\n\n[color=#ff6666]Error: " + error_message + "[/color]")
	input_edit.grab_focus.call_deferred()

	# Automatically trigger STT recording if enabled by default (deferred until speaking finishes)
	_resume_stt_recording_when_done_speaking()


func _on_skill_confirmation_requested(skill_name: String, description: String) -> void:
	var card_scene = load("res://scenes/SkillConfirmationCard.tscn")
	if not card_scene:
		if _ai_service and _ai_service.has_method("respond_to_confirmation"):
			_ai_service.call("respond_to_confirmation", true)
		return
		
	var card = card_scene.instantiate()
	var vbox = get_node_or_null("MainPanel/VBox")
	if vbox:
		# Add card below response label, before input bar if possible, or just append
		vbox.add_child(card)
		card.setup(description)
		card.confirmed.connect(func(approved: bool):
			vbox.remove_child(card)
			card.queue_free()
			if _ai_service and _ai_service.has_method("respond_to_confirmation"):
				_ai_service.call("respond_to_confirmation", approved)
		)



func _on_guidance_started() -> void:
	_is_interactive_mode = true
	input_edit.placeholder_text = "Navi is presenting..."
	input_edit.editable = false
	_update_send_button_ui()


func _on_guidance_step_started(text: String, point: Variant, current_idx: int, total_steps: int) -> void:
	if current_idx == 0:
		if _visual_history == "":
			_visual_history = text
		else:
			_visual_history += "\n\n" + text
	else:
		_visual_history += "\n\n" + text
		
	response_label.text = NaviUtils.markdown_to_bbcode(_visual_history)
	_update_send_button_ui()


func _on_guidance_finished(_restore_follow: bool) -> void:
	_is_interactive_mode = false
	input_edit.placeholder_text = "Ask Navi..."
	input_edit.editable = true
	_update_send_button_ui()
	input_edit.grab_focus.call_deferred()

	# Automatically trigger STT recording if enabled by default (deferred until speaking finishes)
	_resume_stt_recording_when_done_speaking()


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
		if _use_step_playback:
			if _guidance_controller.has_method("get_display_active_text"):
				text += _guidance_controller.get_display_active_text()
		else:
			text += NaviUtils.strip_skill_and_pause_tags(_current_response_text)

	# Show placeholder only when the turn has just started (no trail, no response yet)
	if _thought_trail.is_empty() and _current_response_text == "":
		if text != "":
			text += "\n\n"
		text += "[color=#888888]Thinking...[/color]"

	response_label.text = NaviUtils.markdown_to_bbcode(text)


## Manually updates the cached screenshot image context.
func set_screenshot(screenshot: Image) -> void:
	_current_screenshot = screenshot
	if screenshot and screenshot.get_width() > 0:
		preview_texture.texture = ImageTexture.create_from_image(screenshot)
	else:
		preview_texture.texture = null


## Dynamically repositions the consolidated main panel, placing it adjacent to the fairy.
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
	
	# Determine whether to place panel on the left or right of the fairy.
	# If the fairy is close to the right edge (less than 350px of space), flip to the left side.
	var right_space := screen_width - fairy_pos.x
	var use_left_side := right_space < 350.0
	
	var panel_size := main_panel.size
	if panel_size.x <= 0:
		panel_size = main_panel.custom_minimum_size
		
	var target_pos := Vector2.ZERO
	
	if use_left_side:
		# Place on the left side of the fairy
		target_pos.x = fairy_pos.x - panel_size.x - 30.0
		
		# Draw the indicator pointer triangle pointing to the right (toward the fairy)
		pointer.position = Vector2(panel_size.x, panel_size.y / 2.0)
		pointer.polygon = PackedVector2Array([
			Vector2(0, -10),
			Vector2(30, 0),
			Vector2(0, 10)
		])
	else:
		# Place on the right side of the fairy
		target_pos.x = fairy_pos.x + 30.0
		
		# Draw the indicator pointer triangle pointing to the left (toward the fairy)
		pointer.position = Vector2(0, panel_size.y / 2.0)
		pointer.polygon = PackedVector2Array([
			Vector2(0, -10),
			Vector2(-30, 0),
			Vector2(0, 10)
		])
		
	# Center vertically on the fairy center
	target_pos.y = fairy_pos.y - (panel_size.y / 2.0)
	
	# Clamp positions inside window margins to prevent rendering offscreen
	var margin := 10.0
	target_pos.x = clamp(target_pos.x, margin, screen_width - panel_size.x - margin)
	target_pos.y = clamp(target_pos.y, margin, screen_height - panel_size.y - margin)

	# Apply new positions to the control panel object
	main_panel.position = target_pos

	# Keep the resize handle pinned to the top-right corner of the main panel
	_position_resize_handle()


## Utility helper to verify if a given screen coordinate lies within the main panel.
## Used to dismiss the UI when the user clicks outside.
func is_position_inside_ui(local_pos: Vector2) -> bool:
	if not visible:
		return false
	# Treat any active resize drag as "inside" to prevent accidental dismissal
	if _is_resizing:
		return true
	return main_panel.get_rect().has_point(local_pos)


## Pins the resize handle to the top-right corner of the main panel.
func _position_resize_handle() -> void:
	if not _resize_handle:
		return
	var panel_size: Vector2 = main_panel.size
	if panel_size.x <= 0:
		panel_size = main_panel.custom_minimum_size
	_resize_handle.size = Vector2(_RESIZE_HANDLE_SIZE, _RESIZE_HANDLE_SIZE)
	_resize_handle.position = main_panel.position + Vector2(panel_size.x - _RESIZE_HANDLE_SIZE, 0.0)


## Handles drag-to-resize interactions on the top-right corner handle of the main panel.
## Dragging right increases width; dragging up increases height (bottom edge stays anchored).
func _on_resize_handle_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_is_resizing = true
				_resize_start_mouse = get_global_mouse_position()
				_resize_start_size = main_panel.size
				if _resize_start_size.x <= 0:
					_resize_start_size = main_panel.custom_minimum_size
				_resize_start_panel_pos = main_panel.position
			else:
				_is_resizing = false
	elif event is InputEventMouseMotion and _is_resizing:
		var delta: Vector2 = get_global_mouse_position() - _resize_start_mouse
		# Right drag → wider; up drag (negative delta.y) → taller, bottom edge stays fixed
		var new_w: float = maxf(_RESIZE_MIN_W, _resize_start_size.x + delta.x)
		var new_h: float = maxf(_RESIZE_MIN_H, _resize_start_size.y - delta.y)
		# Adjust top-left Y so the bottom edge of the panel remains in place
		var new_y: float = _resize_start_panel_pos.y + (_resize_start_size.y - new_h)
		main_panel.custom_minimum_size = Vector2(new_w, new_h)
		main_panel.size = Vector2(new_w, new_h)
		main_panel.position = Vector2(_resize_start_panel_pos.x, new_y)
		# Repin the handle to follow the new top-right corner
		_position_resize_handle()


func _input(event: InputEvent) -> void:
	if not visible:
		return
		
	var hotkey_mac_code = 126
	if _settings_mgr:
		hotkey_mac_code = _settings_mgr.get_setting("hotkey_keycode", 126)
	var godot_keycode = KEY_UP
	for k in SettingsUI.GODOT_TO_MACOS_KEYCODES.keys():
		if SettingsUI.GODOT_TO_MACOS_KEYCODES[k] == hotkey_mac_code:
			godot_keycode = k
			break
			
	if event is InputEventKey and event.keycode == godot_keycode:
		if event.pressed and not event.echo:
			if _is_greeting_mode:
				get_viewport().set_input_as_handled()
				_transition_from_greeting_to_interactive()
				return
				
	if not _settings_mgr or not _settings_mgr.get_setting("enable_stt", true) or not _settings_mgr.get_setting("enable_push_to_talk", true):
		return
		
	if event is InputEventKey and event.keycode == godot_keycode:
		if event.pressed and not event.echo:
			if not _space_held and input_edit.editable:
				get_viewport().set_input_as_handled()
				handle_hotkey_down(true)
		elif not event.pressed:
			if _space_held:
				get_viewport().set_input_as_handled()
				handle_hotkey_up()


func handle_hotkey_down(was_open: bool) -> void:
	if not _settings_mgr or not _settings_mgr.get_setting("enable_stt", true) or not _settings_mgr.get_setting("enable_push_to_talk", true):
		return
		
	_navi_was_open_on_press = was_open
	_hotkey_press_start_time = Time.get_ticks_msec() / 1000.0
	_abort_recording = false
	_space_held = true
	
	if _voice_button:
		_voice_button.button_pressed = true


func handle_hotkey_up() -> void:
	if not _space_held:
		return
		
	_space_held = false
	var duration = (Time.get_ticks_msec() / 1000.0) - _hotkey_press_start_time
	if duration < 0.4:
		# Tap detected: cancel recording and stay open for typing
		_abort_recording = true
		if _voice_button and _voice_button.button_pressed:
			_voice_button.button_pressed = false
		
		# If Navi was already open before the tap, refocus text box
		if _navi_was_open_on_press:
			DisplayServer.window_move_to_foreground()
			input_edit.grab_focus.call_deferred()
	else:
		# Hold detected: stop recording and send immediately
		_abort_recording = false
		if _voice_button and _voice_button.button_pressed:
			_voice_button.button_pressed = false
			await get_tree().process_frame
			while _is_transcribing:
				await get_tree().process_frame
			_on_prompt_submitted(input_edit.text)


func _on_voice_toggled(toggled_on: bool) -> void:
	if not _settings_mgr or not _settings_mgr.get_setting("enable_stt", true):
		return

	var fairy := _get_fairy()

	if toggled_on:
		# Stop active speech playback when user starts talking (unless programmatically enabled during stream setup)
		if not _stream_is_running and has_node("/root/TTSService"):
			get_node("/root/TTSService").stop()

		_voice_button.text = "🔴"
		input_edit.editable = true
		_initial_input_text = input_edit.text
		_voice_session_text = ""
		if fairy and fairy.has_method("set_status_light"):
			fairy.set_status_light(Color(1.0, 0.0, 0.0, 1.0), true) # Pulsing Red indicator
		if has_node("/root/STTService"):
			get_node("/root/STTService").start_recording()
			# DEPRECATED: VAD voice detection is deprecated and commented out.
			# if not _settings_mgr.get_setting("enable_push_to_talk", true):
			# 	_start_vad_monitoring()
			pass
	else:
		_live_transcribe_active = false
		_voice_button.text = "🎙️"
		if fairy and fairy.has_method("clear_status_light"):
			fairy.clear_status_light()
		if has_node("/root/STTService"):
			var recording: AudioStreamWAV = get_node("/root/STTService").stop_recording()
			if recording:
				if _abort_recording:
					input_edit.editable = true
					return
					
				_voice_button.disabled = true
				_voice_button.text = "⏳"
				# Wait for any active chunk transcription to finish
				while _is_transcribing:
					await get_tree().process_frame
				
				# Run final transcription for the last chunk
				_is_transcribing = true
				var text: String = await get_node("/root/STTService").transcribe_audio(recording)
				_is_transcribing = false
				_voice_button.disabled = false
				_voice_button.text = "🎙️"
				input_edit.editable = true
				
				if text != "":
					if _voice_session_text == "":
						_voice_session_text = text
					else:
						_voice_session_text = _voice_session_text + " " + text
						
				if _voice_session_text != "":
					if _initial_input_text == "":
						input_edit.text = _voice_session_text
					else:
						input_edit.text = _initial_input_text + " " + _voice_session_text
					input_edit.text_changed.emit(input_edit.text)
			else:
				input_edit.editable = true


## DEPRECATED: Voice Activity Detection (VAD) / continuous voice detection logic.
## This has been commented out to enforce Push-to-Talk (Shift + Up) as the sole voice interaction model.
## To re-enable in a future iteration:
## 1. Un-comment the VAD monitoring loop below.
## 2. Restore the push-to-talk toggle in the settings UI.
## 3. Wire the toggles back to conditional checks in ChatUI and WindowController.
func _start_vad_monitoring() -> void:
	# if not has_node("/root/STTService"):
	# 	return
	# var stt = get_node("/root/STTService")
	# var bus_idx := AudioServer.get_bus_index("Record")
	# print("[VAD] Monitoring Started. Bus index: ", bus_idx)
	# if bus_idx == -1:
	# 	return
	# 	
	# _live_transcribe_active = true
	# _has_spoken_in_chunk = false
	# _silence_duration = 0.0
	# 
	# var check_interval := 0.1
	# while _live_transcribe_active and _voice_button and _voice_button.button_pressed:
	# 	await get_tree().create_timer(check_interval).timeout
	# 	if not _live_transcribe_active or not _voice_button or not _voice_button.button_pressed:
	# 		break
	# 		
	# 	# Measure current input volume level
	# 	var volume := AudioServer.get_bus_peak_volume_left_db(bus_idx, 0)
	# 	print("[VAD] volume: ", volume, " silence: ", _silence_duration, " spoken: ", _has_spoken_in_chunk)
	# 	
	# 	# Adaptive threshold: raise threshold if agent is vocalizing to filter out speaker bleed
	# 	var is_tts_speaking := false
	# 	if has_node("/root/TTSService"):
	# 		is_tts_speaking = get_node("/root/TTSService").is_speaking()
	# 		
	# 	var threshold := -35.0
	# 	if is_tts_speaking:
	# 		threshold = -22.0
	# 		
	# 	if volume > threshold:
	# 		_has_spoken_in_chunk = true
	# 		_silence_duration = 0.0
	# 		
	# 		if is_tts_speaking:
	# 			print("[VAD] User speech detected above barge-in threshold (", volume, " > ", threshold, "). Interrupting agent!")
	# 			get_node("/root/TTSService").stop()
	# 	else:
	# 		if _has_spoken_in_chunk:
	# 			_silence_duration += check_interval
	# 			
	# 	# If silence duration exceeds 0.8s, we process the current chunk
	# 	if _has_spoken_in_chunk and _silence_duration >= 0.8:
	# 		print("[VAD] Silence detected! Transcribing chunk...")
	# 		# If we are already running a transcription, skip this turn
	# 		if _is_transcribing:
	# 			continue
	# 			
	# 		# Stop the current recording and get the stream
	# 		var recording = stt.stop_recording()
	# 		# Restart the recording immediately so we don't miss the next spoken phrase
	# 		stt.start_recording()
	# 		
	# 		_silence_duration = 0.0
	# 		_has_spoken_in_chunk = false
	# 		
	# 		if recording:
	# 			_is_transcribing = true
	# 			var text: String = await stt.transcribe_audio(recording)
	# 			_is_transcribing = false
	# 			print("[VAD] Chunk transcription: ", text)
	# 			
	# 			# Ensure user hasn't cancelled/stopped STT while transcription was running
	# 			if _live_transcribe_active and _voice_button and _voice_button.button_pressed:
	# 				if text != "":
	# 					if _voice_session_text == "":
	# 						_voice_session_text = text
	# 					else:
	# 						_voice_session_text = _voice_session_text + " " + text
	# 					
	# 					# Combine the initial typed text (if any) with the running STT session transcript
	# 					if _initial_input_text == "":
	# 						input_edit.text = _voice_session_text
	# 					else:
	# 						input_edit.text = _initial_input_text + " " + _voice_session_text
	# 					input_edit.text_changed.emit(input_edit.text)
	pass


func _update_voice_buttons_visibility() -> void:
	if not _settings_mgr:
		return
	if _voice_button:
		_voice_button.visible = false # Always hidden in the UI


func _update_send_button_ui() -> void:
	if _is_interactive_mode and input_edit.text.strip_edges() == "":
		send_button.text = "Next"
	else:
		send_button.text = "Send"


# Helper to retrieve the fairy node reference from the active SceneTree root.
func _get_fairy() -> Node:
	for child in get_tree().root.get_children():
		if child.name == "Main" or child.has_method("capture_clean_screenshot"):
			if "_fairy" in child:
				return child._fairy
	return null


## DEPRECATED: Resuming recording automatically after Navi finishes speaking is deprecated.
func _resume_stt_recording_when_done_speaking() -> void:
	# if not _settings_mgr or not _settings_mgr.get_setting("enable_stt", true) or not _voice_button:
	# 	return
	# if _settings_mgr.get_setting("enable_push_to_talk", true):
	# 	return
	# 	
	# # Wait if TTSService is currently vocalizing
	# if has_node("/root/TTSService"):
	# 	var tts = get_node("/root/TTSService")
	# 	while tts.is_speaking():
	# 		await get_tree().create_timer(0.2).timeout
	# 		
	# # Double check that the user hasn't closed the chat or submitted a new prompt while waiting
	# if visible and input_edit.editable and not _stream_is_running:
	# 	_voice_button.button_pressed = true
	pass


## Updates the chat window styling based on the active fairy base color.
func update_theme_colors(base_color: Color) -> void:
	if not main_panel:
		return
	var stylebox: StyleBoxFlat = main_panel.get_theme_stylebox("panel")
	if stylebox:
		var new_stylebox := stylebox.duplicate() as StyleBoxFlat
		new_stylebox.bg_color = Color(base_color.r, base_color.g, base_color.b, 0.85)
		new_stylebox.border_color = base_color.darkened(0.4)
		new_stylebox.border_color.a = 1.0 # Opaque accent color border
		main_panel.add_theme_stylebox_override("panel", new_stylebox)
	if pointer:
		pointer.color = Color(base_color.r, base_color.g, base_color.b, 0.85)


func _on_input_text_changed(new_text: String) -> void:
	_update_send_button_ui()
	
	if _settings_mgr and not _settings_mgr.get_setting("enable_predictive_trigger", false):
		return
		
	_predictive_token += 1
	var token := _predictive_token
	
	var text_trimmed := new_text.strip_edges()
	if text_trimmed == "":
		return
		
	# Check if the text ends with punctuation (e.g. "?", ".", "!")
	var last_char := text_trimmed[-1]
	if last_char in ["?", ".", "!"]:
		print("ChatUI: [AUTO-TRIGGER] Punctuation detected. Starting 1.2s debounced trigger...")
		# Wait 1.2 seconds of typing inactivity
		var timer = get_tree().create_timer(1.2)
		await timer.timeout
		if _predictive_token == token and input_edit.text.strip_edges() == text_trimmed:
			print("ChatUI: [AUTO-TRIGGER] Inactivity period reached. Auto-submitting prompt.")
			_on_prompt_submitted(input_edit.text)
