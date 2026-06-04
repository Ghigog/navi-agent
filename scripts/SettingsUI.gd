class_name SettingsUI
extends Control
## Translucent settings panel overlay allowing user configurations of color, endpoints, keys, and system instructions.
## Incorporates lazy node mapping to tolerate partial trees in headful and test runner contexts.

## Emitted when the settings UI is dismissed by the user.
signal settings_closed
## Emitted when the color picker button changes to live-preview new colors.
signal color_changed(new_color: Color)

# UI Control Elements (Mapped lazily at runtime)
var _panel: PanelContainer
var _system_prompt_edit: TextEdit
var _personality_edit: LineEdit
var _color_picker: ColorPickerButton
var _provider_option: OptionButton
var _api_key_label: Label
var _api_key_edit: LineEdit
var _endpoint_edit: LineEdit
var _model_edit: LineEdit
var _thinking_model_edit: LineEdit
var _save_button: Button
var _close_button: Button
var _enable_screenshots_check: CheckBox
var _enable_thinking_check: CheckBox
var _enable_stt_check: CheckBox
var _enable_tts_check: CheckBox
var _font_size_spinbox: SpinBox
var _whisper_label: Label
var _whisper_url_edit: LineEdit
var _whisper_model_edit: LineEdit
var _voice_option: OptionButton
var _custom_mutter_edit: LineEdit
var _add_mutter_button: Button
var _remove_mutter_button: Button
var _mutter_error_label: Label
var _mutter_pitch_min_spin: SpinBox
var _mutter_pitch_max_spin: SpinBox
var _mutter_speed_spin: SpinBox
var _show_neural_check: CheckBox
var _show_system_check: CheckBox
var _show_mutter_check: CheckBox
var _custom_voice_edit: LineEdit
var _add_voice_button: Button
var _remove_voice_button: Button
var _openai_api_key_label: Label
var _openai_api_key_edit: LineEdit


var _settings_manager: Node = null
var _tween: Tween = null


