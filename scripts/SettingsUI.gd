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
var _api_key_edit: LineEdit
var _endpoint_edit: LineEdit
var _model_edit: LineEdit
var _thinking_model_edit: LineEdit
var _save_button: Button
var _close_button: Button
var _enable_screenshots_check: CheckBox
var _enable_thinking_check: CheckBox

var _settings_manager: Node = null
var _tween: Tween = null


func _ready() -> void:
	# Resolve node tree connections lazily, preventing errors if run without full visual scenes (e.g., GUT testing)
	_panel = get_node_or_null("PanelContainer")
	var margin: Node = null
	var vbox: Node = null
	if _panel:
		margin = _panel.get_node_or_null("MarginContainer")
	if margin:
		vbox = margin.get_node_or_null("VBoxContainer")
	if vbox:
		_system_prompt_edit = vbox.get_node_or_null("SystemPromptEdit")
		_personality_edit    = vbox.get_node_or_null("PersonalityEdit")
		_provider_option     = vbox.get_node_or_null("ProviderOption")
		_endpoint_edit       = vbox.get_node_or_null("EndpointEdit")
		_model_edit          = vbox.get_node_or_null("ModelEdit")
		_thinking_model_edit = vbox.get_node_or_null("ThinkingModelEdit")
		_api_key_edit        = vbox.get_node_or_null("ApiKeyEdit")
		_save_button         = vbox.get_node_or_null("ButtonRow/SaveButton")
		_close_button        = vbox.get_node_or_null("ButtonRow/CloseButton")
		var color_row: Node  = vbox.get_node_or_null("ColorRow")
		if color_row:
			_color_picker = color_row.get_node_or_null("ColorPickerButton")
		var toggle_row: Node = vbox.get_node_or_null("SkillsToggleRow")
		if toggle_row:
			_enable_screenshots_check = toggle_row.get_node_or_null("EnableScreenshotsCheck")
			_enable_thinking_check    = toggle_row.get_node_or_null("EnableThinkingCheck")

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

	if _api_key_edit:
		_api_key_edit.visible = is_cloud

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
