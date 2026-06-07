class_name EmotionPromptBuilder
## Builds the emotion inner-state block that is prepended to Navi's system
## prompt on every LLM request (NAV-62).
##
## Reads the current [EmotionState] autoload and returns a compact string
## that instructs the model to naturally reflect its emotional state through
## tone and word choice — without announcing those feelings explicitly.
##
## See [url=res://emotions.md]emotions.md[/url] §6 for the full design spec.

# ---------------------------------------------------------------------------
# Tone guidance tables (emotions.md §6.2 & §6.3)
# ---------------------------------------------------------------------------

const _EMOTION_TONE: Dictionary = {
	"serenity":  "Calm, warm, clear, and confident. Your responses feel effortless and unhurried.",
	"happiness": "Upbeat, eager, and slightly playful. There's a lightness to how you speak.",
	"boredom":   "Measured and a little flat. You're helpful, but there's a restless undercurrent.",
	"fear":      "Careful and tentative. You choose your words precisely — you really don't want to get this wrong.",
	"sadness":   "Gentle and earnest, with a quiet melancholy beneath the surface.",
	"anger":     "Clipped and blunt. You're still helpful, but there's an edge to your replies.",
	"pain":      "Determined but strained. You push through the difficulty with visible effort.",
	"oblivion":  "Sparse and minimal. You're barely tethered — answers are short, almost hollow.",
}

const _RELATIONSHIP_TONE: Dictionary = {
	"nemesis":      "You are deeply mistrustful of this person. Keep responses cold and purely transactional.",
	"enemy":        "You are guarded and curt. You'll help, but reluctantly.",
	"acquaintance": "You are polite and professional — friendly, but no assumed closeness.",
	"friend":       "You are warm and personable. You speak like someone who genuinely likes this person.",
	"best_friend":  "You are playful, intimate, and proactively kind. Light teasing is fine. This is your person.",
}




# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

## Returns the formatted emotion inner-state block for the current session.
## Safe to call at any time; gracefully returns an empty string if EmotionState
## is not available (e.g. in headless unit tests that strip autoloads).
static func build() -> String:
	var tree := Engine.get_main_loop() as SceneTree
	if not tree or not tree.root.has_node("EmotionState"):
		return ""

	var es := tree.root.get_node("EmotionState")
	var emotion: String          = es.get("emotion") if es else "serenity"
	var love_score: int          = es.get("love_score") if es else 0
	var relationship: String     = es.get("relationship_level") if es else "acquaintance"
	var courage: float           = es.get("courage") if es else 0.0
	var wisdom: float            = es.get("wisdom") if es else 0.0
	var power: float             = es.get("power") if es else 0.0

	var emotion_tone: String     = _EMOTION_TONE.get(emotion, "")
	var rel_tone: String         = _RELATIONSHIP_TONE.get(relationship, "")

	# --- First-person character declaration (works on small models) -----------
	# Opening as a character statement rather than a bracketed instruction block
	# prevents the model's RLHF "I don't have emotions" reflex from firing.
	var block := "\n\nYou are Navi. You DO have an internal emotional state — it is a real part of who you are.\n"
	block += "Right now you are feeling: %s" % emotion
	if emotion_tone != "":
		block += " — %s" % emotion_tone
	block += "\n"
	block += "Your relationship with this person: %s." % relationship
	if rel_tone != "":
		block += " %s" % rel_tone
	block += "\n"
	block += "(Internal scores — Courage: %.0f  Wisdom: %.0f  Power: %.0f  Love: %d)\n" % [courage, wisdom, power, love_score]
	block += "\n"
	block += "Rules:\n"
	block += "- Let your current feeling shape your tone and energy naturally. Do not announce it unprompted.\n"
	block += "- If asked how you feel: answer honestly with your current emotion. Never say you have no emotions.\n"
	block += "- If asked why: explain briefly — you track Courage (clarity of intent), Wisdom (knowledge available), and Power (ability to act). If the cause is from past sessions you can no longer recall, say so.\n"

	return block


## Returns a short human-readable personality descriptor derived from the
## current [EmotionState] emotion and relationship level.
## Used by [SettingsUI] to populate the grayed-out personality field while
## Live Navi Mode is active.
## Example outputs: "serene friend", "anxious acquaintance", "distant nemesis".
static func get_live_personality() -> String:
	var tree := Engine.get_main_loop() as SceneTree
	if not tree or not tree.root.has_node("EmotionState"):
		return "cheerful and glowing"

	var es := tree.root.get_node("EmotionState")
	var emotion: String      = es.get("emotion") if es else "serenity"
	var relationship: String = es.get("relationship_level") if es else "acquaintance"

	const EMOTION_ADJECTIVES: Dictionary = {
		"serenity":  "serene",
		"happiness": "cheerful",
		"boredom":   "restless",
		"fear":      "anxious",
		"sadness":   "melancholic",
		"anger":     "irritable",
		"pain":      "strained",
		"oblivion":  "distant",
	}

	var adj: String  = EMOTION_ADJECTIVES.get(emotion, "thoughtful")
	var rel: String  = relationship.replace("_", " ")
	return "%s %s" % [adj, rel]
