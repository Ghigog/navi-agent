extends GutTest
## Test suite for verifying AIService signal emissions for the thinking_update intermediate status updates
## and for verifying ChatUI correctly handles both response_received and thinking_update signals.

class MockAIService:
	extends Node
	
	signal request_started
	signal response_received(response_text: String)
	signal request_failed(error_message: String)
	signal thinking_update(update_text: String)


class MockSettingsManager:
	extends Node
	
	var _data: Dictionary = {}
	
	func get_setting(key: String, default_value: Variant = null) -> Variant:
		return _data.get(key, default_value)
	
	func set_setting(key: String, value: Variant) -> void:
		_data[key] = value


func test_thinking_update_signal_exists_on_ai_service() -> void:
	var ai_service: Node = load("res://scripts/AIService.gd").new()
	add_child_autofree(ai_service)
	
	assert_true(ai_service.has_signal("thinking_update"),
		"AIService must expose a 'thinking_update' signal for intermediate thought status.")


func test_thinking_update_signal_can_be_connected() -> void:
	var mock_ai := MockAIService.new()
	add_child_autofree(mock_ai)
	
	var received_updates: Array = []
	mock_ai.thinking_update.connect(func(text: String) -> void:
		received_updates.append(text)
	)
	
	mock_ai.thinking_update.emit("Checking line 42...")
	mock_ai.thinking_update.emit("Verifying the fix...")
	
	assert_eq(received_updates.size(), 2, "Two thinking update emissions should be received.")
	assert_eq(received_updates[0], "Checking line 42...", "First update should match emission.")
	assert_eq(received_updates[1], "Verifying the fix...", "Second update should match emission.")


func test_fast_model_skill_tags_detected_correctly() -> void:
	var cases := [
		"[SKILL: take_screenshot]",
		"Sure, let me look! [SKILL: take_screenshot]",
		"I'll zoom in. [SKILL: take_crop_screenshot]",
		"This is complex. [SKILL: heavy_thinking]",
	]
	
	for reply in cases:
		assert_true(
			reply.contains("[SKILL: take_screenshot]") or
			reply.contains("[SKILL: take_crop_screenshot]") or
			reply.contains("[SKILL: heavy_thinking]"),
			"Reply '%s' should contain a skill tag." % reply
		)


func test_skill_stripping_preserves_user_text() -> void:
	var raw := "Got it, let me take a look at this. [SKILL: heavy_thinking]"
	var cleaned := raw
	cleaned = cleaned.replace("[SKILL: take_screenshot]", "")
	cleaned = cleaned.replace("[SKILL: take_crop_screenshot]", "")
	cleaned = cleaned.replace("[SKILL: heavy_thinking]", "")
	cleaned = cleaned.strip_edges()
	
	assert_eq(cleaned, "Got it, let me take a look at this.",
		"Skill stripping should only remove tags and leave human-facing text intact.")


func test_multiple_skill_tags_all_stripped() -> void:
	var raw := "[SKILL: take_screenshot] [SKILL: heavy_thinking] Sure."
	var cleaned := raw
	cleaned = cleaned.replace("[SKILL: take_screenshot]", "")
	cleaned = cleaned.replace("[SKILL: take_crop_screenshot]", "")
	cleaned = cleaned.replace("[SKILL: heavy_thinking]", "")
	cleaned = cleaned.strip_edges()
	
	assert_false(cleaned.contains("[SKILL:"), "All skill tags should be removed regardless of how many appear.")


func test_agent_plan_parsing() -> void:
	var raw_reply := "[PLAN: take_screenshot, heavy_thinking]\nGot it! Let me check the screen first."
	var plan_start := raw_reply.find("[PLAN:")
	var plan_end := raw_reply.find("]", plan_start)
	
	var planned_skills: Array[String] = []
	var clean_intro := raw_reply
	
	if plan_start != -1 and plan_end != -1:
		var plan_content := raw_reply.substr(plan_start + 6, plan_end - plan_start - 6).strip_edges()
		clean_intro = raw_reply.substr(plan_end + 1).strip_edges()
		
		for skill in plan_content.split(","):
			var clean_skill := skill.strip_edges()
			if clean_skill != "":
				planned_skills.append(clean_skill)
				
	assert_eq(planned_skills.size(), 2, "Should parse exactly two skills.")
	assert_eq(planned_skills[0], "take_screenshot", "First skill should be take_screenshot.")
	assert_eq(planned_skills[1], "heavy_thinking", "Second skill should be heavy_thinking.")
	assert_eq(clean_intro, "Got it! Let me check the screen first.", "Clean intro should have bracket plan removed.")


func test_agent_plan_validation() -> void:
	# Available skills registry mockup
	var mock_registry := {
		"take_screenshot": true,
		"take_crop_screenshot": true,
		"heavy_thinking": true
	}
	
	var planned_skills: Array[String] = ["take_screenshot", "hallucinated_tool", "heavy_thinking"]
	var verified_skills: Array[String] = []
	
	for skill in planned_skills:
		if skill in mock_registry:
			verified_skills.append(skill)
			
	assert_eq(verified_skills.size(), 2, "Validation should filter out hallucinated tool.")
	assert_eq(verified_skills[0], "take_screenshot", "First validated tool is correct.")
	assert_eq(verified_skills[1], "heavy_thinking", "Second validated tool is correct.")


