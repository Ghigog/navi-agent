class_name FollowController
extends Node
## Controls transparent window positioning by tracking the desktop mouse cursor.
## Uses floating-point interpolation to compute sub-pixel motion, eliminating integer round-off jitter.

## Toggles global mouse tracking behavior.
@export var is_following: bool = true
## Target layout offset of the window relative to the mouse cursor tip (prevents cursor-under-window click blocking).
@export var follow_offset: Vector2i = Vector2i(20, 20)
## Speed coefficient for linear interpolation (lerp) calculations.
@export var lerp_speed: float = 6.0

## Dependency injection endpoint for retrieving mouse coordinates (overridden in GUT tests).
var get_mouse_position_func: Callable = Callable(DisplayServer, "mouse_get_position")
## Dependency injection endpoint for retrieving mouse button click state (overridden in GUT tests).
var get_mouse_button_state_func: Callable = Callable(DisplayServer, "mouse_get_button_state")

# Keeps track of sub-pixel fractional positions before rounding to integer pixels
var _current_float_pos: Vector2

# Navigation state variables
var is_navigating: bool = false
var _navigation_target: Vector2 = Vector2.ZERO
var _actual_target_coord: Vector2 = Vector2.ZERO
var _sequence_queue: Array[Vector2] = []
var _waiting_for_click: bool = false
var _last_mouse_button_state: int = 0
var _active_tween: Tween = null


func _ready() -> void:
	# Initialize internal tracking coordinate with the initial window position
	_current_float_pos = Vector2(DisplayServer.window_get_position())


## Instantly resets the internal tracking position and updates the window's OS position.
func reset_position(new_pos: Vector2) -> void:
	_current_float_pos = new_pos
	DisplayServer.window_set_position(Vector2i(_current_float_pos.round()))



func _process(delta: float) -> void:
	if is_navigating:
		var main_node = get_parent()
		var is_fullscreen := false
		if main_node and "_active_panel" in main_node:
			is_fullscreen = main_node._active_panel != 0
			
		if is_fullscreen:
			var fairy = main_node.get_node_or_null("FairyVisuals") if main_node else null
			if fairy:
				if fairy.has_method("show_pointer_arrow"):
					var window_pos := Vector2(get_window().position)
					var local_target = (_actual_target_coord - window_pos) - fairy.position
					fairy.show_pointer_arrow(local_target)
				var chat_ui = main_node.get_node_or_null("ChatUI")
				if chat_ui and chat_ui.has_method("reposition_ui"):
					chat_ui.reposition_ui(fairy.position)
		else:
			# Smoothly slide the Godot window bounds to center around target coordinates
			_current_float_pos = _current_float_pos.lerp(_navigation_target, lerp_speed * delta)
			DisplayServer.window_set_position(Vector2i(_current_float_pos.round()))
		
		# Check for global clicks to advance chained coordinate steps
		if _waiting_for_click:
			var current_state = get_mouse_button_state_func.call()
			if (current_state & MOUSE_BUTTON_MASK_LEFT) != 0 and (_last_mouse_button_state & MOUSE_BUTTON_MASK_LEFT) == 0:
				# Click detected: pause slightly before advancing to let user finish action
				_waiting_for_click = false
				get_tree().create_timer(0.35).timeout.connect(_advance_sequence)
			_last_mouse_button_state = current_state
		return

	if not is_following:
		return
		
	var main_node = get_parent()
	var is_fullscreen := false
	if main_node and "_active_panel" in main_node:
		is_fullscreen = main_node._active_panel != 0
	if is_fullscreen:
		return
		
	# Call coordinate retriever delegate
	var mouse_pos: Vector2i = get_mouse_position_func.call()
	var target_pos := Vector2(mouse_pos + follow_offset)
	
	# Smoothly interpolate floating coordinates to maintain sub-pixel movement stability
	_current_float_pos = _current_float_pos.lerp(target_pos, lerp_speed * delta)
	
	# Cast coordinates to rounded integers prior to updating the OS window manager
	DisplayServer.window_set_position(Vector2i(_current_float_pos.round()))


