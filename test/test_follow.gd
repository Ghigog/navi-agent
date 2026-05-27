extends GutTest
## Test suite for checking FollowController smooth mouse following behaviors.

var follow_ctrl: Node
var mock_mouse_pos: Vector2i = Vector2i(0, 0)

func before_each() -> void:
	var follow_script := load("res://scripts/FollowController.gd")
	follow_ctrl = follow_script.new()
	# Inject mock mouse polling function
	follow_ctrl.get_mouse_position_func = func() -> Vector2i: return mock_mouse_pos
	add_child_autofree(follow_ctrl)

func test_follow_movement() -> void:
	# Set start coordinates
	follow_ctrl._current_float_pos = Vector2(0, 0)
	DisplayServer.window_set_position(Vector2i(0, 0))
	
	# Set target mouse position
	mock_mouse_pos = Vector2i(100, 100)
	var expected_target := Vector2(mock_mouse_pos + follow_ctrl.follow_offset)
	
	# Run a frame step
	follow_ctrl._process(0.1)
	
	# Verify internal float position has moved closer to target
	assert_gt(follow_ctrl._current_float_pos.x, 0.0, "Float pos X should move towards target.")
	assert_gt(follow_ctrl._current_float_pos.y, 0.0, "Float pos Y should move towards target.")
	assert_lt(follow_ctrl._current_float_pos.x, expected_target.x, "Float pos X should not overshoot target.")
	
	# Simulate multiple steps to let it converge
	for i in range(50):
		follow_ctrl._process(0.1)
		
	# Verify convergence
	assert_eq(Vector2i(follow_ctrl._current_float_pos.round()), Vector2i(expected_target), "Internal position should converge to target.")
	
	# Check window manager position directly if running on a real display server
	if DisplayServer.get_name() != "headless":
		assert_eq(DisplayServer.window_get_position(), Vector2i(expected_target), "Window position should match target.")

func test_no_follow_when_disabled() -> void:
	# Disable following
	follow_ctrl.is_following = false
	follow_ctrl._current_float_pos = Vector2(50, 50)
	DisplayServer.window_set_position(Vector2i(50, 50))
	
	# Move mock mouse
	mock_mouse_pos = Vector2i(300, 300)
	
	# Run frame step
	follow_ctrl._process(0.1)
	
	# Verify position remained stationary
	assert_eq(follow_ctrl._current_float_pos, Vector2(50, 50), "Internal float position should remain unchanged.")
	
	if DisplayServer.get_name() != "headless":
		assert_eq(DisplayServer.window_get_position(), Vector2i(50, 50), "Window position should remain unchanged.")

func test_reset_position() -> void:
	follow_ctrl.reset_position(Vector2(250.0, 350.0))
	assert_eq(follow_ctrl._current_float_pos, Vector2(250.0, 350.0), "Internal float position should be set immediately.")
	if DisplayServer.get_name() != "headless":
		assert_eq(DisplayServer.window_get_position(), Vector2i(250, 350), "Window position should be updated immediately.")

