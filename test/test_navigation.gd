extends GutTest
## Test suite for screen navigation and pointer guidance (NAV-11).

var follow_ctrl: Node
var mock_fairy: Node

class MockFairy extends Node2D:
	var arrow_shown = false
	var arrow_hidden = false
	var target_coord = Vector2.ZERO
	
	func show_pointer_arrow(local_target: Vector2) -> void:
		arrow_shown = true
		target_coord = local_target
		
	func hide_pointer_arrow() -> void:
		arrow_hidden = true

func before_each() -> void:
	var main_mock = Node2D.new()
	add_child_autofree(main_mock)
	
	mock_fairy = MockFairy.new()
	mock_fairy.name = "FairyVisuals"
	main_mock.add_child(mock_fairy)
	
	var follow_script := load("res://scripts/FollowController.gd")
	follow_ctrl = follow_script.new()
	follow_ctrl.get_mouse_button_state_func = func() -> int: return 0
	main_mock.add_child(follow_ctrl)

func test_single_coordinate_navigation() -> void:
	follow_ctrl.fly_to_screen_coordinate(Vector2(500, 600))
	
	assert_true(follow_ctrl.is_navigating, "Should set navigating to true")
	assert_false(follow_ctrl.is_following, "Should disable normal following mode")
	assert_eq(follow_ctrl._navigation_target, Vector2(400, 500), "Target should center window around coordinates")
	assert_true(mock_fairy.arrow_shown, "Should show pointing arrow")
	assert_eq(mock_fairy.target_coord, Vector2(100, 100), "Pointing arrow target coordinate should be at window center")

func test_abort_navigation() -> void:
	follow_ctrl.fly_to_screen_coordinate(Vector2(500, 600))
	await follow_ctrl.abort_navigation()
	
	assert_false(follow_ctrl.is_navigating, "Should set navigating to false")
	assert_true(mock_fairy.arrow_hidden, "Should hide pointer arrow")
	assert_true(follow_ctrl.is_following, "Should restore following mode")

func test_sequence_navigation_queues_points() -> void:
	var points: Array[Vector2] = [Vector2(300, 300), Vector2(600, 600)]
	follow_ctrl.navigate_sequence(points)
	
	assert_true(follow_ctrl.is_navigating, "Should start navigation sequence")
	assert_eq(follow_ctrl._navigation_target, Vector2(200, 200), "Should immediately fly to first point")
	assert_eq(follow_ctrl._sequence_queue.size(), 1, "Remaining points should be queued")
	assert_true(follow_ctrl._waiting_for_click, "Should wait for user click to advance")
	
	# Manually trigger next sequence advancement to test queue emptying
	follow_ctrl._advance_sequence()
	assert_eq(follow_ctrl._navigation_target, Vector2(500, 500), "Should advance to the second point")
	assert_eq(follow_ctrl._sequence_queue.size(), 0, "Queue should be empty")
	
	# Advance again should complete sequence and abort/reset follow
	follow_ctrl._advance_sequence()
	assert_false(follow_ctrl.is_navigating, "Sequence completion should stop navigation")
	await wait_seconds(0.1)
	assert_true(follow_ctrl.is_following, "Should reset to mouse-following mode")

func test_single_coordinate_navigation_fullscreen() -> void:
	var mock_parent = Node2D.new()
	var mock_script = GDScript.new()
	mock_script.source_code = "extends Node2D\nvar _active_panel: int = 1\n"
	mock_script.reload()
	mock_parent.set_script(mock_script)
	add_child_autofree(mock_parent)
	
	# Move follow_ctrl and mock_fairy under mock_parent
	follow_ctrl.get_parent().remove_child(follow_ctrl)
	mock_parent.add_child(follow_ctrl)
	
	mock_fairy.get_parent().remove_child(mock_fairy)
	mock_parent.add_child(mock_fairy)
	
	# Position fairy initially
	mock_fairy.position = Vector2(100, 100)
	
	var target := Vector2(500, 600)
	follow_ctrl.fly_to_screen_coordinate(target)
	
	assert_true(follow_ctrl.is_navigating, "Should set navigating to true")
	assert_false(follow_ctrl.is_following, "Should disable normal following mode")
	
	# Calculate expected offset dynamically based on window size to support headless limits
	var w_size = Vector2(follow_ctrl.get_window().size)
	if w_size.x <= 0 or w_size.y <= 0:
		w_size = Vector2(2880, 1606)
	var expected_offset := Vector2.ZERO
	expected_offset.x = 80 if target.x < w_size.x / 2.0 else -80
	expected_offset.y = 80 if target.y < w_size.y / 2.0 else -80
	var expected_target := target + expected_offset
	
	assert_eq(follow_ctrl._navigation_target, expected_target, "Target should position fairy adjacent to target coordinates in fullscreen mode")
	assert_true(mock_fairy.arrow_shown, "Should show pointing arrow")


