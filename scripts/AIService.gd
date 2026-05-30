extends Node
## Service orchestrator that handles local (Ollama) and cloud (Gemini) LLM request payload generation and delivery.
## Supports dynamic streaming agent conversation, modular plug-and-play skills routing, and real-time reasoning.

# Signals emitted during the request lifecycle
## Emitted when an API request is initiated.
signal request_started
## Emitted when a text response is successfully received from the LLM.
signal response_received(response_text: String)
## Emitted if the API request fails due to network, configuration, or payload errors.
signal request_failed(error_message: String)
## Emitted when the thinking model outputs intermediate reasoning/status updates.
signal thinking_update(update_text: String)
## Emitted when a streaming chunk of the response is received.
signal response_chunk(chunk_text: String)

# Internal helper references
var _settings_mgr: Node
# Internal cache to avoid constant Dictionary lookups
var _config_cache := {
	"system_prompt" : "",
	"personality": "",
	"llm_provider": "local",
	"fast_model": "",
	"heavy_model": ""
}

# The plug-and-play skills registry mapping skill tags to Callable execution handlers.
var _skills_registry: Dictionary = {}


func _ready() -> void:
	# Initialize the plug-and-play skills registry
	_initialize_skills_registry()
	
	# Fetch reference to SettingsManager Autoload if present in the scene tree
	if has_node("/root/SettingsManager"):
		_settings_mgr = get_node("/root/SettingsManager")
		_settings_mgr.settings_updated.connect(_on_settings_updated)
	if _settings_mgr:
		_on_settings_updated()


## Registers all available skills. To add a new skill to Navi, simply write
## a callback method and add its mapping to this dictionary!
func _initialize_skills_registry() -> void:
	_skills_registry = {
		"take_screenshot": _execute_take_screenshot,
		"take_crop_screenshot": _execute_take_crop_screenshot,
		"heavy_thinking": _execute_heavy_thinking
	}


func _on_settings_updated() -> void:
	if not _settings_mgr:
		return
	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	var fast_model: String = _settings_mgr.get_setting("local_model" if provider == "local" else "cloud_model", "")
	var heavy_model: String = _settings_mgr.get_setting("local_thinking_model" if provider == "local" else "cloud_thinking_model", "")
	
	update_config({
		"system_prompt": _settings_mgr.get_setting("system_prompt", ""),
		"personality": _settings_mgr.get_setting("personality", ""),
		"llm_provider": provider,
		"fast_model": fast_model,
		"heavy_model": heavy_model
	})


func update_config(new_config: Dictionary) -> void:
	_config_cache.merge(new_config, true)
	print("AIService: Configuration updated.")


