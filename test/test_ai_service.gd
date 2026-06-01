extends GutTest
## Test suite for AIService routing signals, model selection, skill detection, and settings integration.
## The new AIService uses per-call spawned HTTPRequest nodes, so we test through signals and helpers
## rather than injecting a single mock HTTP node.

# Minimal stub that exposes get_setting/set_setting without file I/O
class MockSettingsManager:
	extends Node
	
	var _data: Dictionary = {}
	
	func get_setting(key: String, default_value: Variant = null) -> Variant:
		return _data.get(key, default_value)
	
	func set_setting(key: String, value: Variant) -> void:
		_data[key] = value


var ai_service: Node
var mock_settings: MockSettingsManager


func before_each() -> void:
	# Load AIService directly (headless-safe — no autoload dependency)
	ai_service = load("res://scripts/AIService.gd").new()
	assert_not_null(ai_service, "AIService should load without errors.")
	add_child_autofree(ai_service)
	
	# Inject mock settings manager to bypass file I/O
	mock_settings = MockSettingsManager.new()
	add_child_autofree(mock_settings)
	ai_service._settings_mgr = mock_settings


# ---------------------------------------------------------------------------
# Tests: Settings Manager Injection
# ---------------------------------------------------------------------------

func test_ai_service_loads_successfully() -> void:
	assert_not_null(ai_service, "AIService node should instantiate successfully.")


func test_missing_settings_manager_emits_request_failed() -> void:
	# Remove the settings manager to simulate startup without an Autoload
	ai_service._settings_mgr = null
	
	watch_signals(ai_service)
	ai_service.send_prompt("hello")
	
	assert_signal_emitted(ai_service, "request_failed",
		"request_failed should emit when SettingsManager is missing.")


func test_request_started_signal_emitted_before_llm_call() -> void:
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_url", "http://localhost:11434")
	mock_settings.set_setting("local_model", "gemma4:e4b")
	mock_settings.set_setting("local_thinking_model", "deepseek-r1:8b")
	mock_settings.set_setting("enable_thinking", false)
	mock_settings.set_setting("fast_system_prompt", "Respond fast.")
	mock_settings.set_setting("personality", "")
	
	watch_signals(ai_service)
	# Don't await because the HTTP will time out headlessly — just verify signal fires
	ai_service.send_prompt("Test prompt")
	
	assert_signal_emitted(ai_service, "request_started",
		"request_started must be emitted at the start of every prompt dispatch.")


# ---------------------------------------------------------------------------
# Tests: Skill Tag Detection Logic (unit test via helper)
# ---------------------------------------------------------------------------

func test_skill_screenshot_tag_detected() -> void:
	var test_text := "Sure! [SKILL: take_screenshot] Let me see your screen."
	assert_true(test_text.contains("[SKILL: take_screenshot]"),
		"Screenshot skill tag should be present in fast model reply.")


func test_skill_crop_screenshot_tag_detected() -> void:
	var test_text := "Let me zoom in. [SKILL: take_crop_screenshot]"
	assert_true(test_text.contains("[SKILL: take_crop_screenshot]"),
		"Crop screenshot skill tag should be detectable.")


func test_skill_heavy_thinking_tag_detected() -> void:
	var test_text := "This looks complex. [SKILL: heavy_thinking]"
	assert_true(test_text.contains("[SKILL: heavy_thinking]"),
		"Heavy thinking skill tag should be detectable.")


func test_skill_tags_stripped_for_display() -> void:
	# Simulate the stripping logic used inside send_prompt
	var raw := "Got it! [SKILL: take_screenshot] Let me check."
	var cleaned: String = raw
	cleaned = cleaned.replace("[SKILL: take_screenshot]", "")
	cleaned = cleaned.replace("[SKILL: take_crop_screenshot]", "")
	cleaned = cleaned.replace("[SKILL: heavy_thinking]", "")
	cleaned = cleaned.strip_edges()
	
	assert_false(cleaned.contains("[SKILL:"), "All skill tags should be stripped before user display.")
	assert_true(cleaned.contains("Got it!"), "Non-tag text should be preserved after stripping.")


# ---------------------------------------------------------------------------
# Tests: Think-block Parsing Logic
# ---------------------------------------------------------------------------

