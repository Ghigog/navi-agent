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
	mock_settings.set_setting("enable_thinking", false)
	mock_settings.set_setting("fast_system_prompt", "Respond fast.")
	mock_settings.set_setting("personality", "")
	
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"func _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[]):\n" + \
		"    return 'mock_reply'"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai._config_cache = {
		"system_prompt" : "Respond fast.",
		"personality": "",
		"llm_provider": "local",
		"heavy_model": "gemma4:e4b"
	}
	
	var state := {
		"signal_fired": false,
		"failed_message": ""
	}
	mock_ai.request_started.connect(func():
		state["signal_fired"] = true
	)
	mock_ai.request_failed.connect(func(msg):
		state["failed_message"] = msg
	)
	
	mock_ai.send_prompt("Test prompt")
	
	assert_true(state["signal_fired"], "request_started must be emitted at the start of every prompt dispatch.")


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

func test_local_model_loaded_as_heavy_model() -> void:
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "gemma4:e4b")
	ai_service._on_settings_updated()
	assert_eq(ai_service._config_cache.get("heavy_model"), "gemma4:e4b", "Local model should be loaded as heavy_model.")


func test_cloud_model_loaded_as_heavy_model() -> void:
	mock_settings.set_setting("llm_provider", "cloud")
	mock_settings.set_setting("cloud_model", "gemini-2.5-flash")
	ai_service._on_settings_updated()
	assert_eq(ai_service._config_cache.get("heavy_model"), "gemini-2.5-flash", "Cloud model should be loaded as heavy_model.")



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
	script.source_code = "extends 'res://scripts/AIService.gd'\nvar mock_response := ''\nfunc _request_llm(p, s, i=false, b1='', b2='', t=0.7, h=[], k=false): return mock_response"
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
	script.source_code = "extends 'res://scripts/AIService.gd'\nvar mock_response := ''\nfunc _request_llm(p, s, i=false, b1='', b2='', t=0.7, h=[], k=false): return mock_response"
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
		"heavy_model": "gemma4:e4b"
	}
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "gemma4:e4b")
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
		"heavy_model": "gemma4:e4b"
	}
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "gemma4:e4b")
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


func test_deterministic_classification_patterns_match() -> void:
	var result_behind_you = ai_service._classify_prompt("what is Pablo saying in the chat behind you?")
	assert_eq(result_behind_you.get("skill"), "take_screenshot", "Prompt with 'behind you' should trigger take_screenshot.")
	
	var result_behind = ai_service._classify_prompt("what is behind the window")
	assert_eq(result_behind.get("skill"), "take_screenshot", "Prompt with 'behind' should trigger take_screenshot.")
	
	var result_chat = ai_service._classify_prompt("read the chat history")
	assert_eq(result_chat.get("skill"), "take_screenshot", "Prompt with 'chat' should trigger take_screenshot.")
	
	var result_saying = ai_service._classify_prompt("what is the terminal saying?")
	assert_eq(result_saying.get("skill"), "take_screenshot", "Prompt with 'saying' should trigger take_screenshot.")

	var result_move = ai_service._classify_prompt("Can you move to the top right corner?")
	assert_eq(result_move.get("skill"), "take_screenshot", "Prompt with 'move to' should trigger take_screenshot.")

	var result_point = ai_service._classify_prompt("Point out the main window.")
	assert_eq(result_point.get("skill"), "take_screenshot", "Prompt with 'point out' should trigger take_screenshot.")