## Formulates and dispatches a request using a direct conversation routing.
## Navi streams responses in real-time, executing background skills on-demand.
func send_prompt(prompt: String, screen_img: Image = null, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO) -> void:
	if not _settings_mgr:
		request_failed.emit("SettingsManager Autoload is missing.")
		return
		
	var system_prompt_user: String = _config_cache.get("system_prompt", "")
	var personality: String = _config_cache.get("personality", "")
	var provider: String = _config_cache.get("llm_provider", "local")
	
	var fast_model: String = _config_cache.get("fast_model", "")
	var heavy_model: String = _config_cache.get("heavy_model", "")
	var enable_thinking: bool = _settings_mgr.get_setting("enable_thinking", true)
	
	if fast_model == "" or (enable_thinking and heavy_model == ""):
		print("AIService ERROR: Configuration validation failed. One or more configured models is missing.")
		request_failed.emit("model missing, please right click to update me!")
		return
		
	request_started.emit()
	
	var identity := "You are Navi, the desktop assistant."
	if personality != "":
		identity = "You are Navi, a " + personality + " desktop assistant."
		
	# --- PHASE 1: Direct Conversation & Skill Detection ---
	var fast_system_prompt := identity + "\n" + system_prompt_user + "\n\n" + """
### INSTRUCTIONS:
Speak conversationally, snappy, and naturally.
If you need to use a tool to answer the user's question, output the tool tag at the very end of your response.

AVAILABLE TOOLS:
- [SKILL: take_screenshot]: Use if the user asks about what is on their screen, visual elements, errors, emojis, or what is above/below/near you.
- [SKILL: take_crop_screenshot]: Use if the user points to a specific detail right next to you.
- [SKILL: heavy_thinking]: Use if the query requires programming, coding, math, logic, or deep reasoning.

PLANNING RULES:
- ONLY output a tool tag if you absolutely need it.
- If you can answer immediately, do NOT output any tool tags.
- Example: "Let me check your screen! [SKILL: take_screenshot]"
"""

	print("AIService: [STAGE 1] Initiating prompt request. Provider: ", provider, ", Fast Model: ", fast_model, ", Prompt length: ", prompt.length())
	# Stream direct fast model response
	var fast_reply := await _request_llm_stream(prompt, fast_system_prompt, false, "", "", 0.7)
	
	if fast_reply == "":
		print("AIService ERROR: [STAGE 1] Fast model failed to respond.")
		request_failed.emit("Model failed to respond.")
		return
		
	print("AIService: [STAGE 1] Fast model stream completed. Checking for skill tags...")
	# Check for skill tags in raw fast model reply
	var skill_tag := _extract_skill_tag(fast_reply)
	if skill_tag == "":
		print("AIService: [STAGE 1] No skills requested. Direct response completed successfully.")
		# No skills needed. We are fully done!
		response_received.emit("") # Emit empty string to finalise input focus and editable state
		return
		
	# --- PHASE 2: Skill Validation & Settings Filtering ---
	print("AIService: [STAGE 2] Skill tag detected: '", skill_tag, "'. Validating skills against settings...")
	var verified_skills: Array[String] = []
	var enable_screenshots: bool = _settings_mgr.get_setting("enable_screenshots", true)
	
	if skill_tag in _skills_registry:
		if (skill_tag == "take_screenshot" or skill_tag == "take_crop_screenshot") and not enable_screenshots:
			print("AIService: [STAGE 2] Skill '" + skill_tag + "' skipped because screenshots are disabled.")
		elif skill_tag == "heavy_thinking" and not enable_thinking:
			print("AIService: [STAGE 2] Skill '" + skill_tag + "' skipped because deep thinking is disabled.")
		else:
			verified_skills.append(skill_tag)
			print("AIService: [STAGE 2] Skill '" + skill_tag + "' successfully verified and enabled.")
			
	# If skill was disabled/filtered, we are fully done
	if verified_skills.size() == 0:
		print("AIService: [STAGE 2] All detected skills were filtered/disabled. Finalizing.")
		response_received.emit("")
		return
		
	# --- PHASE 3: Execution of Skills & Hand-off ---
	print("AIService: [STAGE 3] Executing background skills sequentially...")
	var context := {
		"prompt": prompt,
		"base64_image": "",
		"base64_crop": "",
		"personality": personality,
		"system_prompt": system_prompt_user
	}
	
	var has_heavy_thinking := false
	for skill in verified_skills:
		var callback: Callable = _skills_registry[skill]
		if skill == "heavy_thinking":
			has_heavy_thinking = true
			
		print("AIService: [STAGE 3] Invoking skill callback for '", skill, "'...")
		var outcome: String = await callback.call(context) as String
		print("AIService: [STAGE 3] Skill '", skill, "' execution outcome: ", outcome)
		
	# --- PHASE 4: Final Conversation Delivery ---
	if has_heavy_thinking:
		var thinking_system_prompt := identity + "\n\n" + system_prompt_user + "\n\n" + """
IMPORTANT: First, outline your reasoning in bullet points inside a <think>...</think> block.
Example:
<think>
- Finding the issue on screen
- Fixing the error
</think>
Write your final conversational response directly after the </think> block.
"""
		print("AIService: [STAGE 4] Requesting heavy thinking model response. Model: ", _config_cache.get("heavy_model", ""))
		# Stream final answer from heavy model
		var heavy_reply := await _request_llm_stream(
			prompt,
			thinking_system_prompt,
			true,
			context.get("base64_image", ""),
			context.get("base64_crop", ""),
			0.7
		)
		if heavy_reply == "":
			print("AIService ERROR: [STAGE 4] Heavy thinking model failed to respond.")
			request_failed.emit("Heavy thinking model failed.")
		else:
			print("AIService: [STAGE 4] Heavy thinking model completed successfully.")
			response_received.emit("")
	else:
		# If screenshot was taken but no heavy thinking was requested, stream final answer from fast model
		var analysis_system_prompt := identity + "\n\n" + system_prompt_user
		print("AIService: [STAGE 4] Requesting final analysis model response. Model: ", _config_cache.get("fast_model", ""))
		var final_fast_reply := await _request_llm_stream(
			prompt,
			analysis_system_prompt,
			false,
			context.get("base64_image", ""),
			context.get("base64_crop", ""),
			0.7
		)
		if final_fast_reply == "":
			print("AIService ERROR: [STAGE 4] Analysis model failed to respond.")
			request_failed.emit("Analysis model failed.")
		else:
			print("AIService: [STAGE 4] Analysis model response completed successfully.")
			response_received.emit("")
			
	# Clear status light at the end of execution
	var window_controller := _get_window_controller()
	var fairy: Node = null
	if window_controller and "_fairy" in window_controller:
		fairy = window_controller._fairy
	if fairy and fairy.has_method("clear_status_light"):
		fairy.clear_status_light()


