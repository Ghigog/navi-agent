extends Node
## Autoload service handling Text-to-Speech responses.
## Integrates with DisplayServer's native platform voice synthesizers.

var _settings_mgr: Node = null
var _audio_player: AudioStreamPlayer = null
var _procedural_sound: AudioStreamWAV = null
var _speak_active_id: int = 0

var _stream_active: bool = false
var _stream_buffer: String = ""
var _stream_char_queue: Array[String] = []
var _is_mutter_loop_running: bool = false
var _playback_queue: Array[AudioStream] = []
var _next_sequence_id: int = 0
var _next_play_idx: int = 0
var _synthesis_results: Dictionary = {}


func _ready() -> void:
	if has_node("/root/SettingsManager"):
		_settings_mgr = get_node("/root/SettingsManager")

	_audio_player = AudioStreamPlayer.new()
	add_child(_audio_player)
	_audio_player.finished.connect(_on_audio_finished)
	_procedural_sound = _generate_procedural_chatter_sound()


## Vocalizes the specified [param text] if TTS is enabled and not muted.
## Strips bbcode formatting and internal <think> blocks before sending to the engine.
func speak(text: String) -> void:
	if not _settings_mgr:
		return
	if not _settings_mgr.get_setting("enable_tts", true) or _settings_mgr.get_setting("tts_mute", false):
		return

	var clean_text := NaviUtils.strip_thinking_block(text)
	clean_text = NaviUtils.strip_skill_and_pause_tags(clean_text)
	clean_text = _strip_bbcode(clean_text)
	clean_text = _clean_text_for_tts(clean_text)
	clean_text = clean_text.strip_edges()
	if clean_text == "":
		return

	# Halt any ongoing playback before starting new text output
	stop()

	print("TTSService: Speaking text: \"", clean_text.left(60), ("..." if clean_text.length() > 60 else ""), "\"")
	
	var voice_id: String = _settings_mgr.get_setting("tts_voice", "")
	if voice_id == "local_piper":
		_speak_local_piper(clean_text)
	elif voice_id.begins_with("cloud_"):
		_speak_cloud_tts(clean_text, voice_id)
	elif voice_id == "mutter_procedural":
		_speak_mutter(clean_text, "")
	elif voice_id.begins_with("mutter_custom:"):
		var custom_path := voice_id.substr("mutter_custom:".length())
		_speak_mutter(clean_text, custom_path)
	else:
		var voice := voice_id
		if voice == "":
			voice = _get_best_voice()
		var pitch: float = _settings_mgr.get_setting("tts_pitch", 1.0)
		var rate: float = _settings_mgr.get_setting("tts_rate", 1.0)
		if voice != "":
			DisplayServer.tts_speak(clean_text, voice, 50, pitch, rate)
		else:
			DisplayServer.tts_speak(clean_text, "", 50, pitch, rate)


func _get_actual_path(path: String) -> String:
	if path.begins_with("res://bin/"):
		var rel := path.substr("res://bin/".length())
		if OS.has_feature("editor"):
			return ProjectSettings.globalize_path(path)
		else:
			var exe_dir := OS.get_executable_path().get_base_dir()
			return exe_dir.path_join("bin").path_join(rel)
	return ProjectSettings.globalize_path(path)


