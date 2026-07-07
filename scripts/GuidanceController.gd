class_name GuidanceController
extends Node
## Stateful controller class managing step-by-step guidance sequences,
## auto-advancement delays, fairy positioning signals, and voice readback.

signal guidance_started
signal step_started(text: String, point: Variant, current_idx: int, total_steps: int)
signal guidance_finished(restore_follow: bool)

var steps: Array[Dictionary] = []
var current_step_idx: int = 0
var is_active: bool = false
var stream_is_running: bool = false

var current_active_text: String = ""

var _unprocessed_stream_idx: int = 0
var _current_point: Variant = null
var _step_execution_token: int = 0
var _style_detected: bool = false
var _is_style_a: bool = false


## Parses and appends new steps from the LLM chunk stream.
func parse_and_append_new_steps(current_response_text: String) -> void:
	var think_regex := RegEx.new()
	think_regex.compile("(?s)<think>.*?</think>")
	var clean_text := think_regex.sub(current_response_text, "", true)
	clean_text = NaviUtils.strip_scratchpad_block(clean_text)

	var regex := RegEx.new()
	regex.compile("\\[PAUSE\\]|\\[SKILL:\\s*point_to:\\s*(.*?)\\]")
	
	var matches := regex.search_all(clean_text, _unprocessed_stream_idx)
	for m in matches:
		var start: int = m.get_start()
		var segment := clean_text.substr(_unprocessed_stream_idx, start - _unprocessed_stream_idx).strip_edges()
		
		# Detect style on first match
		if not _style_detected:
			_style_detected = true
			# If the first segment is long (more than 35 characters), it likely contains the description of the first point.
			# So it is Style A (tag after description). Otherwise, it's Style B (tag before description).
			_is_style_a = segment.length() > 35
			
		var matched_str := m.get_string(0)
		var next_point: Variant = null
		if matched_str.begins_with("[SKILL:"):
			var args := m.get_string(1).strip_edges()
			var coords := args.split(",")
			if coords.size() >= 2:
				var norm_coord := Vector2(float(coords[0].strip_edges()), float(coords[1].strip_edges()))
				next_point = NaviUtils.map_normalized_coordinate_to_screen(norm_coord)
				
		if _is_style_a:
			# Style A: segment gets the point of the tag that *follows* it (next_point)
			if segment != "" or next_point != null:
				steps.append({
					"text": segment,
					"point": next_point
				})
		else:
			# Style B: segment gets the point of the tag that *precedes* it (_current_point)
			if segment != "" or _current_point != null:
				steps.append({
					"text": segment,
					"point": _current_point
				})
			_current_point = next_point
			
		_unprocessed_stream_idx = m.get_end()
		
	# Update active text for streaming UI updates
	current_active_text = clean_text.substr(_unprocessed_stream_idx).strip_edges()
	
	if not is_active and not steps.is_empty():
		_start_playback()


## Called on stream completion to flush any remaining text as the final step.
func finish_stream(final_reply: String) -> void:
	stream_is_running = false
	var think_regex := RegEx.new()
	think_regex.compile("(?s)<think>.*?</think>")
	var clean_reply := think_regex.sub(final_reply, "", true)
	clean_reply = NaviUtils.strip_scratchpad_block(clean_reply)
	
	var remainder := clean_reply.substr(_unprocessed_stream_idx).strip_edges()
	
	# If we are Style A, remainder is the text *after* the last tag.
	# Since there's no tag after this remainder, its point is null.
	if _is_style_a:
		if remainder != "":
			steps.append({
				"text": remainder,
				"point": null
			})
	else:
		# If we are Style B, remainder gets the last parsed point
		if remainder != "" or _current_point != null:
			steps.append({
				"text": remainder,
				"point": _current_point
			})
			
	# Update active text to empty since streaming is done
	current_active_text = ""
	
	if not is_active:
		if not steps.is_empty():
			_start_playback()
		else:
			is_active = false
			guidance_finished.emit(true)


func reset() -> void:
	is_active = false
	stream_is_running = true
	steps.clear()
	current_step_idx = 0
	_unprocessed_stream_idx = 0
	_current_point = null
	_style_detected = false
	_is_style_a = false
	current_active_text = ""


func get_display_active_text() -> String:
	var text := NaviUtils.strip_skill_and_pause_tags(current_active_text)
	var open_bracket := text.rfind("[")
	if open_bracket != -1:
		text = text.substr(0, open_bracket)
	return text.strip_edges()


func _start_playback() -> void:
	is_active = true
	current_step_idx = 0
	guidance_started.emit()
	_execute_step()


func _execute_step() -> void:
	_step_execution_token += 1
	var token := _step_execution_token
	
	if steps.is_empty() or current_step_idx >= steps.size():
		is_active = false
		guidance_finished.emit(true)
		return
		
	var step = steps[current_step_idx]
	var text: String = NaviUtils.strip_skill_and_pause_tags(step["text"])
	var point: Variant = step["point"]
	
	step_started.emit(text, point, current_step_idx, steps.size())
	
	var main_node = get_parent().get_parent() if get_parent() else null
	var fairy = main_node.get_node_or_null("FairyVisuals") if main_node else null
	var follow_ctrl = main_node.get_node_or_null("FollowController") if main_node else null
	
	if point != null:
		var settings_mgr = get_node_or_null("/root/SettingsManager")
		if settings_mgr and settings_mgr.get_setting("require_skill_confirmation", true):
			var ai_service = get_node_or_null("/root/AIService")
			if ai_service and ai_service.has_method("confirm_skill"):
				var desc = "Navi wants to point to (%d, %d)" % [int(point.x), int(point.y)]
				var approved = await ai_service.call("confirm_skill", "point_to", desc)
				if not approved:
					abort_guidance(true)
					return
		print("GuidanceController: [MOVEMENT] Moving to step coordinate: ", point)
		if fairy and fairy.has_method("set_status_light"):
			fairy.set_status_light(Color(0.2, 0.8, 0.2, 1.0), true)
		if follow_ctrl:
			follow_ctrl.call("fly_to_screen_coordinate", point)
	else:
		print("GuidanceController: [MOVEMENT] Step has no coordinate; maintaining position.")
		if fairy and fairy.has_method("clear_status_light"):
			fairy.clear_status_light()
		if follow_ctrl:
			follow_ctrl.call("abort_navigation", false)
			
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").speak(text)
		
	var has_more_steps = current_step_idx < steps.size() - 1
	if has_more_steps or stream_is_running:
		_auto_advance_after_delay(token)
	else:
		is_active = false
		guidance_finished.emit(true)
		if point == null:
			if follow_ctrl:
				follow_ctrl.call("abort_navigation", true)
			if fairy and fairy.has_method("clear_status_light"):
				fairy.clear_status_light()


