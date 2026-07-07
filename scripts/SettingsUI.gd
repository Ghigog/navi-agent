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
var _save_button: Button
var _close_button: Button
var _enable_screenshots_check: CheckBox
var _enable_thinking_check: CheckBox
var _require_skill_confirmation_check: CheckBox
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

var _hotkey_button: Button
var _tts_speed_spin: SpinBox
var _tts_pitch_spin: SpinBox
var _live_navi_toggle: CheckButton


# In-app models downloader variables (NAV-74)
var _download_models_button: Button
var _download_http: HTTPRequest = null
var _download_queue: Array = []
var _current_download_url: String = ""
var _install_piper_button: Button
var _installer_thread: Thread = null
var _current_download_dest: String = ""
var _current_download_desc: String = ""
var _progress_timer: Timer = null

var _is_recording_hotkey := false
var _recorded_keycode: int = 126
var _recorded_modifiers: int = 512
var _recorded_text: String = "Shift + Up"

const GODOT_TO_MACOS_KEYCODES := {
	KEY_A: 0, KEY_B: 11, KEY_C: 8, KEY_D: 2, KEY_E: 14, KEY_F: 3, KEY_G: 5, KEY_H: 4,
	KEY_I: 34, KEY_J: 38, KEY_K: 40, KEY_L: 37, KEY_M: 46, KEY_N: 45, KEY_O: 31, KEY_P: 35,
	KEY_Q: 12, KEY_R: 15, KEY_S: 1, KEY_T: 17, KEY_U: 32, KEY_V: 9, KEY_W: 13, KEY_X: 7,
	KEY_Y: 16, KEY_Z: 6,
	KEY_0: 29, KEY_1: 18, KEY_2: 19, KEY_3: 20, KEY_4: 21, KEY_5: 23, KEY_6: 22, KEY_7: 26,
	KEY_8: 28, KEY_9: 25,
	KEY_SPACE: 49, KEY_ENTER: 36, KEY_KP_ENTER: 36, KEY_TAB: 48, KEY_ESCAPE: 53, KEY_UP: 126,
	KEY_QUOTELEFT: 50, KEY_EQUAL: 24, KEY_MINUS: 27,
	KEY_BRACKETLEFT: 33, KEY_BRACKETRIGHT: 30, KEY_BACKSLASH: 42,
	KEY_SEMICOLON: 41, KEY_APOSTROPHE: 39, KEY_COMMA: 43, KEY_PERIOD: 47, KEY_SLASH: 44,
	KEY_F1: 122, KEY_F2: 120, KEY_F3: 99, KEY_F4: 118, KEY_F5: 96, KEY_F6: 97,
	KEY_F7: 98, KEY_F8: 100, KEY_F9: 101, KEY_F10: 109, KEY_F11: 103, KEY_F12: 111
}


var _settings_manager: Node = null
var _tween: Tween = null

# Collapsible section containers: maps section_name -> { "header": Button, "container": VBoxContainer }
var _sections: Dictionary = {}


## Creates a collapsible section header with an icon, title, and tooltip.
## Returns the VBoxContainer that child controls should be added to.
func _create_section(vbox_parent: VBoxContainer, title: String, icon: String, tooltip: String, collapsed_by_default: bool = false) -> VBoxContainer:
	# Separator line above section
	var sep := HSeparator.new()
	sep.add_theme_color_override("separator_color", Color(0.25, 0.35, 0.5, 0.3))
	vbox_parent.add_child(sep)

	# Header button (acts as a toggle)
	var header := Button.new()
	header.name = title.replace(" ", "") + "Header"
	header.text = ("▾ " if not collapsed_by_default else "▸ ") + icon + " " + title
	header.tooltip_text = tooltip
	header.flat = true
	header.alignment = HORIZONTAL_ALIGNMENT_LEFT
	header.add_theme_font_size_override("font_size", 13)
	header.add_theme_color_override("font_color", Color(0.7, 0.85, 1.0, 0.9))
	header.add_theme_color_override("font_hover_color", Color(0.85, 0.92, 1.0, 1.0))
	header.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	vbox_parent.add_child(header)

	# Content container
	var container := VBoxContainer.new()
	container.name = title.replace(" ", "") + "Content"
	container.add_theme_constant_override("separation", 8)
	container.visible = not collapsed_by_default
	vbox_parent.add_child(container)

	# Wire toggle
	header.pressed.connect(func():
		container.visible = not container.visible
		if container.visible:
			header.text = "▾ " + icon + " " + title
		else:
			header.text = "▸ " + icon + " " + title
	)

	_sections[title] = { "header": header, "container": container }
	return container


