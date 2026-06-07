extends GutTest
## Tests for the EmotionEngine rule-based scoring system (NAV-61).

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


# ---------------------------------------------------------------------------
# Tier 2 emotion derivation
# ---------------------------------------------------------------------------

func test_all_positive_produces_serenity() -> void:
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     true,
		"skills_available": true,
		"skill_succeeded":  true,
		"memory_entries":   6,
		"prompt_length":    5,
		"response_text":    "Here you go!",
	})
	assert_eq(EmotionState.emotion, "serenity",
		"All positive inputs should produce serenity.")


func test_all_negative_produces_oblivion() -> void:
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     false,
		"skills_available": false,
		"skill_succeeded":  false,
		"memory_entries":   0,
		"prompt_length":    5,
		"response_text":    "I don't know.",
	})
	assert_eq(EmotionState.emotion, "oblivion",
		"All negative inputs should produce oblivion.")


func test_courage_only_produces_pain() -> void:
	# High courage, low wisdom (no memory), low power (no skills)
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     true,
		"skills_available": false,
		"skill_succeeded":  false,
		"memory_entries":   0,
		"prompt_length":    5,
		"response_text":    "I'll try my best.",
	})
	assert_eq(EmotionState.emotion, "pain",
		"High courage, low wisdom, low power should produce pain.")


func test_high_power_wisdom_low_courage_produces_fear() -> void:
	# Low courage (unclear intent), high wisdom, high power
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     false,
		"skills_available": true,
		"skill_succeeded":  true,
		"memory_entries":   6,
		"prompt_length":    5,
		"response_text":    "Done.",
	})
	assert_eq(EmotionState.emotion, "fear",
		"Low courage, high wisdom, high power should produce fear.")


# ---------------------------------------------------------------------------
# Relevance Flags (NAV-61 relevance logic)
# ---------------------------------------------------------------------------

func test_relevance_flags_default_false() -> void:
	EmotionState.courage = 5.0
	EmotionState.wisdom = 5.0
	EmotionState.power = 5.0
	EmotionState.love_score = 100
	engine.evaluate({
		"intent_clear": true,
		"skills_available": true,
		"skill_succeeded": true,
		"memory_entries": 6,
		"prompt_length": 5,
		"response_text": "Done",
	})
	assert_eq(EmotionState.courage, 5.0, "Courage should not change when courage_relevant is false.")
	assert_eq(EmotionState.wisdom, 5.0, "Wisdom should not change when wisdom_relevant is false.")
	assert_eq(EmotionState.power, 5.0, "Power should not change when power_relevant is false.")
	assert_eq(EmotionState.love_score, 100, "Love score should not change when all relevance flags are false.")


func test_courage_penalty_for_long_prompt() -> void:
	engine.evaluate({
		"courage_relevant": true,
		"intent_clear": true,
		"prompt_length": 81,
	})
	assert_eq(EmotionState.courage, 1.0, "Long prompt should apply courage penalty (+5 - 4 = +1).")


func test_wisdom_deduction_for_hedging_phrases() -> void:
	engine.evaluate({
		"wisdom_relevant": true,
		"memory_entries": 3,
		"response_text": "i don't know the answer",
	})
	assert_eq(EmotionState.wisdom, 0.0, "Hedging response should deduct wisdom score (+3 - 3 = 0).")


func test_partial_power_credit() -> void:
	engine.evaluate({
		"power_relevant": true,
		"skills_available": true,
		"skill_succeeded": false,
	})
	assert_eq(EmotionState.power, 3.0, "Failed skill with skills available should get partial power credit (+3).")


func test_exact_love_meter_delta() -> void:
	EmotionState.love_score = 100
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant": true,
		"power_relevant": true,
		"intent_clear": true,
		"memory_entries": 3,
		"skills_available": true,
		"skill_succeeded": true,
	})
	# Courage = +8 (clear intent +5, memory entries >= 3 -> +3)
	# Wisdom = +3 (memory entries >= 2 -> +3)
	# Power = +7 (skills available and succeeded -> +7)
	# Delta = 8 + 3 + 7 = 18
	assert_eq(EmotionState.love_score, 118, "Love meter should increase by the exact prompt score sum.")


func test_emotion_updated_signal_parameters() -> void:
	watch_signals(engine)
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant": true,
		"power_relevant": true,
		"intent_clear": true,
		"memory_entries": 3,
		"skills_available": true,
		"skill_succeeded": true,
		"is_pre_eval": false,
	})
	assert_signal_emitted_with_parameters(engine, "emotion_updated", ["serenity", 18, 8.0, 3.0, 7.0], 0)


# ---------------------------------------------------------------------------
# Derived composite emotions (Remaining 4)
# ---------------------------------------------------------------------------

func test_happiness_derived() -> void:
	# HLH -> Happiness (courage >= 1, wisdom < 1, power >= 1)
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant": true,
		"power_relevant": true,
		"intent_clear": true,
		"memory_entries": 0,
		"skills_available": true,
		"skill_succeeded": true,
	})
	assert_eq(EmotionState.emotion, "happiness", "HLH should map to happiness.")


func test_boredom_derived() -> void:
	# HHL -> Boredom (courage >= 1, wisdom >= 1, power < 1)
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant": true,
		"power_relevant": true,
		"intent_clear": true,
		"memory_entries": 5,
		"skills_available": false,
	})
	assert_eq(EmotionState.emotion, "boredom", "HHL should map to boredom.")