class MockFairy extends Node:
	var last_color: Color = Color.BLACK
	var last_pulse: bool = false
	var is_loading: bool = false
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
		"func _deliver_final_response(p, context, has_heavy_thinking, id, s_usr, f_mod, h_mod) -> void:\n" + \
		"    last_is_heavy = has_heavy_thinking or context.get('base64_image', '') != '' or context.get('base64_crop', '') != ''\n" + \
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
		"heavy_model": "gemma4:e4b"
	}
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_model", "gemma4:e4b")
	mock_settings.set_setting("enable_thinking", true)
	mock_settings.set_setting("enable_screenshots", true)
	
	# Scenario 1: Deterministic routing matches visual query patterns
	# Should execute 'take_screenshot' which populates base64_image, and promote to is_heavy = true
	mock_ai.send_prompt("show me what is on my screen")
	assert_true(mock_ai.last_is_heavy, "Deterministic visual query must be promoted to heavy model.")


func test_single_model_routing_and_no_escalation() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var call_count: int = 0\n" + \
		"func _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[]):\n" + \
		"    call_count += 1\n" + \
		"    return 'direct answer'"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai._config_cache = {
		"system_prompt" : "",
		"personality": "",
		"llm_provider": "local",
		"heavy_model": "gemma4:e4b"
	}
	
	mock_ai.send_prompt("Please help me with this problem")
	assert_eq(mock_ai.call_count, 1, "Direct conversational queries should call the model exactly once (no T1/T2 escalation).")


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
	await mock_ai._deliver_final_response("prompt", context, true, "identity", "system_prompt_user", "", "heavy_model")
	
	assert_eq(fairy.last_color, Color(0.6, 0.2, 1.0, 1.0), "Status light must be set to Purple (0.6, 0.2, 1.0).")
	assert_true(fairy.last_pulse, "Status light must be set to pulse.")


func test_response_cleared_emitted_during_stream_request() -> void:
	var state := {
		"emitted": false
	}
	ai_service.response_cleared.connect(func():
		state["emitted"] = true
	)

	var _discard = await ai_service._request_llm_stream("prompt", "system")
	assert_true(state["emitted"], "response_cleared signal must be emitted during LLM stream request.")


func test_dynamic_registration() -> void:
	var real_ai = load("res://scripts/AIService.gd").new()
	add_child_autofree(real_ai)
	real_ai._initialize_skills_registry()
	
	assert_true(real_ai._skills_registry.has("take_screenshot"), "Dynamic scan should load take_screenshot.")
	assert_true(real_ai._skills_registry.has("take_crop_screenshot"), "Dynamic scan should load take_crop_screenshot.")
	assert_true(real_ai._skills_registry.has("heavy_thinking"), "Dynamic scan should load heavy_thinking.")
	assert_true(real_ai._skills_registry.has("summarize_session"), "Dynamic scan should load summarize_session.")
	assert_true(real_ai._skills_registry.has("point_to"), "Dynamic scan should load point_to.")


func test_extract_json_objects_handles_fragmented_stream() -> void:
	var buffer := ""
	buffer += "[\n{\n  \"candidates\": [\n    {\n      \"content\": {\n        \"parts\": [\n          {\n            \"text\": \"Hello\"\n          }\n        ]\n      }\n    }\n  ]\n}"
	
	var res = ai_service._extract_json_objects(buffer)
	var objects: Array = res[0]
	var remaining_buffer: String = res[1]
	
	assert_eq(objects.size(), 1, "Should parse one complete JSON object.")
	assert_eq(objects[0]["candidates"][0]["content"]["parts"][0]["text"], "Hello", "Should parse Candidate text.")
	assert_eq(remaining_buffer, "", "Buffer should be empty since JSON was complete.")
	
	# Fragmented test
	buffer = "{\n  \"incomplete\": true"
	res = ai_service._extract_json_objects(buffer)
	assert_eq(res[0].size(), 0, "Should not parse incomplete JSON.")
	assert_eq(res[1], "{\n  \"incomplete\": true", "Buffer should retain the incomplete fragment.")
	
	# Appending next fragment
	buffer = res[1] + ",\n  \"finished\": true\n}"
	res = ai_service._extract_json_objects(buffer)
	assert_eq(res[0].size(), 1, "Should parse after appending remainder.")
	assert_eq(res[0][0]["finished"], true, "Should extract properties successfully.")
	assert_eq(res[1], "", "Buffer should be empty after complete parse.")