## Helper to reparent an existing child node into a section container.
## Safely removes from current parent and adds to the section.
func _reparent_to_section(node: Node, section_container: VBoxContainer) -> void:
	if node == null:
		return
	var old_parent := node.get_parent()
	if old_parent:
		old_parent.remove_child(node)
	section_container.add_child(node)

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
			_require_skill_confirmation_check = toggle_row.get_node_or_null("RequireSkillConfirmationCheck")
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
			_tts_speed_spin = mutter_row.get_node_or_null("TtsSpeedHBox/TtsSpeedSpin")
			_tts_pitch_spin = mutter_row.get_node_or_null("TtsPitchHBox/TtsPitchSpin")
			_openai_api_key_label = mutter_row.get_node_or_null("OpenAIApiKeyLabel")
			_openai_api_key_edit = mutter_row.get_node_or_null("OpenAIApiKeyEdit")
		
		var hotkey_row = vbox.get_node_or_null("HotkeyRow")
		if hotkey_row:
			_hotkey_button = hotkey_row.get_node_or_null("HotkeyButton")

		# Live Navi Mode toggle (NAV-65) — built programmatically like other toggle rows
		var live_navi_row := vbox.get_node_or_null("LiveNaviRow")
		if not live_navi_row:
			live_navi_row = HBoxContainer.new()
			live_navi_row.name = "LiveNaviRow"
			var lnm_label := Label.new()
			lnm_label.text = "⚡ Live Navi Mode"
			lnm_label.tooltip_text = "When enabled, Navi's body colour and personality are driven entirely by the Emotion Engine. The colour picker and personality field become read-only."
			lnm_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			_live_navi_toggle = CheckButton.new()
			_live_navi_toggle.name = "LiveNaviToggle"
			live_navi_row.add_child(lnm_label)
			live_navi_row.add_child(_live_navi_toggle)
			# Insert as the first item in the VBox so it sits at the top of settings
			vbox.add_child(live_navi_row)
			vbox.move_child(live_navi_row, 0)
		else:
			_live_navi_toggle = live_navi_row.get_node_or_null("LiveNaviToggle")
		if _live_navi_toggle:
			_live_navi_toggle.toggled.connect(_on_live_navi_toggled)


		# Offline Models Row (NAV-74)
		var offline_models_row := vbox.get_node_or_null("OfflineModelsRow")
		if not offline_models_row:
			offline_models_row = HBoxContainer.new()
			offline_models_row.name = "OfflineModelsRow"
			var om_label := Label.new()
			om_label.text = "📥 Local Offline Models"
			om_label.tooltip_text = "Download local Whisper (STT) and Piper (TTS) models to use fully offline."
			om_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			_download_models_button = Button.new()
			_download_models_button.name = "DownloadModelsButton"
			_download_models_button.text = "Download"
			_download_models_button.pressed.connect(_on_download_models_pressed)
			offline_models_row.add_child(om_label)
			offline_models_row.add_child(_download_models_button)
			
			var insert_idx := vbox.get_child_count()
			var mr = vbox.get_node_or_null("MutterRow")
			if mr:
				insert_idx = mr.get_index() + 1
			vbox.add_child(offline_models_row)
			vbox.move_child(offline_models_row, insert_idx)
		else:
			_download_models_button = offline_models_row.get_node_or_null("DownloadModelsButton")
			if _download_models_button and not _download_models_button.pressed.is_connected(_on_download_models_pressed):
				_download_models_button.pressed.connect(_on_download_models_pressed)

		# Reflect whether models are already present
		_check_offline_models_state()

		# Piper Engine Row
		var piper_engine_row := vbox.get_node_or_null("PiperEngineRow")
		if not piper_engine_row:
			piper_engine_row = HBoxContainer.new()
			piper_engine_row.name = "PiperEngineRow"
			var pe_label := Label.new()
			pe_label.text = "⚙️ Piper TTS Engine"
			pe_label.tooltip_text = "Install the local Piper python package dependency to generate speech locally."
			pe_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			_install_piper_button = Button.new()
			_install_piper_button.name = "InstallPiperButton"
			_install_piper_button.text = "Install"
			_install_piper_button.pressed.connect(_on_install_piper_pressed)
			piper_engine_row.add_child(pe_label)
			piper_engine_row.add_child(_install_piper_button)
			
			var insert_idx := vbox.get_child_count()
			var om_row = vbox.get_node_or_null("OfflineModelsRow")
			if om_row:
				insert_idx = om_row.get_index() + 1
			vbox.add_child(piper_engine_row)
			vbox.move_child(piper_engine_row, insert_idx)
		else:
			_install_piper_button = piper_engine_row.get_node_or_null("InstallPiperButton")
			if _install_piper_button and not _install_piper_button.pressed.is_connected(_on_install_piper_pressed):
				_install_piper_button.pressed.connect(_on_install_piper_pressed)

		# Reflect whether Piper engine is already installed
		_check_piper_engine_state()



		if _voice_option:
			_voice_option.item_selected.connect(_on_voice_selected)
		if _hotkey_button:
			_hotkey_button.pressed.connect(_on_hotkey_button_pressed)
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
	if has_node("/root/SettingsManager"):
		_settings_manager = get_node("/root/SettingsManager")

	# -----------------------------------------------------------------------
	# Organize controls into collapsible sections
	# -----------------------------------------------------------------------
	if vbox:
		# Gather references to scene-defined nodes before reparenting
		var system_prompt_label = vbox.get_node_or_null("SystemPromptLabel")
		var personality_label = vbox.get_node_or_null("PersonalityLabel")
		var personality_edit = vbox.get_node_or_null("PersonalityEdit")
		var color_row = vbox.get_node_or_null("ColorRow")
		var font_size_row = vbox.get_node_or_null("FontSizeRow")
		var provider_label = vbox.get_node_or_null("ProviderLabel")
		var provider_option = vbox.get_node_or_null("ProviderOption")
		var endpoint_label = vbox.get_node_or_null("EndpointLabel")
		var endpoint_edit = vbox.get_node_or_null("EndpointEdit")
		var model_edit = vbox.get_node_or_null("ModelEdit")
		var api_key_label = vbox.get_node_or_null("ApiKeyLabel")
		var api_key_edit = vbox.get_node_or_null("ApiKeyEdit")
		var skills_toggle_row = vbox.get_node_or_null("SkillsToggleRow")
		var voice_toggle_row = vbox.get_node_or_null("VoiceToggleRow")
		var hotkey_row = vbox.get_node_or_null("HotkeyRow")
		var voice_instructions = vbox.get_node_or_null("VoiceInstructionsLabel")
		var mutter_row = vbox.get_node_or_null("MutterRow")
		var whisper_label = vbox.get_node_or_null("WhisperLabel")
		var whisper_url_edit = vbox.get_node_or_null("WhisperUrlEdit")
		var whisper_model_edit = vbox.get_node_or_null("WhisperModelEdit")
		var live_navi_row = vbox.get_node_or_null("LiveNaviRow")
		var offline_models_row = vbox.get_node_or_null("OfflineModelsRow")
		var piper_engine_row = vbox.get_node_or_null("PiperEngineRow")
		# Section 1: Behavior
		var sec_behavior := _create_section(vbox, "Behavior", "✨", "Controls how Navi behaves and interacts with you.")
		_reparent_to_section(live_navi_row, sec_behavior)
		_reparent_to_section(skills_toggle_row, sec_behavior)

		# Section 2: Appearance
		var sec_appearance := _create_section(vbox, "Appearance", "🎨", "Customize how Navi looks and how text is displayed.")
		_reparent_to_section(color_row, sec_appearance)
		_reparent_to_section(personality_label, sec_appearance)
		_reparent_to_section(personality_edit, sec_appearance)
		_reparent_to_section(font_size_row, sec_appearance)

		# Section 3: AI & Model
		var sec_ai := _create_section(vbox, "AI & Model", "🧠", "Configure which AI model Navi uses and how it's connected.")
		_reparent_to_section(provider_label, sec_ai)
		_reparent_to_section(provider_option, sec_ai)
		_reparent_to_section(endpoint_label, sec_ai)
		_reparent_to_section(endpoint_edit, sec_ai)
		_reparent_to_section(model_edit, sec_ai)
		_reparent_to_section(api_key_label, sec_ai)
		_reparent_to_section(api_key_edit, sec_ai)
		_reparent_to_section(system_prompt_label, sec_ai)
		_reparent_to_section(_system_prompt_edit, sec_ai)

		# Section 4: Voice
		var sec_voice := _create_section(vbox, "Voice", "🗣️", "Configure voice input (speech-to-text) and voice output (text-to-speech).")
		_reparent_to_section(voice_toggle_row, sec_voice)
		_reparent_to_section(hotkey_row, sec_voice)
		_reparent_to_section(voice_instructions, sec_voice)
		_reparent_to_section(mutter_row, sec_voice)
		_reparent_to_section(offline_models_row, sec_voice)
		_reparent_to_section(piper_engine_row, sec_voice)

		# Section 5: Advanced (collapsed by default)
		var sec_advanced := _create_section(vbox, "Advanced", "🔧", "Server URLs, model paths, and other technical settings. Most users don't need to change these.", true)
		_reparent_to_section(whisper_label, sec_advanced)
		_reparent_to_section(whisper_url_edit, sec_advanced)
		_reparent_to_section(whisper_model_edit, sec_advanced)


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
	if _require_skill_confirmation_check:
		_require_skill_confirmation_check.button_pressed = _settings_manager.get_setting("require_skill_confirmation", true)
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
	if _hotkey_button:
		_recorded_keycode = _settings_manager.get_setting("hotkey_keycode", 126)
		_recorded_modifiers = _settings_manager.get_setting("hotkey_modifiers", 512)
		_recorded_text = _settings_manager.get_setting("hotkey_text", "Shift + Up")
		_hotkey_button.text = _recorded_text
	if _tts_speed_spin:
		_tts_speed_spin.value = _settings_manager.get_setting("tts_rate", 1.0)
	if _tts_pitch_spin:
		_tts_pitch_spin.value = _settings_manager.get_setting("tts_pitch", 1.0)

	# Apply live mode grayed state last so it overrides field values (NAV-65)
	var live_mode: bool = _settings_manager.get_setting("live_navi_mode", false)
	if _live_navi_toggle:
		_live_navi_toggle.set_pressed_no_signal(live_mode)
	_apply_live_mode_ui(live_mode)





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
		var found_piper_voices := false
		var added_voices := {}
		
		# Check res://bin/voices/
		var dir_res := DirAccess.open("res://bin/voices/")
		if dir_res:
			dir_res.list_dir_begin()
			var file_name: String = dir_res.get_next()
			while file_name != "":
				if not dir_res.current_is_dir() and file_name.ends_with(".onnx"):
					var voice_name: String = file_name.get_basename()
					_voice_option.add_item("Neural: Local Piper (" + voice_name + ")")
					_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "local_piper:res://bin/voices/".path_join(file_name))
					found_piper_voices = true
					added_voices[voice_name] = true
				file_name = dir_res.get_next()
		
		# Also check user://models/voices/
		var dir_user := DirAccess.open("user://models/voices/")
		if dir_user:
			dir_user.list_dir_begin()
			var file_name: String = dir_user.get_next()
			while file_name != "":
				if not dir_user.current_is_dir() and file_name.ends_with(".onnx"):
					var voice_name: String = file_name.get_basename()
					if not added_voices.has(voice_name):
						_voice_option.add_item("Neural: Local Piper (" + voice_name + ")")
						_voice_option.set_item_metadata(_voice_option.get_item_count() - 1, "local_piper:user://models/voices/".path_join(file_name))
						found_piper_voices = true
						added_voices[voice_name] = true
				file_name = dir_user.get_next()
		
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
		var voices: Array[Dictionary] = DisplayServer.tts_get_voices()
		for voice in voices:
			if voice is Dictionary and voice.has("id") and voice.has("name"):
				var lang = voice.get("language", "")
				var label = "System: " + voice["name"] + (" (" + lang + ")" if lang != "" else "")
				_voice_option.add_item(label)
				var idx = _voice_option.get_item_count() - 1
				_voice_option.set_item_metadata(idx, voice["id"])
			
	# Select saved voice
	var saved_voice: String = _settings_manager.get_setting("tts_voice", "")
	var saved_model: String = _settings_manager.get_setting("piper_model_path", "res://bin/voices/en_US-amy-medium.onnx")
	var selected_idx: int = 0
	for i in range(_voice_option.get_item_count()):
		var meta = _voice_option.get_item_metadata(i)
		if meta == saved_voice:
			selected_idx = i
			break
		elif saved_voice == "local_piper" and meta == "local_piper:" + saved_model:
			selected_idx = i
			break
	_voice_option.selected = selected_idx
	_update_conditional_field_visibility()


