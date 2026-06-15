extends Node
## Singleton manager handling persistent application configurations, stored in JSON format.
## Manages defaults, configuration migration, disk reads/writes, and setting accessors.

signal settings_updated 

var SETTINGS_FILE := "user://settings.json"

## Active application settings dictionary holding visual and model configuration states.
var settings: Dictionary = {
	"llm_provider": "local",
	"local_url": "http://localhost:11434",
	"local_model": "",
	"local_thinking_model": "",
	"cloud_url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
	"cloud_model": "",
	"cloud_thinking_model": "",
	"cloud_api_key": "",
	"openai_api_key": "",
	"system_prompt": "",
	"personality": "cheerful and glowing",
	"fairy_color": "404040", # True neutral — midpoint of all emotion parameters (C=0 W=0 P=0 love=0)
	"enable_screenshots": true,
	"enable_thinking": true,
	"font_size_offset": 0,  # Integer offset applied on top of all base font sizes
	"enable_stt": true,
	"enable_tts": true,
	"tts_mute": false,
	"whisper_url": "http://localhost:8080/v1/audio/transcriptions",
	"whisper_model": "whisper-1",
	"whisper_bin_path": "res://bin/whisper-cli",
	"whisper_model_path": "res://bin/ggml-base.en.bin",
	"tts_mode": "system",
	"tts_mutter_sound_path": "",
	"tts_mutter_pitch_min": 0.85,
	"tts_mutter_pitch_max": 1.25,
	"tts_mutter_speed": 0.06,
	"tts_voice": "",
	"custom_mutters": [],
	"tts_provider": "local_piper",
	"piper_bin_path": "res://bin/piper",
	"piper_model_path": "res://bin/voices/en_US-amy-medium.onnx",
	"piper_speed": 1.0,
	"cloud_tts_provider": "openai",
	"cloud_tts_url": "https://api.openai.com/v1/audio/speech",
	"cloud_tts_model": "tts-1",
	"cloud_tts_voice": "alloy",
	"filter_show_neural": true,
	"filter_show_system": true,
	"filter_show_mutter": true,
	"hotkey_keycode": 126,
	"hotkey_modifiers": 512,
	"hotkey_text": "Shift + Up",
	"tts_rate": 1.0,
	"tts_pitch": 1.0,
	"live_navi_mode": false,
	"require_skill_confirmation": true,
	"enable_push_to_talk": true, # DEPRECATED: Voice detection is removed. Push-to-talk is now the default/only option.
	"enable_predictive_trigger": false
}

var skills = [
	{"tag": "take_screenshot", "description": "Captures the desktop to analyze visual elements."},
	{"tag": "take_crop_screenshot", "description": "Captures a close-up cropped visual around the fairy for precise visual detail."},
	{"tag": "heavy_thinking", "description": "Invokes advanced reasoning for complex problems."}
]


