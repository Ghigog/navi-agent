extends Node
## Rule-based emotion scoring engine for the Triforce Emotion System.
##
## After each LLM response, [method evaluate] is called with a context
## dictionary describing the outcome. It scores the three base dimensions
## (Courage, Wisdom, Power), derives the Tier 2 composite emotion, updates
## the Love Meter, and emits [signal emotion_updated].
##
## Scoring is intentionally synchronous and rule-based (no extra LLM call)
## to keep latency near zero. See [url=res://emotions.md]emotions.md[/url]
## §4 for the full scoring rationale.

# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

## Emitted after every evaluation. Connect this to FairyVisuals and any
## other listeners that need to react to an emotion change.
## [param emotion]            — Tier 2 emotion key (e.g. "serenity", "fear")
## [param love_score]         — Updated cumulative Love Meter value [-1000, +1000]
## [param courage]            — Updated Courage score [-10, +10]
## [param wisdom]             — Updated Wisdom score  [-10, +10]
## [param power]              — Updated Power score   [-10, +10]
signal emotion_updated(emotion: String, love_score: int, courage: float, wisdom: float, power: float)

# ---------------------------------------------------------------------------
# Tier 2 emotion map
# Keyed by a 3-char string of "H"/"L" for [Courage][Wisdom][Power].
# ---------------------------------------------------------------------------

const _EMOTION_MAP := {
	"HHH": "serenity",
	"HLH": "happiness",
	"HHL": "boredom",
	"LHH": "fear",
	"LHL": "sadness",
	"LLH": "anger",
	"HLL": "pain",
	"LLL": "oblivion",
}

# ---------------------------------------------------------------------------
# Hedging phrases used to detect low-wisdom responses
# ---------------------------------------------------------------------------

const _HEDGING_PHRASES := [
	"i'm not sure", "i am not sure", "i don't know", "i do not know",
	"i'm unsure", "i am unsure", "i cannot be certain", "i'm uncertain",
	"i'm not certain", "i'm not confident", "i'm afraid i",
	"i don't have enough", "i lack the information",
]

# ---------------------------------------------------------------------------
# Relationship level thresholds (see emotions.md §5)
# ---------------------------------------------------------------------------

const _RELATIONSHIP_THRESHOLDS := [
	[-1000, -600, "nemesis"],
	[-599,  -200, "enemy"],
	[-199,   199, "acquaintance"],
	[200,    599, "friend"],
	[600,   1000, "best_friend"],
]

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