func _update_conditional_field_visibility() -> void:
	if not _voice_option:
		return
	var selected_idx: int = _voice_option.selected
	if selected_idx < 0 or selected_idx >= _voice_option.get_item_count():
		return
	var metadata: Variant = _voice_option.get_item_metadata(selected_idx)
	var is_mutter: bool = false
	var is_cloud_voice: bool = false
	if metadata is String:
		is_mutter = metadata == "mutter_procedural" or metadata.begins_with("mutter_custom:")
		is_cloud_voice = metadata.begins_with("cloud_")
	
	# Mutter Settings vs. Normal Voice Settings
	if _mutter_pitch_min_spin and _mutter_pitch_min_spin.get_parent():
		_mutter_pitch_min_spin.get_parent().visible = is_mutter
	if _mutter_speed_spin and _mutter_speed_spin.get_parent():
		_mutter_speed_spin.get_parent().visible = is_mutter
	if _tts_speed_spin and _tts_speed_spin.get_parent():
		_tts_speed_spin.get_parent().visible = not is_mutter
	if _tts_pitch_spin and _tts_pitch_spin.get_parent():
		_tts_pitch_spin.get_parent().visible = not is_mutter

	# LLM Provider API Key & Endpoint visibility
	var provider_is_cloud: bool = false
	if _provider_option:
		provider_is_cloud = _provider_option.selected == 1

	if _api_key_edit:
		_api_key_edit.visible = provider_is_cloud
	if _api_key_label:
		_api_key_label.visible = provider_is_cloud

	# Whisper Local Settings visibility (hidden when using Cloud LLM)
	if _whisper_label:
		_whisper_label.visible = not provider_is_cloud
	if _whisper_url_edit:
		_whisper_url_edit.visible = not provider_is_cloud
	if _whisper_model_edit:
		_whisper_model_edit.visible = not provider_is_cloud

	# OpenAI API Key (needed for Cloud OpenAI TTS voice)
	var needs_openai_key: bool = (metadata == "cloud_openai")
	if _openai_api_key_edit:
		_openai_api_key_edit.visible = needs_openai_key
	if _openai_api_key_label:
		_openai_api_key_label.visible = needs_openai_key