func _ready() -> void:
	# Resolve node tree connections lazily, preventing errors if run without full visual scenes (e.g., GUT testing)
	_panel = get_node_or_null("PanelContainer")
	var margin: Node = null
	var vbox_outer: Node = null
	var vbox: Node = null
	if _panel:
		margin = _panel.get_node_or_null("MarginContainer")
	if margin:
		vbox_outer = margin.get_node_or_null("VBoxOuter")
	if vbox_outer:
		vbox = vbox_outer.get_node_or_null("ScrollContainer/VBoxContainer")
	if vbox:
		_system_prompt_edit = vbox.get_node_or_null("SystemPromptEdit")
		_personality_edit    = vbox.get_node_or_null("PersonalityEdit")
		_provider_option     = vbox.get_node_or_null("ProviderOption")
		_endpoint_edit       = vbox.get_node_or_null("EndpointEdit")
		_model_edit          = vbox.get_node_or_null("ModelEdit")
		_thinking_model_edit = vbox.get_node_or_null("ThinkingModelEdit")
		_api_key_label       = vbox.get_node_or_null("ApiKeyLabel")
		_api_key_edit        = vbox.get_node_or_null("ApiKeyEdit")
	if vbox_outer:
		_save_button         = vbox_outer.get_node_or_null("ButtonRow/SaveButton")
		_close_button        = vbox_outer.get_node_or_null("ButtonRow/CloseButton")
	if vbox:
		var color_row: Node  = vbox.get_node_or_null("ColorRow")
		if color_row:
			_color_picker = color_row.get_node_or_null("ColorPickerButton")
		var toggle_row: Node = vbox.get_node_or_null("SkillsToggleRow")
		if toggle_row:
			_enable_screenshots_check = toggle_row.get_node_or_null("EnableScreenshotsCheck")
			_enable_thinking_check    = toggle_row.get_node_or_null("EnableThinkingCheck")
		var voice_toggle_row: Node = vbox.get_node_or_null("VoiceToggleRow")
		if voice_toggle_row:
			_enable_stt_check = voice_toggle_row.get_node_or_null("EnableSTTCheck")
			_enable_tts_check = voice_toggle_row.get_node_or_null("EnableTTSCheck")
		_whisper_label = vbox.get_node_or_null("WhisperLabel")
		_whisper_url_edit = vbox.get_node_or_null("WhisperUrlEdit")
		_whisper_model_edit = vbox.get_node_or_null("WhisperModelEdit")
		var font_size_row: Node = vbox.get_node_or_null("FontSizeRow")
		if font_size_row:
			_font_size_spinbox = font_size_row.get_node_or_null("FontSizeSpinBox")
		var mutter_row: Node = vbox.get_node_or_null("MutterRow")
		if mutter_row:
			var filter_row = mutter_row.get_node_or_null("FilterVoicesRow")
			if filter_row:
				_show_neural_check = filter_row.get_node_or_null("ShowNeuralCheck")
				_show_system_check = filter_row.get_node_or_null("ShowSystemCheck")
				_show_mutter_check = filter_row.get_node_or_null("ShowMutterCheck")
			_voice_option = mutter_row.get_node_or_null("VoiceModeHBox/VoiceOption")
			var custom_hbox = mutter_row.get_node_or_null("CustomMutterHBox")
			if custom_hbox:
				_custom_mutter_edit = custom_hbox.get_node_or_null("CustomMutterEdit")
				_add_mutter_button = custom_hbox.get_node_or_null("AddMutterButton")
				_remove_mutter_button = custom_hbox.get_node_or_null("RemoveMutterButton")
			_mutter_error_label = mutter_row.get_node_or_null("MutterErrorLabel")
			var custom_voice_hbox = mutter_row.get_node_or_null("CustomVoiceHBox")
			if custom_voice_hbox:
				_custom_voice_edit = custom_voice_hbox.get_node_or_null("CustomVoiceEdit")
				_add_voice_button = custom_voice_hbox.get_node_or_null("AddVoiceButton")
				_remove_voice_button = custom_voice_hbox.get_node_or_null("RemoveVoiceButton")
			_mutter_pitch_min_spin = mutter_row.get_node_or_null("MutterPitchHBox/MutterPitchMinSpin")
			_mutter_pitch_max_spin = mutter_row.get_node_or_null("MutterPitchHBox/MutterPitchMaxSpin")
			_mutter_speed_spin = mutter_row.get_node_or_null("MutterSpeedHBox/MutterSpeedSpin")
			_openai_api_key_label = mutter_row.get_node_or_null("OpenAIApiKeyLabel")
			_openai_api_key_edit = mutter_row.get_node_or_null("OpenAIApiKeyEdit")

		if _voice_option:
			_voice_option.item_selected.connect(_on_voice_selected)
		if _add_mutter_button:
			_add_mutter_button.pressed.connect(_on_add_mutter_pressed)
		if _remove_mutter_button:
			_remove_mutter_button.pressed.connect(_on_remove_mutter_pressed)
		if _add_voice_button:
			_add_voice_button.pressed.connect(_on_add_voice_pressed)
		if _remove_voice_button:
			_remove_voice_button.pressed.connect(_on_remove_voice_pressed)
		if _show_neural_check:
			_show_neural_check.toggled.connect(func(_t): _populate_voice_options())
		if _show_system_check:
			_show_system_check.toggled.connect(func(_t): _populate_voice_options())
		if _show_mutter_check:
			_show_mutter_check.toggled.connect(func(_t): _populate_voice_options())

	# Establish initial closed visual state
	if _panel:
		hide()
		_panel.scale = Vector2.ZERO

	# Connect control event listeners
	if _save_button:
		_save_button.pressed.connect(_on_save_pressed)
	if _close_button:
		_close_button.pressed.connect(_on_close_pressed)
	if _color_picker:
		_color_picker.color_changed.connect(_on_color_picked)
	if _provider_option:
		_provider_option.item_selected.connect(_on_provider_selected)

	# Reference SettingsManager autoload singleton
	if Engine.has_singleton("SettingsManager"):
		_settings_manager = Engine.get_singleton("SettingsManager")
	elif has_node("/root/SettingsManager"):
		_settings_manager = get_node("/root/SettingsManager")