func _speak_local_piper(text: String) -> void:
	if get_tree() and get_tree().root and get_tree().root.has_node("GutRunner"):
		return
		
	var raw_bin: String = _settings_mgr.get_setting("piper_bin_path", "res://bin/piper")
	var raw_model: String = _settings_mgr.get_setting("piper_model_path", "res://bin/voices/en_US-amy-medium.onnx")
	
	var bin_path := _get_actual_path(raw_bin)
	var model_path := _get_actual_path(raw_model)
	
	if not FileAccess.file_exists(bin_path) or not FileAccess.file_exists(model_path):
		printerr("TTSService: Local piper binary or voice model missing. Falling back to system default. Resolved Bin: ", bin_path, " Resolved Model: ", model_path)
		var voice = _get_best_voice()
		if voice != "":
			DisplayServer.tts_speak(text, voice)
		else:
			DisplayServer.tts_speak(text, "")
		return

	var current_id := _speak_active_id
	var seq_id := _next_sequence_id
	_next_sequence_id += 1

	var temp_wav := "user://temp_speech_" + str(current_id) + "_" + str(randi()) + ".wav"
	var abs_wav_path := ProjectSettings.globalize_path(temp_wav)
	var speed: float = _settings_mgr.get_setting("piper_speed", 1.0)

	var length_scale := 1.0
	if speed > 0.0:
		length_scale = 1.0 / speed

	var args: PackedStringArray = [
		"--model", model_path,
		"--output_file", abs_wav_path,
		"--length_scale", str(length_scale),
		text
	]

	var thread := Thread.new()
	var output: Array[String] = []
	print("TTSService: Spawning Piper thread for text: \"", text.left(30), "...\" using bin: ", bin_path)
	var thread_err: Error = thread.start(_execute_piper_task.bind(bin_path, args, output))
	if thread_err != OK:
		printerr("TTSService: Failed to start background Piper thread. Error: ", thread_err)
		var exit_code: int = OS.execute(bin_path, args, output, true)
		print("TTSService: Direct fallback execute exit code: ", exit_code, " Output: ", output)
		if exit_code == 0:
			_play_generated_wav(temp_wav, current_id, seq_id)
		else:
			_on_synthesis_completed(seq_id, null, current_id)
		return

	while thread.is_alive():
		await get_tree().process_frame

	var exit_code: int = thread.wait_to_finish()
	print("TTSService: Piper thread finished. Exit code: ", exit_code, " Output: ", output)
	if exit_code == 0 and current_id == _speak_active_id:
		_play_generated_wav(temp_wav, current_id, seq_id)
	else:
		if current_id != _speak_active_id:
			print("TTSService: speak_active_id changed from ", current_id, " to ", _speak_active_id, ", discarding synthesis.")
		DirAccess.remove_absolute(temp_wav)
		_on_synthesis_completed(seq_id, null, current_id)


func _play_generated_wav(path: String, id: int, seq_id: int) -> void:
	if id != _speak_active_id:
		print("TTSService: Discarding generated WAV: speak_active_id changed.")
		DirAccess.remove_absolute(path)
		_on_synthesis_completed(seq_id, null, id)
		return
	if not FileAccess.file_exists(path):
		printerr("TTSService: Generated speech WAV not found at: ", path)
		_on_synthesis_completed(seq_id, null, id)
		return
		
	var stream := AudioStreamWAV.load_from_file(path)
	print("TTSService: Successfully loaded speech WAV: ", path, " size: ", stream.data.size() if stream else 0)
	DirAccess.remove_absolute(path)
	_on_synthesis_completed(seq_id, stream, id)


func _on_synthesis_completed(seq_id: int, stream: AudioStream, id: int) -> void:
	if id != _speak_active_id:
		print("TTSService: Synthesis completed for discarded ID: ", id)
		return
		
	_synthesis_results[seq_id] = stream
	
	# Play completed streams in strict sequential sequence order
	while _synthesis_results.has(_next_play_idx):
		var next_stream = _synthesis_results[_next_play_idx]
		_synthesis_results.erase(_next_play_idx)
		_next_play_idx += 1
		if next_stream:
			_queue_audio_stream(next_stream)


func _queue_audio_stream(stream: AudioStream) -> void:
	_playback_queue.append(stream)
	if not _audio_player.playing:
		_play_next_in_queue()


func _play_next_in_queue() -> void:
	if _playback_queue.is_empty():
		return
	var stream = _playback_queue.pop_front()
	_audio_player.stream = stream
	_audio_player.pitch_scale = 1.0
	_audio_player.play()


func _on_audio_finished() -> void:
	_play_next_in_queue()