# ---------------------------------------------------------------------------
# Plug-and-Play Skill Handlers
# ---------------------------------------------------------------------------

func _execute_take_screenshot(context: Dictionary) -> String:
	var window_controller := _get_window_controller()
	var fairy: Node = null
	if window_controller and "_fairy" in window_controller:
		fairy = window_controller._fairy
	if fairy and fairy.has_method("set_status_light"):
		fairy.set_status_light(Color(1.0, 0.75, 0.0, 1.0), true) # Pulsing Amber

	thinking_update.emit("Let me capture the screen first to see what is going on...")
	if window_controller:
		var img: Image = await window_controller.capture_clean_screenshot()
		if img:
			# Keep Navi visible in the capture to maintain pointing context!
			img.resize(1024, 1024, Image.INTERPOLATE_BILINEAR)
			context["base64_image"] = Marshalls.raw_to_base64(img.save_jpg_to_buffer())
			return "Success: captured screen image."
	return "Failure: window controller or capture failed."


func _execute_take_crop_screenshot(context: Dictionary) -> String:
	var window_controller := _get_window_controller()
	var fairy: Node = null
	if window_controller and "_fairy" in window_controller:
		fairy = window_controller._fairy
	if fairy and fairy.has_method("set_status_light"):
		fairy.set_status_light(Color(1.0, 0.75, 0.0, 1.0), true) # Pulsing Amber

	thinking_update.emit("Let me capture a close-up cropped visual detail next to me...")
	if window_controller and window_controller.has_method("capture_crop_screenshot"):
		var img: Image = await window_controller.capture_crop_screenshot()
		if img:
			img.resize(512, 512, Image.INTERPOLATE_BILINEAR)
			context["base64_crop"] = Marshalls.raw_to_base64(img.save_jpg_to_buffer())
			return "Success: captured crop image centered around Navi."
	return "Failure: window controller or crop failed."


func _execute_heavy_thinking(context: Dictionary) -> String:
	var window_controller := _get_window_controller()
	var fairy: Node = null
	if window_controller and "_fairy" in window_controller:
		fairy = window_controller._fairy
	if fairy and fairy.has_method("set_status_light"):
		fairy.set_status_light(Color(0.6, 0.2, 1.0, 1.0), true) # Pulsing Purple

	thinking_update.emit("Wait a minute... let me think deeply about this.")
	return "Success: heavy thinking executed."


# ---------------------------------------------------------------------------
# Asynchronous Isolated HTTP Client Requests (Non-Streaming Fallback)
# ---------------------------------------------------------------------------

