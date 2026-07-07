extends GutTest
## Test suite for NaviUtils static methods and autoload registration.

func test_navi_utils_autoload_registered() -> void:
	var global_navi_utils = get_node_or_null("/root/NaviUtils")
	assert_not_null(global_navi_utils, "NaviUtils should be registered as a global Autoload singleton.")
	# Wait, the node itself is registered in the scene tree, but in headless tests it might not be class typed.
	# Let's check that it responds to the expected methods.
	if global_navi_utils:
		assert_true(global_navi_utils.has_method("map_normalized_coordinate_to_screen"), "Autoload should have map method.")
		assert_true(global_navi_utils.has_method("strip_thinking_block"), "Autoload should have strip thinking method.")


func test_map_normalized_coordinate_to_screen() -> void:
	var screen := DisplayServer.window_get_current_screen()
	var screen_pos := DisplayServer.screen_get_position(screen)
	var screen_size := DisplayServer.screen_get_size(screen)
	var scale := DisplayServer.screen_get_scale(screen)
	if scale <= 0.0:
		scale = 1.0
	if screen_size.x <= 0 or screen_size.y <= 0:
		screen_pos = Vector2i.ZERO
		screen_size = Vector2i(1920, 1080)
		scale = 1.0
		
	var norm_pos := Vector2(500, 500)
	var logical_screen_size := Vector2(screen_size) / scale
	var expected := Vector2(
		screen_pos.x + 0.5 * logical_screen_size.x,
		screen_pos.y + 0.5 * logical_screen_size.y
	)
	var mapped := NaviUtils.map_normalized_coordinate_to_screen(norm_pos)
	assert_eq(mapped, expected, "Coordinates should be correctly mapped based on screen size, position, and scale.")


func test_strip_thinking_block() -> void:
	assert_eq(NaviUtils.strip_thinking_block("<think>thoughts</think>Hello"), "Hello")
	assert_eq(NaviUtils.strip_thinking_block("<think>thoughts</think>"), "")
	assert_eq(NaviUtils.strip_thinking_block("Hello <think>thoughts"), "Hello ")
	assert_eq(NaviUtils.strip_thinking_block("Hello"), "Hello")


func test_strip_scratchpad_block() -> void:
	assert_eq(NaviUtils.strip_scratchpad_block("<scratchpad>my notes</scratchpad>Hello"), "Hello")
	assert_eq(NaviUtils.strip_scratchpad_block("<scratchpad>my notes</scratchpad>"), "")
	assert_eq(NaviUtils.strip_scratchpad_block("Hello <scratchpad>notes"), "Hello ")
	assert_eq(NaviUtils.strip_scratchpad_block("Hello"), "Hello")


func test_strip_skill_and_pause_tags() -> void:
	assert_eq(NaviUtils.strip_skill_and_pause_tags("<think>thoughts</think>[PAUSE]Hello [SKILL: point_to: 100,200]"), "Hello")
	assert_eq(NaviUtils.strip_skill_and_pause_tags("[TOOL: read] Hello [SCREEN_CONTEXT: text]"), "Hello")
	assert_eq(NaviUtils.strip_skill_and_pause_tags("<scratchpad>notes</scratchpad>Hello [CONTINUE]"), "Hello")
	assert_eq(NaviUtils.strip_skill_and_pause_tags("<scratchpad>notes</scratchpad> [CONTINUE]"), "notes")
	assert_eq(NaviUtils.strip_skill_and_pause_tags("<scratchpad>I can hear you!</scratchpad>"), "I can hear you!")
	assert_eq(NaviUtils.strip_skill_and_pause_tags("<scratchpad>notes"), "notes")



func test_markdown_to_bbcode() -> void:
	assert_eq(NaviUtils.markdown_to_bbcode("**bold**"), "[b]bold[/b]")
	assert_eq(NaviUtils.markdown_to_bbcode("*italic*"), "[b]italic[/b]")
	assert_eq(NaviUtils.markdown_to_bbcode("normal"), "normal")