func _on_voice_selected(_index: int) -> void:
	_update_conditional_field_visibility()


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

	var batch := {}

	if _system_prompt_edit:
		batch["system_prompt"] = _system_prompt_edit.text

	var live_on: bool = _live_navi_toggle != null and _live_navi_toggle.button_pressed
	batch["live_navi_mode"] = live_on



	# Only persist personality/color from the UI fields when NOT in live mode
	# (preserves the user's saved values so they restore cleanly when toggling off)
	if not live_on:
		if _personality_edit:
			batch["personality"] = _personality_edit.text
		if _color_picker:
			batch["fairy_color"] = _color_picker.color.to_html(false)
			color_changed.emit(_color_picker.color)
		
	var is_cloud := false
	if _provider_option:
		var provider := "local" if _provider_option.selected == 0 else "cloud"
		batch["llm_provider"] = provider
		is_cloud = provider == "cloud"
		
	if _api_key_edit:
		batch["cloud_api_key"] = _api_key_edit.text
	if _endpoint_edit:
		batch["cloud_url" if is_cloud else "local_url"] = _endpoint_edit.text
	if _model_edit:
		var model_name = _model_edit.text
		if is_cloud:
			batch["cloud_model"] = model_name
			batch["cloud_thinking_model"] = model_name
		else:
			batch["local_model"] = model_name
			batch["local_thinking_model"] = model_name
		
	if _enable_screenshots_check:
		batch["enable_screenshots"] = _enable_screenshots_check.button_pressed
	if _enable_thinking_check:
		batch["enable_thinking"] = _enable_thinking_check.button_pressed

	if _require_skill_confirmation_check:
		batch["require_skill_confirmation"] = _require_skill_confirmation_check.button_pressed
	if _enable_stt_check:
		batch["enable_stt"] = _enable_stt_check.button_pressed
	if _enable_tts_check:
		batch["enable_tts"] = _enable_tts_check.button_pressed
	if _whisper_url_edit:
		batch["whisper_url"] = _whisper_url_edit.text
	if _whisper_model_edit:
		batch["whisper_model"] = _whisper_model_edit.text
	if _font_size_spinbox:
		batch["font_size_offset"] = int(_font_size_spinbox.value)
	
	if _voice_option:
		var metadata = _voice_option.get_item_metadata(_voice_option.selected)
		if metadata is String and metadata.begins_with("local_piper:"):
			var model_path = metadata.substr("local_piper:".length())
			batch["tts_voice"] = "local_piper"
			batch["piper_model_path"] = model_path
		else:
			batch["tts_voice"] = metadata
		
	if _show_neural_check:
		batch["filter_show_neural"] = _show_neural_check.button_pressed
	if _show_system_check:
		batch["filter_show_system"] = _show_system_check.button_pressed
	if _show_mutter_check:
		batch["filter_show_mutter"] = _show_mutter_check.button_pressed
	if _openai_api_key_edit:
		batch["openai_api_key"] = _openai_api_key_edit.text

	if _mutter_pitch_min_spin:
		batch["tts_mutter_pitch_min"] = _mutter_pitch_min_spin.value
	if _mutter_pitch_max_spin:
		batch["tts_mutter_pitch_max"] = _mutter_pitch_max_spin.value
	if _mutter_speed_spin:
		batch["tts_mutter_speed"] = _mutter_speed_spin.value
	if _hotkey_button:
		batch["hotkey_keycode"] = _recorded_keycode
		batch["hotkey_modifiers"] = _recorded_modifiers
		batch["hotkey_text"] = _recorded_text
	if _tts_speed_spin:
		batch["tts_rate"] = _tts_speed_spin.value
		batch["piper_speed"] = _tts_speed_spin.value
	if _tts_pitch_spin:
		batch["tts_pitch"] = _tts_pitch_spin.value

	if _settings_manager.has_method("set_settings_batch"):
		_settings_manager.call("set_settings_batch", batch)
	else:
		for key in batch.keys():
			_settings_manager.set_setting(key, batch[key])

	close_settings()