func _auto_advance_after_delay(token: int) -> void:
	await _wait_for_step_completion(token)
	if not is_active or _step_execution_token != token:
		return
		
	while current_step_idx >= steps.size() - 1 and stream_is_running:
		await get_tree().create_timer(0.1).timeout
		if not is_active or _step_execution_token != token:
			return
			
	if current_step_idx < steps.size() - 1:
		current_step_idx += 1
		_execute_step()
	else:
		is_active = false
		guidance_finished.emit(false)


func _wait_for_step_completion(token: int) -> void:
	await get_tree().process_frame
	if _step_execution_token != token:
		return
		
	var tts = get_node_or_null("/root/TTSService")
	if tts and tts.has_method("is_speaking"):
		await get_tree().create_timer(0.2).timeout
		while tts.is_speaking():
			await get_tree().create_timer(0.1).timeout
			if not is_active or _step_execution_token != token:
				return
				
	await get_tree().create_timer(1.0).timeout


func advance_step() -> void:
	if not is_active:
		return
	if current_step_idx < steps.size() - 1:
		current_step_idx += 1
		_execute_step()
	elif not stream_is_running:
		abort_guidance(true)


func abort_guidance(restore_follow: bool = false) -> void:
	if not is_active:
		return
	is_active = false
	_step_execution_token += 1
	steps.clear()
	
	var main_node = get_parent().get_parent() if get_parent() else null
	var fairy = main_node.get_node_or_null("FairyVisuals") if main_node else null
	var follow_ctrl = main_node.get_node_or_null("FollowController") if main_node else null
	
	if fairy and fairy.has_method("clear_status_light"):
		fairy.clear_status_light()
	if follow_ctrl:
		follow_ctrl.call("abort_navigation", restore_follow)
		
	guidance_finished.emit(restore_follow)


## Helper parsing logic to split a text stream into discrete pause/point_to segments.
static func parse_interactive_steps(text: String) -> Array[Dictionary]:
	var raw_steps: Array[Dictionary] = []
	text = NaviUtils.strip_scratchpad_block(NaviUtils.strip_thinking_block(text))
	
	var regex := RegEx.new()
	regex.compile("\\[PAUSE\\]|\\[SKILL:\\s*point_to:\\s*(.*?)\\]")
	
	var matches := regex.search_all(text)
	if matches.is_empty():
		return [{"text": text, "point": null}]
		
	# Heuristic style detection:
	var first_match_start := matches[0].get_start()
	var first_segment := text.substr(0, first_match_start).strip_edges()
	var is_style_a := first_segment.length() > 35
	
	var last_idx := 0
	var parsed_segments: Array[String] = []
	var parsed_points: Array[Variant] = []
	
	for m in matches:
		var start: int = m.get_start()
		var segment := text.substr(last_idx, start - last_idx).strip_edges()
		parsed_segments.append(segment)
		
		var matched_str := m.get_string(0)
		var point: Variant = null
		if matched_str.begins_with("[SKILL:"):
			var args := m.get_string(1).strip_edges()
			var coords := args.split(",")
			if coords.size() >= 2:
				var norm_coord := Vector2(float(coords[0].strip_edges()), float(coords[1].strip_edges()))
				point = NaviUtils.map_normalized_coordinate_to_screen(norm_coord)
		parsed_points.append(point)
		last_idx = m.get_end()
		
	var final_segment := text.substr(last_idx).strip_edges()
	parsed_segments.append(final_segment)
	
	if is_style_a:
		# Style A: Each segment gets the tag that follows it
		for i in parsed_segments.size():
			var seg := parsed_segments[i]
			var pt: Variant = null
			if i < parsed_points.size():
				pt = parsed_points[i]
			if seg != "" or pt != null:
				raw_steps.append({"text": seg, "point": pt})
	else:
		# Style B: Each segment gets the tag that precedes it
		var current_point: Variant = null
		for i in parsed_segments.size():
			var seg := parsed_segments[i]
			var pt = current_point
			if seg != "" or pt != null:
				raw_steps.append({"text": seg, "point": pt})
			if i < parsed_points.size():
				current_point = parsed_points[i]
				
	# Apply final merge logic for null point steps (e.g. trailing comments or uncoordinated blocks)
	var combined_steps: Array[Dictionary] = []
	for step in raw_steps:
		if combined_steps.is_empty():
			combined_steps.append(step)
		else:
			var last_step: Dictionary = combined_steps[-1]
			if step["point"] == null:
				if last_step["text"] != "":
					last_step["text"] += "\n\n" + step["text"]
				else:
					last_step["text"] = step["text"]
			else:
				combined_steps.append(step)
				
	return combined_steps
