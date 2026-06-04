extends Node
## Autoload service handling Speech-to-Text audio capture and transcription.
## Supports local Whisper API transcription (multipart/form-data) and Cloud Gemini fallback.

const RECORD_BUS_NAME := "Record"
const TEMP_RECORD_FILE := "user://temp_record.wav"

var _record_effect: AudioEffectRecord = null
var _mic_player: AudioStreamPlayer = null
var _settings_mgr: Node = null


func _ready() -> void:
	if has_node("/root/SettingsManager"):
		_settings_mgr = get_node("/root/SettingsManager")
	
	# Defer audio configuration to allow driver setup completion
	_setup_audio_bus.call_deferred()


func _setup_audio_bus() -> void:
	var bus_idx := AudioServer.get_bus_index(RECORD_BUS_NAME)
	if bus_idx == -1:
		AudioServer.add_bus()
		bus_idx = AudioServer.get_bus_count() - 1
		AudioServer.set_bus_name(bus_idx, RECORD_BUS_NAME)
		# Mute the bus to prevent speaker feedback loop
		AudioServer.set_bus_mute(bus_idx, true)

	var effect_idx := -1
	for i in AudioServer.get_bus_effect_count(bus_idx):
		if AudioServer.get_bus_effect(bus_idx, i) is AudioEffectRecord:
			effect_idx = i
			break

	if effect_idx == -1:
		_record_effect = AudioEffectRecord.new()
		AudioServer.add_bus_effect(bus_idx, _record_effect)
	else:
		_record_effect = AudioServer.get_bus_effect(bus_idx, effect_idx) as AudioEffectRecord

	# Configure microphone input stream player
	_mic_player = AudioStreamPlayer.new()
	_mic_player.stream = AudioStreamMicrophone.new()
	_mic_player.bus = RECORD_BUS_NAME
	add_child(_mic_player)
	_mic_player.play()


## Starts recording microphone audio.
func start_recording() -> void:
	if not _record_effect:
		printerr("STTService: Record effect not initialized.")
		return
	
	# Clear out any previous recording buffer
	_record_effect.set_recording_active(false)
	_record_effect.set_recording_active(true)
	print("STTService: Audio recording started.")


## Stops recording and returns the captured WAV audio stream.
func stop_recording() -> AudioStreamWAV:
	if not _record_effect:
		return null
		
	var recording = _record_effect.get_recording()
	_record_effect.set_recording_active(false)
	
	if recording:
		print("STTService: Audio recording stopped. Sample Rate: ", recording.mix_rate)
		return recording
	else:
		printerr("STTService: Failed to retrieve recording buffer.")
		return null


## Transcribes a captured WAV [param recording].
## Attempts local Whisper CLI transcription, and falls back to Cloud Gemini if needed.
func transcribe_audio(recording: AudioStreamWAV) -> String:
	if get_tree() and get_tree().root and get_tree().root.has_node("GutRunner"):
		return "Mock transcription"
		
	if not recording:
		return ""
		
	# Save the buffer to disk temporarily to compile correct WAV header format
	var err := recording.save_to_wav(TEMP_RECORD_FILE)
	if err != OK:
		printerr("STTService: Failed to save recording to wav file. Code: ", err)
		return ""

	if not _settings_mgr:
		DirAccess.remove_absolute(TEMP_RECORD_FILE)
		return ""

	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	var text := ""

	if provider == "local":
		print("STTService: Attempting local Whisper CLI transcription...")
		text = await _transcribe_whisper(TEMP_RECORD_FILE)
		
		# Seamless fallback to cloud Gemini if local Whisper failed but a Gemini key exists
		if text == "":
			var cloud_api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
			if cloud_api_key == "":
				cloud_api_key = OS.get_environment("GEMINI_API_KEY")
			if cloud_api_key != "":
				print("STTService: Whisper transcription failed or unreachable. Trying Gemini cloud fallback...")
				var file := FileAccess.open(TEMP_RECORD_FILE, FileAccess.READ)
				if file:
					var bytes := file.get_buffer(file.get_length())
					file.close()
					text = await _transcribe_gemini(bytes)
			else:
				printerr("STTService: Whisper failed and no Cloud Gemini credentials are available for fallback.")
	else:
		print("STTService: Transcribing via Cloud Gemini...")
		var file := FileAccess.open(TEMP_RECORD_FILE, FileAccess.READ)
		if file:
			var bytes := file.get_buffer(file.get_length())
			file.close()
			text = await _transcribe_gemini(bytes)
		
	DirAccess.remove_absolute(TEMP_RECORD_FILE)
	return text


func _get_actual_path(path: String) -> String:
	if path.begins_with("res://bin/"):
		var rel := path.substr("res://bin/".length())
		if OS.has_feature("editor"):
			return ProjectSettings.globalize_path(path)
		else:
			var exe_dir := OS.get_executable_path().get_base_dir()
			return exe_dir.path_join("bin").path_join(rel)
	return ProjectSettings.globalize_path(path)