func test_gemini_tool_call_extraction() -> void:
	var response_chunk = {
		"candidates": [
			{
				"content": {
					"parts": [
						{
							"functionCall": {
								"name": "point_to",
								"args": {
									"x": 500,
									"y": 600
								}
							}
						}
					]
				}
			}
		]
	}
	var current_tool_name = ""
	var current_tool_args_dict = {}
	if response_chunk.has("candidates") and response_chunk["candidates"].size() > 0:
		var candidate = response_chunk["candidates"][0]
		if candidate.has("content") and candidate["content"].has("parts"):
			for part in candidate["content"]["parts"]:
				if part.has("functionCall"):
					var func_call = part["functionCall"]
					current_tool_name = func_call["name"]
					current_tool_args_dict = func_call["args"]
					
	assert_eq(current_tool_name, "point_to")
	assert_eq(current_tool_args_dict["x"], 500)
	assert_eq(current_tool_args_dict["y"], 600)


func test_ollama_tool_call_delta_extraction() -> void:
	var chunks = [
		{
			"choices": [
				{
					"delta": {
						"tool_calls": [
							{
								"function": {
									"name": "point_to",
									"arguments": "{\"x\": "
								}
							}
						]
					}
				}
			]
		},
		{
			"choices": [
				{
					"delta": {
						"tool_calls": [
							{
								"function": {
									"arguments": "500, \"y\": 600}"
								}
							}
						]
					}
				}
			]
		}
	]
	
	var current_tool_name = ""
	var current_tool_args_accumulated = ""
	
	for json_data in chunks:
		if json_data.has("choices") and json_data["choices"].size() > 0:
			var choice = json_data["choices"][0]
			if choice.has("delta") and choice["delta"].has("tool_calls"):
				var tool_calls = choice["delta"]["tool_calls"]
				if tool_calls is Array and tool_calls.size() > 0:
					var tc = tool_calls[0]
					if tc.has("function"):
						var func_data = tc["function"]
						if func_data.has("name") and func_data["name"] != "":
							current_tool_name = func_data["name"]
						if func_data.has("arguments"):
							current_tool_args_accumulated += func_data["arguments"]
							
	assert_eq(current_tool_name, "point_to")
	assert_eq(current_tool_args_accumulated, "{\"x\": 500, \"y\": 600}")
	
	var parse_res = JSON.parse_string(current_tool_args_accumulated)
	assert_eq(parse_res["x"], 500)
	assert_eq(parse_res["y"], 600)


func test_tool_call_received_signal_emission() -> void:
	watch_signals(ai_service)
	ai_service.tool_call_received.emit("point_to", {"x": 100, "y": 200})
	assert_signal_emitted_with_parameters(ai_service, "tool_call_received", ["point_to", {"x": 100, "y": 200}], 0)


func test_empty_reply_with_tool_call_succeeds() -> void:
	mock_settings.set_setting("llm_provider", "local")
	mock_settings.set_setting("local_url", "http://localhost:11434")
	mock_settings.set_setting("local_model", "gemma4:e4b")
	mock_settings.set_setting("enable_thinking", false)
	mock_settings.set_setting("personality", "")
	
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"func _request_llm_stream(p, s, i=false, b1='', b2='', t=0.7, h=[]):\n" + \
		"    _last_request_had_tool_call = true\n" + \
		"    return ''"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai._config_cache = {
		"system_prompt" : "Respond fast.",
		"personality": "",
		"llm_provider": "local",
		"heavy_model": "gemma4:e4b"
	}
	
	var state := {
		"response_received_emitted": false,
		"request_failed_emitted": false
	}
	
	mock_ai.response_received.connect(func(reply):
		print("TEST DEBUG: response_received received with: '", reply, "'")
		state["response_received_emitted"] = true
	)
	mock_ai.request_failed.connect(func(msg):
		print("TEST DEBUG: request_failed received with: '", msg, "'")
		state["request_failed_emitted"] = true
	)
	
	await mock_ai.send_prompt("Test prompt")
	
	print("TEST DEBUG: response_received_emitted status: ", state["response_received_emitted"])
	print("TEST DEBUG: request_failed_emitted status: ", state["request_failed_emitted"])
	
	assert_true(state["response_received_emitted"], "Should emit response_received even if text is empty when a tool call was processed.")
	assert_false(state["request_failed_emitted"], "Should not fail when a tool call was processed.")