## Opens the Settings panel, loading configuration settings and playing a scale-in transition.
func open_settings() -> void:
	_populate_fields()
	show()

	if _tween:
		_tween.kill()
	_tween = create_tween().set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
	if _panel:
		_panel.scale = Vector2.ZERO
		_tween.tween_property(_panel, "scale", Vector2.ONE, 0.25)


## Closes the settings UI, playing a scale-out transition and emitting settings_closed.
func close_settings() -> void:
	if _tween:
		_tween.kill()
	_tween = create_tween().set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_BACK)
	if _panel:
		_tween.tween_property(_panel, "scale", Vector2.ZERO, 0.18)
	await _tween.finished
	hide()
	settings_closed.emit()


# Private helper to load SettingsManager settings into the UI elements
func _populate_fields() -> void:
	if _settings_manager == null:
		return

	if _system_prompt_edit:
		_system_prompt_edit.text = _settings_manager.get_setting("system_prompt", "")
	if _personality_edit:
		_personality_edit.text = _settings_manager.get_setting("personality", "")

	if _color_picker:
		var hex: String = _settings_manager.get_setting("fairy_color", "66b2ff")
		_color_picker.color = Color.html(hex)

	if _provider_option:
		var provider: String = _settings_manager.get_setting("llm_provider", "local")
		_provider_option.selected = 0 if provider == "local" else 1
		_update_provider_fields(provider)

	if _api_key_edit:
		_api_key_edit.text = _settings_manager.get_setting("cloud_api_key", "")
		
	if _enable_screenshots_check:
		_enable_screenshots_check.button_pressed = _settings_manager.get_setting("enable_screenshots", true)
	if _enable_thinking_check:
		_enable_thinking_check.button_pressed = _settings_manager.get_setting("enable_thinking", true)
	if _enable_stt_check:
		_enable_stt_check.button_pressed = _settings_manager.get_setting("enable_stt", true)
	if _enable_tts_check:
		_enable_tts_check.button_pressed = _settings_manager.get_setting("enable_tts", true)
	if _whisper_url_edit:
		_whisper_url_edit.text = _settings_manager.get_setting("whisper_url", "http://localhost:8080/v1/audio/transcriptions")
	if _whisper_model_edit:
		_whisper_model_edit.text = _settings_manager.get_setting("whisper_model", "whisper-1")
	if _font_size_spinbox:
		_font_size_spinbox.value = float(_settings_manager.get_setting("font_size_offset", 0))
	
	if _show_neural_check:
		_show_neural_check.button_pressed = _settings_manager.get_setting("filter_show_neural", true)
	if _show_system_check:
		_show_system_check.button_pressed = _settings_manager.get_setting("filter_show_system", true)
	if _show_mutter_check:
		_show_mutter_check.button_pressed = _settings_manager.get_setting("filter_show_mutter", true)
	
	_populate_voice_options()

	if _mutter_pitch_min_spin:
		_mutter_pitch_min_spin.value = _settings_manager.get_setting("tts_mutter_pitch_min", 0.85)
	if _mutter_pitch_max_spin:
		_mutter_pitch_max_spin.value = _settings_manager.get_setting("tts_mutter_pitch_max", 1.25)
	if _mutter_speed_spin:
		_mutter_speed_spin.value = _settings_manager.get_setting("tts_mutter_speed", 0.06)
	if _openai_api_key_edit:
		_openai_api_key_edit.text = _settings_manager.get_setting("openai_api_key", "")


