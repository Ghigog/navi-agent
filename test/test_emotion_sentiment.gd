extends GutTest
## Tests for user sentiment evaluation (kind vs mean) in EmotionEngine.

var engine: Node


func before_each() -> void:
	engine = load("res://scripts/EmotionEngine.gd").new()
	add_child_autofree(engine)
	# Reset EmotionState to baseline so each test starts from zero
	EmotionState.courage            = 0.0
	EmotionState.wisdom             = 0.0
	EmotionState.power              = 0.0
	EmotionState.emotion            = "serenity"
	EmotionState.love_score         = 0
	EmotionState.relationship_level = "acquaintance"


func test_kind_sentiment_increases_love_and_dimensions() -> void:
	engine.evaluate({
		"user_sentiment": "kind",
		"courage_relevant": false,
		"wisdom_relevant": false,
		"power_relevant": false,
		"intent_clear": true,
		"skills_available": false,
		"skill_succeeded": false,
		"memory_entries": 0,
		"prompt_length": 5,
		"response_text": "Thank you!",
	})
	assert_eq(EmotionState.love_score, 15, "Kind sentiment should increase love score by +15.")
	assert_eq(EmotionState.courage, 3.0, "Kind sentiment should increase courage by +3.0.")
	assert_eq(EmotionState.wisdom, 2.0, "Kind sentiment should increase wisdom by +2.0.")
	assert_eq(EmotionState.power, 0.0, "Kind sentiment should not affect power.")


func test_mean_sentiment_decreases_love_and_dimensions() -> void:
	engine.evaluate({
		"user_sentiment": "mean",
		"courage_relevant": false,
		"wisdom_relevant": false,
		"power_relevant": false,
		"intent_clear": true,
		"skills_available": false,
		"skill_succeeded": false,
		"memory_entries": 0,
		"prompt_length": 5,
		"response_text": "You are stupid.",
	})
	assert_eq(EmotionState.love_score, -40, "Mean sentiment should decrease love score by -40.")
	assert_eq(EmotionState.courage, -5.0, "Mean sentiment should decrease courage by -5.0.")
	assert_eq(EmotionState.wisdom, 0.0, "Mean sentiment should not affect wisdom.")
	assert_eq(EmotionState.power, -4.0, "Mean sentiment should decrease power by -4.0.")


func test_pre_eval_kind_sentiment_changes_dimensions_but_not_love() -> void:
	engine.evaluate({
		"user_sentiment": "kind",
		"is_pre_eval": true,
		"courage_relevant": false,
		"wisdom_relevant": false,
		"power_relevant": false,
		"intent_clear": true,
		"skills_available": false,
		"skill_succeeded": false,
		"memory_entries": 0,
		"prompt_length": 5,
		"response_text": "Thank you!",
	})
	assert_eq(EmotionState.love_score, 0, "Pre-evaluation should not modify love score.")
	assert_eq(EmotionState.courage, 3.0, "Pre-evaluation kind sentiment should still update courage.")
	assert_eq(EmotionState.wisdom, 2.0, "Pre-evaluation kind sentiment should still update wisdom.")
