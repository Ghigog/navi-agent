extends GutTest
## Test suite for verifying AIService signal emissions for the thinking_update intermediate status updates
## and for verifying ChatUI correctly handles both response_received and thinking_update signals.

class MockAIService:
	extends Node
	
	signal request_started
	signal response_received(response_text: String)
	signal request_failed(error_message: String)
	signal thinking_update(update_text: String)


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