func _populate_voice_options() -> void:
	if not _voice_option or not _settings_manager:
		return
	
	_voice_option.clear()
	
	var show_neural := true
	var show_system := true
	var show_mutter := true
	if _show_neural_check:
		show_neural = _show_neural_check.button_pressed
	else:
		show_neural = _settings_manager.get_setting("filter_show_neural", true)
	if _show_system_check:
		show_system = _show_system_check.button_pressed
	else:
		show_system = _settings_manager.get_setting("filter_show_system", true)
	if _show_mutter_check:
		show_mutter = _show_mutter_check.button_pressed
	else:
		show_mutter = _settings_manager.get_setting("filter_show_mutter", true)

	# 1. Neural Voices (Piper & Cloud APIs)
	if show_neural:
		var dir := DirAccess.open("res://bin/voices/")
		var found_piper_voices := false
		if dir:
			dir.list_dir_begin()
			var file_name = dir.get_next()
			while file_name != "":
				if not dir.current_is_dir() and file_name.ends_with(".onnx"):
					var voice_name = file_name.get_basename()
					_voice_option.add_item("Neural: Local Piper (" + voice_name + ")")
					_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "local_piper:res://bin/voices/".path_join(file_name))
					found_piper_voices = true
				file_name = dir.get_next()
		
		if not found_piper_voices:
			_voice_option.add_item("Neural: Local Piper")
			_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "local_piper:res://bin/voices/en_US-amy-medium.onnx")
		
		_voice_option.add_item("Neural: Cloud OpenAI")
		_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "cloud_openai")
		
		_voice_option.add_item("Neural: Cloud Edge")
		_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "cloud_edge")
		
		_voice_option.add_item("Neural: Cloud Gemini")
		_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "cloud_gemini")

	# 2. Procedural & Custom Mutter Files
	if show_mutter:
		_voice_option.add_item("Mutter: Procedural Retro")
		_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "mutter_procedural")
		
		var custom_mutters: Array = _settings_manager.get_setting("custom_mutters", [])
		for path in custom_mutters:
			if FileAccess.file_exists(path):
				var filename = path.get_file()
				_voice_option.add_item("Mutter: " + filename)
				var idx = _voice_option.get_item_count() - 1
				_voice_option.set_item_metadata(idx, "mutter_custom:" + path)
			
	# 3. System Voices
	if show_system:
		var voices = DisplayServer.tts_get_voices()
		for voice in voices:
			if voice is Dictionary and voice.has("id") and voice.has("name"):
				var lang = voice.get("language", "")
				var label = "System: " + voice["name"] + (" (" + lang + ")" if lang != "" else "")
				_voice_option.add_item(label)
				var idx = _voice_option.get_item_count() - 1
				_voice_option.set_item_metadata(idx, voice["id"])
			
	# Select saved voice
	var saved_voice = _settings_manager.get_setting("tts_voice", "")
	var saved_model = _settings_manager.get_setting("piper_model_path", "res://bin/voices/en_US-amy-medium.onnx")
	var selected_idx = 0
	for i in range(_voice_option.get_item_count()):
		var meta = _voice_option.get_item_metadata(i)
		if meta == saved_voice:
			selected_idx = i
			break
		elif saved_voice == "local_piper" and meta == "local_piper:" + saved_model:
			selected_idx = i
			break
	_voice_option.selected = selected_idx
	_update_mutter_visibility()


