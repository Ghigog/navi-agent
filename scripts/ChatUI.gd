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
var _is_start_of_paragraph: bool = true

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
	
	# Bind event listeners
	input_edit.text_submitted.connect(_on_prompt_submitted)
	send_button.pressed.connect(func(): _on_prompt_submitted(input_edit.text))

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


## Opens the chat panel with a scale-in/fade-in animation, populating screenshot context.
func open_chat(screenshot: Image = null, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO) -> void:
	_current_screenshot = screenshot
	_fairy_pos = fairy_pos
	_window_size = window_size
	
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
	response_label.text = "[color=#66b2ff]Hello! How can I help you?[/color]"
	
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


## Closes the chat interface with a scale-out/fade-out animation.
func close_chat() -> void:
	# Hide handle immediately so it doesn't linger during fade
	if _resize_handle:
		_resize_handle.visible = false
	var tween := create_tween().set_parallel(true)
	tween.tween_property(self, "modulate:a", 0.0, 0.15)
	tween.tween_property(input_panel, "scale", Vector2(0.9, 0.9), 0.15)
	tween.tween_property(response_panel, "scale", Vector2(0.9, 0.9), 0.15)
	
	await tween.finished
	visible = false
	_current_screenshot = null


# Triggered when prompt input is submitted (via Enter or click)
func _on_prompt_submitted(text: String) -> void:
	var prompt := text.strip_edges()
	if prompt == "" or not input_edit.editable:
		return
		
	# Trigger LLM dispatch via AIService Autoload
	if _ai_service:
		input_edit.editable = false
		_ai_service.send_prompt(prompt, _current_screenshot, _fairy_pos, _window_size)


# Callback triggered when AIService starts processing
func _on_ai_request_started() -> void:
	response_label.text = "[color=#888888]Thinking...[/color]"
	_is_start_of_paragraph = true


# Callback triggered when response is returned
func _on_ai_response_received(response_text: String) -> void:
	input_edit.editable = true
	input_edit.text = ""
	if response_text != "":
		if response_label.text == "[color=#888888]Thinking...[/color]" or response_label.text == "":
			response_label.text = response_text
		else:
			if not response_label.text.ends_with(response_text):
				if _is_start_of_paragraph:
					response_label.text += "\n\n" + response_text
				else:
					response_label.text += response_text
	input_edit.grab_focus.call_deferred()


# Callback triggered when thinking model has intermediate thought updates
func _on_ai_thinking_update(update_text: String) -> void:
	# Avoid duplicate appends if we're showing similar progress/loading text
	if response_label.text == "[color=#888888]Thinking...[/color]" or response_label.text == "":
		response_label.text = update_text
	else:
		# If it's a new unique update, replace/show it cleanly
		if not response_label.text.contains(update_text):
			response_label.text = update_text
	_is_start_of_paragraph = true


# Callback triggered when a streaming chunk of response is received
func _on_ai_response_chunk(chunk: String) -> void:
	if response_label.text == "[color=#888888]Thinking...[/color]" or response_label.text == "":
		response_label.text = chunk
		_is_start_of_paragraph = false
	else:
		if _is_start_of_paragraph:
			response_label.text += "\n\n" + chunk
			_is_start_of_paragraph = false
		else:
			response_label.text += chunk


# Callback triggered when request errors out
func _on_ai_request_failed(error_message: String) -> void:
	input_edit.editable = true
	if response_label.text == "[color=#888888]Thinking...[/color]" or response_label.text == "":
		response_label.text = "[color=#ff6666]Error: " + error_message + "[/color]"
	else:
		response_label.text += "\n\n[color=#ff6666]Error: " + error_message + "[/color]"
	input_edit.grab_focus.call_deferred()


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
