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
	var handle = chat_ui.get_node_or_null("ResponsePanel/ResizeHandle")
	assert_not_null(handle, "ResizeHandle control node must exist inside ResponsePanel.")


func test_resize_guard_prevents_dismiss_while_resizing() -> void:
	chat_ui.open_chat()
	# Simulate a resize drag being active
	chat_ui._is_resizing = true
	# Even a click position outside both panels must return true while resizing
	assert_true(chat_ui.is_position_inside_ui(Vector2(9999, 9999)),
		"is_position_inside_ui should return true while _is_resizing is active.")
	chat_ui._is_resizing = false