## Navigates the window to center around a single global coordinate [param target_coord].
## Animates the fairy offset and draws a pointer arrow pointing to the center target.
func fly_to_screen_coordinate(target_coord: Vector2) -> void:
	is_following = false
	is_navigating = true
	_waiting_for_click = false
	_actual_target_coord = target_coord
	
	var main_node = get_parent()
	var is_fullscreen := false
	if main_node and "_active_panel" in main_node:
		is_fullscreen = main_node._active_panel != 0
		
	if _active_tween and _active_tween.is_valid():
		_active_tween.kill()
		
	if is_fullscreen:
		var window_pos := Vector2(get_window().position)
		var local_target_coord := target_coord - window_pos
		
		# In fullscreen mode, the target position for the fairy node should float adjacent to local_target_coord
		var offset := Vector2(-80, -80)
		var w_size := Vector2(get_window().size)
		
		if local_target_coord.x < w_size.x / 2.0:
			offset.x = 80
		else:
			offset.x = -80
			
		if local_target_coord.y < w_size.y / 2.0:
			offset.y = 80
		else:
			offset.y = -80
			
		_navigation_target = local_target_coord + offset
		
		# Create a tween for the fairy movement!
		if main_node and main_node.has_node("FairyVisuals"):
			var fairy = main_node.get_node("FairyVisuals")
			_active_tween = create_tween()
			if _active_tween:
				_active_tween.tween_property(fairy, "position", _navigation_target, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
			if fairy.has_method("show_pointer_arrow"):
				fairy.show_pointer_arrow(local_target_coord - fairy.position)
	else:
		# Center the window around the target
		_navigation_target = target_coord - Vector2(100, 100)
		
		# Offset the fairy visuals inside the window layout so she floats adjacent to the target
		if main_node and main_node.has_node("FairyVisuals"):
			var fairy = main_node.get_node("FairyVisuals")
			_active_tween = create_tween()
			if _active_tween:
				_active_tween.tween_property(fairy, "position", Vector2(40, 40), 0.45).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
			
			# Display the pointer arrow pointing to local target (100, 100)
			if fairy.has_method("show_pointer_arrow"):
				fairy.show_pointer_arrow(Vector2(100, 100))


## Navigates Navi sequentially along a list of global coordinates [param coords].
func navigate_sequence(coords: Array[Vector2]) -> void:
	_sequence_queue = coords.duplicate()
	_waiting_for_click = false
	_advance_sequence()


func _advance_sequence() -> void:
	if _sequence_queue.is_empty():
		# Sequence complete: reset to default follow
		abort_navigation()
		return
		
	var next_point = _sequence_queue.pop_front()
	fly_to_screen_coordinate(next_point)
	
	# Enable click detection loop
	_waiting_for_click = true
	_last_mouse_button_state = get_mouse_button_state_func.call()


## Aborts active sequences and optionally restores mouse-follow mode.
func abort_navigation(restore_follow: bool = true) -> void:
	is_navigating = false
	_waiting_for_click = false
	_sequence_queue.clear()
	
	if _active_tween and _active_tween.is_valid():
		_active_tween.kill()
	
	# Revert fairy body alignment and hide pointer arrow
	var main_node = get_parent()
	var is_fullscreen := false
	if main_node and "_active_panel" in main_node:
		is_fullscreen = main_node._active_panel != 0
		
	if main_node and main_node.has_node("FairyVisuals"):
		var fairy = main_node.get_node("FairyVisuals")
		if restore_follow and not is_fullscreen:
			var tween = create_tween()
			if tween:
				tween.tween_property(fairy, "position", Vector2(100, 100), 0.3).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
		if fairy.has_method("hide_pointer_arrow"):
			fairy.hide_pointer_arrow()
			
	# Yield a frame to let visual tweens settle before follow kicks back in
	if restore_follow and not is_fullscreen:
		await get_tree().process_frame
		is_following = true