func _request_llm(prompt: String, system_prompt: String, is_thinking_model: bool = false, base64_image: String = "", base64_crop: String = "", temperature: float = 0.7) -> String:
	if not _settings_mgr:
		return ""
		
	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	
	# Dynamically spawn HTTPRequest to ensure request isolation and headless safety
	var http := HTTPRequest.new()
	add_child(http)
	
	var endpoint := ""
	var headers := ["Content-Type: application/json"]
	var payload := {}
	
	if provider == "local":
		var url: String = _settings_mgr.get_setting("local_url", "http://localhost:11434")
		var model_key := "heavy_model" if is_thinking_model else "fast_model"
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
			"temperature": temperature
		}
	else:
		var url: String = _settings_mgr.get_setting("cloud_url", "")
		var api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
		var model_key := "heavy_model" if is_thinking_model else "fast_model"
		var model: String = _config_cache.get(model_key, "gemini-2.5-flash")
		
		endpoint = url
		if endpoint.contains("/models/"):
			var url_parts := endpoint.split("/models/")
			var model_action := url_parts[1].split(":")
			var action := model_action[1] if model_action.size() > 1 else "generateContent"
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


# ---------------------------------------------------------------------------
# Asynchronous Isolated HTTP Client Requests (Streaming)
# ---------------------------------------------------------------------------

