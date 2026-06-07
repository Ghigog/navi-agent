extends Node
## Persistent data store for Navi's emotional state.
##
## Tracks the three base dimension scores (Courage, Wisdom, Power), the
## derived Tier 2 composite emotion, and the cumulative Love Meter.
## All values are persisted to [code]user://emotion_state.json[/code] so
## they survive across sessions.
##
## Registered as an Autoload singleton named [b]EmotionState[/b].
## See [url=res://emotions.md]emotions.md[/url] for the full system design.

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

const SAVE_PATH := "user://emotion_state.json"

## Valid Tier 2 emotion keys (see emotions.md §3).
const EMOTIONS := [
	"serenity", "happiness", "boredom", "fear",
	"sadness", "anger", "pain", "oblivion"
]

## Valid relationship level keys (see emotions.md §5).
const RELATIONSHIP_LEVELS := [
	"nemesis", "enemy", "acquaintance", "friend", "best_friend"
]

# ---------------------------------------------------------------------------
# Tier 1 base dimension scores  [-10.0, +10.0]
# ---------------------------------------------------------------------------

## Confidence in interpreting the user's intent (Green channel).
var courage: float = 0.0 :
	set(v): courage = clampf(v, -10.0, 10.0)

## Access to relevant knowledge and context (Blue channel).
var wisdom: float = 0.0 :
	set(v): wisdom = clampf(v, -10.0, 10.0)

## Ability to execute on the request (Red channel).
var power: float = 0.0 :
	set(v): power = clampf(v, -10.0, 10.0)

# ---------------------------------------------------------------------------
# Tier 2 composite emotion
# ---------------------------------------------------------------------------

## Current derived emotion key, e.g. "serenity", "fear", "oblivion".
var emotion: String = "serenity"

# ---------------------------------------------------------------------------
# Tier 3 Love Meter  [-1000, +1000]
# ---------------------------------------------------------------------------

## Cumulative relationship score. Clamped to [-1000, +1000].
var love_score: int = 0 :
	set(v): love_score = clampi(v, -1000, 1000)

## Derived relationship level string.
## One of: "nemesis" | "enemy" | "acquaintance" | "friend" | "best_friend".
var relationship_level: String = "acquaintance"

# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

func _ready() -> void:
	if FileAccess.file_exists(SAVE_PATH):
		print("EmotionState: ── STARTUP ──────────────────────────────────────")
		print("EmotionState:   Saved state found. Restoring from ", SAVE_PATH)
		load_state()
		print("EmotionState:   Restored → ", debug_string())
	else:
		print("EmotionState: ── STARTUP ──────────────────────────────────────")
		print("EmotionState:   No saved state found. Starting fresh with defaults.")
		print("EmotionState:   Defaults → ", debug_string())
	print("EmotionState: ─────────────────────────────────────────────────────")


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

## Serialise the current state to [code]user://emotion_state.json[/code].
func save() -> void:
	var data := {
		"courage": courage,
		"wisdom": wisdom,
		"power": power,
		"emotion": emotion,
		"love_score": love_score,
		"relationship_level": relationship_level,
	}
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		printerr("EmotionState: could not open %s for writing (error %d)" % [SAVE_PATH, FileAccess.get_open_error()])
		return
	file.store_string(JSON.stringify(data, "\t"))
	file.close()
	print("EmotionState: 💾 Saved → ", debug_string())


## Deserialise state from [code]user://emotion_state.json[/code].
## Falls back to defaults silently if the file does not exist.
func load_state() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return

	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		printerr("EmotionState: could not open %s for reading (error %d)" % [SAVE_PATH, FileAccess.get_open_error()])
		return

	var raw := file.get_as_text()
	file.close()

	var json := JSON.new()
	var parse_err := json.parse(raw)
	if parse_err != OK or not json.data is Dictionary:
		printerr("EmotionState: malformed JSON in %s — resetting to defaults." % SAVE_PATH)
		return

	var d: Dictionary = json.data
	courage           = float(d.get("courage",           0.0))
	wisdom            = float(d.get("wisdom",            0.0))
	power             = float(d.get("power",             0.0))
	emotion           = str(d.get("emotion",           "serenity"))
	love_score        = int(d.get("love_score",         0))
	relationship_level = str(d.get("relationship_level", "acquaintance"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

## Returns a human-readable summary for debugging.
func debug_string() -> String:
	return "EmotionState[emotion=%s love=%d(%s) C=%.1f W=%.1f P=%.1f]" % [
		emotion, love_score, relationship_level, courage, wisdom, power
	]
