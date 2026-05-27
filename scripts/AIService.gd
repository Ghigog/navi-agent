extends Node
## Service orchestrator that handles local (Ollama) and cloud (Gemini) LLM request payload generation and delivery.
## Supports sending text prompts alongside screen capture contexts and localized visual focus crop regions.

# Signals emitted during the request lifecycle
## Emitted when an API request is initiated.
signal request_started
## Emitted when a text response is successfully received from the LLM.
signal response_received(response_text: String)
## Emitted if the API request fails due to network, configuration, or payload errors.
signal request_failed(error_message: String)
## Emitted when the thinking model outputs intermediate reasoning/status updates.
signal thinking_update(update_text: String)

# Internal nodes and helper references
@onready var _http_request: HTTPRequest = $HTTPRequest
var _settings_mgr: Node
# Internal cache to avoid constant Dictionary lookups
var _config_cache := {
	"fast_system_prompt": "",
	"system_prompt" : "",
	"personality": "",
	"llm_provider": "local",
	"model": ""
	}

func _ready() -> void:
	# Instantiates the HTTPRequest node dynamically to isolate requests
	_http_request.connect("request_completed", _on_request_completed)
	
	# Fetch reference to SettingsManager Autoload if present in the scene tree
	if has_node("/root/SettingsManager"):
		_settings_mgr = get_node("/root/SettingsManager")
		_settings_mgr.settings_updated.connect(_on_settings_updated)
	_on_settings_updated()

func _on_settings_updated() -> void:
	var provider = _settings_mgr.get_setting("llm_provider", "local")
# Extract both pairs from SettingsManager
	var fast_model = _settings_mgr.get_setting("local_model" if provider == "local" else "cloud_model")
	var heavy_model = _settings_mgr.get_setting("local_thinking_model" if provider == "local" else "cloud_thinking_model")
	# Build the dictionary from the manager and update the cache
	update_config({
		"fast_system_prompt": _settings_mgr.get_setting("fast_system_prompt"),
		"system_prompt": _settings_mgr.get_setting("system_prompt"),
		"personality": _settings_mgr.get_setting("personality"),
		"llm_provider": provider,
		"fast_model": fast_model,
		"heavy_model": heavy_model
	})

func update_config(new_config: Dictionary) -> void:
	_config_cache.merge(new_config, true)
	print("AIService: Configuration updated.")