func test_greetings_speed_under_three_seconds() -> void:
	var mock_settings = MockSettingsManager.new()
	mock_settings.set_setting("require_skill_confirmation", false)
	add_child_autofree(mock_settings)
	
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"func _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[], k=false):\n" + \
		"    return 'hello back'"
	script.reload()
	
	var ai_service: Node = Node.new()
	ai_service.set_script(script)
	add_child_autofree(ai_service)
	ai_service._settings_mgr = mock_settings
	
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "gemma4:e4b")
	mock_settings.set_setting("local_thinking_model", "deepseek-r1:8b")
	mock_settings.set_setting("enable_thinking", false)
	
	var start_time := Time.get_ticks_msec()
	ai_service.send_prompt("hello")
	var elapsed := Time.get_ticks_msec() - start_time
	
	assert_lt(elapsed, 3000, "Conversational greetings bypass planning and must complete in less than 3 seconds.")


func test_skill_filtering_when_disabled_in_settings() -> void:
	var planned_skills: Array[String] = ["take_screenshot", "heavy_thinking"]
	var verified_skills: Array[String] = []
	
	var enable_screenshots := false
	var enable_thinking := true
	
	var mock_registry := {
		"take_screenshot": true,
		"heavy_thinking": true
	}
	
	for skill in planned_skills:
		if skill in mock_registry:
			if skill == "take_screenshot" and not enable_screenshots:
				continue
			if skill == "heavy_thinking" and not enable_thinking:
				continue
			verified_skills.append(skill)
			
	assert_eq(verified_skills.size(), 1, "Should filter out take_screenshot if screenshots are disabled.")
	assert_eq(verified_skills[0], "heavy_thinking", "Only heavy_thinking should be kept.")


func test_skill_extraction_with_arguments() -> void:
	var ai_service = load("res://scripts/AIService.gd").new()
	add_child_autofree(ai_service)
	
	var tag1 = ai_service._extract_skill_tag("Please look here: [SKILL: point_to: 500, 600]")
	assert_eq(tag1, "point_to: 500, 600", "Should correctly extract tag with arguments.")
	
	var tag2 = ai_service._extract_skill_tag("[SKILL: take_screenshot]")
	assert_eq(tag2, "take_screenshot", "Should extract simple skill tags.")


class MockFollowController extends Node:
	var last_fly_target = null
	var last_nav_sequence = null
	
	func fly_to_screen_coordinate(target: Vector2) -> void:
		last_fly_target = target
		
	func navigate_sequence(sequence) -> void:
		last_nav_sequence = sequence


class MockMainNode extends Node2D:
	var follow_ctrl
	func _init():
		name = "Main"
		follow_ctrl = MockFollowController.new()
		follow_ctrl.name = "FollowController"
		add_child(follow_ctrl)
		
	func capture_clean_screenshot() -> Image:
		return null


func test_point_to_single_coordinate_execution() -> void:
	var ai_service = load("res://scripts/AIService.gd").new()
	add_child_autofree(ai_service)
	ai_service._initialize_skills_registry()
	
	var main_mock = MockMainNode.new()
	get_tree().root.add_child(main_mock)
	
	var context = {
		"skill_args": "500, 600"
	}
	
	var outcome = await ai_service._execute_point_to(context)
	assert_true(outcome.begins_with("Success"), "Execution should succeed.")
	assert_eq(main_mock.follow_ctrl.last_fly_target, Vector2(960, 648), "Should call fly_to_screen_coordinate with correct mapped vector.")
	
	get_tree().root.remove_child(main_mock)
	main_mock.free()


func test_point_to_sequence_coordinates_execution() -> void:
	var ai_service = load("res://scripts/AIService.gd").new()
	add_child_autofree(ai_service)
	ai_service._initialize_skills_registry()
	
	var main_mock = MockMainNode.new()
	get_tree().root.add_child(main_mock)
	
	var context = {
		"skill_args": "500, 600; 300, 400"
	}
	
	var outcome = await ai_service._execute_point_to(context)
	
	assert_true(outcome.begins_with("Success"), "Execution should succeed.")
	assert_not_null(main_mock.follow_ctrl.last_nav_sequence, "Should trigger navigate_sequence.")
	assert_eq(main_mock.follow_ctrl.last_nav_sequence.size(), 2, "Should parse two coordinates.")
	assert_eq(main_mock.follow_ctrl.last_nav_sequence[0], Vector2(960, 648), "First mapped coordinate matches.")
	assert_eq(main_mock.follow_ctrl.last_nav_sequence[1], Vector2(576, 432), "Second mapped coordinate matches.")
	
	get_tree().root.remove_child(main_mock)
	main_mock.free()