func _speak_cloud_tts(text: String, provider: String) -> void:
	var api_key: String = _settings_mgr.get_setting("openai_api_key", "")
	if api_key == "":
		api_key = OS.get_environment("OPENAI_API_KEY")
		
	var url: String = _settings_mgr.get_setting("cloud_tts_url", "https://api.openai.com/v1/audio/speech")
	var model: String = _settings_mgr.get_setting("cloud_tts_model", "tts-1")
	var voice: String = _settings_mgr.get_setting("cloud_tts_voice", "alloy")

	var current_id := _speak_active_id
	var seq_id := _next_sequence_id
	_next_sequence_id += 1

	var headers: Array[String] = ["Content-Type: application/json"]
	var payload := {}

	if provider == "cloud_openai":
		if api_key != "":
			headers.append("Authorization: Bearer " + api_key)
		payload = {
			"model": model,
			"input": text,
			"voice": voice
		}
	elif provider == "cloud_gemini" or provider == "cloud_edge":
		# Use free Google Translate speech endpoint as a highly premium, fallback cloud option that doesn't need key
		var lang := "en"
		var tts_url: String = "https://translate.google.com/translate_tts?ie=UTF-8&tl=" + lang + "&client=tw-ob&q=" + text.uri_encode()
		_speak_via_get_request(tts_url, current_id, seq_id)
		return

	var http := HTTPRequest.new()
	add_child(http)
	var json_string := JSON.stringify(payload)
	var err := http.request(url, headers, HTTPClient.METHOD_POST, json_string)
	if err != OK:
		http.queue_free()
		_on_synthesis_completed(seq_id, null, current_id)
		return

	var completed_args: Array = await http.request_completed
	http.queue_free()

	if current_id != _speak_active_id:
		_on_synthesis_completed(seq_id, null, current_id)
		return

	var result: int = completed_args[0]
	var response_code: int = completed_args[1]
	var body: PackedByteArray = completed_args[3]

	if result == HTTPRequest.RESULT_SUCCESS and response_code >= 200 and response_code < 300:
		var stream := AudioStreamMP3.new()
		stream.data = body
		_on_synthesis_completed(seq_id, stream, current_id)
	else:
		printerr("TTSService: Cloud TTS request failed with code ", response_code)
		_on_synthesis_completed(seq_id, null, current_id)


func _speak_via_get_request(url: String, id: int, seq_id: int) -> void:
	var http := HTTPRequest.new()
	add_child(http)
	var err := http.request(url)
	if err != OK:
		http.queue_free()
		_on_synthesis_completed(seq_id, null, id)
		return
	var completed_args: Array = await http.request_completed
	http.queue_free()
	
	if id != _speak_active_id:
		_on_synthesis_completed(seq_id, null, id)
		return
		
	var result: int = completed_args[0]
	var response_code: int = completed_args[1]
	var body: PackedByteArray = completed_args[3]
	
	if result == HTTPRequest.RESULT_SUCCESS and response_code >= 200 and response_code < 300:
		var stream := AudioStreamMP3.new()
		stream.data = body
		_on_synthesis_completed(seq_id, stream, id)
	else:
		printerr("TTSService: Cloud voice fetch failed with code: ", response_code)
		_on_synthesis_completed(seq_id, null, id)


## Checks if the speech synthesizer, background synthesis, or mutter playback is active.
func is_speaking() -> bool:
	if _audio_player and _audio_player.playing:
		return true
	if _playback_queue.size() > 0:
		return true
	if _next_play_idx < _next_sequence_id:
		return true
	if DisplayServer.tts_is_speaking():
		return true
	return false


## Immediately stops any ongoing speech synthesis or mutter playback.
func stop() -> void:
	DisplayServer.tts_stop()
	_speak_active_id += 1
	_stream_active = false
	_stream_buffer = ""
	_stream_char_queue.clear()
	_playback_queue.clear()
	_next_sequence_id = 0
	_next_play_idx = 0
	_synthesis_results.clear()
	if _audio_player and _audio_player.playing:
		_audio_player.stop()


func start_speech_stream() -> void:
	stop()
	if not _settings_mgr:
		print("TTSService: start_speech_stream returned early - _settings_mgr is null")
		return
	var enabled = _settings_mgr.get_setting("enable_tts", true)
	var muted = _settings_mgr.get_setting("tts_mute", false)
	print("TTSService: start_speech_stream called. enable_tts: ", enabled, ", tts_mute: ", muted)
	if not enabled or muted:
		return
		
	_stream_active = true
	_stream_buffer = ""
	_stream_char_queue.clear()
	_is_mutter_loop_running = false


func add_speech_chunk(chunk: String) -> void:
	if not _stream_active or not _settings_mgr:
		# Only print if settings_mgr exists, to avoid spamming if not initialized
		if _settings_mgr:
			print("TTSService: add_speech_chunk ignored - _stream_active is false")
		return
		
	var voice_id: String = _settings_mgr.get_setting("tts_voice", "")
	var is_mutter := voice_id == "mutter_procedural" or voice_id.begins_with("mutter_custom:")
	
	if is_mutter:
		for character in chunk:
			_stream_char_queue.append(character)
		if not _is_mutter_loop_running:
			_is_mutter_loop_running = true
			_run_mutter_stream_loop(voice_id)
	else:
		_stream_buffer += chunk
		_process_system_stream_buffer()