func _on_close_pressed() -> void:
	close_settings()


func _on_hotkey_button_pressed() -> void:
	if _is_recording_hotkey:
		return
	_is_recording_hotkey = true
	_hotkey_button.text = "[ Press keys... ]"
	_hotkey_button.release_focus()


func _input(event: InputEvent) -> void:
	if not _is_recording_hotkey:
		return
		
	if event is InputEventKey and event.pressed:
		get_viewport().set_input_as_handled()
		
		if event.keycode == KEY_ESCAPE:
			_is_recording_hotkey = false
			_populate_fields() # Restore old text
			return
			
		var keycode = event.keycode
		if keycode in [KEY_CTRL, KEY_SHIFT, KEY_ALT, KEY_META]:
			return
			
		if not keycode in GODOT_TO_MACOS_KEYCODES:
			return
			
		var mac_keycode = GODOT_TO_MACOS_KEYCODES[keycode]
		var modifiers := 0
		var label_parts := []
		
		if event.ctrl_pressed:
			modifiers += 4096
			label_parts.append("Ctrl")
		if event.shift_pressed:
			modifiers += 512
			label_parts.append("Shift")
		if event.alt_pressed:
			modifiers += 2048
			label_parts.append("Opt")
		if event.meta_pressed:
			modifiers += 256
			label_parts.append("Cmd")
			
		var key_name := OS.get_keycode_string(keycode)
		label_parts.append(key_name)
		
		var hotkey_text = " + ".join(label_parts)
		
		_recorded_keycode = mac_keycode
		_recorded_modifiers = modifiers
		_recorded_text = hotkey_text
		
		_hotkey_button.text = hotkey_text
		_is_recording_hotkey = false


func _on_color_picked(color: Color) -> void:
	# Live preview color modulation on the fairy visuals during Picker operations
	color_changed.emit(color)


func _on_provider_selected(index: int) -> void:
	var provider: String = "local" if index == 0 else "cloud"
	_update_provider_fields(provider)


# Adjusts UI input visibility configurations to reflect current provider selection (local vs cloud API endpoints)
func _update_provider_fields(provider: String) -> void:
	var is_cloud: bool = provider == "cloud"

	# Update all conditional field visibilities in one place
	_update_conditional_field_visibility()

	# Adjust inline placeholder guides based on context
	if _endpoint_edit:
		_endpoint_edit.placeholder_text = (
			"https://generativelanguage.googleapis.com" if is_cloud
			else "http://localhost:11434"
		)
	if _model_edit:
		_model_edit.placeholder_text = "Enter model name"

	if _settings_manager:
		if _endpoint_edit:
			_endpoint_edit.text = _settings_manager.get_setting(
				"cloud_url" if is_cloud else "local_url", ""
			)
		if _model_edit:
			_model_edit.text = _settings_manager.get_setting(
				"cloud_model" if is_cloud else "local_model", ""
			)