func _update_mutter_visibility() -> void:
	if not _voice_option:
		return
	var selected_idx = _voice_option.selected
	if selected_idx < 0 or selected_idx >= _voice_option.get_item_count():
		return
	var metadata = _voice_option.get_item_metadata(selected_idx)
	var is_mutter = false
	var is_cloud_voice = false
	if metadata is String:
		is_mutter = metadata == "mutter_procedural" or metadata.begins_with("mutter_custom:")
		is_cloud_voice = metadata.begins_with("cloud_")
	
	if _mutter_pitch_min_spin and _mutter_pitch_min_spin.get_parent():
		_mutter_pitch_min_spin.get_parent().visible = is_mutter
	if _mutter_speed_spin and _mutter_speed_spin.get_parent():
		_mutter_speed_spin.get_parent().visible = is_mutter

	# Show API Key if LLM Provider is cloud
	var provider_is_cloud = false
	if _provider_option:
		provider_is_cloud = _provider_option.selected == 1

	if _api_key_edit:
		_api_key_edit.visible = provider_is_cloud
	if _api_key_label:
		_api_key_label.visible = provider_is_cloud

	# Show OpenAI API Key if cloud voice is selected (like cloud_openai)
	var needs_openai_key = (metadata == "cloud_openai")
	if _openai_api_key_edit:
		_openai_api_key_edit.visible = needs_openai_key
	if _openai_api_key_label:
		_openai_api_key_label.visible = needs_openai_key


func _on_voice_selected(_index: int) -> void:
	_update_mutter_visibility()


func _on_add_mutter_pressed() -> void:
	if not _custom_mutter_edit or not _settings_manager:
		return
	
	if _mutter_error_label:
		_mutter_error_label.text = ""
		_mutter_error_label.visible = false
		
	var path := _custom_mutter_edit.text.strip_edges()
	if path == "":
		_show_mutter_error("Please enter a file path.")
		return
		
	if not FileAccess.file_exists(path):
		_show_mutter_error("File does not exist.")
		return
		
	var ext := path.get_extension().to_lower()
	if ext != "wav" and ext != "ogg":
		_show_mutter_error("Only .wav and .ogg files are supported.")
		return
		
	# Check sound length (must be <= 1.0 second)
	var stream: AudioStream = null
	if ext == "wav":
		stream = AudioStreamWAV.load_from_file(path)
	elif ext == "ogg":
		stream = AudioStreamOggVorbis.load_from_file(path)
		
	if not stream:
		_show_mutter_error("Failed to load audio file.")
		return
		
	var length = stream.get_length()
	if length > 1.0:
		_show_mutter_error("Sound file must be no longer than 1 second (Current: %.2fs)." % length)
		return
		
	# Add to settings
	var custom_mutters: Array = _settings_manager.get_setting("custom_mutters", []).duplicate()
	if not path in custom_mutters:
		custom_mutters.append(path)
		_settings_manager.set_setting("custom_mutters", custom_mutters)
		
	# Refresh dropdown
	_populate_voice_options()
	
	# Select the newly added voice
	for i in range(_voice_option.get_item_count()):
		if _voice_option.get_item_metadata(i) == "mutter_custom:" + path:
			_voice_option.selected = i
			_on_voice_selected(i)
			break
			
	_custom_mutter_edit.text = ""


func _on_remove_mutter_pressed() -> void:
	if not _voice_option or not _settings_manager:
		return
		
	var selected_idx = _voice_option.selected
	if selected_idx < 0 or selected_idx >= _voice_option.get_item_count():
		return
	var metadata = _voice_option.get_item_metadata(selected_idx)
	if not metadata is String or not metadata.begins_with("mutter_custom:"):
		_show_mutter_error("Only custom mutter sounds can be removed.")
		return
		
	var path = metadata.substr("mutter_custom:".length())
	var custom_mutters: Array = _settings_manager.get_setting("custom_mutters", []).duplicate()
	custom_mutters.erase(path)
	_settings_manager.set_setting("custom_mutters", custom_mutters)
	
	# If the removed voice was the active one, fallback to default
	_settings_manager.set_setting("tts_voice", "")
	
	# Refresh dropdown
	_populate_voice_options()