func end_speech_stream() -> void:
	if not _stream_active or not _settings_mgr:
		if _settings_mgr:
			print("TTSService: end_speech_stream ignored - _stream_active is false")
		return
		
	var voice_id: String = _settings_mgr.get_setting("tts_voice", "")
	var is_mutter := voice_id == "mutter_procedural" or voice_id.begins_with("mutter_custom:")
	
	if not is_mutter:
		if _stream_buffer.strip_edges() != "":
			_speak_system_sentence(_stream_buffer)
			_stream_buffer = ""
			
	_stream_active = false


func _process_system_stream_buffer() -> void:
	# Clean completed scratchpad blocks
	while true:
		var scratch_idx = _stream_buffer.find("<scratchpad>")
		if scratch_idx != -1:
			var close_idx = _stream_buffer.find("</scratchpad>", scratch_idx)
			if close_idx != -1:
				_stream_buffer = _stream_buffer.left(scratch_idx) + _stream_buffer.substr(close_idx + 13)
			else:
				# Scratchpad is still streaming, wait for closing tag and do not speak anything yet
				return
		else:
			# If the stream starts with a partial/streaming opening tag, wait and do not speak it
			if _stream_buffer.contains("<scra") or _stream_buffer.contains("<scratch") or _stream_buffer.contains("<scratchpad"):
				return
			break

	# Clean completed think blocks
	while true:
		var think_idx = _stream_buffer.find("<think>")
		if think_idx != -1:
			var close_idx = _stream_buffer.find("</think>", think_idx)
			if close_idx != -1:
				_stream_buffer = _stream_buffer.left(think_idx) + _stream_buffer.substr(close_idx + 8)
			else:
				# Think block is still streaming, wait for closing tag and do not speak anything yet
				return
		else:
			# If the stream starts with a partial/streaming opening tag, wait and do not speak it
			if _stream_buffer.contains("<thi") or _stream_buffer.contains("<think"):
				return
			break

	var punctuations := [".", "?", "!", "\n"]
	var search_index := 0
	
	while search_index < _stream_buffer.length():
		var character := _stream_buffer[search_index]
		if character in punctuations:
			var sentence := _stream_buffer.substr(0, search_index + 1)
			_stream_buffer = _stream_buffer.substr(search_index + 1)
			_speak_system_sentence(sentence)
			search_index = 0
		else:
			search_index += 1


func _speak_system_sentence(sentence: String) -> void:
	var clean := NaviUtils.strip_thinking_block(sentence)
	clean = NaviUtils.strip_skill_and_pause_tags(clean)
	clean = _strip_bbcode(clean)
	clean = _clean_text_for_tts(clean)
	clean = clean.strip_edges()
	if clean == "":
		return
		
	var voice_id: String = _settings_mgr.get_setting("tts_voice", "")
	if voice_id == "local_piper":
		_speak_local_piper(clean)
	elif voice_id.begins_with("cloud_"):
		_speak_cloud_tts(clean, voice_id)
	else:
		var voice := voice_id
		if voice == "":
			voice = _get_best_voice()
		var pitch: float = _settings_mgr.get_setting("tts_pitch", 1.0)
		var rate: float = _settings_mgr.get_setting("tts_rate", 1.0)
		if voice != "":
			DisplayServer.tts_speak(clean, voice, 50, pitch, rate)
		else:
			DisplayServer.tts_speak(clean, "", 50, pitch, rate)


func _run_mutter_stream_loop(voice_id: String) -> void:
	_speak_active_id += 1
	var current_id := _speak_active_id
	
	var custom_path := ""
	if voice_id.begins_with("mutter_custom:"):
		custom_path = voice_id.substr("mutter_custom:".length())
		
	var stream: AudioStream = null
	if custom_path != "" and FileAccess.file_exists(custom_path):
		var ext := custom_path.get_extension().to_lower()
		if ext == "wav":
			stream = AudioStreamWAV.load_from_file(custom_path)
		elif ext == "ogg":
			stream = AudioStreamOggVorbis.load_from_file(custom_path)

	if not stream:
		stream = _procedural_sound

	_audio_player.stream = stream

	var min_pitch: float = _settings_mgr.get_setting("tts_mutter_pitch_min", 0.85)
	var max_pitch: float = _settings_mgr.get_setting("tts_mutter_pitch_max", 1.25)
	var speed: float = _settings_mgr.get_setting("tts_mutter_speed", 0.06)
	
	var in_think := false
	
	while _speak_active_id == current_id and (_stream_active or not _stream_char_queue.is_empty()):
		if _stream_char_queue.is_empty():
			await get_tree().process_frame
			continue
			
		var character: String = _stream_char_queue.pop_front()
		
		if character == "<":
			var tag_buffer := "<"
			while not _stream_char_queue.is_empty() and character != ">":
				character = _stream_char_queue.pop_front()
				tag_buffer += character
			if tag_buffer == "<think>":
				in_think = true
			elif tag_buffer == "</think>":
				in_think = false
			continue
			
		if character == "[":
			while not _stream_char_queue.is_empty() and character != "]":
				character = _stream_char_queue.pop_front()
			continue
			
		if in_think:
			continue
			
		if character.strip_edges() != "" and not character in [".", ",", "!", "?", "-", ";", ":"]:
			_audio_player.pitch_scale = randf_range(min_pitch, max_pitch)
			_audio_player.play()
			
		await get_tree().create_timer(speed).timeout
		
	_is_mutter_loop_running = false



