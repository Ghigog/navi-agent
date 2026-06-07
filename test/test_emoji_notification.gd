extends GutTest
## Tests for the EmojiNotification system (NAV-64).

# ---------------------------------------------------------------------------
# pick_emoji static helper
# ---------------------------------------------------------------------------

func test_pick_emoji_serenity_is_valid() -> void:
	var valid := ["😌", "✨", "💫", "🌟"]
	var result := EmojiNotification.pick_emoji("serenity")
	assert_true(result in valid,
		"pick_emoji('serenity') should return one of the serenity pool values.")


func test_pick_emoji_oblivion_does_not_crash() -> void:
	var result := EmojiNotification.pick_emoji("oblivion")
	assert_true(result.length() > 0,
		"pick_emoji('oblivion') should return a non-empty string.")


func test_pick_emoji_unknown_emotion_returns_fallback() -> void:
	var result := EmojiNotification.pick_emoji("nonexistent_emotion")
	assert_eq(result, "✨",
		"Unknown emotion should fall back to ✨.")


func test_pick_emoji_all_known_emotions_return_non_empty() -> void:
	var known := ["serenity", "happiness", "boredom", "fear",
				  "sadness", "anger", "pain", "oblivion"]
	for emotion in known:
		var result := EmojiNotification.pick_emoji(emotion)
		assert_true(result.length() > 0,
			"pick_emoji('%s') should return a non-empty string." % emotion)


# ---------------------------------------------------------------------------
# Deduplication guard via FairyVisuals
# ---------------------------------------------------------------------------

func test_no_duplicate_spawn_on_same_emotion() -> void:
	var fairy_scene: PackedScene = load("res://scenes/FairyVisuals.tscn")
	var fairy: Node2D = fairy_scene.instantiate()
	add_child_autofree(fairy)

	# Manually set last_emotion and try spawning the same emotion
	fairy._last_emotion = "serenity"
	var before_count := get_tree().root.get_child_count()
	fairy.spawn_emoji_notification("serenity")  # same emotion — should no-op
	var after_count := get_tree().root.get_child_count()
	assert_eq(before_count, after_count,
		"No emoji node should be added when emotion is unchanged.")


func test_spawn_on_new_emotion_adds_child() -> void:
	var fairy_scene: PackedScene = load("res://scenes/FairyVisuals.tscn")
	var fairy: Node2D = fairy_scene.instantiate()
	add_child_autofree(fairy)

	fairy._last_emotion = "serenity"
	var before_count := get_tree().root.get_child_count()
	fairy.spawn_emoji_notification("anger")  # different emotion — should spawn
	var after_count := get_tree().root.get_child_count()
	assert_eq(after_count, before_count + 1,
		"A new emoji node should be added when emotion changes.")
	assert_eq(fairy._last_emotion, "anger",
		"_last_emotion should update to the new emotion after spawning.")