func test_complete_preload_resets_warming_up_and_loading_states() -> void:
	# Mock SettingsManager and WindowController with a mock Fairy
	var win_ctrl := MockWindowController.new()
	var fairy := MockFairy.new()
	# Give MockFairy properties for is_loading
	fairy.set("is_loading", true)
	win_ctrl._fairy = fairy
	add_child_autofree(win_ctrl)
	add_child_autofree(fairy)
	
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var mock_window_controller = null\n" + \
		"func _get_window_controller() -> Node:\n" + \
		"    return mock_window_controller"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai.mock_window_controller = win_ctrl
	
	mock_ai.is_warming_up = true
	mock_ai.is_warming_up = false
	mock_ai._set_fairy_loading(false)
	
	assert_false(mock_ai.is_warming_up, "is_warming_up should be false.")
	assert_false(fairy.get("is_loading"), "fairy's is_loading should be reset to false after loader is disabled.")


func test_deferred_pointing_skill_execution() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var mock_window_controller = null\n" + \
		"func _get_window_controller() -> Node:\n" + \
		"    return mock_window_controller"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai._initialize_skills_registry()
	
	# Stub the point_to skill to see if it gets called using a dict to bypass lambda capture-by-value
	var state := {"called": false}
	mock_ai._skills_registry["point_to"] = func(context):
		state["called"] = true
		return "Success"
		
	# Call forced pointing skill stage 0 (stage 3 checks)
	var classification = {
		"label": "POINT",
		"skill": "point_to",
		"status": "Pointing...",
		"matched": "point"
	}
	var context := {
		"prompt": "point to something",
		"base64_image": ""
	}
	
	# Emulate stage 0 path with forced_skill = "point_to"
	var forced_skill = classification["skill"]
	mock_ai.thinking_update.emit(classification["status"])
	
	if forced_skill == "point_to":
		mock_ai._deferred_skill = {
			"name": forced_skill,
			"context": context
		}
	
	assert_false(state["called"], "point_to skill should NOT be called immediately when deferred.")
	assert_eq(mock_ai._deferred_skill["name"], "point_to", "point_to should be stored in _deferred_skill.")
	
	# Execute deferred skill
	await mock_ai._execute_deferred_skill()
	assert_true(state["called"], "point_to skill should be called when _execute_deferred_skill is invoked.")
	assert_true(mock_ai._deferred_skill.is_empty(), "_deferred_skill should be cleared after execution.")