func _strip_bbcode(text: String) -> String:
	var regex := RegEx.new()
	var err := regex.compile("\\[.*?\\]")
	if err == OK:
		return regex.sub(text, "", true)
	return text


func _get_best_voice() -> String:
	var voices := DisplayServer.tts_get_voices_for_language("en")
	if voices.is_empty():
		voices = DisplayServer.tts_get_voices()
	
	if not voices.is_empty():
		for voice in voices:
			if "Samantha" in voice or "Alex" in voice or "Daniel" in voice:
				return voice
		return voices[0]
	return ""


func _speak_mutter(text: String, custom_path: String = "") -> void:
	_speak_active_id += 1
	var current_id := _speak_active_id

	var stream: AudioStream = null

	if custom_path != "" and FileAccess.file_exists(custom_path):
		var ext := custom_path.get_extension().to_lower()
		if ext == "wav":
			stream = AudioStreamWAV.load_from_file(custom_path)
		elif ext == "ogg":
			stream = AudioStreamOggVorbis.load_from_file(custom_path)

	if not stream:
		stream = _procedural_sound

	_audio_player.stream = stream

	var min_pitch: float = _settings_mgr.get_setting("tts_mutter_pitch_min", 0.85)
	var max_pitch: float = _settings_mgr.get_setting("tts_mutter_pitch_max", 1.25)
	var speed: float = _settings_mgr.get_setting("tts_mutter_speed", 0.06)

	for i in range(text.length()):
		if _speak_active_id != current_id:
			return

		var character := text[i]
		if character.strip_edges() != "" and not character in [".", ",", "!", "?", "-", ";", ":"]:
			_audio_player.pitch_scale = randf_range(min_pitch, max_pitch)
			_audio_player.play()

		await get_tree().create_timer(speed).timeout


## Generates a cute retro-synth blip tone (880Hz sine wave with exponential decay)
func _generate_procedural_chatter_sound() -> AudioStreamWAV:
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = 16000
	stream.stereo = false

	var duration := 0.05 # 50 milliseconds
	var total_samples := int(16000 * duration)
	var bytes := PackedByteArray()
	bytes.resize(total_samples * 2) # 16-bit needs 2 bytes per sample

	var freq := 880.0
	for i in range(total_samples):
		var time := float(i) / 16000.0
		var value := sin(2.0 * PI * freq * time)
		var envelope := exp(-15.0 * time) # Decay curve
		var sample := int(value * envelope * 24000.0)

		bytes.encode_s16(i * 2, sample)

	stream.data = bytes
	return stream


func _execute_piper_task(bin_path: String, args: PackedStringArray, output: Array) -> int:
	return OS.execute(bin_path, args, output, true, true)



func _clean_text_for_tts(text: String) -> String:
	var cleaned := text
	# Remove formatting characters that TTS reads aloud
	cleaned = cleaned.replace("*", "")
	cleaned = cleaned.replace("_", "")
	cleaned = cleaned.replace("~", "")
	cleaned = cleaned.replace("`", "")
	cleaned = cleaned.replace("#", "")
	cleaned = cleaned.replace(">", "")

	# Remove emojis and miscellaneous symbols/pictographs
	var emoji_regex := RegEx.new()
	emoji_regex.compile("[\\x{1F600}-\\x{1F64F}\\x{1F300}-\\x{1F5FF}\\x{1F680}-\\x{1F6FF}\\x{1F900}-\\x{1F9FF}\\x{1FA70}-\\x{1FAFF}\\x{2600}-\\x{26FF}\\x{2700}-\\x{27BF}]")
	if emoji_regex.is_valid():
		cleaned = emoji_regex.sub(cleaned, "", true)

	return cleaned
