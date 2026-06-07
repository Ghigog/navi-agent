extends GutTest
## Tests for EmotionPromptBuilder (NAV-62).
##
## Because EmotionPromptBuilder.build() reads from the EmotionState autoload,
## we set EmotionState values directly before each assertion.

var _builder_script: GDScript


func before_all() -> void:
	_builder_script = load("res://scripts/EmotionPromptBuilder.gd")


func before_each() -> void:
	# Reset EmotionState to a known baseline
	EmotionState.courage            = 0.0
	EmotionState.wisdom             = 0.0
	EmotionState.power              = 0.0
	EmotionState.emotion            = "serenity"
	EmotionState.love_score         = 0
	EmotionState.relationship_level = "acquaintance"


# ---------------------------------------------------------------------------
# Content correctness
# ---------------------------------------------------------------------------

func test_build_contains_current_emotion() -> void:
	EmotionState.emotion = "fear"
	var result: String = _builder_script.build()
	assert_true(result.contains("fear"),
		"Built string should contain the current emotion key.")


func test_build_contains_relationship_level() -> void:
	EmotionState.relationship_level = "friend"
	var result: String = _builder_script.build()
	assert_true(result.contains("friend"),
		"Built string should contain the current relationship level.")


func test_build_contains_emotion_tone_for_fear() -> void:
	EmotionState.emotion            = "fear"
	EmotionState.relationship_level = "friend"
	var result: String = _builder_script.build()
	# The fear tone guidance contains "Careful"
	assert_true(result.contains("Careful") or result.contains("fear"),
		"Built string should contain fear tone guidance.")


func test_build_contains_relationship_tone_for_friend() -> void:
	EmotionState.emotion            = "serenity"
	EmotionState.relationship_level = "friend"
	var result: String = _builder_script.build()
	# Friend tone contains "warm" or similar
	assert_true(result.to_lower().contains("warm") or result.contains("friend"),
		"Built string should contain friend relationship tone guidance.")


func test_build_contains_all_three_scores() -> void:
	EmotionState.courage = 5.0
	EmotionState.wisdom  = -3.0
	EmotionState.power   = 8.0
	var result: String = _builder_script.build()
	assert_true(result.contains("5") and result.contains("3") and result.contains("8"),
		"Built string should include all three dimension scores.")


func test_build_contains_love_score() -> void:
	EmotionState.love_score = 350
	var result: String = _builder_script.build()
	assert_true(result.contains("350"),
		"Built string should include the current love score.")


# ---------------------------------------------------------------------------
# Length / token budget
# ---------------------------------------------------------------------------

func test_build_contains_structural_elements() -> void:
	EmotionState.emotion            = "oblivion"
	EmotionState.relationship_level = "nemesis"
	EmotionState.courage            = -1.0
	EmotionState.wisdom             = -2.0
	EmotionState.power              = -3.0
	EmotionState.love_score         = -700
	var result: String = _builder_script.build()
	assert_true(result.contains("oblivion"), "Should contain current emotion.")
	assert_true(result.contains("nemesis"), "Should contain current relationship level.")
	assert_true(result.contains("-1") and result.contains("-2") and result.contains("-3"), "Should contain dimensions.")
	assert_true(result.contains("-700"), "Should contain love score.")


func test_build_non_empty_with_defaults() -> void:
	var result: String = _builder_script.build()
	assert_true(result.length() > 0,
		"build() should return a non-empty string with default EmotionState values.")


# ---------------------------------------------------------------------------
# All 8 emotions produce a non-empty, unique block
# ---------------------------------------------------------------------------

func test_all_emotions_produce_non_empty_blocks() -> void:
	var emotions := ["serenity", "happiness", "boredom", "fear",
					 "sadness", "anger", "pain", "oblivion"]
	for emotion in emotions:
		EmotionState.emotion = emotion
		var result: String = _builder_script.build()
		assert_true(result.length() > 0,
			"build() should return a non-empty string for emotion '%s'." % emotion)


func test_different_emotions_produce_different_blocks() -> void:
	EmotionState.emotion = "serenity"
	var serenity_block: String = _builder_script.build()

	EmotionState.emotion = "anger"
	var anger_block: String = _builder_script.build()

	assert_ne(serenity_block, anger_block,
		"Different emotions should produce different prompt blocks.")


func test_get_live_personality_matrix() -> void:
	var emotions := ["serenity", "happiness", "boredom", "fear", "sadness", "anger", "pain", "oblivion"]
	var relationships := ["nemesis", "enemy", "acquaintance", "friend", "best_friend"]

	for emotion in emotions:
		for rel in relationships:
			EmotionState.emotion = emotion
			EmotionState.relationship_level = rel
			var res: String = _builder_script.get_live_personality()
			assert_true(res.length() > 0, "Personality string should not be empty.")
			assert_true(res.contains(rel.replace("_", " ")), "Personality string should contain relationship level.")
