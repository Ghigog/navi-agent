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

# Keeps track of sub-pixel fractional positions before rounding to integer pixels
var _current_float_pos: Vector2


func _ready() -> void:
	# Initialize internal tracking coordinate with the initial window position
	_current_float_pos = Vector2(DisplayServer.window_get_position())


func _process(delta: float) -> void:
	if not is_following:
		return
		
	# Call coordinate retriever delegate
	var mouse_pos: Vector2i = get_mouse_position_func.call()
	var target_pos := Vector2(mouse_pos + follow_offset)
	
	# Smoothly interpolate floating coordinates to maintain sub-pixel movement stability
	_current_float_pos = _current_float_pos.lerp(target_pos, lerp_speed * delta)
	
	# Cast coordinates to rounded integers prior to updating the OS window manager
	DisplayServer.window_set_position(Vector2i(_current_float_pos.round()))


## Snaps the tracking system and the OS window position directly to a new coordinate [param pos].
func reset_position(pos: Vector2) -> void:
	_current_float_pos = pos
	DisplayServer.window_set_position(Vector2i(pos.round()))