# ---------------------------------------------------------------------------
# Live Navi Mode (NAV-65)
# ---------------------------------------------------------------------------

## Grays out or restores the colour picker and personality field depending on
## whether Live Navi Mode is active.
func _apply_live_mode_ui(enabled: bool) -> void:
	if _color_picker:
		_color_picker.disabled = enabled
		_color_picker.modulate.a = 0.45 if enabled else 1.0
		if enabled and has_node("/root/EmotionState"):
			# Show the live emotion colour
			var es := get_node("/root/EmotionState")
			var live_hex: String = _settings_manager.get_setting("fairy_color", "66b2ff")
			if es:
				var c: float = clampf((float(es.get("courage")) + 10.0) / 20.0, 0.0, 1.0)
				var w: float = clampf((float(es.get("wisdom"))  + 10.0) / 20.0, 0.0, 1.0)
				var p: float = clampf((float(es.get("power"))   + 10.0) / 20.0, 0.0, 1.0)
				var brightness: float = clampf((float(es.get("love_score")) + 1000.0) / 2000.0, 0.0, 1.0)
				var live_color := Color(p * brightness, c * brightness, w * brightness, 1.0)
				live_hex = live_color.to_html(false)
			_color_picker.color = Color.html(live_hex)

	if _personality_edit:
		_personality_edit.editable = not enabled
		_personality_edit.modulate.a = 0.45 if enabled else 1.0
		if enabled:
			# Show live personality descriptor in the grayed field
			var live_p: String = EmotionPromptBuilder.get_live_personality()
			_personality_edit.text = live_p
		else:
			# Restore saved personality text
			if _settings_manager:
				_personality_edit.text = _settings_manager.get_setting("personality", "")


## Called when the Live Navi Mode toggle changes.
## Immediately applies the grayed/restored UI state and restores the fairy
## colour via FairyVisuals when turning off.
func _on_live_navi_toggled(enabled: bool) -> void:
	_apply_live_mode_ui(enabled)

	if not enabled:
		# Restore fairy to saved user colour
		var window_controller := get_tree().root.get_node_or_null("Main/WindowController")
		if window_controller and "_fairy" in window_controller:
			window_controller._fairy.restore_user_color()
		else:
			# Try direct scene tree search as fallback
			var fairy := get_tree().root.find_child("FairyVisuals", true, false)
			if fairy and fairy.has_method("restore_user_color"):
				fairy.restore_user_color()


## Updates the settings panel container background & border colors.
## Uses the mood color as a subtle accent (border) while keeping a fixed dark
## background for consistent text legibility.
func update_theme_colors(base_color: Color) -> void:
	if not _panel:
		return
	var stylebox: StyleBoxFlat = _panel.get_theme_stylebox("panel")
	if stylebox:
		var new_stylebox := stylebox.duplicate() as StyleBoxFlat
		# Fixed dark neutral background — never changes with mood
		new_stylebox.bg_color = Color(0.06, 0.06, 0.08, 0.88)
		# Mood color as accent border
		var accent := base_color.lightened(0.15)
		accent.a = 0.55
		new_stylebox.border_color = accent
		_panel.add_theme_stylebox_override("panel", new_stylebox)

	# Tint the Save button with the mood color so it pops as an accent element
	if _save_button:
		var btn_style := StyleBoxFlat.new()
		btn_style.bg_color = Color(base_color.r * 0.7, base_color.g * 0.7, base_color.b * 0.7, 0.85)
		btn_style.corner_radius_top_left = 8
		btn_style.corner_radius_top_right = 8
		btn_style.corner_radius_bottom_right = 8
		btn_style.corner_radius_bottom_left = 8
		btn_style.content_margin_left = 12.0
		btn_style.content_margin_top = 8.0
		btn_style.content_margin_right = 12.0
		btn_style.content_margin_bottom = 8.0
		_save_button.add_theme_stylebox_override("normal", btn_style)
		# Lighter hover state
		var hover_style := btn_style.duplicate() as StyleBoxFlat
		hover_style.bg_color = Color(base_color.r * 0.85, base_color.g * 0.85, base_color.b * 0.85, 0.9)
		_save_button.add_theme_stylebox_override("hover", hover_style)


# ---------------------------------------------------------------------------
# In-app models downloader (NAV-74)
# ---------------------------------------------------------------------------

## Checks whether the offline Whisper + Piper models already exist on disk.
## Updates the Download button state so users can't re-download unnecessarily.
func _check_offline_models_state() -> void:
	if not _download_models_button:
		return
	var whisper_ready := FileAccess.file_exists("user://models/ggml-base.en.bin")
	var piper_ready := (
		FileAccess.file_exists("user://models/voices/en_US-amy-medium.onnx") or
		FileAccess.file_exists("user://models/voices/en_US-hfc_female-medium.onnx")
	)
	if whisper_ready and piper_ready:
		_download_models_button.text = "✅ Downloaded"
		_download_models_button.disabled = true
		_download_models_button.tooltip_text = "Models are already installed. Delete user://models/ to re-download."
	elif whisper_ready:
		_download_models_button.text = "Download (Voice missing)"
		_download_models_button.disabled = false
	else:
		_download_models_button.text = "Download"
		_download_models_button.disabled = false