func _request_llm_stream(prompt: String, system_prompt: String, is_thinking_model: bool = false, base64_image: String = "", base64_crop: String = "", temperature: float = 0.7) -> String:
	if not _settings_mgr:
		return ""
		
	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	var url_setting: String = _settings_mgr.get_setting("cloud_url" if provider == "cloud" else "local_url", "")
	var model_key := "heavy_model" if is_thinking_model else "fast_model"
	var model: String = _config_cache.get(model_key, "gemma4:e4b")
	
	var parsed_url := _parse_url(url_setting)
	var host: String = parsed_url["host"]
	var port: int = parsed_url["port"]
	var path: String = parsed_url["path"]
	
	if host.length() < 3:
		return ""
		
	if provider == "local":
		path = "/v1/chat/completions"
		
	var use_ssl := url_setting.begins_with("https://")
	print("AIService: Connecting to host: ", host, " port: ", port, " ssl: ", use_ssl)
	var client := HTTPClient.new()
	var tls_opts: TLSOptions = null
	if use_ssl:
		tls_opts = TLSOptions.client()
	var err := client.connect_to_host(host, port, tls_opts)
	if err != OK:
		print("AIService ERROR: Failed to connect to host: ", err)
		return ""
		
	while client.get_status() == HTTPClient.STATUS_CONNECTING or client.get_status() == HTTPClient.STATUS_RESOLVING:
		await get_tree().process_frame
		
	if client.get_status() != HTTPClient.STATUS_CONNECTED:
		print("AIService ERROR: Client status is not connected: ", client.get_status())
		return ""
		
	var headers := ["Content-Type: application/json"]
	var payload := {}
	
	if provider == "local":
		var messages := []
		if system_prompt != "":
			messages.append({"role": "system", "content": system_prompt})
		var user_content := []
		user_content.append({"type": "text", "text": prompt})
		if base64_image != "":
			user_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64_image}})
		if base64_crop != "":
			user_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64_crop}})
		messages.append({"role": "user", "content": user_content})
		
		payload = {
			"model": model,
			"messages": messages,
			"temperature": temperature,
			"stream": true
		}
	else:
		var api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
		var gemini_url := url_setting
		if gemini_url.contains("/models/"):
			var url_parts := gemini_url.split("/models/")
			gemini_url = url_parts[0] + "/models/" + model + ":streamGenerateContent"
			
		if not gemini_url.contains("?"):
			gemini_url += "?key=" + api_key
		else:
			gemini_url += "&key=" + api_key
			
		var url_parsed = _parse_url(gemini_url)
		host = url_parsed["host"]
		port = url_parsed["port"]
		path = url_parsed["path"]
		
		var cloud_parts: Array = []
		if system_prompt != "":
			cloud_parts.append({"text": "SYSTEM INSTRUCTIONS:\n" + system_prompt + "\n\nUSER PROMPT:\n" + prompt})
		else:
			cloud_parts.append({"text": prompt})
			
		if base64_image != "":
			cloud_parts.append({"inlineData": {"mimeType": "image/jpeg", "data": base64_image}})
		if base64_crop != "":
			cloud_parts.append({"inlineData": {"mimeType": "image/jpeg", "data": base64_crop}})
			
		payload = {
			"contents": [
				{
					"parts": cloud_parts
				}
			]
		}
		
	var json_payload := JSON.stringify(payload)
	print("AIService: Dispatching LLM request. Host: ", host, " Path: ", path)
	var req_err := client.request(HTTPClient.METHOD_POST, path, headers, json_payload)
	if req_err != OK:
		print("AIService ERROR: Request dispatch failed: ", req_err)
		return ""
		
	while client.get_status() == HTTPClient.STATUS_REQUESTING:
		await get_tree().process_frame
		
	if not client.has_response():
		print("AIService ERROR: No response received from client.")
		return ""
		
	var response_code := client.get_response_code()
	print("AIService: HTTP response code received: ", response_code)
	if response_code < 200 or response_code >= 300:
		return ""
		
	var full_text := ""
	var current_line_buffer := ""
	var is_buffering_tag := false
	var tag_buffer := ""
	var is_thinking := false
	var think_buffer := ""
	var personality: String = _config_cache.get("personality", "")
	var is_stream_finished := false
	
	while client.get_status() == HTTPClient.STATUS_BODY:
		if is_stream_finished:
			break
		client.poll()
		var chunk := client.read_response_body_chunk()
		if chunk.size() > 0:
			var text := chunk.get_string_from_utf8()
			
			if provider == "local":
				current_line_buffer += text
				while current_line_buffer.contains("\n"):
					var newline_idx := current_line_buffer.find("\n")
					var line := current_line_buffer.substr(0, newline_idx).strip_edges()
					current_line_buffer = current_line_buffer.substr(newline_idx + 1)
					
					if line.begins_with("data: "):
						var data_str := line.substr(6).strip_edges()
						if data_str == "[DONE]":
							print("AIService: Stream finished ([DONE] tag matched).")
							is_stream_finished = true
							break
						var json_data: Variant = JSON.parse_string(data_str)
						if json_data is Dictionary and json_data.has("choices") and json_data["choices"].size() > 0:
							var choice: Dictionary = json_data["choices"][0]
							if choice.has("delta") and choice["delta"].has("content"):
								var word: String = choice["delta"]["content"]
								full_text += word
								print("AIService: [Ollama Chunk] ", word)
								
								var filtered_word := _filter_stream_chunk(word, is_buffering_tag, tag_buffer, is_thinking, think_buffer, personality)
								is_buffering_tag = filtered_word["is_buffering"]
								tag_buffer = filtered_word["tag_buffer"]
								is_thinking = filtered_word["is_thinking"]
								think_buffer = filtered_word["think_buffer"]
								
								if filtered_word["text"] != "":
									response_chunk.emit(filtered_word["text"])
				if is_stream_finished:
					break
			else:
				# Gemini stream parsing
				var regex := RegEx.new()
				regex.compile("\"text\"\\s*:\\s*\"([^\"]*)\"")
				var matches := regex.search_all(text)
				for m in matches:
					var word: String = m.get_string(1).replace("\\n", "\n").replace("\\\"", "\"")
					full_text += word
					print("AIService: [Gemini Chunk] ", word)
					
					var filtered_word := _filter_stream_chunk(word, is_buffering_tag, tag_buffer, is_thinking, think_buffer, personality)
					is_buffering_tag = filtered_word["is_buffering"]
					tag_buffer = filtered_word["tag_buffer"]
					is_thinking = filtered_word["is_thinking"]
					think_buffer = filtered_word["think_buffer"]
					
					if filtered_word["text"] != "":
						response_chunk.emit(filtered_word["text"])
						
		await get_tree().process_frame
		
	client.close()
	print("AIService: HTTP connection closed. Full text length: ", full_text.length())
	return full_text