func test_sadness_derived() -> void:
	# LHL -> Sadness (courage < 1, wisdom >= 1, power < 1)
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant": true,
		"power_relevant": true,
		"intent_clear": false,
		"memory_entries": 5,
		"skills_available": false,
	})
	assert_eq(EmotionState.emotion, "sadness", "LHL should map to sadness.")


func test_anger_derived() -> void:
	# LLH -> Anger (courage < 1, wisdom < 1, power >= 1)
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant": true,
		"power_relevant": true,
		"intent_clear": false,
		"memory_entries": 0,
		"skills_available": true,
		"skill_succeeded": true,
	})
	assert_eq(EmotionState.emotion, "anger", "LLH should map to anger.")


# ---------------------------------------------------------------------------
# Love Meter accumulation
# ---------------------------------------------------------------------------

func test_love_score_increases_on_positive_evaluation() -> void:
	var before: int = EmotionState.love_score
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     true,
		"skills_available": true,
		"skill_succeeded":  true,
		"memory_entries":   6,
		"prompt_length":    5,
		"response_text":    "Done!",
	})
	assert_gt(EmotionState.love_score, before,
		"Love score should increase after a positive evaluation.")


func test_love_score_decreases_on_negative_evaluation() -> void:
	var before: int = EmotionState.love_score
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     false,
		"skills_available": false,
		"skill_succeeded":  false,
		"memory_entries":   0,
		"prompt_length":    5,
		"response_text":    "I don't know.",
	})
	assert_lt(EmotionState.love_score, before,
		"Love score should decrease after a negative evaluation.")


func test_love_score_never_exceeds_max() -> void:
	EmotionState.love_score = 995
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     true,
		"skills_available": true,
		"skill_succeeded":  true,
		"memory_entries":   6,
		"prompt_length":    5,
		"response_text":    "Perfect.",
	})
	assert_lte(EmotionState.love_score, 1000,
		"Love score must never exceed 1000.")


func test_love_score_never_falls_below_min() -> void:
	EmotionState.love_score = -995
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     false,
		"skills_available": false,
		"skill_succeeded":  false,
		"memory_entries":   0,
		"prompt_length":    5,
		"response_text":    "I'm not sure.",
	})
	assert_gte(EmotionState.love_score, -1000,
		"Love score must never fall below -1000.")


# ---------------------------------------------------------------------------
# Relationship level derivation
# ---------------------------------------------------------------------------
# All five tests use the same all-positive evaluate context.
# Courage = +8, Wisdom = +6, Power = +7 → prompt_score = +21.
# Starting each test at the mid-point of the target band guarantees the +21
# delta cannot cross a band boundary, so assertions need no conditional guard.
const _POSITIVE_CTX := {
	"courage_relevant": true,
	"wisdom_relevant":  true,
	"power_relevant":   true,
	"intent_clear":     true,
	"skills_available": true,
	"skill_succeeded":  true,
	"memory_entries":   6,
	"prompt_length":    5,
	"response_text":    "Done.",
}


func test_nemesis_band_yields_nemesis() -> void:
	EmotionState.love_score = -800  # mid-nemesis; +21 delta → -779, still in [-1000, -600]
	engine.evaluate(_POSITIVE_CTX)
	assert_eq(EmotionState.relationship_level, "nemesis",
		"Love score in nemesis band should yield 'nemesis'.")


func test_enemy_band_yields_enemy() -> void:
	EmotionState.love_score = -400  # mid-enemy; +21 delta → -379, still in [-599, -200]
	engine.evaluate(_POSITIVE_CTX)
	assert_eq(EmotionState.relationship_level, "enemy",
		"Love score in enemy band should yield 'enemy'.")


func test_acquaintance_band_yields_acquaintance() -> void:
	EmotionState.love_score = 0  # mid-acquaintance; +21 delta → 21, still in [-199, 199]
	engine.evaluate(_POSITIVE_CTX)
	assert_eq(EmotionState.relationship_level, "acquaintance",
		"Love score in acquaintance band should yield 'acquaintance'.")


func test_friend_band_yields_friend() -> void:
	EmotionState.love_score = 400  # mid-friend; +21 delta → 421, still in [200, 599]
	engine.evaluate(_POSITIVE_CTX)
	assert_eq(EmotionState.relationship_level, "friend",
		"Love score in friend band should yield 'friend'.")


func test_best_friend_band_yields_best_friend() -> void:
	EmotionState.love_score = 800  # mid-best-friend; +21 delta → 821, still in [600, 1000]
	engine.evaluate(_POSITIVE_CTX)
	assert_eq(EmotionState.relationship_level, "best_friend",
		"Love score in best-friend band should yield 'best_friend'.")


# ---------------------------------------------------------------------------
# emotion_updated signal
# ---------------------------------------------------------------------------

func test_emotion_updated_signal_emitted() -> void:
	watch_signals(engine)
	engine.evaluate({
		"courage_relevant": true,
		"wisdom_relevant":  true,
		"power_relevant":   true,
		"intent_clear":     true,
		"skills_available": true,
		"skill_succeeded":  true,
		"memory_entries":   3,
		"prompt_length":    4,
		"response_text":    "Done.",
	})
	assert_signal_emitted(engine, "emotion_updated",
		"emotion_updated signal should be emitted after evaluate().")