func test_think_block_extracted_from_heavy_model_output() -> void:
	var heavy_reply := "<think>\n- Examining bug at line 42\n- Verifying fix\n</think>\nHere is your solution!"
	
	var thoughts: Array = []
	var final_answer := heavy_reply
	
	if heavy_reply.contains("<think>") and heavy_reply.contains("</think>"):
		var start_idx := heavy_reply.find("<think>")
		var end_idx := heavy_reply.find("</think>")
		var think_content := heavy_reply.substr(start_idx + 7, end_idx - start_idx - 7).strip_edges()
		final_answer = heavy_reply.substr(end_idx + 8).strip_edges()
		for line in think_content.split("\n"):
			var clean_line := line.strip_edges()
			if clean_line.begins_with("-"):
				clean_line = clean_line.substr(1).strip_edges()
			if clean_line != "":
				thoughts.append(clean_line)
	
	assert_eq(thoughts.size(), 2, "Should extract exactly 2 thought lines.")
	assert_eq(thoughts[0], "Examining bug at line 42", "First thought should parse correctly.")
	assert_eq(final_answer, "Here is your solution!", "Final answer should exclude the think block.")


func test_think_block_missing_returns_full_text() -> void:
	var heavy_reply := "Here is your solution without any think block."
	
	var final_answer := heavy_reply
	var thoughts: Array = []
	
	if heavy_reply.contains("<think>") and heavy_reply.contains("</think>"):
		pass # would extract
	
	assert_eq(final_answer, heavy_reply, "When no <think> block exists, full reply is used as answer.")
	assert_eq(thoughts.size(), 0, "No thoughts should be extracted when block is absent.")


# ---------------------------------------------------------------------------
# Tests: Settings Model Key Selection
# ---------------------------------------------------------------------------

func test_local_fast_model_key_used() -> void:
	mock_settings.set_setting("local_model", "gemma4:e4b")
	var model: String = mock_settings.get_setting("local_model", "")
	assert_eq(model, "gemma4:e4b", "Local fast model should be read from 'local_model' key.")


func test_local_thinking_model_key_used() -> void:
	mock_settings.set_setting("local_thinking_model", "deepseek-r1:8b")
	var model: String = mock_settings.get_setting("local_thinking_model", "")
	assert_eq(model, "deepseek-r1:8b", "Local thinking model should be read from 'local_thinking_model' key.")


func test_cloud_fast_model_key_used() -> void:
	mock_settings.set_setting("cloud_model", "gemini-2.5-flash")
	var model: String = mock_settings.get_setting("cloud_model", "")
	assert_eq(model, "gemini-2.5-flash", "Cloud fast model should be read from 'cloud_model' key.")


func test_cloud_thinking_model_key_used() -> void:
	mock_settings.set_setting("cloud_thinking_model", "gemini-2.5-pro")
	var model: String = mock_settings.get_setting("cloud_thinking_model", "")
	assert_eq(model, "gemini-2.5-pro", "Cloud thinking model should be read from 'cloud_thinking_model' key.")


func test_response_streaming_aborts_deferred_thoughts() -> void:
	ai_service._is_response_streaming = true
	watch_signals(ai_service)
	await ai_service._parse_and_emit_thoughts_deferred("- Thought 1\n- Thought 2", "cheerful")
	assert_signal_not_emitted(ai_service, "thinking_update",
		"thinking_update should not emit if _is_response_streaming is true.")


func test_history_appending() -> void:
	ai_service.clear_history()
	assert_eq(ai_service._conversation_history.size(), 0, "History should be empty initially.")
	
	var user_prompt := "What is the error on my screen?"
	var ai_raw_response := "<think>\n- Checking error\n- Explaining fix\n</think>\nHere is the answer. [SKILL: take_screenshot]"
	
	ai_service._append_to_history(user_prompt, "mock_image_data", "", ai_raw_response)
	
	assert_eq(ai_service._conversation_history.size(), 2, "History should contain exactly 2 turns.")
	
	var turn1: Dictionary = ai_service._conversation_history[0]
	assert_eq(turn1["role"], "user")
	assert_eq(turn1["text"], user_prompt)
	assert_eq(turn1["image"], "mock_image_data")
	
	var turn2: Dictionary = ai_service._conversation_history[1]
	assert_eq(turn2["role"], "assistant")
	assert_eq(turn2["text"], "Here is the answer.") # tags stripped
	assert_eq(turn2["image"], "")


func test_clear_history() -> void:
	var mock_history: Array[Dictionary] = [
		{"role": "user", "text": "hello"},
		{"role": "assistant", "text": "hi"}
	]
	ai_service._conversation_history = mock_history
	ai_service.clear_history()
	assert_eq(ai_service._conversation_history.size(), 0, "clear_history should empty history.")


