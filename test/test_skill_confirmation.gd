extends GutTest

class MockSettingsManager:
	extends Node
	
	var _data: Dictionary = {}
	
	func get_setting(key: String, default_value: Variant = null) -> Variant:
		return _data.get(key, default_value)
	
	func set_setting(key: String, value: Variant) -> void:
		_data[key] = value

class MockFollowController extends Node:
	var last_fly_target = null
	var aborted = false
	
	func fly_to_screen_coordinate(target: Vector2) -> void:
		last_fly_target = target
		
	func abort_navigation(restore: bool) -> void:
		aborted = true

class MockMainNode extends Node2D:
	var follow_ctrl
	func _init():
		name = "Main"
		follow_ctrl = MockFollowController.new()
		follow_ctrl.name = "FollowController"
		add_child(follow_ctrl)
		
	func capture_clean_screenshot() -> Image:
		return null

var ai_service: Node
var mock_settings: MockSettingsManager

func before_each() -> void:
	ai_service = load("res://scripts/AIService.gd").new()
	add_child_autofree(ai_service)
	
	mock_settings = MockSettingsManager.new()
	add_child_autofree(mock_settings)
	ai_service._settings_mgr = mock_settings
	ai_service._initialize_skills_registry()

func test_require_skill_confirmation_default_value() -> void:
	var manager = load("res://scripts/SettingsManager.gd").new()
	manager.SETTINGS_FILE = "user://settings_test_confirmation.json"
	add_child_autofree(manager)
	assert_true(manager.settings.has("require_skill_confirmation"), "require_skill_confirmation should be defined in SettingsManager")
	assert_true(manager.get_setting("require_skill_confirmation", false), "require_skill_confirmation should default to true")

func test_should_confirm_skill_returns_true_for_sensitive_only() -> void:
	mock_settings.set_setting("require_skill_confirmation", true)
	assert_true(ai_service._should_confirm_skill("point_to"), "point_to should require confirmation when setting is active")
	assert_false(ai_service._should_confirm_skill("take_screenshot"), "take_screenshot should not require confirmation by default")

func test_should_confirm_skill_returns_false_if_setting_disabled() -> void:
	mock_settings.set_setting("require_skill_confirmation", false)
	assert_false(ai_service._should_confirm_skill("point_to"), "point_to should not require confirmation when setting is disabled")

func test_skill_execution_suspended_until_confirmed() -> void:
	mock_settings.set_setting("require_skill_confirmation", true)
	
	var main_mock = MockMainNode.new()
	get_tree().root.add_child(main_mock)
	
	var state = {
		"signal_emitted": false,
		"confirmed_desc": ""
	}
	ai_service.skill_confirmation_requested.connect(func(name, desc):
		state["signal_emitted"] = true
		state["confirmed_desc"] = desc
	)
	
	# Execute point_to (which requires confirmation)
	var context = {
		"args": {"x": 100, "y": 200}
	}
	
	# We run it as a coroutine/task and resume later
	var run_tool = func():
		await ai_service._on_tool_call_received("point_to", {"x": 100, "y": 200})
	run_tool.call_deferred()
	
	# Wait one frame for signal to emit
	await get_tree().process_frame
	
	assert_true(state["signal_emitted"], "skill_confirmation_requested signal should emit")
	assert_true(state["confirmed_desc"].contains("100"), "Description should contain parameters")
	assert_null(main_mock.follow_ctrl.last_fly_target, "Fairy should not fly until approved")
	
	# Now approve it
	ai_service.respond_to_confirmation(true)
	
	# Await execution to finish by waiting a frame/process
	await get_tree().process_frame
	await get_tree().process_frame
	
	assert_not_null(main_mock.follow_ctrl.last_fly_target, "Fairy should fly after approval")
	
	get_tree().root.remove_child(main_mock)
	main_mock.free()

func test_skill_execution_aborted_when_denied() -> void:
	mock_settings.set_setting("require_skill_confirmation", true)
	
	var main_mock = MockMainNode.new()
	get_tree().root.add_child(main_mock)
	
	# Run point_to
	var run_tool = func():
		await ai_service._on_tool_call_received("point_to", {"x": 100, "y": 200})
	run_tool.call_deferred()
	await get_tree().process_frame
	
	# Deny it
	ai_service.respond_to_confirmation(false)
	await get_tree().process_frame
	await get_tree().process_frame
	
	assert_null(main_mock.follow_ctrl.last_fly_target, "Fairy should not fly after denial")
	
	get_tree().root.remove_child(main_mock)
	main_mock.free()