## Formulates and dispatches a multimodal request to the configured LLM provider.
## Utilizes a fast model by default to handle conversational response routing and skills execution.
func send_prompt(prompt: String, screen_img: Image = null, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO) -> void:
	if not _settings_mgr:
		request_failed.emit("SettingsManager Autoload is missing.")
		return
		
	request_started.emit()
	
	# Use the cached values instead of querying SettingsManager directly
	var fast_prompt : String = _config_cache.get("fast_system_prompt", "")
	var personality : String = _config_cache.get("personality", "")
	var system_prompt: String = _config_cache.get("system_prompt", "")
	
	var final_fast_system_prompt := fast_prompt
	if personality != "":
		final_fast_system_prompt += "\nRespond with a " + personality + " personality."
		
	# Phase 1: Send the user prompt to the Fast Model (without screenshots)
	var fast_reply: String = await _request_llm(prompt, final_fast_system_prompt, false)
	if fast_reply == "":
		request_failed.emit("Fast model request failed.")
		return
		
	# Check for skill calls
	var has_screenshot := fast_reply.contains("[SKILL: take_screenshot]")
	var has_crop := fast_reply.contains("[SKILL: take_crop_screenshot]")
	var has_thinking := fast_reply.contains("[SKILL: heavy_thinking]")
	
	# Strip skill tags for immediate conversational display
	var clean_fast_reply := fast_reply
	clean_fast_reply = clean_fast_reply.replace("[SKILL: take_screenshot]", "")
	clean_fast_reply = clean_fast_reply.replace("[SKILL: take_crop_screenshot]", "")
	clean_fast_reply = clean_fast_reply.replace("[SKILL: heavy_thinking]", "")
	clean_fast_reply = clean_fast_reply.strip_edges()
	
	if clean_fast_reply != "":
		response_received.emit(clean_fast_reply)
		
	# If screenshot or crop requested, capture it dynamically
	var active_screenshot: Image = null
	var base64_image := ""
	var base64_crop := ""
	
	if has_screenshot or has_crop:
		# Locate the WindowController root node to trigger clean screenshot capture
		var window_controller: Node = null
		for child in get_tree().root.get_children():
			if child.name == "Main" or child.has_method("capture_clean_screenshot"):
				window_controller = child
				break
				
		if window_controller and window_controller.has_method("capture_clean_screenshot"):
			active_screenshot = await window_controller.call("capture_clean_screenshot")
			
		if active_screenshot and active_screenshot.get_width() > 0:
			var buffer := active_screenshot.save_jpg_to_buffer()
			base64_image = Marshalls.raw_to_base64(buffer)
			
			# If crop was requested specifically, crop around the fairy
			if has_crop and window_controller:
				var f_pos: Vector2 = window_controller._fairy.position if "_fairy" in window_controller else Vector2.ZERO
				var w_size: Vector2 = Vector2(window_controller.get_window().size)
				
				if f_pos != Vector2.ZERO and w_size != Vector2.ZERO:
					var rel_x := f_pos.x / w_size.x
					var rel_y := f_pos.y / w_size.y
					var px_x := int(rel_x * active_screenshot.get_width())
					var px_y := int(rel_y * active_screenshot.get_height())
					var crop_size := 600
					var crop_x: int = clamp(px_x - crop_size / 2, 0, active_screenshot.get_width() - crop_size)
					var crop_y: int = clamp(px_y - crop_size / 2, 0, active_screenshot.get_height() - crop_size)
					var rect_w: int = min(crop_size, active_screenshot.get_width())
					var rect_h: int = min(crop_size, active_screenshot.get_height())
					var crop_rect := Rect2i(crop_x, crop_y, rect_w, rect_h)
					var cropped_img := active_screenshot.get_region(crop_rect)
					var crop_buffer := cropped_img.save_jpg_to_buffer()
					base64_crop = Marshalls.raw_to_base64(crop_buffer)
					
		# Feed screenshot context back to fast model to re-evaluate difficulty
		var context_prompt: String = "Here is the screenshot you requested.\nUser prompt: " + prompt
		if base64_crop != "":
			context_prompt += "\n[Visual Focus Helper crop is attached.]"
			
		var fast_reply_2: String = await _request_llm(context_prompt, final_fast_system_prompt, false, base64_image, base64_crop)
		if fast_reply_2 == "":
			request_failed.emit("Fast model re-evaluation failed.")
			return
			
		has_thinking = fast_reply_2.contains("[SKILL: heavy_thinking]")
		var clean_fast_reply_2 := fast_reply_2
		clean_fast_reply_2 = clean_fast_reply_2.replace("[SKILL: heavy_thinking]", "")
		clean_fast_reply_2 = clean_fast_reply_2.strip_edges()
		
		if not has_thinking:
			if clean_fast_reply_2 != "":
				response_received.emit(clean_fast_reply_2)
			return
		else:
			if clean_fast_reply_2 != "":
				response_received.emit(clean_fast_reply_2)
				
	# If we need heavy thinking:
	if has_thinking:
		# Add instructions to output internal plan
		var thinking_system_prompt := system_prompt
		if personality != "":
			thinking_system_prompt += "\nRespond with a " + personality + " personality."
		thinking_system_prompt += "\nIMPORTANT: You are the thinking model. First, describe your plan/reasoning in bullet points inside a <think>...</think> block (e.g. '<think>\n- Finding the issue\n- Verifying the file\n</think>'). Then, output your final conversational response."
		
		# Call heavy model
		var heavy_reply: String = await _request_llm(prompt, thinking_system_prompt, true, base64_image, base64_crop)
		if heavy_reply == "":
			request_failed.emit("Thinking model request failed.")
			return
			
		# Parse <think>...</think> blocks
		var final_answer := heavy_reply
		var thoughts: Array = []
		
		if heavy_reply.contains("<think>") and heavy_reply.contains("</think>"):
			var start_idx: int = heavy_reply.find("<think>")
			var end_idx: int = heavy_reply.find("</think>")
			var think_content: String = heavy_reply.substr(start_idx + 7, end_idx - start_idx - 7).strip_edges()
			final_answer = heavy_reply.substr(end_idx + 8).strip_edges()
			
			for line: String in think_content.split("\n"):
				var clean_line: String = line.strip_edges()
				if clean_line.begins_with("-"):
					clean_line = clean_line.substr(1).strip_edges()
				if clean_line != "":
					thoughts.append(clean_line)
					
		# If we have thoughts, translate and display them with delays
		if thoughts.size() > 0:
			for thought: String in thoughts:
				var rephrase_prompt: String = "The thinking model is thinking: '" + thought + "'. Briefly rephrase this as a short, natural status update from Navi the fairy (e.g. 'I'm checking line 12, one sec...'). Follow personality: " + personality
				var update_text: String = await _request_llm(rephrase_prompt, "Respond with a single short line update.", false)
				if update_text == "":
					update_text = "Checking: " + thought + "..."
				else:
					update_text = update_text.strip_edges().replace("\"", "")
					
				thinking_update.emit(update_text)
				# Small non-blocking delay to simulate thinking time
				await get_tree().create_timer(1.2).timeout
				
		response_received.emit(final_answer)


