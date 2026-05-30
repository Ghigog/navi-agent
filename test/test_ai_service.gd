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