func _on_download_models_pressed() -> void:
	if _download_models_button:
		_download_models_button.disabled = true
		_download_models_button.text = "Initializing..."

	# Ensure directories exist
	DirAccess.make_dir_recursive_absolute("user://models/voices")

	# Populate download queue
	_download_queue.clear()
	_download_queue.append({
		"url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
		"dest": "user://models/ggml-base.en.bin",
		"desc": "Whisper STT"
	})
	_download_queue.append({
		"url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx",
		"dest": "user://models/voices/en_US-amy-medium.onnx",
		"desc": "Amy ONNX Model"
	})
	_download_queue.append({
		"url": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json",
		"dest": "user://models/voices/en_US-amy-medium.onnx.json",
		"desc": "Amy Config"
	})

	_start_progress_timer()
	_process_download_queue()


func _start_download(url: String, dest_path: String, desc: String) -> void:
	if _download_http:
		_download_http.queue_free()
	
	_download_http = HTTPRequest.new()
	add_child(_download_http)
	_download_http.download_file = dest_path
	_download_http.request_completed.connect(_on_download_completed)
	
	_current_download_url = url
	_current_download_dest = dest_path
	_current_download_desc = desc
	
	var err = _download_http.request(url)
	if err != OK:
		_on_download_failed("Failed to start request: " + str(err))


func _start_progress_timer() -> void:
	if not _progress_timer:
		_progress_timer = Timer.new()
		_progress_timer.wait_time = 0.5
		_progress_timer.timeout.connect(_update_download_progress)
		add_child(_progress_timer)
	_progress_timer.start()


func _stop_progress_timer() -> void:
	if _progress_timer:
		_progress_timer.stop()


func _update_download_progress() -> void:
	if not _download_http or not _download_models_button:
		return
	
	var downloaded = _download_http.get_downloaded_bytes()
	var total = _download_http.get_body_size()
	
	if total > 0:
		var percent = int((float(downloaded) / float(total)) * 100.0)
		_download_models_button.text = "Downloading %s (%d%%)" % [_current_download_desc, percent]
	else:
		_download_models_button.text = "Downloading %s..." % _current_download_desc


func _process_download_queue() -> void:
	if _download_queue.is_empty():
		_download_models_button.text = "Downloaded"
		_download_models_button.disabled = false
		_stop_progress_timer()
		
		if _settings_manager:
			_settings_manager.set_setting("whisper_model_path", "user://models/ggml-base.en.bin")
			_settings_manager.set_setting("piper_model_path", "user://models/voices/en_US-amy-medium.onnx")
			_settings_manager.save_settings()
			
		_populate_voice_options()
		_check_offline_models_state()
		_show_mutter_error("Offline models downloaded successfully!")
		return
	
	var next_item = _download_queue.pop_front()
	_start_download(next_item.url, next_item.dest, next_item.desc)


func _on_download_completed(result: int, response_code: int, headers: PackedStringArray, body: PackedByteArray) -> void:
	# Intercept HTTP redirects (301, 302, 303, 307, 308) and follow the Location header manually
	if response_code in [301, 302, 303, 307, 308]:
		var location := _get_header_value(headers, "Location")
		if location != "":
			var resolved_url := _resolve_redirect_url(_current_download_url, location)
			print("Offline downloader: Redirected (", response_code, ") to ", resolved_url)
			# Remove any redirection payload written to the destination file
			if FileAccess.file_exists(_current_download_dest):
				DirAccess.remove_absolute(_current_download_dest)
			# Restart request with redirected absolute URL
			_start_download(resolved_url, _current_download_dest, _current_download_desc)
			return
		else:
			_on_download_failed("Redirect status received without a Location header.")
			return

	if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
		_on_download_failed("Download failed with result: %d, response: %d" % [result, response_code])
		return
	
	_process_download_queue()


func _get_header_value(headers: PackedStringArray, header_name: String) -> String:
	var prefix := header_name.to_lower() + ":"
	for header in headers:
		var cleaned := header.strip_edges()
		if cleaned.to_lower().begins_with(prefix):
			return cleaned.substr(prefix.length()).strip_edges()
	return ""


func _resolve_redirect_url(original_url: String, redirect_url: String) -> String:
	if redirect_url.begins_with("http://") or redirect_url.begins_with("https://"):
		return redirect_url
	
	# Root-relative path
	if redirect_url.begins_with("/"):
		var scheme_end := original_url.find("://")
		if scheme_end == -1:
			return redirect_url
		var host_end := original_url.find("/", scheme_end + 3)
		var host: String
		if host_end == -1:
			host = original_url
		else:
			host = original_url.left(host_end)
		return host + redirect_url

	# Relative path (not starting with /)
	var parent_url := original_url.get_base_dir()
	if not parent_url.ends_with("/"):
		parent_url += "/"
	return parent_url + redirect_url


func _on_download_failed(error_msg: String) -> void:
	_stop_progress_timer()
	_download_queue.clear()
	if _download_models_button:
		_download_models_button.text = "Download Failed"
		_download_models_button.disabled = false
	ErrorBus.report("Offline download failed: " + str(error_msg))
	_show_mutter_error("Download failed: " + error_msg)


