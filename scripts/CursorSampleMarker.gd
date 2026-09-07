class_name CursorSampleMarker
extends Node2D
## Brief visual confirmation of the screen point Navi sampled for a cursor-anchored crop
## (NAV-99). Draws a fading amber ring centered on this node's position, then frees itself.

var _alpha: float = 1.0
const _RADIUS := 18.0
const _FADE_DURATION := 0.6

func _ready() -> void:
	var t := create_tween()
	t.tween_method(_set_alpha, 1.0, 0.0, _FADE_DURATION)
	t.tween_callback(queue_free)

func _set_alpha(a: float) -> void:
	_alpha = a
	queue_redraw()

func _draw() -> void:
	draw_arc(Vector2.ZERO, _RADIUS, 0.0, TAU, 32, Color(1.0, 0.75, 0.0, _alpha), 3.0)
