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
## Tween used for smooth emotion-driven body colour transitions.
var _emotion_tween: Tween = null
## Last emotion key, used to avoid duplicate emoji spawns on unchanged emotion.
var _last_emotion: String = ""

## Preloaded emoji notification scene (NAV-64).
const _EMOJI_NOTIF_SCENE := preload("res://scenes/EmojiNotification.tscn")

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

	# Connect EmotionEngine signal if the engine is present
	if has_node("/root/AIService"):
		var ai_service := get_node("/root/AIService")
		if ai_service.has_signal("_emotion_engine"):
			pass # connection made via AIService reference below
		# Connect via the engine child node if accessible
		if "_emotion_engine" in ai_service and ai_service._emotion_engine != null:
			var engine: Node = ai_service._emotion_engine
			if not engine.emotion_updated.is_connected(_on_emotion_updated):
				engine.emotion_updated.connect(_on_emotion_updated)

	# Apply saved emotion colour immediately on startup when Live Navi Mode is ON (NAV-65)
	# Deferred so SettingsManager and EmotionState autoloads have fully initialised.
	call_deferred("_apply_startup_emotion_color")


func _process(delta: float) -> void:
	_time_passed += delta * flap_speed

	# Map a standard sine wave [-1, 1] to a normalized flap factor [0, 1]
	var flap_factor: float = (sin(_time_passed) + 1.0) / 2.0
	var scale_x: float = lerp(min_wing_scale_x, max_wing_scale_x, flap_factor)

	# Update the horizontal scale of both wing nodes (Left wing is flipped via negative X)
	left_wing.scale.x = -scale_x
	right_wing.scale.x = scale_x


## Called once via call_deferred at startup.
## If Live Navi Mode is enabled and EmotionState has saved data, immediately applies
## the correct emotion colour so the fairy never boots blue when it should be green/red.
func _apply_startup_emotion_color() -> void:
	if not has_node("/root/SettingsManager"):
		return
	var sm := get_node("/root/SettingsManager")
	if not sm.get_setting("live_navi_mode", false):
		return
	if not Engine.has_singleton("EmotionState"):
		return
	var es: Node = Engine.get_singleton("EmotionState")
	print("FairyVisuals: 🌅 Startup — applying saved emotion colour (live mode on). State: ", es.debug_string())
	apply_emotion_color(es.courage, es.wisdom, es.power, es.love_score)


## Animates the pointer arrow fading in and pointing from the fairy body center (0,0)
## to the local target position [param local_target].
func show_pointer_arrow(local_target: Vector2) -> void:
	if not _pointer_arrow:
		return
	_pointer_arrow.visible = false


## Smoothly fades out and deactivates the pointer arrow visual.
func hide_pointer_arrow() -> void:
	if not _pointer_arrow:
		return
	_pointer_arrow.visible = false


## Updates the self_modulate property of the core sprite, wing polygons, and particle system.
func set_fairy_color(color: Color) -> void:
	base_color = color

	if is_inside_tree():
		glow_core.self_modulate = color
		particles.self_modulate = color
		left_wing.color = color
		right_wing.color = color


