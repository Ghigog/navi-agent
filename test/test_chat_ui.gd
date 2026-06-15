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
	assert_gt(chat_ui.main_panel.position.x, 200.0, "Main panel should be placed to the right of the fairy.")
	assert_eq(chat_ui.pointer.position.x, 0.0, "Pointer X offset should be at 0 (left edge of response bubble).")

func test_reposition_ui_left_side() -> void:
	# Position fairy close to right edge of 1920px width (e.g. 1700)
	chat_ui.reposition_ui(Vector2(1700, 300))
	assert_lt(chat_ui.main_panel.position.x, 1700.0, "Main panel should be placed to the left of the fairy.")


func test_is_position_inside_ui() -> void:
	chat_ui.open_chat()
	
	# Mock sizes and positions for test stability
	chat_ui.main_panel.position = Vector2(100, 100)
	chat_ui.main_panel.size = Vector2(200, 200)
	
	assert_true(chat_ui.is_position_inside_ui(Vector2(150, 150)), "Point inside main panel should return true.")
	assert_false(chat_ui.is_position_inside_ui(Vector2(50, 50)), "Point outside main panel should return false.")


# func test_open_chat_triggers_stt() -> void:
# 	if chat_ui._settings_mgr:
# 		chat_ui._settings_mgr.settings["enable_push_to_talk"] = false
# 	chat_ui.open_chat()
# 	if chat_ui._settings_mgr and chat_ui._settings_mgr.get_setting("enable_stt", true):
# 		assert_true(chat_ui._voice_button.button_pressed, "STT should start recording automatically on open_chat.")



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
	var GC_Script = load("res://scripts/GuidanceController.gd")
	var steps: Array = GC_Script.parse_interactive_steps(text)
	
	assert_eq(steps.size(), 1, "Should combine steps without coordinates.")
	assert_eq(steps[0]["text"], "First part.\n\nSecond part.", "Merged step text matches.")
	assert_null(steps[0]["point"], "Merged step has no coordinate.")


func test_parse_interactive_steps_with_pointing() -> void:
	var text := "I found it!\n[SKILL: point_to: 100, 200] Look here.\n[SKILL: point_to: 300, 400] Now here."
	var GC_Script = load("res://scripts/GuidanceController.gd")
	var steps: Array = GC_Script.parse_interactive_steps(text)
	
	assert_eq(steps.size(), 3, "Should parse three steps.")
	assert_eq(steps[0]["text"], "I found it!", "First step matches intro.")
	assert_null(steps[0]["point"], "Intro has no coordinate.")
	assert_eq(steps[1]["text"], "Look here.", "Second step text matches.")
	assert_eq(steps[1]["point"], Vector2(192, 216), "Second step has correct mapped coordinate.")
	assert_eq(steps[2]["text"], "Now here.", "Third step text matches.")
	assert_eq(steps[2]["point"], Vector2(576, 432), "Third step has correct mapped coordinate.")


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
	var real_settings = get_node_or_null("/root/SettingsManager")
	var prev_confirmation = true
	if real_settings:
		prev_confirmation = real_settings.get_setting("require_skill_confirmation", true)
		real_settings.set_setting("require_skill_confirmation", false)

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
		{"text": "Last point.", "point": null}
	]
	
	var gc: Node = chat_ui._guidance_controller
	gc.steps = steps_typed
	gc.stream_is_running = false
	gc._start_playback()
	# Step 0 has null point, does not auto-advance synchronously anymore.
	assert_eq(gc.current_step_idx, 0, "Should remain at Step 0 initially.")
	assert_eq(chat_ui.input_edit.placeholder_text, "Navi is presenting...", "Should show presenting instruction.")
	
	# Manually advance to Step 1 to test movement
	gc.current_step_idx = 1
	gc._execute_step()
	assert_eq(mock_fairy.status_color, Color(0.2, 0.8, 0.2, 1.0), "Should set status color to pulsing Green when moving.")
	assert_eq(mock_follow.last_fly_target, Vector2(100, 100), "Should trigger flight to Vector2(100, 100).")
	assert_eq(chat_ui.input_edit.placeholder_text, "Navi is presenting...", "Should show presenting instruction.")
	
	# Manually advance to Step 2 (last step)
	gc.current_step_idx = 2
	gc._execute_step()
	assert_false(gc.is_active, "Should terminate interactive mode on last step.")
	assert_false(chat_ui._is_interactive_mode, "Should terminate interactive mode on last step in ChatUI.")
	assert_eq(mock_fairy.status_color, null, "Should clear status color on sequence completion.")
	assert_true(mock_follow.was_aborted, "Should abort active sequences.")
	assert_true(mock_follow.restore_follow_arg, "Should restore follow mode on last step.")
	assert_eq(chat_ui.input_edit.placeholder_text, "Ask Navi...", "Should restore default placeholder.")
	
	chat_ui.get_parent().remove_child(mock_fairy)
	mock_fairy.free()
	chat_ui.get_parent().remove_child(mock_follow)
	mock_follow.free()

	if real_settings:
		real_settings.set_setting("require_skill_confirmation", prev_confirmation)


