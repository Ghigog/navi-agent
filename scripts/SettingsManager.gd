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
	"system_prompt": "",
	"personality": "cheerful and glowing",
	"fairy_color": "66b2ff", # Light blue hex
	"enable_screenshots": true,
	"enable_thinking": true,
	"font_size_offset": 0  # Integer offset applied on top of all base font sizes
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
	return settings.get(key, default_value)


## Updates a configuration key with [param value] and immediately persists the dictionary to disk.
func set_setting(key: String, value: Variant) -> void:
	settings[key] = value
	save_settings()
	settings_updated.emit() # Notify all listeners