# Helper function to dynamically spawn HTTP requests asynchronously
func _request_llm(prompt: String, system_prompt: String, is_thinking_model: bool = false, base64_image: String = "", base64_crop: String = "") -> String:
	if not _settings_mgr:
		return ""
		
	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	var http := _http_request
	
	var endpoint := ""
	var headers := ["Content-Type: application/json"]
	var payload := {}
	
	if provider == "local":
		var url: String = _settings_mgr.get_setting("local_url", "http://localhost:11434")
		var model_key = "heavy_model" if is_thinking_model else "fast_model"
		var model: String = _config_cache.get(model_key, "gemma4:e4b")

		endpoint = url + "/v1/chat/completions"
		
		var messages := []
		if system_prompt != "":
			messages.append({
				"role": "system",
				"content": system_prompt
			})
			
		var user_content := []
		user_content.append({
			"type": "text",
			"text": prompt
		})
		
		if base64_image != "":
			user_content.append({
				"type": "image_url",
				"image_url": {
					"url": "data:image/jpeg;base64," + base64_image
				}
			})
			
		if base64_crop != "":
			user_content.append({
				"type": "image_url",
				"image_url": {
					"url": "data:image/jpeg;base64," + base64_crop
				}
			})
			
		messages.append({
			"role": "user",
			"content": user_content
		})
		
		payload = {
			"model": model,
			"messages": messages,
			"temperature": 0.7
		}
	else:
		var url: String = _settings_mgr.get_setting("cloud_url", "")
		var api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
		var model: String = _settings_mgr.get_setting(
			"cloud_thinking_model" if is_thinking_model else "cloud_model",
			"gemini-2.5-pro" if is_thinking_model else "gemini-2.5-flash"
		)
		
		endpoint = url
		if endpoint.contains("/models/"):
			var url_parts: PackedStringArray = endpoint.split("/models/")
			var model_action: PackedStringArray = url_parts[1].split(":")
			var action: String = model_action[1] if model_action.size() > 1 else "generateContent"
			endpoint = url_parts[0] + "/models/" + model + ":" + action
			
		if not endpoint.contains("?"):
			endpoint += "?key=" + api_key
		else:
			endpoint += "&key=" + api_key
			
		var cloud_parts: Array = []
		if system_prompt != "":
			cloud_parts.append({
				"text": "SYSTEM INSTRUCTIONS:\n" + system_prompt + "\n\nUSER PROMPT:\n" + prompt
			})
		else:
			cloud_parts.append({
				"text": prompt
			})
			
		if base64_image != "":
			cloud_parts.append({
				"inlineData": {
					"mimeType": "image/jpeg",
					"data": base64_image
				}
			})
			
		if base64_crop != "":
			cloud_parts.append({
				"inlineData": {
					"mimeType": "image/jpeg",
					"data": base64_crop
				}
			})
			
		payload = {
			"contents": [
				{
					"parts": cloud_parts
				}
			]
		}
		
	var json_string := JSON.stringify(payload)
	var err: Error = http.request(endpoint, headers, HTTPClient.METHOD_POST, json_string)
	if err != OK:
		return ""
		
	var completed_args: Array = await http.request_completed
	
	var result: int = completed_args[0]
	var response_code: int = completed_args[1]
	var body: PackedByteArray = completed_args[3]
	
	if result != HTTPRequest.RESULT_SUCCESS or response_code < 200 or response_code >= 300:
		return ""
		
	var response_string := body.get_string_from_utf8()
	var json := JSON.new()
	var parse_err := json.parse(response_string)
	if parse_err != OK:
		return ""
		
	var response_data: Variant = json.get_data()
	if not response_data is Dictionary:
		return ""
		
	var reply_text := ""
	if provider == "local":
		if response_data.has("choices") and response_data["choices"].size() > 0:
			var choice: Dictionary = response_data["choices"][0]
			if choice.has("message") and choice["message"].has("content"):
				reply_text = choice["message"]["content"]
		if reply_text == "":
			if response_data.has("response"):
				reply_text = response_data["response"]
	else:
		if response_data.has("candidates") and response_data["candidates"].size() > 0:
			var candidate: Dictionary = response_data["candidates"][0]
			if candidate.has("content") and candidate["content"].has("parts") and candidate["content"]["parts"].size() > 0:
				if candidate["content"]["parts"][0].has("text"):
					reply_text = candidate["content"]["parts"][0]["text"]
					
	return reply_text


# Deprecated callback preserved for backwards compatibility with tests that look for it.
func _on_request_completed(_result: int, _response_code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	pass
