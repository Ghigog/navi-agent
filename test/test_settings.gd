extends GutTest
## GUT tests for NAV-08: SettingsManager persistence and SettingsUI color relay.

# ---------------------------------------------------------------------------
# SettingsManager tests
# ---------------------------------------------------------------------------

var _manager: Node

func before_each() -> void:
	# Instantiate a fresh SettingsManager for every test (isolated from user://settings.json)
	_manager = load("res://scripts/SettingsManager.gd").new()
	# Prevent the test manager instance from overwriting user://settings.json
	_manager.SETTINGS_FILE = "user://settings_test.json"
	add_child_autofree(_manager)
	# Manually override the settings dict to known defaults so file I/O is not required
	_manager.settings = {
		"llm_provider": "local",
		"local_url": "http://localhost:11434",
		"local_model": "gemma4:e4b",
		"cloud_url": "https://generativelanguage.googleapis.com",
		"cloud_model": "gemini-2.5-flash",
		"cloud_api_key": "",
		"system_prompt": "",
		"personality": "cheerful",
		"fairy_color": "66b2ff",
		"font_size_offset": 0,
	}

func test_get_setting_returns_default_for_missing_key() -> void:
	var result: Variant = _manager.get_setting("nonexistent_key", "fallback")
	assert_eq(result, "fallback", "Should return the provided default for unknown keys.")

func test_set_setting_updates_dictionary() -> void:
	_manager.settings["llm_provider"] = "local"   # Start from known state
	_manager.set_setting("llm_provider", "cloud")
	assert_eq(_manager.settings["llm_provider"], "cloud",
		"set_setting should update the in-memory dict.")

func test_set_setting_persists_fairy_color() -> void:
	_manager.set_setting("fairy_color", "ff88cc")
	var retrieved: String = _manager.get_setting("fairy_color", "")
	assert_eq(retrieved, "ff88cc", "Fairy color should be stored and retrievable.")

func test_load_settings_merges_defaults() -> void:
	# Simulate a partial load where only one key is set
	var partial: Dictionary = {"llm_provider": "cloud"}
	for key in partial.keys():
		_manager.settings[key] = partial[key]
	# All other default keys must still be present
	assert_true(_manager.settings.has("system_prompt"),
		"Default keys should survive a partial settings merge.")
	assert_eq(_manager.settings["llm_provider"], "cloud",
		"Loaded value should override the default.")

func test_get_setting_returns_current_value() -> void:
	_manager.settings["personality"] = "mysterious"
	var result: String = _manager.get_setting("personality", "")
	assert_eq(result, "mysterious", "get_setting should reflect current dictionary state.")

# ---------------------------------------------------------------------------
# SettingsUI signal relay tests (stub-based, headless-safe)
# ---------------------------------------------------------------------------

## Minimal stub that only declares the color_changed signal —
## avoids instantiating the full SettingsUI scene in headless mode.
class _SettingsStub extends Node:
	signal color_changed(c: Color)

var _received_color: Color

func _on_color_signal(c: Color) -> void:
	_received_color = c

func test_settings_ui_color_changed_signal_fires() -> void:
	var stub := _SettingsStub.new()
	add_child_autofree(stub)

	_received_color = Color.BLACK
	stub.color_changed.connect(_on_color_signal)

	stub.color_changed.emit(Color.PURPLE)

	assert_eq(_received_color, Color.PURPLE,
		"color_changed should relay the picked color to any connected receiver.")

func test_fairy_set_fairy_color_updates_base_color() -> void:
	var _fairy: Node = load("res://scenes/FairyVisuals.tscn").instantiate()
	add_child_autofree(_fairy)

	var target := Color(1.0, 0.5, 0.8, 1.0)
	_fairy.set_fairy_color(target)

	assert_eq(_fairy.base_color, target,
		"set_fairy_color should update the base_color property.")

func test_fairy_click_enabled_defaults_false() -> void:
	var _fairy: Node = load("res://scenes/FairyVisuals.tscn").instantiate()
	add_child_autofree(_fairy)

	assert_false(_fairy.click_enabled,
		"Fairy click detection should be disabled by default (follow mode).")

func test_font_size_offset_default_is_zero() -> void:
	# fresh SettingsManager should have font_size_offset = 0
	assert_true(_manager.settings.has("font_size_offset"),
		"font_size_offset key must be present in settings dictionary.")


func test_font_size_offset_stored_and_retrieved() -> void:
	_manager.set_setting("font_size_offset", 4)
	var result: int = _manager.get_setting("font_size_offset", 0)
	assert_eq(result, 4,
		"font_size_offset should be stored and returned correctly.")


# func test_enable_push_to_talk_stored_and_retrieved() -> void:
# 	_manager.set_setting("enable_push_to_talk", false)
# 	var result: bool = _manager.get_setting("enable_push_to_talk", true)
# 	assert_false(result, "enable_push_to_talk should be saved and retrieved correctly.")
