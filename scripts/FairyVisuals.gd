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

## Controls whether mouse interactions (drag, right-click settings) are active.
## Clicks are disabled during follow-mouse mode to let clicks pass through to background apps.
var click_enabled: bool = false

var _is_dragging: bool = false
var _drag_offset: Vector2 = Vector2.ZERO
var _time_passed: float = 0.0


func _ready() -> void:
	# Apply initial customization color
	# set_fairy_color(base_color)
	
	# Set up Area2D input detection properties
	click_area.input_pickable = true
	click_area.input_event.connect(_on_click_area_input_event)


func _process(delta: float) -> void:
	_time_passed += delta * flap_speed

	# Map a standard sine wave [-1, 1] to a normalized flap factor [0, 1]
	var flap_factor: float = (sin(_time_passed) + 1.0) / 2.0
	var scale_x: float = lerp(min_wing_scale_x, max_wing_scale_x, flap_factor)

	# Update the horizontal scale of both wing nodes (Left wing is flipped via negative X)
	left_wing.scale.x = -scale_x
	right_wing.scale.x = scale_x


## Updates the self_modulate property of the core sprite, wing polygons, and particle system.
func set_fairy_color(color: Color) -> void:
	base_color = color

	if is_inside_tree():
		glow_core.self_modulate = color
		particles.self_modulate = color
		left_wing.color = color
		right_wing.color = color


# Event handler connected to Area2D click zone input
func _on_click_area_input_event(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	print("Fairy received input: ", event)
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