func test_strip_skill_and_pause_tags() -> void:
	var text_with_tags := "Here is a [SKILL: take_screenshot] and a [PAUSE] tag. And also [SKILL: point_to: 100, 200] tag."
	var cleaned: String = NaviUtils.strip_skill_and_pause_tags(text_with_tags)
	assert_eq(cleaned, "Here is a  and a  tag. And also  tag.", "Should strip all skill and pause tags.")
	
	var text_with_think := "<think>\n- Reasoning here\n</think>Actual response [PAUSE]"
	var cleaned_think: String = NaviUtils.strip_skill_and_pause_tags(text_with_think)
	assert_eq(cleaned_think, "Actual response", "Should strip think blocks and pause tags.")


func test_markdown_to_bbcode() -> void:
	var raw_text := "This is **bold** text and *also bold* text."
	var parsed: String = NaviUtils.markdown_to_bbcode(raw_text)
	assert_eq(parsed, "This is [b]bold[/b] text and [b]also bold[/b] text.", "Should convert both single and double asterisks to bbcode [b] tags.")


func test_parse_interactive_steps_with_pointing_style_a() -> void:
	var text := "First, the most obvious one is the current time displayed in the top right corner of your screen, in the system menu bar.\n[SKILL: point_to: 100, 200]\nAlso, on the left side of the screen, there is a dedicated widget showing multiple time slots or hourly status.\n[SKILL: point_to: 300, 400]"
	var GC_Script = load("res://scripts/GuidanceController.gd")
	var steps: Array = GC_Script.parse_interactive_steps(text)
	
	assert_eq(steps.size(), 2, "Should parse two steps.")
	assert_eq(steps[0]["text"], "First, the most obvious one is the current time displayed in the top right corner of your screen, in the system menu bar.", "First step text matches description.")
	assert_eq(steps[0]["point"], Vector2(192, 216), "First step has correct mapped coordinate.")
	assert_eq(steps[1]["text"], "Also, on the left side of the screen, there is a dedicated widget showing multiple time slots or hourly status.", "Second step text matches description.")
	assert_eq(steps[1]["point"], Vector2(576, 432), "Second step has correct mapped coordinate.")


func test_voice_toggled_starts_vad_and_initializes_text() -> void:
	chat_ui.input_edit.text = "Pre-existing text"
	chat_ui._on_voice_toggled(true)
	assert_eq(chat_ui._initial_input_text, "Pre-existing text", "Should store the initial typed text when voice starts.")
	assert_eq(chat_ui._voice_session_text, "", "Should initialize voice session text as empty.")


func test_push_to_talk_shift_space_press_and_release() -> void:
	# 1. Setup mock settings and open chat
	chat_ui._settings_mgr = load("res://scripts/SettingsManager.gd").new()
	chat_ui._settings_mgr.settings["enable_push_to_talk"] = true
	chat_ui._settings_mgr.settings["enable_stt"] = true
	chat_ui._settings_mgr.settings["hotkey_keycode"] = 126 # KEY_UP
	chat_ui.open_chat()
	
	# Simulate hotkey down waking it up
	chat_ui.handle_hotkey_down(false)
	
	# Verify that voice recording was started
	assert_true(chat_ui._voice_button.button_pressed, "Voice recording should start on hotkey down.")
	assert_true(chat_ui._space_held, "_space_held should be true on hotkey down.")
	
	# 2. Simulate tap release (< 0.4s hold)
	chat_ui._hotkey_press_start_time = (Time.get_ticks_msec() / 1000.0) - 0.2 # 0.2s hold
	var release_event := InputEventKey.new()
	release_event.keycode = KEY_UP
	release_event.pressed = false
	chat_ui._input(release_event)
	
	assert_false(chat_ui._space_held, "_space_held should be false after release.")
	assert_true(chat_ui._abort_recording, "_abort_recording should be true for short press.")
	assert_false(chat_ui._voice_button.button_pressed, "Voice button should be un-pressed.")
	
	# 3. Simulate new hold press
	var press_event := InputEventKey.new()
	press_event.keycode = KEY_UP
	press_event.pressed = true
	chat_ui._input(press_event)
	
	assert_true(chat_ui._space_held, "_space_held should be true on new hold.")
	assert_true(chat_ui._voice_button.button_pressed, "Voice button should be pressed on new hold.")
	assert_true(chat_ui._navi_was_open_on_press, "_navi_was_open_on_press should be true when pressed within open Chat UI.")
	
	# 4. Simulate long release (>= 0.4s hold)
	chat_ui._hotkey_press_start_time = (Time.get_ticks_msec() / 1000.0) - 1.0 # 1.0s hold
	chat_ui._input(release_event)
	
	assert_false(chat_ui._space_held, "_space_held should be false after release.")
	assert_false(chat_ui._abort_recording, "_abort_recording should be false for long hold.")
	assert_false(chat_ui._voice_button.button_pressed, "Voice button should be un-pressed.")


