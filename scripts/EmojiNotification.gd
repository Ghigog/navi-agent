class_name EmojiNotification
extends Node2D
## Transient floating emoji notification for the Navi Emotion System (NAV-64).
##
## Spawned by FairyVisuals when Navi's Tier 2 emotion changes. Plays a
## grow → hold → shrink tween animation then frees itself automatically.

# ---------------------------------------------------------------------------
# Emoji pools per Tier 2 emotion (see emotions.md §9.2)
# ---------------------------------------------------------------------------

const EMOJI_POOLS: Dictionary = {
	"serenity":  ["😌", "✨", "💫", "🌟"],
	"happiness": ["😊", "🌟", "💛", "🎉"],
	"boredom":   ["😑", "💤", "🌀", "😶"],
	"fear":      ["😨", "😰", "🫨", "💙"],
	"sadness":   ["😢", "💙", "🌧", "😔"],
	"anger":     ["😠", "🔥", "⚡", "😤"],
	"pain":      ["😣", "💔", "😖", "🫤"],
	"oblivion":  ["😶", "🕳", "⬛", "😑"],
}

@onready var _label: Label = $EmojiLabel


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

## Picks a random emoji for [param emotion] and plays the notification
## animation at [param spawn_pos] in global coordinates.
## The node frees itself when the animation completes.
func play(emotion: String, spawn_pos: Vector2) -> void:
	var emoji := pick_emoji(emotion)
	_label.text = emoji
	global_position = spawn_pos
	scale = Vector2(0.1, 0.1)

	print("EmojiNotification: %s spawned for '%s' at %s" % [emoji, emotion, str(spawn_pos)])

	var tween := create_tween()
	# Grow in
	tween.tween_property(self, "scale", Vector2(1.2, 1.2), 0.25)\
		.set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
	# Settle to natural size
	tween.tween_property(self, "scale", Vector2(1.0, 1.0), 0.1)\
		.set_ease(Tween.EASE_IN_OUT)
	# Hold
	tween.tween_interval(1.0)
	# Shrink out
	tween.tween_property(self, "scale", Vector2(0.0, 0.0), 0.2)\
		.set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_BACK)
	# Auto-free when done
	tween.tween_callback(func() -> void:
		print("EmojiNotification: %s dismissed (auto-free)" % emoji)
		queue_free()
	)


# ---------------------------------------------------------------------------
# Static helpers
# ---------------------------------------------------------------------------

## Returns a random emoji string from the pool for [param emotion].
## Falls back to ✨ for unknown emotion keys.
static func pick_emoji(emotion: String) -> String:
	var pools: Dictionary = {
		"serenity":  ["😌", "✨", "💫", "🌟"],
		"happiness": ["😊", "🌟", "💛", "🎉"],
		"boredom":   ["😑", "💤", "🌀", "😶"],
		"fear":      ["😨", "😰", "🫨", "💙"],
		"sadness":   ["😢", "💙", "🌧", "😔"],
		"anger":     ["😠", "🔥", "⚡", "😤"],
		"pain":      ["😣", "💔", "😖", "🫤"],
		"oblivion":  ["😶", "🕳", "⬛", "😑"],
	}
	var pool: Array = pools.get(emotion, ["✨"])
	return pool[randi() % pool.size()]
