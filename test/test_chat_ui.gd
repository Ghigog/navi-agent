extends GutTest
## Test suite for checking ChatUI layout interactions and network state callbacks.

var chat_scene: PackedScene
var chat_ui: Node

func before_each() -> void:
	chat_scene = load("res://scenes/ChatUI.tscn")
	chat_ui = chat_scene.instantiate()
	add_child_autofree(chat_ui)

func test_initial_state() -> void:
	# Assert initially hidden
	assert_false(chat_ui.visible, "Chat UI should start hidden.")

func test_open_chat() -> void:
	chat_ui.open_chat()
	assert_true(chat_ui.visible, "Chat UI should be visible after calling open_chat.")
	assert_eq(chat_ui.input_edit.text, "", "Input edit should be reset to empty.")
	assert_true(chat_ui.input_edit.editable, "Input field should be editable.")

func test_ai_callbacks() -> void:
	# 1. Test request started state
	chat_ui._on_ai_request_started()
	assert_true(chat_ui.response_label.text.contains("Thinking..."), "Label should display thinking state.")
	
	# 2. Test response received state
	chat_ui._on_ai_response_received("Reply message from model.")
	assert_eq(chat_ui.response_label.text, "Reply message from model.", "Label should display response text.")
	assert_true(chat_ui.input_edit.editable, "Input field should be re-enabled.")
	
	# 3. Test request failed state
	chat_ui._on_ai_request_failed("Failed to connect.")
	assert_true(chat_ui.response_label.text.contains("Failed to connect."), "Label should display the error message.")
	assert_true(chat_ui.input_edit.editable, "Input field should be re-enabled after failure.")

func test_reposition_ui_right_side() -> void:
	# Position fairy in left/center area of screen
	chat_ui.reposition_ui(Vector2(200, 300))
	assert_gt(chat_ui.response_panel.position.x, 200.0, "Response panel should be placed to the right of the fairy.")
	assert_gt(chat_ui.input_panel.position.x, 200.0, "Input panel should be placed to the right of the fairy.")
	assert_eq(chat_ui.pointer.position.x, 0.0, "Pointer X offset should be at 0 (left edge of response bubble).")

func test_reposition_ui_left_side() -> void:
	# Position fairy close to right edge of 1920px width (e.g. 1700)
	chat_ui.reposition_ui(Vector2(1700, 300))
	assert_lt(chat_ui.response_panel.position.x, 1700.0, "Response panel should be placed to the left of the fairy.")
	assert_lt(chat_ui.input_panel.position.x, 1700.0, "Input panel should be placed to the left of the fairy.")


func test_is_position_inside_ui() -> void:
	chat_ui.open_chat()
	
	# Mock sizes and positions for test stability
	chat_ui.input_panel.position = Vector2(100, 100)
	chat_ui.input_panel.size = Vector2(100, 50)
	chat_ui.response_panel.position = Vector2(100, 200)
	chat_ui.response_panel.size = Vector2(100, 50)
	
	assert_true(chat_ui.is_position_inside_ui(Vector2(150, 120)), "Point inside input panel should return true.")
	assert_true(chat_ui.is_position_inside_ui(Vector2(150, 220)), "Point inside response panel should return true.")
	assert_false(chat_ui.is_position_inside_ui(Vector2(50, 50)), "Point outside both panels should return false.")


func test_resize_handle_node_exists() -> void:
	var handle = chat_ui.get_node_or_null("ResizeHandle")
	assert_not_null(handle, "ResizeHandle control node must exist as a direct child of ChatUI.")


func test_resize_guard_prevents_dismiss_while_resizing() -> void:
	chat_ui.open_chat()
	# Simulate a resize drag being active
	chat_ui._is_resizing = true
	# Even a click position outside both panels must return true while resizing
	assert_true(chat_ui.is_position_inside_ui(Vector2(9999, 9999)),
		"is_position_inside_ui should return true while _is_resizing is active.")
	chat_ui._is_resizing = false


func test_thinking_update_ignored_during_active_response() -> void:
	chat_ui.open_chat()
	chat_ui._on_ai_request_started()
	chat_ui._on_ai_response_chunk("Actual streamed response...")
	assert_true(chat_ui.response_label.text.contains("Actual streamed response..."), "Should display the response chunk.")
	
	# Late thinking update arrives while streaming is still in progress
	chat_ui._on_ai_thinking_update("Late rephrased thought...")
	# Verify that the response label was NOT overwritten
	assert_true(chat_ui.response_label.text.contains("Actual streamed response..."), "Should not overwrite active response with late thoughts.")
	assert_false(chat_ui.response_label.text.contains("Late rephrased thought..."), "Should ignore late thoughts during streaming.")


func test_thinking_update_ignored_after_response_received() -> void:
	# Regression test: deferred thought rephrases were firing AFTER _on_ai_response_received
	# and overwriting the committed response in the chat history.
	chat_ui.open_chat()
	chat_ui._on_ai_request_started()
	
	# Simulate a response streaming in and completing
	chat_ui._on_ai_response_chunk("You're working in Godot!")
	chat_ui._on_ai_response_received("")
	
	# Verify the response is now committed to history
	assert_true(chat_ui.response_label.text.contains("You're working in Godot!"),
		"Committed response should be visible after response_received.")
	
	# Simulate a deferred thought arriving AFTER the response finished
	# (this is the exact scenario from the bug report)
	chat_ui._on_ai_thinking_update("Oh, finally! I'll just check the current app...")
	
	# The committed response must still be intact — thoughts must be silently dropped
	assert_true(chat_ui.response_label.text.contains("You're working in Godot!"),
		"Response must not be overwritten by post-response deferred thoughts.")
	assert_false(chat_ui.response_label.text.contains("Oh, finally!"),
		"Deferred thought text must not appear after response is received.")


