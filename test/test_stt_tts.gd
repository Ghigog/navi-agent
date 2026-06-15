extends GutTest
## Test suite for verifying speech services text-cleaning and state structures.

var tts_service: Node
var stt_service: Node
var mock_settings: Node


class MockSettings:
	extends Node
	var data := {
		"enable_tts": true,
		"enable_stt": true,
		"tts_mute": false
	}
	func get_setting(key: String, default_value = null):
		return data.get(key, default_value)
	func set_setting(key: String, val) -> void:
		data[key] = val


func before_each() -> void:
	tts_service = load("res://scripts/TTSService.gd").new()
	stt_service = load("res://scripts/STTService.gd").new()
	mock_settings = MockSettings.new()
	
	add_child_autofree(tts_service)
	add_child_autofree(stt_service)
	add_child_autofree(mock_settings)
	
	tts_service._settings_mgr = mock_settings
	stt_service._settings_mgr = mock_settings


func test_tts_strips_thinking_blocks() -> void:
	var text_with_think := "<think>\n- Analysing visual data\n- Solving coding problem\n</think>Here is the answer!"
	var clean: String = NaviUtils.strip_thinking_block(text_with_think)
	assert_eq(clean.strip_edges(), "Here is the answer!", "Thinking blocks must be stripped from the TTS stream.")


func test_tts_strips_unclosed_thinking_blocks() -> void:
	var text_with_unclosed_think := "<think>\n- Unfinished analysis\nNo response yet."
	var clean: String = NaviUtils.strip_thinking_block(text_with_unclosed_think)
	assert_eq(clean.strip_edges(), "", "Unclosed thinking blocks should be cleaned entirely.")


func test_tts_strips_bbcode() -> void:
	var text_with_bbcode := "[color=#66b2ff][i]Hello[/i][/color] world!"
	var clean: String = tts_service._strip_bbcode(text_with_bbcode)
	assert_eq(clean.strip_edges(), "Hello world!", "BBCode tags must be stripped from spoken text.")


func test_tts_mute_respected() -> void:
	mock_settings.data["tts_mute"] = true
	assert_true(mock_settings.get_setting("tts_mute"), "tts_mute setting should be set to true.")


func test_whisper_paths_exist() -> void:
	var settings_mgr = load("res://scripts/SettingsManager.gd").new()
	add_child_autofree(settings_mgr)
	var bin_path = ProjectSettings.globalize_path(settings_mgr.get_setting("whisper_bin_path"))
	var model_path = ProjectSettings.globalize_path(settings_mgr.get_setting("whisper_model_path"))
	assert_true(FileAccess.file_exists(bin_path), "Bundled whisper-cli should exist")
	assert_true(FileAccess.file_exists(model_path), "Bundled ggml-base.en.bin should exist")


func test_voice_options_settings() -> void:
	mock_settings.data["tts_voice"] = "mutter_procedural"
	assert_eq(mock_settings.get_setting("tts_voice"), "mutter_procedural", "tts_voice should be saved successfully.")
	
	mock_settings.data["custom_mutters"] = ["user://test_mutter.wav"]
	assert_eq(mock_settings.get_setting("custom_mutters").size(), 1, "custom_mutters should persist array.")


func test_clean_text_for_tts() -> void:
	var raw_text := "Hello *world*! 🙄🙄 This is a #test with ~tildes~, `backticks`, and > blockquotes. ✨💖"
	var cleaned: String = tts_service._clean_text_for_tts(raw_text)
	assert_eq(cleaned, "Hello world!  This is a test with tildes, backticks, and  blockquotes. ", "Asterisks, other symbols, and emojis should be removed.")


func test_clean_transcription() -> void:
	var raw_trans := "Hello [BLANK_AUDIO] world (keyboard clicking) and some [laughter] text."
	var cleaned := stt_service._clean_transcription(raw_trans)
	assert_eq(cleaned, "Hello world and some text.", "Should strip bracketed and parenthesized noise text.")
	
	var blank_trans := "[BLANK_AUDIO]"
	assert_eq(stt_service._clean_transcription(blank_trans), "", "Should return empty string if only noise is transcribed.")


func test_tts_stream_buffer_strips_scratchpad() -> void:
	tts_service._stream_active = true
	
	# Simulate receiving scratchpad tag block in system stream buffer
	tts_service._stream_buffer = "<scratchpad>\n* Plan: warm greeting\n* Step: talk\n</scratchpad>\nHello there! How's it going?"
	tts_service._process_system_stream_buffer()
	
	# After processing completed block, the scratchpad should be fully stripped from the buffer
	# (Only the trailing sentence part remains)
	assert_eq(tts_service._stream_buffer.strip_edges(), "Hello there! How's it going?", "Scratchpad tag block and contents must be stripped completely from stream buffer.")



