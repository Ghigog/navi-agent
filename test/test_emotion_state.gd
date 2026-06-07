extends GutTest
## Tests for the EmotionState autoload data model (NAV-60).
##
## Because EmotionState is a real Autoload, we reset its values in before_each
## to ensure test isolation.

func before_each() -> void:
	# Reset to clean defaults before each test
	EmotionState.courage            = 0.0
	EmotionState.wisdom             = 0.0
	EmotionState.power              = 0.0
	EmotionState.emotion            = "serenity"
	EmotionState.love_score         = 0
	EmotionState.relationship_level = "acquaintance"


# ---------------------------------------------------------------------------
# Default state
# ---------------------------------------------------------------------------

func test_default_values() -> void:
	assert_eq(EmotionState.courage,            0.0,           "Default courage should be 0.")
	assert_eq(EmotionState.wisdom,             0.0,           "Default wisdom should be 0.")
	assert_eq(EmotionState.power,              0.0,           "Default power should be 0.")
	assert_eq(EmotionState.emotion,            "serenity",    "Default emotion should be serenity.")
	assert_eq(EmotionState.love_score,         0,             "Default love score should be 0.")
	assert_eq(EmotionState.relationship_level, "acquaintance","Default relationship should be acquaintance.")


# ---------------------------------------------------------------------------
# Clamp guards
# ---------------------------------------------------------------------------

func test_courage_clamped_above() -> void:
	EmotionState.courage = 15.0
	assert_eq(EmotionState.courage, 10.0, "Courage above 10 should clamp to 10.")

func test_courage_clamped_below() -> void:
	EmotionState.courage = -15.0
	assert_eq(EmotionState.courage, -10.0, "Courage below -10 should clamp to -10.")

func test_wisdom_clamped_above() -> void:
	EmotionState.wisdom = 99.0
	assert_eq(EmotionState.wisdom, 10.0, "Wisdom above 10 should clamp to 10.")

func test_wisdom_clamped_below() -> void:
	EmotionState.wisdom = -99.0
	assert_eq(EmotionState.wisdom, -10.0, "Wisdom below -10 should clamp to -10.")

func test_power_clamped_above() -> void:
	EmotionState.power = 100.0
	assert_eq(EmotionState.power, 10.0, "Power above 10 should clamp to 10.")

func test_power_clamped_below() -> void:
	EmotionState.power = -100.0
	assert_eq(EmotionState.power, -10.0, "Power below -10 should clamp to -10.")

func test_love_score_clamped_above() -> void:
	EmotionState.love_score = 9999
	assert_eq(EmotionState.love_score, 1000, "Love score above 1000 should clamp to 1000.")

func test_love_score_clamped_below() -> void:
	EmotionState.love_score = -9999
	assert_eq(EmotionState.love_score, -1000, "Love score below -1000 should clamp to -1000.")


# ---------------------------------------------------------------------------
# Save / load round-trip
# ---------------------------------------------------------------------------

func test_save_and_reload() -> void:
	EmotionState.courage            = 7.5
	EmotionState.wisdom             = -3.0
	EmotionState.power              = 10.0
	EmotionState.emotion            = "happiness"
	EmotionState.love_score         = 350
	EmotionState.relationship_level = "friend"
	EmotionState.save()

	# Reset in-memory to defaults, then reload from disk
	EmotionState.courage            = 0.0
	EmotionState.wisdom             = 0.0
	EmotionState.power              = 0.0
	EmotionState.emotion            = "serenity"
	EmotionState.love_score         = 0
	EmotionState.relationship_level = "acquaintance"

	EmotionState.load_state()

	assert_almost_eq(EmotionState.courage, 7.5,  0.01, "Courage should round-trip through save/load.")
	assert_almost_eq(EmotionState.wisdom, -3.0,  0.01, "Wisdom should round-trip through save/load.")
	assert_almost_eq(EmotionState.power,  10.0,  0.01, "Power should round-trip through save/load.")
	assert_eq(EmotionState.emotion,            "happiness", "Emotion should round-trip through save/load.")
	assert_eq(EmotionState.love_score,         350,          "Love score should round-trip through save/load.")
	assert_eq(EmotionState.relationship_level, "friend",    "Relationship should round-trip through save/load.")


func test_debug_string_is_non_empty() -> void:
	var s: String = EmotionState.debug_string()
	assert_true(s.length() > 0, "debug_string() should return a non-empty string.")
	assert_true(s.contains("EmotionState"), "debug_string() should contain EmotionState prefix.")


func test_load_state_malformed_json() -> void:
	# Set non-default values in memory
	EmotionState.courage            = 7.5
	EmotionState.wisdom             = -3.0
	EmotionState.power              = 10.0
	EmotionState.emotion            = "happiness"
	EmotionState.love_score         = 350
	EmotionState.relationship_level = "friend"

	# Write corrupted JSON to disk
	var file := FileAccess.open(EmotionState.SAVE_PATH, FileAccess.WRITE)
	assert_not_null(file, "Should be able to open save file for writing.")
	file.store_string("{ invalid json : [unclosed }")
	file.close()

	# Load state should handle the malformed JSON gracefully and leave the memory state intact
	EmotionState.load_state()

	assert_almost_eq(EmotionState.courage, 7.5,  0.01, "Courage should remain at pre-load value.")
	assert_almost_eq(EmotionState.wisdom, -3.0,  0.01, "Wisdom should remain at pre-load value.")
	assert_almost_eq(EmotionState.power,  10.0,  0.01, "Power should remain at pre-load value.")
	assert_eq(EmotionState.emotion,            "happiness", "Emotion should remain at pre-load value.")
	assert_eq(EmotionState.love_score,         350,          "Love score should remain at pre-load value.")
	assert_eq(EmotionState.relationship_level, "friend",    "Relationship should remain at pre-load value.")

	# Cleanup by deleting the invalid file
	DirAccess.remove_absolute(EmotionState.SAVE_PATH)