func test_parse_interactive_steps_with_pauses() -> void:
	var text := "First part.\n[PAUSE]\nSecond part."
	var steps: Array = chat_ui._parse_interactive_steps(text)
	
	assert_eq(steps.size(), 2, "Should parse two steps.")
	assert_eq(steps[0]["text"], "First part.", "First step text matches.")
	assert_null(steps[0]["point"], "First step has no coordinate.")
	assert_eq(steps[1]["text"], "Second part.", "Second step text matches.")
	assert_null(steps[1]["point"], "Second step has no coordinate.")


func test_parse_interactive_steps_with_pointing() -> void:
	var text := "I found it!\n[SKILL: point_to: 100, 200] Look here.\n[SKILL: point_to: 300, 400] Now here."
	var steps: Array = chat_ui._parse_interactive_steps(text)
	
	assert_eq(steps.size(), 3, "Should parse three steps.")
	assert_eq(steps[0]["text"], "I found it!", "First step matches intro.")
	assert_null(steps[0]["point"], "Intro has no coordinate.")
	assert_eq(steps[1]["text"], "Look here.", "Second step text matches.")
	assert_eq(steps[1]["point"], Vector2(100, 200), "Second step has correct coordinate.")
	assert_eq(steps[2]["text"], "Now here.", "Third step text matches.")
	assert_eq(steps[2]["point"], Vector2(300, 400), "Third step has correct coordinate.")


func test_interactive_guide_morph_button() -> void:
	chat_ui._is_interactive_mode = true
	chat_ui.input_edit.text = ""
	chat_ui._update_send_button_ui()
	assert_eq(chat_ui.send_button.text, "Next", "Should morph button to 'Next' when empty.")
	
	chat_ui.input_edit.text = "Hello"
	chat_ui._update_send_button_ui()
	assert_eq(chat_ui.send_button.text, "Send", "Should morph button back to 'Send' when text is typed.")
	
	chat_ui._is_interactive_mode = false
	chat_ui.input_edit.text = ""
	chat_ui._update_send_button_ui()
	assert_eq(chat_ui.send_button.text, "Send", "Should stay 'Send' when not in interactive mode.")


class MockFairyNode extends Node2D:
	var status_color = null
	var is_pulsing = false
	
	func set_status_light(color: Color, pulsing: bool) -> void:
		status_color = color
		is_pulsing = pulsing
		
	func clear_status_light() -> void:
		status_color = null


class MockFollowControllerNode extends Node:
	var last_fly_target = null
	var was_aborted = false
	var restore_follow_arg = null
	
	func fly_to_screen_coordinate(target: Vector2) -> void:
		last_fly_target = target
		
	func abort_navigation(restore_follow: bool) -> void:
		was_aborted = true
		restore_follow_arg = restore_follow


func test_interactive_step_execution_flow() -> void:
	var mock_fairy = MockFairyNode.new()
	mock_fairy.name = "FairyVisuals"
	chat_ui.get_parent().add_child(mock_fairy)
	
	var mock_follow = MockFollowControllerNode.new()
	mock_follow.name = "FollowController"
	chat_ui.get_parent().add_child(mock_follow)
	
	chat_ui.open_chat()
	var steps_typed: Array[Dictionary] = [
		{"text": "Intro point.", "point": null},
		{"text": "First point.", "point": Vector2(100, 100)},
		{"text": "Last point.", "point": Vector2(200, 200)}
	]
	chat_ui._interactive_steps = steps_typed
	chat_ui._is_interactive_mode = true
	chat_ui._current_step_idx = 0
	
	chat_ui._execute_current_interactive_step()
	# Step 0 has null point, so it should auto-advance to Step 1 and move!
	assert_eq(chat_ui._current_step_idx, 1, "Should auto-advance from Step 0 (null) to Step 1.")
	assert_eq(mock_fairy.status_color, Color(0.2, 0.8, 0.2, 1.0), "Should set status color to pulsing Green when moving.")
	assert_eq(mock_follow.last_fly_target, Vector2(100, 100), "Should trigger flight to Vector2(100, 100).")
	assert_true(chat_ui.input_edit.placeholder_text.contains("Next"), "Should show continue instruction.")
	
	chat_ui._current_step_idx = 2
	chat_ui._execute_current_interactive_step()
	assert_false(chat_ui._is_interactive_mode, "Should terminate interactive mode on last step.")
	assert_eq(mock_fairy.status_color, null, "Should clear status color on sequence completion.")
	assert_true(mock_follow.was_aborted, "Should abort active sequences.")
	assert_true(mock_follow.restore_follow_arg, "Should restore follow mode on last step.")
	assert_eq(chat_ui.input_edit.placeholder_text, "Ask Navi...", "Should restore default placeholder.")
	
	chat_ui.get_parent().remove_child(mock_fairy)
	mock_fairy.free()
	chat_ui.get_parent().remove_child(mock_follow)
	mock_follow.free()


func test_strip_skill_and_pause_tags() -> void:
	var text_with_tags := "Here is a [SKILL: take_screenshot] and a [PAUSE] tag. And also [SKILL: point_to: 100, 200] tag."
	var cleaned := chat_ui._strip_skill_and_pause_tags(text_with_tags)
	assert_eq(cleaned, "Here is a  and a  tag. And also  tag.", "Should strip all skill and pause tags.")
	
	var text_with_think := "<think>\n- Reasoning here\n</think>Actual response [PAUSE]"
	var cleaned_think := chat_ui._strip_skill_and_pause_tags(text_with_think)
	assert_eq(cleaned_think, "Actual response", "Should strip think blocks and pause tags.")