func test_open_chat_greeting_mode() -> void:
	chat_ui.open_chat_greeting("Welcome to Navi!")
	assert_true(chat_ui._is_greeting_mode, "Should be in greeting mode.")
	assert_false(chat_ui.get_node("MainPanel/VBox/InputBar").visible, "InputBar should be hidden in greeting mode.")
	assert_false(chat_ui._resize_handle.visible, "ResizeHandle should be hidden in greeting mode.")
	assert_eq(chat_ui.response_label.text, "Welcome to Navi!", "ResponseLabel text should match the greeting.")


func test_transition_from_greeting_to_interactive() -> void:
	chat_ui.open_chat_greeting("Welcome to Navi!")
	chat_ui._transition_from_greeting_to_interactive()
	assert_false(chat_ui._is_greeting_mode, "Should not be in greeting mode after transition.")
	assert_true(chat_ui.get_node("MainPanel/VBox/InputBar").visible, "InputBar should be restored.")
	assert_true(chat_ui._resize_handle.visible, "ResizeHandle should be restored.")
	assert_true(chat_ui.response_label.text.contains("Hello!"), "ResponseLabel should reset to default hello.")


func test_greeting_mode_click_transitions_to_interactive() -> void:
	chat_ui.open_chat_greeting("Welcome to Navi!")
	var click_event := InputEventMouseButton.new()
	click_event.button_index = MOUSE_BUTTON_LEFT
	click_event.pressed = true
	chat_ui._on_main_panel_gui_input(click_event)
	assert_false(chat_ui._is_greeting_mode, "Clicking main panel in greeting mode should transition to interactive mode.")


func test_greeting_mode_hotkey_transitions_to_interactive() -> void:
	chat_ui._settings_mgr = load("res://scripts/SettingsManager.gd").new()
	chat_ui._settings_mgr.settings["hotkey_keycode"] = 126 # KEY_UP
	chat_ui.open_chat_greeting("Welcome to Navi!")
	
	var press_event := InputEventKey.new()
	press_event.keycode = KEY_UP
	press_event.pressed = true
	chat_ui._input(press_event)
	assert_false(chat_ui._is_greeting_mode, "Pressing hotkey in greeting mode should transition to interactive mode.")


func test_predictive_auto_submit_on_punctuation() -> void:
	var real_settings = get_node_or_null("/root/SettingsManager")
	var prev_predictive = false
	if real_settings:
		prev_predictive = real_settings.get_setting("enable_predictive_trigger", false)
		real_settings.set_setting("enable_predictive_trigger", true)
		
	chat_ui.open_chat()
	chat_ui.input_edit.text = "Hello Navi, what's up?"
	chat_ui._on_input_text_changed("Hello Navi, what's up?")
	
	# Verify that it doesn't submit immediately
	assert_true(chat_ui.input_edit.editable, "Input field should still be editable immediately after typing punctuation.")
	
	# Wait 1.4 seconds (longer than the 1.2s debounced trigger)
	await get_tree().create_timer(1.4).timeout
	
	# Auto-submit will trigger _on_prompt_submitted, disabling editable state
	assert_false(chat_ui.input_edit.editable, "Input field should be submitted (disabled) after debounced inactivity timeout.")

	if real_settings:
		real_settings.set_setting("enable_predictive_trigger", prev_predictive)







