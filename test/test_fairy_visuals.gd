extends GutTest
## Test suite for checking FairyVisuals wing flapping and color customization.

var fairy_scene: PackedScene
var fairy: Node2D

func before_each() -> void:
	fairy_scene = load("res://scenes/FairyVisuals.tscn")
	fairy = fairy_scene.instantiate()
	add_child_autofree(fairy)

func test_default_color_applied() -> void:
	# Check that default base color is applied on startup
	assert_eq(fairy.glow_core.self_modulate, fairy.base_color, "Glow core should start with base_color.")
	assert_eq(fairy.particles.self_modulate, fairy.base_color, "Particles should start with base_color.")
	assert_eq(fairy.left_wing.color, fairy.base_color, "Left wing should start with base_color.")
	assert_eq(fairy.right_wing.color, fairy.base_color, "Right wing should start with base_color.")

func test_set_fairy_color() -> void:
	# Change color and verify all sub-nodes receive the update
	var target_color := Color(0.8, 0.2, 0.9, 1.0) # Purple
	fairy.set_fairy_color(target_color)
	
	assert_eq(fairy.base_color, target_color, "Base color variable should update.")
	assert_eq(fairy.glow_core.self_modulate, target_color, "Glow core color modulation should update.")
	assert_eq(fairy.particles.self_modulate, target_color, "Particles color modulation should update.")
	assert_eq(fairy.left_wing.color, target_color, "Left wing color should update.")
	assert_eq(fairy.right_wing.color, target_color, "Right wing color should update.")

func test_wing_flapping_range() -> void:
	# Record starting scales
	var initial_left_scale_x: float = fairy.left_wing.scale.x
	var initial_right_scale_x: float = fairy.right_wing.scale.x
	
	# Simulate time step
	fairy._process(0.05)
	
	# Assert that scales modified
	assert_ne(fairy.left_wing.scale.x, initial_left_scale_x, "Left wing scale should change over time.")
	assert_ne(fairy.right_wing.scale.x, initial_right_scale_x, "Right wing scale should change over time.")
	
	# Simulate multiple steps to ensure bounds are respected
	for i in range(20):
		fairy._process(0.1)
		var abs_left_scale: float = abs(fairy.left_wing.scale.x)
		var abs_right_scale: float = abs(fairy.right_wing.scale.x)
		
		assert_between(abs_left_scale, fairy.min_wing_scale_x, fairy.max_wing_scale_x, "Left wing absolute scale should be within bounds.")
		assert_between(abs_right_scale, fairy.min_wing_scale_x, fairy.max_wing_scale_x, "Right wing absolute scale should be within bounds.")

func test_dragging_events() -> void:
	fairy.click_enabled = true
	watch_signals(fairy)
	
	# 1. Simulate left mouse press to start drag
	var press_event := InputEventMouseButton.new()
	press_event.button_index = MOUSE_BUTTON_LEFT
	press_event.pressed = true
	fairy._on_click_area_input_event(null, press_event, 0)
	
	assert_true(fairy._is_dragging, "Fairy should start dragging after left-click press.")
	
	# 2. Simulate mouse movement
	var motion_event := InputEventMouseMotion.new()
	motion_event.position = Vector2(100, 100)
	fairy._input(motion_event)
	assert_signal_emitted(fairy, "fairy_dragged", "fairy_dragged signal should be emitted during motion.")
	
	# 3. Simulate left mouse release to stop drag
	var release_event := InputEventMouseButton.new()
	release_event.button_index = MOUSE_BUTTON_LEFT
	release_event.pressed = false
	fairy._input(release_event)
	
	assert_false(fairy._is_dragging, "Fairy should stop dragging after left-click release.")
	assert_signal_emitted(fairy, "fairy_drag_finished", "fairy_drag_finished signal should be emitted on drag end.")

func test_right_click_settings_signal() -> void:
	fairy.click_enabled = true
	watch_signals(fairy)
	
	# Simulate right click
	var rclick_event := InputEventMouseButton.new()
	rclick_event.button_index = MOUSE_BUTTON_RIGHT
	rclick_event.pressed = true
	fairy._on_click_area_input_event(null, rclick_event, 0)
	
	assert_signal_emitted(fairy, "fairy_clicked", "fairy_clicked should be emitted on right-click to open settings.")


func test_set_status_light() -> void:
	var light_color := Color(1.0, 0.5, 0.0, 1.0)
	fairy.set_status_light(light_color, false)
	
	assert_true(fairy.status_light.visible, "Status light should be visible when set.")
	assert_eq(fairy.status_light.self_modulate, light_color, "Status light color modulate should match target color.")
	assert_eq(fairy.status_light.modulate.a, 1.0, "Status light alpha should be 1.0 when not pulsing.")


func test_clear_status_light() -> void:
	fairy.set_status_light(Color.YELLOW, false)
	fairy.clear_status_light()
	
	assert_false(fairy.status_light.visible, "Status light should not be visible when cleared.")


# ---------------------------------------------------------------------------
# Emotion color system tests (NAV-63)
# ---------------------------------------------------------------------------

func test_emotion_color_all_max_is_near_white() -> void:
	# When all three scores are max and love is max, brightness = 1.0 → near-white
	fairy.apply_emotion_color(10, 10, 10, 1000)
	if fairy._emotion_tween:
		fairy._emotion_tween.custom_step(0.8)
	assert_almost_eq(fairy.base_color.r, 1.0, 0.01, "Red channel should be ~1.0 at max.")
	assert_almost_eq(fairy.base_color.g, 1.0, 0.01, "Green channel should be ~1.0 at max.")
	assert_almost_eq(fairy.base_color.b, 1.0, 0.01, "Blue channel should be ~1.0 at max.")


func test_emotion_color_zero_love_is_black() -> void:
	# Love = -1000 means brightness = 0 → black regardless of dimension scores
	fairy.apply_emotion_color(10, 10, 10, -1000)
	if fairy._emotion_tween:
		fairy._emotion_tween.custom_step(0.8)
	assert_almost_eq(fairy.base_color.r, 0.0, 0.01, "Red channel should be 0.0 at min love.")
	assert_almost_eq(fairy.base_color.g, 0.0, 0.01, "Green channel should be 0.0 at min love.")
	assert_almost_eq(fairy.base_color.b, 0.0, 0.01, "Blue channel should be 0.0 at min love.")


func test_emotion_color_high_courage_dominates_green() -> void:
	# High Courage (10), low Wisdom (-10) and Power (-10), mid love (0)
	# Brightness = 0.5. Courage normalised = 1.0. Wisdom normalised = 0.0. Power normalised = 0.0.
	# Green = 1.0 * 0.5 = 0.5. Red = 0.0. Blue = 0.0.
	fairy.apply_emotion_color(10, -10, -10, 0)
	if fairy._emotion_tween:
		fairy._emotion_tween.custom_step(0.8)
	assert_almost_eq(fairy.base_color.g, 0.5, 0.01, "Green channel should be 0.5.")
	assert_almost_eq(fairy.base_color.r, 0.0, 0.01, "Red channel should be 0.0.")
	assert_almost_eq(fairy.base_color.b, 0.0, 0.01, "Blue channel should be 0.0.")