func _ready() -> void:
	load_settings()

	# Migrate missing keys if they don't exist in loaded settings
	var changed := false
	if not settings.has("enable_predictive_trigger"):
		settings["enable_predictive_trigger"] = false
		changed = true
	if not settings.has("local_thinking_model"):
		settings["local_thinking_model"] = ""
		changed = true
	if not settings.has("cloud_thinking_model"):
		settings["cloud_thinking_model"] = ""
		changed = true
	if not settings.has("enable_screenshots"):
		settings["enable_screenshots"] = true
		changed = true
	if not settings.has("enable_thinking"):
		settings["enable_thinking"] = true
		changed = true
	if not settings.has("font_size_offset"):
		settings["font_size_offset"] = 0
		changed = true
	if not settings.has("enable_stt"):
		settings["enable_stt"] = true
		changed = true
	if not settings.has("enable_tts"):
		settings["enable_tts"] = true
		changed = true
	if not settings.has("tts_mute"):
		settings["tts_mute"] = false
		changed = true
	if not settings.has("whisper_url"):
		settings["whisper_url"] = "http://localhost:8080/v1/audio/transcriptions"
		changed = true
	if not settings.has("whisper_model"):
		settings["whisper_model"] = "whisper-1"
		changed = true
	if not settings.has("whisper_bin_path"):
		settings["whisper_bin_path"] = "res://bin/whisper-cli"
		changed = true
	if not settings.has("whisper_model_path"):
		settings["whisper_model_path"] = "res://bin/ggml-base.en.bin"
		changed = true
	if not settings.has("tts_mode"):
		settings["tts_mode"] = "system"
		changed = true
	if not settings.has("tts_mutter_sound_path"):
		settings["tts_mutter_sound_path"] = ""
		changed = true
	if not settings.has("tts_mutter_pitch_min"):
		settings["tts_mutter_pitch_min"] = 0.85
		changed = true
	if not settings.has("tts_mutter_pitch_max"):
		settings["tts_mutter_pitch_max"] = 1.25
		changed = true
	if not settings.has("tts_mutter_speed"):
		settings["tts_mutter_speed"] = 0.06
		changed = true
	if not settings.has("tts_voice"):
		settings["tts_voice"] = ""
		changed = true
	if not settings.has("custom_mutters"):
		settings["custom_mutters"] = []
		changed = true
	if not settings.has("tts_provider"):
		settings["tts_provider"] = "local_piper"
		changed = true
	if not settings.has("piper_bin_path"):
		settings["piper_bin_path"] = "res://bin/piper"
		changed = true
	if not settings.has("piper_model_path"):
		settings["piper_model_path"] = "res://bin/voices/en_US-amy-medium.onnx"
		changed = true
	if not settings.has("piper_speed"):
		settings["piper_speed"] = 1.0
		changed = true
	if not settings.has("cloud_tts_provider"):
		settings["cloud_tts_provider"] = "openai"
		changed = true
	if not settings.has("cloud_tts_url"):
		settings["cloud_tts_url"] = "https://api.openai.com/v1/audio/speech"
		changed = true
	if not settings.has("cloud_tts_model"):
		settings["cloud_tts_model"] = "tts-1"
		changed = true
	if not settings.has("cloud_tts_voice"):
		settings["cloud_tts_voice"] = "alloy"
		changed = true
	if not settings.has("filter_show_neural"):
		settings["filter_show_neural"] = true
		changed = true
	if not settings.has("filter_show_system"):
		settings["filter_show_system"] = true
		changed = true
	if not settings.has("filter_show_mutter"):
		settings["filter_show_mutter"] = true
		changed = true
	if not settings.has("openai_api_key"):
		settings["openai_api_key"] = ""
		changed = true
	if not settings.has("hotkey_keycode"):
		settings["hotkey_keycode"] = 126
		changed = true
	if not settings.has("hotkey_modifiers"):
		settings["hotkey_modifiers"] = 512
		changed = true
	if not settings.has("hotkey_text"):
		settings["hotkey_text"] = "Shift + Up"
		changed = true
	if not settings.has("tts_rate"):
		settings["tts_rate"] = 1.0
		changed = true
	if not settings.has("tts_pitch"):
		settings["tts_pitch"] = 1.0
		changed = true
	if not settings.has("live_navi_mode"):
		settings["live_navi_mode"] = false
		changed = true
	if not settings.has("require_skill_confirmation"):
		settings["require_skill_confirmation"] = true
		changed = true
	if not settings.has("enable_push_to_talk"):
		settings["enable_push_to_talk"] = true
		changed = true
	if changed:
		save_settings()


## Loads settings from the local JSON config file, merging loaded data into defaults to ensure new options exist.
func load_settings() -> void:
	if not FileAccess.file_exists(SETTINGS_FILE):
		save_settings() # Save defaults to establish a config file
		return
		
	var file := FileAccess.open(SETTINGS_FILE, FileAccess.READ)
	if file:
		var json_string := file.get_as_text()
		file.close()
		
		var json = JSON.new()
		var parse_err := json.parse(json_string)
		if parse_err == OK:
			var loaded_data = json.get_data()
			print("Settings loaded: ", loaded_data) 
			if loaded_data is Dictionary:
				# Merge loaded fields to retain user customizations while preserving new default keys
				for key in loaded_data.keys():
					settings[key] = loaded_data[key]
		else:
			printerr("SettingsManager: Failed to parse settings file. Error: ", parse_err)


## Serializes the active settings dictionary to disk as formatted JSON.
func save_settings() -> void:
	var file := FileAccess.open(SETTINGS_FILE, FileAccess.WRITE)
	if file:
		var json_string := JSON.stringify(settings, "\t")
		file.store_string(json_string)
		file.close()
	else:
		printerr("SettingsManager: Failed to open settings file for writing.")


## Retrieves a configuration setting value. Returns [param default_value] if the key is missing.
func get_setting(key: String, default_value: Variant = null) -> Variant:
	if key == "enable_push_to_talk":
		return true
	return settings.get(key, default_value)


## Updates a configuration key with [param value] and immediately persists the dictionary to disk.
func set_setting(key: String, value: Variant) -> void:
	settings[key] = value
	save_settings()
	settings_updated.emit() # Notify all listeners


## Updates multiple configuration keys at once, saving to disk and emitting the signal only once.
func set_settings_batch(batch_data: Dictionary) -> void:
	for key in batch_data.keys():
		settings[key] = batch_data[key]
	save_settings()
	settings_updated.emit()