func _check_piper_engine_installed() -> bool:
	var raw_bin := "res://bin/piper"
	if _settings_manager:
		raw_bin = _settings_manager.get_setting("piper_bin_path", "res://bin/piper")
	var bin_path := ProjectSettings.globalize_path(raw_bin)
	
	if not FileAccess.file_exists(bin_path):
		return false
		
	var output: Array[String] = []
	# bin/piper exits with 127 if the piper module import fails.
	# It exits with 2 (missing args) if it succeeds.
	var exit_code := OS.execute(bin_path, [], output, true)
	return exit_code != 127


func _check_piper_engine_state() -> void:
	if not _install_piper_button:
		return
	if _check_piper_engine_installed():
		_install_piper_button.text = "✅ Installed"
		_install_piper_button.disabled = true
		_install_piper_button.tooltip_text = "Piper TTS python package is installed in your python environment."
	else:
		_install_piper_button.text = "Install"
		_install_piper_button.disabled = false
		_install_piper_button.tooltip_text = "Piper TTS python package is missing. Click to install it."


func _on_install_piper_pressed() -> void:
	if _install_piper_button:
		_install_piper_button.disabled = true
		_install_piper_button.text = "Installing..."
	
	var script_path := ProjectSettings.globalize_path("res://install_piper.sh")
	if not FileAccess.file_exists(script_path):
		_write_install_piper_script()
	
	OS.execute("chmod", ["+x", script_path])
	
	_installer_thread = Thread.new()
	var err = _installer_thread.start(_run_installer_thread.bind(script_path))
	if err != OK:
		_install_piper_button.text = "Install Failed"
		_install_piper_button.disabled = false
		_check_piper_engine_state()
		_show_mutter_error("Failed to start background installer thread.")
		return
		
	while _installer_thread.is_alive():
		await get_tree().process_frame
		
	var results = _installer_thread.wait_to_finish()
	var exit_code: int = results[0]
	var output: Array = results[1]
	_on_installer_finished(exit_code, output)


func _run_installer_thread(script_path: String) -> Array:
	var output: Array[String] = []
	var exit_code := OS.execute(script_path, [], output, true)
	return [exit_code, output]


func _on_installer_finished(exit_code: int, output: Array) -> void:
	print("Piper installer finished. Exit code: ", exit_code, " Output: ", output)
	_check_piper_engine_state()
	if _check_piper_engine_installed():
		_show_mutter_error("Piper TTS installed successfully!")
	else:
		var error_msg := "Failed to install Piper. Run 'install_piper.sh' manually."
		if output.size() > 0:
			for line in output:
				if "error" in line.to_lower() or "failed" in line.to_lower():
					error_msg = "Installation failed: " + line.strip_edges()
					break
		_show_mutter_error(error_msg)


func _write_install_piper_script() -> void:
	var script_path := ProjectSettings.globalize_path("res://install_piper.sh")
	var f := FileAccess.open(script_path, FileAccess.WRITE)
	if f:
		var script_content := (
			"#!/usr/bin/env bash\n\n" +
			"echo \"=== Piper TTS Installation Script ===\"\n\n" +
			"# 1. Find python3\n" +
			"PYTHON_CMD=\"\"\n" +
			"for cmd in python3 python; do\n" +
			"    if command -v \"$cmd\" &> /dev/null; then\n" +
			"        PYTHON_CMD=$(command -v \"$cmd\")\n" +
			"        break\n" +
			"    fi\n" +
			"done\n\n" +
			"if [ -z \"$PYTHON_CMD\" ]; then\n" +
			"    echo \"❌ ERROR: python3 or python was not found in your PATH.\" >&2\n" +
			"    echo \"Please install Python 3 and ensure it is in your PATH.\" >&2\n" +
			"    exit 1\n" +
			"fi\n\n" +
			"echo \"Found Python at: $PYTHON_CMD\"\n\n" +
			"# 2. Check if pip is available\n" +
			"PIP_CMD=\"\"\n" +
			"if \"$PYTHON_CMD\" -m pip --version &> /dev/null; then\n" +
			"    PIP_CMD=\"$PYTHON_CMD -m pip\"\n" +
			"elif command -v pip3 &> /dev/null; then\n" +
			"    PIP_CMD=\"pip3\"\n" +
			"elif command -v pip &> /dev/null; then\n" +
			"    PIP_CMD=\"pip\"\n" +
			"fi\n\n" +
			"if [ -z \"$PIP_CMD\" ]; then\n" +
			"    echo \"❌ ERROR: pip was not found. Please install pip for your Python environment.\" >&2\n" +
			"    exit 1\n" +
			"fi\n\n" +
			"echo \"Installing piper-tts module...\"\n" +
			"# 3. Try to install piper-tts\n" +
			"if $PIP_CMD install piper-tts; then\n" +
			"    echo \"✅ Successfully installed piper-tts!\"\n" +
			"    exit 0\n" +
			"else\n" +
			"    echo \"Attempting install with --break-system-packages...\"\n" +
			"    if $PIP_CMD install piper-tts --break-system-packages; then\n" +
			"        echo \"✅ Successfully installed piper-tts!\"\n" +
			"        exit 0\n" +
			"    else\n" +
			"        echo \"❌ ERROR: Failed to install piper-tts.\" >&2\n" +
			"        exit 1\n" +
			"    fi\n" +
			"fi\n"
		)
		f.store_string(script_content)
		f.close()