## Activates and configures the status notification dot in the center of Navi's body.
func set_status_light(color: Color, pulsing: bool = false) -> void:
	if not is_inside_tree() or not status_light:
		return
		
	status_light.self_modulate = color
	status_light.visible = true
	
	if _pulse_tween:
		_pulse_tween.kill()
		_pulse_tween = null
		
	if pulsing:
		status_light.scale = Vector2(0.4, 0.4)
		status_light.modulate.a = 0.4
		
		_pulse_tween = create_tween().set_loops()
		_pulse_tween.set_parallel(true)
		_pulse_tween.tween_property(status_light, "scale", Vector2(0.6, 0.6), 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_pulse_tween.tween_property(status_light, "modulate:a", 1.0, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_pulse_tween.chain().set_parallel(true)
		_pulse_tween.tween_property(status_light, "scale", Vector2(0.4, 0.4), 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_pulse_tween.tween_property(status_light, "modulate:a", 0.4, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	else:
		status_light.scale = Vector2(0.5, 0.5)
		status_light.modulate.a = 1.0


## Deactivates the status notification dot in the center of Navi's body.
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


# ---------------------------------------------------------------------------
# Emotion Visual System (NAV-63)
# ---------------------------------------------------------------------------

## Applies a tricolor body tint derived from the three base emotion dimensions
## and scales brightness from the Love Meter.
##
## [b]Color model[/b] (see emotions.md §9.1):[br]
## - Red channel   → Power score[br]
## - Green channel → Courage score[br]
## - Blue channel  → Wisdom score[br]
## - Brightness    → Love Meter (dark at -1000, bright at +1000)[br]
##
## All transitions are tweened over 0.8 s with EASE_IN_OUT.
func apply_emotion_color(courage: float, wisdom: float, power: float, love_score: int) -> void:
	if not is_inside_tree():
		return

	var brightness := clampf((love_score + 1000.0) / 2000.0, 0.0, 1.0)
	var r := clampf((power   + 10.0) / 20.0, 0.0, 1.0) * brightness
	var g := clampf((courage + 10.0) / 20.0, 0.0, 1.0) * brightness
	var b := clampf((wisdom  + 10.0) / 20.0, 0.0, 1.0) * brightness
	var target_color := Color(r, g, b, 1.0)

	print("FairyVisuals: 🎨 Color update:")
	print("FairyVisuals:   C=%.1f W=%.1f P=%.1f  love=%d  brightness=%.2f" % [
		courage, wisdom, power, love_score, brightness])
	print("FairyVisuals:   RGB target → (R=%.2f  G=%.2f  B=%.2f)  hex=%s" % [
		r, g, b, target_color.to_html(false)])

	if _emotion_tween:
		_emotion_tween.kill()
	_emotion_tween = create_tween().set_parallel(true)
	_emotion_tween.set_ease(Tween.EASE_IN_OUT)
	_emotion_tween.set_trans(Tween.TRANS_SINE)
	_emotion_tween.tween_method(_apply_color_frame, base_color, target_color, 0.8)


## Per-frame callback used by the emotion colour tween.
func _apply_color_frame(color: Color) -> void:
	if not is_inside_tree():
		return
	glow_core.self_modulate  = color
	particles.self_modulate  = color
	left_wing.color          = color
	right_wing.color         = color
	# Update base_color so set_fairy_color() keeps the new tint as baseline
	base_color               = color


## Signal handler for EmotionEngine.emotion_updated.
## Only applies visuals when Live Navi Mode is active.
func _on_emotion_updated(emotion: String, love_score: int, courage: float, wisdom: float, power: float) -> void:
	var live_mode := false
	if has_node("/root/SettingsManager"):
		live_mode = get_node("/root/SettingsManager").get_setting("live_navi_mode", false)
	if not live_mode:
		return
	apply_emotion_color(courage, wisdom, power, love_score)
	spawn_emoji_notification(emotion)


## Reverts the fairy body colour to the user-saved hex in SettingsManager.
## Called when Live Navi Mode is toggled OFF.
func restore_user_color() -> void:
	if not has_node("/root/SettingsManager"):
		return
	var hex: String = get_node("/root/SettingsManager").get_setting("fairy_color", "66b2ff")
	var color := Color.html(hex)
	print("FairyVisuals: 🔄 Restoring user colour: #", hex)
	set_fairy_color(color)
	_last_emotion = ""  # Reset dedup so next live-mode activation can spawn again


# ---------------------------------------------------------------------------
# Emoji Notification System (NAV-64)
# ---------------------------------------------------------------------------

## Spawns a transient emoji notification above the fairy body when the
## Tier 2 emotion has changed since the last response.
## Does nothing if the emotion key is identical to the previous turn.
func spawn_emoji_notification(emotion: String) -> void:
	if not is_inside_tree():
		return
	if emotion == _last_emotion:
		print("FairyVisuals: 🚫 Emoji suppressed — emotion unchanged ('%s')" % emotion)
		return
	_last_emotion = emotion

	var notif: Node2D = _EMOJI_NOTIF_SCENE.instantiate()
	# Add to scene root so it is not parented to the fairy (stays put as fairy moves)
	get_tree().root.add_child(notif)

	# Spawn 40px above the fairy's current world position
	var spawn_pos := global_position + Vector2(0, -40)
	print("FairyVisuals: ✨ Spawning emoji for '%s' at %s" % [emotion, str(spawn_pos)])
	notif.play(emotion, spawn_pos)