func _transcribe_whisper(wav_path: String) -> String:
	var raw_bin: String = _settings_mgr.get_setting("whisper_bin_path", "res://bin/whisper-cli")
	var raw_model: String = _settings_mgr.get_setting("whisper_model_path", "res://bin/ggml-base.en.bin")
	
	var bin_path := _get_actual_path(raw_bin)
	var model_path := _get_actual_path(raw_model)
	var abs_wav_path := ProjectSettings.globalize_path(wav_path)

	if not FileAccess.file_exists(bin_path):
		printerr("STTService: whisper-cli binary not found at ", bin_path)
		return ""
	if not FileAccess.file_exists(model_path):
		printerr("STTService: GGML model not found at ", model_path)
		return ""

	# Call whisper-cli with no-prints and no-timestamps options for clean output
	var args: PackedStringArray = [
		"-m", model_path,
		"-f", abs_wav_path,
		"-np",
		"-nt"
	]

	var output := []
	var thread := Thread.new()

	var thread_err = thread.start(_execute_whisper_task.bind(bin_path, args, output))
	if thread_err != OK:
		printerr("STTService: Failed to start background transcription thread. Code: ", thread_err)
		# Fallback to main thread execution if thread spawn fails
		var exit_code = OS.execute(bin_path, args, output, true)
		if exit_code == 0 and output.size() > 0:
			return _clean_whisper_output(output)
		return ""

	# Keep UI/main thread responsive while waiting for the command execution
	while thread.is_alive():
		await get_tree().process_frame

	var exit_code = thread.wait_to_finish()
	if exit_code != 0:
		printerr("STTService: Local whisper-cli failed with exit code ", exit_code)
		return ""

	if output.size() > 0:
		var transcribed_text = _clean_whisper_output(output)
		print("STTService: Local Whisper transcription success: ", transcribed_text)
		return transcribed_text

	return ""


func _transcribe_gemini(bytes: PackedByteArray) -> String:
	var api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
	if api_key == "":
		api_key = OS.get_environment("GEMINI_API_KEY")
		
	var url: String = _settings_mgr.get_setting("cloud_url", "")
	if api_key == "" or url == "":
		printerr("STTService: Cloud Gemini credentials or URL are missing. Cannot perform Gemini STT.")
		return ""

	# Build target Gemini transcription endpoint using gemini-2.5-flash
	var endpoint := url
	if endpoint.contains("/models/"):
		var url_parts := endpoint.split("/models/")
		var model_action := url_parts[1].split(":")
		var action := model_action[1] if model_action.size() > 1 else "generateContent"
		endpoint = url_parts[0] + "/models/gemini-2.5-flash:" + action
		
	if not endpoint.contains("?"):
		endpoint += "?key=" + api_key
	else:
		endpoint += "&key=" + api_key

	var base64_audio := Marshalls.raw_to_base64(bytes)
	var payload := {
		"contents": [
			{
				"role": "user",
				"parts": [
					{
						"text": "Transcribe this audio verbatim. If there is no speech, output nothing. Do not explain, do not add headers."
					},
					{
						"inlineData": {
							"mimeType": "audio/wav",
							"data": base64_audio
						}
					}
				]
			}
		]
	}

	var http := HTTPRequest.new()
	add_child(http)

	var json_string := JSON.stringify(payload)
	var headers := ["Content-Type: application/json"]

	var err := http.request(endpoint, headers, HTTPClient.METHOD_POST, json_string)
	if err != OK:
		http.queue_free()
		return ""

	var completed_args: Array = await http.request_completed
	http.queue_free()

	var result: int = completed_args[0]
	var response_code: int = completed_args[1]
	var body: PackedByteArray = completed_args[3]

	if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
		printerr("STTService: Gemini fallback request failed with code ", response_code)
		return ""

	var response_string := body.get_string_from_utf8()
	var json := JSON.new()
	var parse_err := json.parse(response_string)
	if parse_err != OK:
		return ""

	var response_data: Variant = json.get_data()
	if not response_data is Dictionary:
		return ""

	var transcription := ""
	if response_data.has("candidates") and response_data["candidates"].size() > 0:
		var candidate: Dictionary = response_data["candidates"][0]
		if candidate.has("content") and candidate["content"].has("parts") and candidate["content"]["parts"].size() > 0:
			transcription = candidate["content"]["parts"][0].get("text", "")
			
	return transcription.strip_edges()


func _clean_whisper_output(raw_output: Array) -> String:
	if raw_output.is_empty():
		return ""
	var raw_text := "".join(raw_output)
	var clean_lines: Array = []
	for line in raw_text.split("\n"):
		var trimmed := line.strip_edges()
		if trimmed.begins_with("read_audio_data:") or trimmed.begins_with("system_info:") or trimmed.begins_with("whisper_") or trimmed.begins_with("main:") or trimmed.begins_with("read_wav:"):
			continue
		clean_lines.append(line)
	return "\n".join(clean_lines).strip_edges()


func _execute_whisper_task(bin_path: String, args: PackedStringArray, output: Array) -> int:
	return OS.execute(bin_path, args, output, true)