## Evaluate the outcome of a completed response and update [EmotionState].
##
## [param context] is a [Dictionary] with the following keys:[br]
## [code]intent_clear[/code]     [bool]   — prompt was parsed without ambiguity.[br]
## [code]skills_available[/code] [bool]   — at least one matching skill existed.[br]
## [code]skill_succeeded[/code]  [bool]   — all triggered skills completed without error.[br]
## [code]memory_entries[/code]   [int]    — number of relevant history/context entries.[br]
## [code]prompt_length[/code]    [int]    — word count of the user's prompt.[br]
## [code]response_text[/code]    [String] — the final LLM reply (for hedging detection).
func evaluate(context: Dictionary) -> void:
	var intent_clear:     bool   = context.get("intent_clear",     true)
	var skills_available: bool   = context.get("skills_available", false)
	var skill_succeeded:  bool   = context.get("skill_succeeded",  false)
	var memory_entries:   int    = context.get("memory_entries",   0)
	var retrieval_relevance: float = context.get("retrieval_relevance", 0.0)
	var prompt_length:    int    = context.get("prompt_length",    0)
	var response_text:    String = context.get("response_text",    "").to_lower()

	# Relevance flags (default to false if not provided)
	var courage_relevant: bool   = context.get("courage_relevant", false)
	var wisdom_relevant:  bool   = context.get("wisdom_relevant",  false)
	var power_relevant:   bool   = context.get("power_relevant",   false)
	var analysis_failed:  bool   = context.get("analysis_failed",  false)

	# ── Detect hedging ───────────────────────────────────────────────────
	var hedging_found: bool = _contains_hedging(response_text)

	# ── Courage score ─────────────────────────────────────────────────────
	var courage: float = EmotionState.courage
	var courage_contribution: float = 0.0
	if courage_relevant:
		courage = 0.0
		if intent_clear:
			courage += 5.0
		else:
			courage -= 5.0
		if memory_entries >= 3:
			courage += 3.0
		if prompt_length > 80:
			courage -= 4.0
		courage = clampf(courage, -10.0, 10.0)
		courage_contribution = courage

	# ── Wisdom score ──────────────────────────────────────────────────────
	var wisdom: float = EmotionState.wisdom
	var wisdom_contribution: float = 0.0
	if wisdom_relevant:
		wisdom = 0.0
		if retrieval_relevance >= 0.8:
			wisdom += 6.0
		elif retrieval_relevance >= 0.3:
			wisdom += 3.0
		elif retrieval_relevance == 0.0:
			wisdom -= 5.0
		if hedging_found:
			wisdom -= 3.0
		wisdom = clampf(wisdom, -10.0, 10.0)
		wisdom_contribution = wisdom

	# ── Power score ───────────────────────────────────────────────────────
	var power: float = EmotionState.power
	var power_contribution: float = 0.0
	if power_relevant:
		power = 0.0
		if analysis_failed:
			power -= 5.0
		elif skills_available and skill_succeeded:
			power += 7.0
		elif skills_available and not skill_succeeded:
			power += 3.0
		elif not skills_available:
			power -= 6.0
		power = clampf(power, -10.0, 10.0)
		power_contribution = power
	else:
		if analysis_failed:
			power -= 5.0
			power = clampf(power, -10.0, 10.0)
			power_contribution = -5.0

	# ── User Sentiment Adjustments ───────────────────────────────────────
	var user_sentiment: String = context.get("user_sentiment", "neutral")
	var sentiment_love_adjustment := 0
	if user_sentiment == "kind":
		courage += 3.0
		wisdom += 2.0
		sentiment_love_adjustment = 15
	elif user_sentiment == "mean":
		courage -= 5.0
		power -= 4.0
		sentiment_love_adjustment = -40

	courage = clampf(courage, -10.0, 10.0)
	wisdom = clampf(wisdom, -10.0, 10.0)
	power = clampf(power, -10.0, 10.0)

	# ── Derive Tier 2 emotion ─────────────────────────────────────────────
	var c_key := "H" if courage >= 0.0 else "L"
	var w_key := "H" if wisdom  >= 0.0 else "L"
	var p_key := "H" if power   >= 0.0 else "L"
	var emotion: String = _EMOTION_MAP.get(c_key + w_key + p_key, "serenity")

	# ── Update Love Meter ─────────────────────────────────────────────────
	var prompt_score: int = roundi(courage_contribution + wisdom_contribution + power_contribution) + sentiment_love_adjustment
	var prev_love: int    = EmotionState.love_score
	var prev_emotion: String = EmotionState.emotion
	var prev_relationship: String = EmotionState.relationship_level
	
	var is_pre_eval: bool = context.get("is_pre_eval", false)
	var new_love: int = prev_love
	if not is_pre_eval:
		new_love = clampi(prev_love + prompt_score, -1000, 1000)
		
	var relationship: String = _derive_relationship(new_love)

	# ── Persist ───────────────────────────────────────────────────────────
	EmotionState.courage            = courage
	EmotionState.wisdom             = wisdom
	EmotionState.power              = power
	EmotionState.emotion            = emotion
	EmotionState.love_score         = new_love
	EmotionState.relationship_level = relationship
	EmotionState.save()

	# ── Structured log ────────────────────────────────────────────────────
	print("EmotionEngine: ── EVALUATION ─────────────────────────────────────")
	print("EmotionEngine:   Input context:")
	print("EmotionEngine:     intent_clear     = ", intent_clear,
		  "  (prompt words: ", prompt_length, ")")
	print("EmotionEngine:     memory_entries   = ", memory_entries,
		  "  retrieval_relevance = ", retrieval_relevance)
	print("EmotionEngine:     skills_available = ", skills_available,
		  "  succeeded: ", skill_succeeded)
	print("EmotionEngine:     hedging detected = ", hedging_found)
	print("EmotionEngine:     user_sentiment   = ", user_sentiment)
	print("EmotionEngine:   Scores:")
	print("EmotionEngine:     Courage  → %+.1f  [%s]" % [courage, c_key])
	print("EmotionEngine:     Wisdom   → %+.1f  [%s]" % [wisdom,  w_key])
	print("EmotionEngine:     Power    → %+.1f  [%s]" % [power,   p_key])
	print("EmotionEngine:     Pattern  → %s" % (c_key + w_key + p_key))
	if prev_emotion != emotion:
		print("EmotionEngine:   Emotion  : %s  →  %s  ⟵ CHANGED" % [prev_emotion, emotion])
	else:
		print("EmotionEngine:   Emotion  : %s  (unchanged)" % emotion)
	print("EmotionEngine:   Love     : %+d → %d  (delta %+d)" % [prev_love, new_love, prompt_score])
	if prev_relationship != relationship:
		print("EmotionEngine:   Relation : %s  →  %s  ⟵ CHANGED" % [prev_relationship, relationship])
	else:
		print("EmotionEngine:   Relation : %s  (unchanged)" % relationship)
	print("EmotionEngine: ─────────────────────────────────────────────────────")

	emotion_updated.emit(emotion, new_love, courage, wisdom, power)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

func _contains_hedging(text: String) -> bool:
	for phrase in _HEDGING_PHRASES:
		if text.contains(phrase):
			return true
	return false


func _derive_relationship(score: int) -> String:
	for row in _RELATIONSHIP_THRESHOLDS:
		if score >= row[0] and score <= row[1]:
			return row[2]
	return "acquaintance"
