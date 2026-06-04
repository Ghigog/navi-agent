class_name FairyVisuals
extends Node2D
## Manages the visual rendering, animated wing flapping, custom coloring, and drag-and-drop interaction of the Navi fairy.

# Signals emitted for interaction states
## Emitted when the user right-clicks on the stationary fairy to open settings.
signal fairy_clicked
## Emitted during mouse dragging with the new screen-space coordinate.
signal fairy_dragged(new_pos: Vector2)
## Emitted when mouse dragging ends with the final screen-space coordinate.
signal fairy_drag_finished(new_pos: Vector2)


@export_group("Fairy Customization")
## The base color used to modulate the fairy's glow core, particles, and wings.
@export var base_color: Color = Color(0.4, 0.7, 1.0, 1.0) # Light blue default

@export_group("Wing Settings")
## The speed modifier for the sine-wave wing flap animation.
@export var flap_speed: float = 15.0
## Minimum horizontal scale for the wings during a flap cycle.
@export var min_wing_scale_x: float = 0.2
## Maximum horizontal scale for the wings during a flap cycle.
@export var max_wing_scale_x: float = 1.0

# Node references
@onready var glow_core: Sprite2D = $GlowCore
@onready var particles: CPUParticles2D = $Particles
@onready var left_wing: Polygon2D = $LeftWing
@onready var right_wing: Polygon2D = $RightWing
@onready var click_area: Area2D = $ClickArea
@onready var status_light: Sprite2D = $StatusLight

var _pulse_tween: Tween = null

## Controls whether mouse interactions (drag, right-click settings) are active.
## Clicks are disabled during follow-mouse mode to let clicks pass through to background apps.
var click_enabled: bool = false

var _is_dragging: bool = false
var _drag_offset: Vector2 = Vector2.ZERO
var _time_passed: float = 0.0
var _pointer_arrow: Line2D = null


func _ready() -> void:
	# Apply initial customization color
	set_fairy_color(base_color)
	
	# Set up Area2D input detection properties
	click_area.input_pickable = true
	click_area.input_event.connect(_on_click_area_input_event)

	# Programmatically create the pointer arrow Line2D
	_pointer_arrow = Line2D.new()
	_pointer_arrow.width = 4.0
	_pointer_arrow.default_color = Color(1.0, 0.75, 0.0, 0.9) # Glowing amber
	_pointer_arrow.begin_cap_mode = Line2D.LINE_CAP_ROUND
	_pointer_arrow.end_cap_mode = Line2D.LINE_CAP_ROUND
	_pointer_arrow.visible = false
	add_child(_pointer_arrow)


func _process(delta: float) -> void:
	_time_passed += delta * flap_speed

	# Map a standard sine wave [-1, 1] to a normalized flap factor [0, 1]
	var flap_factor: float = (sin(_time_passed) + 1.0) / 2.0
	var scale_x: float = lerp(min_wing_scale_x, max_wing_scale_x, flap_factor)

	# Update the horizontal scale of both wing nodes (Left wing is flipped via negative X)
	left_wing.scale.x = -scale_x
	right_wing.scale.x = scale_x


## Animates the pointer arrow fading in and pointing from the fairy body center (0,0)
## to the local target position [param local_target].
func show_pointer_arrow(local_target: Vector2) -> void:
	if not _pointer_arrow:
		return
	
	# Clear previous points
	_pointer_arrow.clear_points()
	
	# Compute direction vector and line endpoint (slightly before target to prevent overlap)
	var dir := local_target.normalized()
	var line_end := local_target - dir * 10.0
	_pointer_arrow.add_point(Vector2.ZERO)
	_pointer_arrow.add_point(line_end)
	
	# Retrieve or spawn arrowhead polygon
	var arrowhead: Polygon2D = _pointer_arrow.get_node_or_null("Arrowhead")
	if not arrowhead:
		arrowhead = Polygon2D.new()
		arrowhead.name = "Arrowhead"
		arrowhead.color = _pointer_arrow.default_color
		_pointer_arrow.add_child(arrowhead)
	
	# Draw arrowhead pointing in direction of 'dir'
	var arrow_length := 12.0
	var arrow_width := 6.0
	var p1 := local_target
	var p2 := local_target - dir * arrow_length + dir.rotated(PI / 2.0) * arrow_width
	var p3 := local_target - dir * arrow_length - dir.rotated(PI / 2.0) * arrow_width
	arrowhead.polygon = PackedVector2Array([p1, p2, p3])
	
	_pointer_arrow.visible = true
	_pointer_arrow.modulate.a = 0.0
	var tween := create_tween()
	tween.tween_property(_pointer_arrow, "modulate:a", 1.0, 0.2)


## Smoothly fades out and deactivates the pointer arrow visual.
func hide_pointer_arrow() -> void:
	if not _pointer_arrow or not _pointer_arrow.visible:
		return
	var tween := create_tween()
	tween.tween_property(_pointer_arrow, "modulate:a", 0.0, 0.15)
	await tween.finished
	_pointer_arrow.visible = false


## Updates the self_modulate property of the core sprite, wing polygons, and particle system.
func set_fairy_color(color: Color) -> void:
	base_color = color

	if is_inside_tree():
		glow_core.self_modulate = color
		particles.self_modulate = color
		left_wing.color = color
		right_wing.color = color


## Activates and configures the status notification dot above Navi.
func set_status_light(color: Color, pulsing: bool = false) -> void:
	if not is_inside_tree() or not status_light:
		return
		
	status_light.self_modulate = color
	status_light.visible = true
	
	if _pulse_tween:
		_pulse_tween.kill()
		_pulse_tween = null
		
	if pulsing:
		status_light.scale = Vector2(0.18, 0.18)
		status_light.modulate.a = 0.4
		
		_pulse_tween = create_tween().set_loops()
		_pulse_tween.set_parallel(true)
		_pulse_tween.tween_property(status_light, "scale", Vector2(0.3, 0.3), 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_pulse_tween.tween_property(status_light, "modulate:a", 1.0, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_pulse_tween.chain().set_parallel(true)
		_pulse_tween.tween_property(status_light, "scale", Vector2(0.18, 0.18), 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_pulse_tween.tween_property(status_light, "modulate:a", 0.4, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	else:
		status_light.scale = Vector2(0.25, 0.25)
		status_light.modulate.a = 1.0


## Deactivates the status notification dot above Navi.
func clear_status_light() -> void:
	if _pulse_tween:
		_pulse_tween.kill()
		_pulse_tween = null
		
	if status_light:
		status_light.visible = false


# Event handler connected to Area2D click zone input
func _on_click_area_input_event(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		
		# RIGHT CLICK: Always allowed to open settings
		if mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
			fairy_clicked.emit()
			return
			
		# LEFT CLICK: Only allowed for dragging if enabled
		if click_enabled and mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_is_dragging = true
				_drag_offset = global_position - get_global_mouse_position()


func _input(event: InputEvent) -> void:
	if _is_dragging:
		if event is InputEventMouseMotion:
			# Update position along with cursor and emit real-time dragging signal
			global_position = get_global_mouse_position() + _drag_offset
			fairy_dragged.emit(global_position)
		elif event is InputEventMouseButton:
			var mb := event as InputEventMouseButton
			if mb.button_index == MOUSE_BUTTON_LEFT and not mb.pressed:
				# Terminate drag action and emit finished signal to trigger screenshot
				_is_dragging = false
				fairy_drag_finished.emit(global_position)