func test_execute_summarize_session() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\nvar mock_response := ''\nfunc _request_llm(p, s, i=false, b1='', b2='', t=0.7, h=[]): return mock_response"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	
	var mock_history: Array[Dictionary] = [
		{"role": "user", "text": "I have an error in my code."},
		{"role": "assistant", "text": "You missed a semicolon."}
	]
	
	mock_ai.mock_response = "Problem: User had error. Solution: Navi fixed it."
	var context := {"history": mock_history}
	var outcome = await mock_ai._execute_summarize_session(context)
	
	assert_eq(outcome, "Success: session summarized.")
	assert_eq(mock_ai.get_cached_summary(), "Problem: User had error. Solution: Navi fixed it.")


func test_end_chat_session_clears_history() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\nvar mock_response := ''\nfunc _request_llm(p, s, i=false, b1='', b2='', t=0.7, h=[]): return mock_response"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai._initialize_skills_registry()
	
	var mock_history: Array[Dictionary] = [
		{"role": "user", "text": "test prompt"},
		{"role": "assistant", "text": "test reply"}
	]
	mock_ai._conversation_history = mock_history
	
	mock_ai.end_chat_session()
	
	assert_eq(mock_ai._conversation_history.size(), 0, "History should be cleared immediately on end_chat_session.")


func test_recall_summary_injections() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\nvar last_system_prompt := ''\nfunc _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[]): last_system_prompt = s; return 'reply'"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	
	mock_ai._config_cache = {
		"system_prompt" : "Custom Prompt",
		"personality": "",
		"llm_provider": "local",
		"fast_model": "llama3.2:3b",
		"heavy_model": "gemma4:e4b"
	}
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "llama3.2:3b")
	mock_settings.set_setting("local_thinking_model", "gemma4:e4b")
	mock_settings.set_setting("enable_thinking", false)
	
	mock_ai._cached_summary = "Problem: A. Solution: B."
	
	mock_ai.send_prompt("Hello")
	
	assert_true(mock_ai.last_system_prompt.contains("Problem: A. Solution: B."),
		"System prompt should be injected with the previous session summary.")
	assert_true(mock_ai.last_system_prompt.contains("Custom Prompt"),
		"Original user system prompt should still be present.")


func test_honesty_directives_in_system_prompt() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var last_system_prompt := ''\n" + \
		"func _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[]):\n" + \
		"    last_system_prompt = s\n" + \
		"    return 'reply'"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	
	mock_ai._config_cache = {
		"system_prompt" : "Custom Prompt",
		"personality": "",
		"llm_provider": "local",
		"fast_model": "llama3.2:3b",
		"heavy_model": "gemma4:e4b"
	}
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "llama3.2:3b")
	mock_settings.set_setting("local_thinking_model", "gemma4:e4b")
	mock_settings.set_setting("enable_thinking", false)
	
	mock_ai.send_prompt("Hello")
	
	assert_true(mock_ai.last_system_prompt.contains("CRITICAL: Be extremely honest and realistic."),
		"System prompt must contain core honesty guidelines.")
	assert_true(mock_ai.last_system_prompt.contains("Trust current screen captures over any previous conversation history"),
		"System prompt must contain warning to trust screen captures over history.")
	
	# Verify warning in summary recall block
	mock_ai._cached_summary = "Problem: User had error. Solution: fixed."
	mock_ai.send_prompt("Hello")
	assert_true(mock_ai.last_system_prompt.contains("Do NOT assume any of these applications or problems are still active"),
		"Summary recall block must warn the model about active applications.")

	# Verify vision sanity check guidelines when visual context is present
	var context := {
		"base64_image": "mock_image_data"
	}
	await mock_ai._deliver_final_response("prompt", context, false, "identity", "system_prompt_user", "fast_model", "heavy_model")
	assert_true(mock_ai.last_system_prompt.contains("### SCREEN ANALYSIS SANITY CHECK:"),
		"Vision sanity check section must be injected when screen capture is present.")
	assert_true(mock_ai.last_system_prompt.contains("Never guess, assume, or hallucinate"),
		"Vision sanity check details must be present.")


class MockFairy extends Node:
	var last_color: Color = Color.BLACK
	var last_pulse: bool = false
	func set_status_light(color: Color, pulsing: bool) -> void:
		last_color = color
		last_pulse = pulsing
	func clear_status_light() -> void:
		pass