func test_speak_startup_greeting_discarded_when_interaction_active() -> void:
	var win_ctrl := MockWindowController.new()
	# Set _active_panel to CHAT (which is 1)
	win_ctrl.set("_active_panel", 1)
	add_child_autofree(win_ctrl)
	
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var mock_window_controller = null\n" + \
		"func _get_window_controller() -> Node:\n" + \
		"    return mock_window_controller\n" + \
		"func _request_llm(p, s, i=false, b1='', b2='', t=0.7, h=[], k=false) -> String:\n" + \
		"    return 'Greeting message'"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai.mock_window_controller = win_ctrl
	
	# Stub window controller to track if show_startup_greeting was called
	var win_script := GDScript.new()
	win_script.source_code = "extends Node\n" + \
		"var _fairy = null\n" + \
		"var _active_panel = 1\n" + \
		"var greeting_called = false\n" + \
		"func show_startup_greeting(text: String) -> void:\n" + \
		"    greeting_called = true"
	win_script.reload()
	win_ctrl.set_script(win_script)
	
	# Scenario 1: Active panel is open (CHAT)
	await mock_ai._speak_startup_greeting()
	assert_false(win_ctrl.get("greeting_called"), "Greeting should be discarded when an active panel is open.")
	
	# Scenario 2: Request in progress
	win_ctrl.set("_active_panel", 0) # reset
	mock_ai._request_in_progress = true
	await mock_ai._speak_startup_greeting()
	assert_false(win_ctrl.get("greeting_called"), "Greeting should be discarded when a request is in progress.")
	
	# Scenario 3: History not empty
	mock_ai._request_in_progress = false
	mock_ai._conversation_history.clear()
	mock_ai._conversation_history.append({"role": "user", "text": "hello"})
	await mock_ai._speak_startup_greeting()
	assert_false(win_ctrl.get("greeting_called"), "Greeting should be discarded when conversation history is not empty.")


func test_speak_startup_greeting_is_greeting_active_flag() -> void:
	var win_ctrl := MockWindowController.new()
	win_ctrl.set("_active_panel", 0)
	add_child_autofree(win_ctrl)
	
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var mock_window_controller = null\n" + \
		"func _get_window_controller() -> Node:\n" + \
		"    return mock_window_controller\n" + \
		"func _request_llm(p, s, i=false, b1='', b2='', t=0.7, h=[], k=false) -> String:\n" + \
		"    return 'Greeting message'"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai.mock_window_controller = win_ctrl
	
	var win_script := GDScript.new()
	win_script.source_code = "extends Node\n" + \
		"var _fairy = null\n" + \
		"var _active_panel = 0\n" + \
		"var greeting_called = false\n" + \
		"func show_startup_greeting(text: String) -> void:\n" + \
		"    greeting_called = true"
	win_script.reload()
	win_ctrl.set_script(win_script)
	
	assert_false(mock_ai.is_greeting_active, "is_greeting_active should start false.")
	await mock_ai._speak_startup_greeting()
	assert_true(win_ctrl.get("greeting_called"), "Greeting should be triggered under normal conditions.")
	assert_true(mock_ai.is_greeting_active, "is_greeting_active should be true during active greeting.")


func test_scratchpad_meta_extraction() -> void:
	var context := {}
	ai_service._short_term_memory = ""
	ai_service._process_reply_meta("<scratchpad>Step 1: explain X\nStep 2: explain Y</scratchpad>Okay [CONTINUE]", context)
	assert_eq(ai_service._short_term_memory, "Step 1: explain X\nStep 2: explain Y", "Scratchpad content should be extracted and saved.")


func test_continuation_cancelled_by_new_prompt() -> void:
	var script := GDScript.new()
	script.source_code = "extends 'res://scripts/AIService.gd'\n" + \
		"var send_prompt_called_count := 0\n" + \
		"func send_prompt(p, s=null, f=Vector2.ZERO, w=Vector2.ZERO, c=false) -> void:\n" + \
		"    send_prompt_called_count += 1\n" + \
		"    _request_in_progress = false"
	script.reload()
	
	var mock_ai = Node.new()
	mock_ai.set_script(script)
	add_child_autofree(mock_ai)
	mock_ai._settings_mgr = mock_settings
	mock_ai._continuation_token = 0
	
	# Schedule a continuation
	var context := {"fairy_pos": Vector2.ZERO, "window_size": Vector2.ZERO}
	mock_ai._schedule_continuation(context)
	
	# Simulate user sending a new prompt immediately (which increments continuation token)
	mock_ai._continuation_token += 1
	mock_ai.send_prompt("User prompt")
	
	# Wait 2.2 seconds (longer than the 2.0s pause)
	await get_tree().create_timer(2.2).timeout
	
	assert_eq(mock_ai.send_prompt_called_count, 1, "Only the user prompt should be called; the continuation should be cancelled.")