func _on_add_voice_pressed() -> void:
	if not _custom_voice_edit or not _settings_manager:
		return
		
	if _mutter_error_label:
		_mutter_error_label.text = ""
		_mutter_error_label.visible = false
		
	var path := _custom_voice_edit.text.strip_edges()
	if path == "":
		_show_mutter_error("Please enter a voice file path.")
		return
		
	if not FileAccess.file_exists(path):
		_show_mutter_error("Voice file does not exist.")
		return
		
	var ext := path.get_extension().to_lower()
	if ext != "onnx":
		_show_mutter_error("Only .onnx voice models are supported.")
		return
		
	# Copy file to res://bin/voices/
	var dest_dir := "res://bin/voices/"
	var file_name := path.get_file()
	var dest_path := dest_dir.path_join(file_name)
	
	var dir := DirAccess.open("res://")
	if dir:
		dir.make_dir_recursive(dest_dir)
		var err := dir.copy(path, dest_path)
		if err != OK:
			_show_mutter_error("Failed to copy voice model. Error: " + str(err))
			return
			
		var json_src_path := path + ".json"
		if FileAccess.file_exists(json_src_path):
			var json_dest_path := dest_path + ".json"
			dir.copy(json_src_path, json_dest_path)
			
	_populate_voice_options()
	
	for i in range(_voice_option.get_item_count()):
		if _voice_option.get_item_metadata(i) == "local_piper:" + dest_path:
			_voice_option.selected = i
			_on_voice_selected(i)
			break
			
	_custom_voice_edit.text = ""


func _on_remove_voice_pressed() -> void:
	if not _voice_option or not _settings_manager:
		return
		
	if _mutter_error_label:
		_mutter_error_label.text = ""
		_mutter_error_label.visible = false
		
	var selected_idx = _voice_option.selected
	if selected_idx < 0 or selected_idx >= _voice_option.get_item_count():
		return
	var metadata = _voice_option.get_item_metadata(selected_idx)
	if not metadata is String or not metadata.begins_with("local_piper:"):
		_show_mutter_error("Only custom local Piper voices can be removed.")
		return
		
	var path: String = metadata.substr("local_piper:".length())
	if path == "res://bin/voices/en_US-amy-medium.onnx":
		_show_mutter_error("Cannot delete the default voice model.")
		return
		
	DirAccess.remove_absolute(path)
	var json_path := path + ".json"
	if FileAccess.file_exists(json_path):
		DirAccess.remove_absolute(json_path)
		
	var saved_voice = _settings_manager.get_setting("tts_voice", "")
	var saved_model = _settings_manager.get_setting("piper_model_path", "")
	if saved_voice == "local_piper" and saved_model == path:
		_settings_manager.set_setting("tts_voice", "")
		_settings_manager.set_setting("piper_model_path", "res://bin/voices/en_US-amy-medium.onnx")
		
	_populate_voice_options()


func _show_mutter_error(msg: String) -> void:
	if _mutter_error_label:
		_mutter_error_label.text = msg
		_mutter_error_label.visible = true