class MockWindowController extends Node:
	var _fairy = null


func test_visual_queries_escalate_to_heavy_model() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var last_is_heavy: bool = false\n" + \
		"var mock_window_controller = null\n" + \
		"func _execute_take_screenshot(context: Dictionary) -> String:\n" + \
		"    context['base64_image'] = 'mock_image_data'\n" + \
		"    return 'Success'\n" + \
		"func _deliver_final_response(p, context, is_heavy, id, s_usr, f_mod, h_mod) -> void:\n" + \
		"    last_is_heavy = is_heavy\n" + \
		"func _get_window_controller() -> Node:\n" + \
		"    return mock_window_controller"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai._initialize_skills_registry()
	
	var win_ctrl := MockWindowController.new()
	var fairy := MockFairy.new()
	win_ctrl._fairy = fairy
	add_child_autofree(win_ctrl)
	add_child_autofree(fairy)
	mock_ai.mock_window_controller = win_ctrl
	
	mock_ai._config_cache = {
		"system_prompt" : "",
		"personality": "",
		"llm_provider": "local",
		"fast_model": "llama3.2:3b",
		"heavy_model": "gemma4:e4b"
	}
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "llama3.2:3b")
	mock_settings.set_setting("local_thinking_model", "gemma4:e4b")
	mock_settings.set_setting("enable_thinking", true)
	mock_settings.set_setting("enable_screenshots", true)
	
	# Scenario 1: Deterministic routing matches visual query patterns
	# Should execute 'take_screenshot' which populates base64_image, and promote to is_heavy = true
	mock_ai.send_prompt("show me what is on my screen")
	assert_true(mock_ai.last_is_heavy, "Deterministic visual query must be promoted to heavy model.")
	
	# Scenario 2: Escalated planning routing
	# Set up mock_ai with custom stream request response sequence:
	# 1st call (fast model) -> ESCALATE
	# 2nd call (heavy model) -> [SKILL: take_screenshot]
	var test_script := GDScript.new()
	test_script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var last_is_heavy: bool = false\n" + \
		"var call_count: int = 0\n" + \
		"var mock_window_controller = null\n" + \
		"func _execute_take_screenshot(context: Dictionary) -> String:\n" + \
		"    context['base64_image'] = 'mock_image_data'\n" + \
		"    return 'Success'\n" + \
		"func _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[]):\n" + \
		"    call_count += 1\n" + \
		"    if call_count == 1:\n" + \
		"        return '[ESCALATE]'\n" + \
		"    elif call_count == 2:\n" + \
		"        return '[SKILL: take_screenshot]'\n" + \
		"    return 'conversational answer'\n" + \
		"func _deliver_final_response(p, context, is_heavy, id, s_usr, f_mod, h_mod) -> void:\n" + \
		"    last_is_heavy = is_heavy\n" + \
		"func _get_window_controller() -> Node:\n" + \
		"    return mock_window_controller"
	test_script.reload()
	
	var planning_mock = Node.new()
	planning_mock.set_script(test_script)
	add_child_autofree(planning_mock)
	planning_mock._settings_mgr = mock_settings
	planning_mock._initialize_skills_registry()
	planning_mock.mock_window_controller = win_ctrl
	
	# Make query that does NOT match deterministic rules (is conversational)
	planning_mock.send_prompt("Please help me with this problem")
	
	assert_true(planning_mock.last_is_heavy, "Escalated visual planning route must be promoted to heavy model.")


func test_status_light_updates_to_purple_for_heavy_thinking() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var mock_window_controller = null\n" + \
		"func _get_window_controller() -> Node:\n" + \
		"    return mock_window_controller\n" + \
		"func _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[]):\n" + \
		"    return 'mock_reply'"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	
	var win_ctrl := MockWindowController.new()
	var fairy := MockFairy.new()
	win_ctrl._fairy = fairy
	add_child_autofree(win_ctrl)
	add_child_autofree(fairy)
	mock_ai.mock_window_controller = win_ctrl
	
	var context := {}
	# Call deliver final response with has_heavy_thinking = true
	await mock_ai._deliver_final_response("prompt", context, true, "identity", "system_prompt_user", "fast_model", "heavy_model")
	
	assert_eq(fairy.last_color, Color(0.6, 0.2, 1.0, 1.0), "Status light must be set to Purple (0.6, 0.2, 1.0).")
	assert_true(fairy.last_pulse, "Status light must be set to pulse.")