func _filter_stream_chunk(word: String, is_buffering: bool, tag_buffer_in: String, is_thinking: bool, think_buffer_in: String, personality: String) -> Dictionary:
	var out_text := ""
	var new_buffering := is_buffering
	var new_buffer_text := tag_buffer_in
	var new_thinking := is_thinking
	var new_think_buffer := think_buffer_in
	
	var i := 0
	while i < word.length():
		var char := word[i]
		
		# 1. Handle <think> block detection
		if not new_thinking and word.substr(i).begins_with("<think>"):
			new_thinking = true
			new_think_buffer = ""
			print("AIService: [THINK BLOCK STARTED]")
			i += 7
			continue
			
		if new_thinking:
			new_think_buffer += char
			if new_think_buffer.ends_with("</think>"):
				new_thinking = false
				var raw_thoughts := new_think_buffer.substr(0, new_think_buffer.length() - 8).strip_edges()
				print("AIService: [THINK BLOCK ENDED] Raw thoughts:\n", raw_thoughts)
				# Rephrase and emit thoughts asynchronously!
				_parse_and_emit_thoughts_deferred(raw_thoughts, personality)
				new_think_buffer = ""
			i += 1
			continue
			
		# 2. Handle skill tag buffering
		if new_buffering:
			new_buffer_text += char
			if char == "]":
				new_buffering = false
				print("AIService: [SKILL TAG INTERCEPTED] Buffer: ", new_buffer_text)
				new_buffer_text = ""
			i += 1
			continue
		else:
			if char == "[":
				new_buffering = true
				new_buffer_text = "["
				i += 1
				continue
			else:
				out_text += char
				i += 1
				
	return {
		"text": out_text,
		"is_buffering": new_buffering,
		"tag_buffer": new_buffer_text,
		"is_thinking": new_thinking,
		"think_buffer": new_think_buffer
	}


func _parse_and_emit_thoughts_deferred(raw_thoughts: String, personality: String) -> void:
	var thoughts: Array[String] = []
	for line in raw_thoughts.split("\n"):
		var clean_line := line.strip_edges()
		if clean_line.begins_with("-"):
			clean_line = clean_line.substr(1).strip_edges()
		if clean_line != "":
			thoughts.append(clean_line)
			
	print("AIService: [DEFERRED THOUGHTS] Rephrasing ", thoughts.size(), " thought points...")
	for thought in thoughts:
		print("AIService: [DEFERRED THOUGHT] Rephrasing: ", thought)
		var rephrase_prompt := "The thinking model is thinking: '" + thought + "'. Briefly rephrase this as a short, status update from Navi (e.g. 'I'm checking line 12, one sec...'). Follow personality: " + personality
		var update_text := await _request_llm(rephrase_prompt, "Respond with a single short line update.", false, "", "", 0.1)
		if update_text == "":
			update_text = "Checking: " + thought + "..."
		else:
			update_text = update_text.strip_edges().replace("\"", "")
		print("AIService: [DEFERRED THOUGHT REPHRASED] Output: ", update_text)
		thinking_update.emit(update_text)
		await get_tree().create_timer(1.2).timeout


# Helper mapped to parsing clean settings endpoints
func _parse_url(url: String) -> Dictionary:
	var clean := url.replace("http://", "").replace("https://", "")
	var slash_idx := clean.find("/")
	var host_port := clean
	var path := "/"
	if slash_idx != -1:
		host_port = clean.substr(0, slash_idx)
		path = clean.substr(slash_idx)
		
	var colon_idx := host_port.find(":")
	var host := host_port
	var port := 80
	if url.begins_with("https://"):
		port = 443
	if colon_idx != -1:
		host = host_port.substr(0, colon_idx)
		port = int(host_port.substr(colon_idx + 1))
	return {"host": host, "port": port, "path": path}


## Utility to cleanly extract tags
func _extract_skill_tag(text: String) -> String:
	var regex = RegEx.new()
	regex.compile("\\[(SKILL|SCREEN_CONTEXT|TOOL):\\s*(.*?)\\]")
	var result = regex.search(text)
	if result:
		var tag = result.get_string(2).strip_edges()
		if result.get_string(1) == "SCREEN_CONTEXT": return "take_screenshot"
		return tag
	return ""


# Helper mapped to `_get_window_controller` to fetch scene context
func _get_window_controller() -> Node:
	for child in get_tree().root.get_children():
		if child.name == "Main" or child.has_method("capture_clean_screenshot"):
			return child
	return null


# Deprecated callback preserved for backwards compatibility with tests that look for it.
func _on_request_completed(_result: int, _response_code: int, _headers: PackedStringArray, _body: PackedByteArray) -> void:
	pass