# Triggered when user commits changes via the Save button
func _on_save_pressed() -> void:
	if _settings_manager == null:
		return

	if _system_prompt_edit:
		_settings_manager.set_setting("system_prompt", _system_prompt_edit.text)
	if _personality_edit:
		_settings_manager.set_setting("personality", _personality_edit.text)
	if _color_picker:
		_settings_manager.set_setting("fairy_color", _color_picker.color.to_html(false))
		color_changed.emit(_color_picker.color)
		
	var is_cloud := false
	if _provider_option:
		var provider := "local" if _provider_option.selected == 0 else "cloud"
		_settings_manager.set_setting("llm_provider", provider)
		is_cloud = provider == "cloud"
		
	if _api_key_edit:
		_settings_manager.set_setting("cloud_api_key", _api_key_edit.text)
	if _endpoint_edit:
		_settings_manager.set_setting("cloud_url" if is_cloud else "local_url", _endpoint_edit.text)
	if _model_edit:
		_settings_manager.set_setting("cloud_model" if is_cloud else "local_model", _model_edit.text)
	if _thinking_model_edit:
		_settings_manager.set_setting("cloud_thinking_model" if is_cloud else "local_thinking_model", _thinking_model_edit.text)
		
	if _enable_screenshots_check:
		_settings_manager.set_setting("enable_screenshots", _enable_screenshots_check.button_pressed)
	if _enable_thinking_check:
		_settings_manager.set_setting("enable_thinking", _enable_thinking_check.button_pressed)
	if _enable_stt_check:
		_settings_manager.set_setting("enable_stt", _enable_stt_check.button_pressed)
	if _enable_tts_check:
		_settings_manager.set_setting("enable_tts", _enable_tts_check.button_pressed)
	if _whisper_url_edit:
		_settings_manager.set_setting("whisper_url", _whisper_url_edit.text)
	if _whisper_model_edit:
		_settings_manager.set_setting("whisper_model", _whisper_model_edit.text)
	if _font_size_spinbox:
		_settings_manager.set_setting("font_size_offset", int(_font_size_spinbox.value))
	
	if _voice_option:
		var metadata = _voice_option.get_item_metadata(_voice_option.selected)
		if metadata is String and metadata.begins_with("local_piper:"):
			var model_path = metadata.substr("local_piper:".length())
			_settings_manager.set_setting("tts_voice", "local_piper")
			_settings_manager.set_setting("piper_model_path", model_path)
		else:
			_settings_manager.set_setting("tts_voice", metadata)
		
	if _show_neural_check:
		_settings_manager.set_setting("filter_show_neural", _show_neural_check.button_pressed)
	if _show_system_check:
		_settings_manager.set_setting("filter_show_system", _show_system_check.button_pressed)
	if _show_mutter_check:
		_settings_manager.set_setting("filter_show_mutter", _show_mutter_check.button_pressed)
	if _openai_api_key_edit:
		_settings_manager.set_setting("openai_api_key", _openai_api_key_edit.text)

	if _mutter_pitch_min_spin:
		_settings_manager.set_setting("tts_mutter_pitch_min", _mutter_pitch_min_spin.value)
	if _mutter_pitch_max_spin:
		_settings_manager.set_setting("tts_mutter_pitch_max", _mutter_pitch_max_spin.value)
	if _mutter_speed_spin:
		_settings_manager.set_setting("tts_mutter_speed", _mutter_speed_spin.value)

	close_settings()


func _on_close_pressed() -> void:
	close_settings()


func _on_color_picked(color: Color) -> void:
	# Live preview color modulation on the fairy visuals during Picker operations
	color_changed.emit(color)


func _on_provider_selected(index: int) -> void:
	var provider: String = "local" if index == 0 else "cloud"
	_update_provider_fields(provider)


# Adjusts UI input visibility configurations to reflect current provider selection (local vs cloud API endpoints)
func _update_provider_fields(provider: String) -> void:
	var is_cloud: bool = provider == "cloud"

	# Let _update_mutter_visibility update the api key visibility based on both LLM and TTS status
	_update_mutter_visibility()

	if _whisper_label:
		_whisper_label.visible = not is_cloud
	if _whisper_url_edit:
		_whisper_url_edit.visible = not is_cloud
	if _whisper_model_edit:
		_whisper_model_edit.visible = not is_cloud

	# Adjust inline placeholder guides based on context
	if _endpoint_edit:
		_endpoint_edit.placeholder_text = (
			"https://generativelanguage.googleapis.com" if is_cloud
			else "http://localhost:11434"
		)
	if _model_edit:
		_model_edit.placeholder_text = "Enter fast model name"
	if _thinking_model_edit:
		_thinking_model_edit.placeholder_text = "Enter thinking model name"

	if _settings_manager:
		if _endpoint_edit:
			_endpoint_edit.text = _settings_manager.get_setting(
				"cloud_url" if is_cloud else "local_url", ""
			)
		if _model_edit:
			_model_edit.text = _settings_manager.get_setting(
				"cloud_model" if is_cloud else "local_model", ""
			)
		if _thinking_model_edit:
			_thinking_model_edit.text = _settings_manager.get_setting(
				"cloud_thinking_model" if is_cloud else "local_thinking_model", ""
			)
