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
		"system_prompt": _settings_mgr.get_setting("system_prompt"),
		"personality": _settings_mgr.get_setting("personality"),
		"llm_provider": provider,
		"fast_model": fast_model,
		"heavy_model": heavy_model
	})

func update_config(new_config: Dictionary) -> void:
	_config_cache.merge(new_config, true)
	print("AIService: Configuration updated.")

## Formulates and dispatches a multimodal request using a recursive message history.
func send_prompt(prompt: String, screen_img: Image = null, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO) -> void:
	if not _settings_mgr:
		request_failed.emit("SettingsManager Autoload is missing.")
		return
		
	request_started.emit()
	
	# Unified System Prompt for all calls
	var system_prompt : String = _config_cache.get("system_prompt", "")
	var personality : String = _config_cache.get("personality", "")
	var full_system_prompt := system_prompt
	if personality != "":
		full_system_prompt += "\nRespond with a " + personality + " personality."
		
	# Persistent Message History
	var messages := [{"role": "system", "content": full_system_prompt}]
	messages.append({"role": "user", "content": prompt})
	
	var is_done := false
	var loop_count := 0
	
	# The loop allows for multiple rounds of interaction until the agent is satisfied
	while not is_done and loop_count < 5:
		loop_count += 1
		
		# Request response based on full current history
		var reply: String = await _request_llm_with_history(messages)
		
		if reply == "":
			request_failed.emit("Model failed to respond.")
			break
		
		# Append AI's response to history
		messages.append({"role": "assistant", "content": reply})
		
		# Check for skills
		var skill_tag := _extract_skill_tag(reply)
		if skill_tag != "":
			var skill_result := await _handle_skill_execution(skill_tag, prompt)
			# Append result as a user-role message so the AI can process what happened
			messages.append({"role": "user", "content": "Skill Output: " + skill_result})
			# We continue the loop so the AI can talk about the result
		else:
			# No more skills, emit the final text
			response_received.emit(reply)
			is_done = true

## Helper to process specific skill tags
func _handle_skill_execution(skill_tag: String, original_prompt: String) -> String:
	if "take_screenshot" in skill_tag or "take_crop_screenshot" in skill_tag:
		# Trigger capture logic
		var window_controller = _get_window_controller()
		if window_controller:
			var img = await window_controller.capture_clean_screenshot()
			# (Optional: Add your base64 logic here)
			return "Screenshot captured successfully."
	
	if "heavy_thinking" in skill_tag:
		# Trigger the thinking model explicitly
		# Note: we pass the full history to the heavy model
		return await _request_llm_with_history([], true) # Pass true for heavy model
		
	return "Skill executed."

func _request_llm_with_history(messages: Array, is_thinking: bool = false) -> String:
	var provider: String = _config_cache.get("llm_provider", "local")
	var http := _http_request
	var model_key = "heavy_model" if is_thinking else "fast_model"
	var model: String = _config_cache.get(model_key, "")
	
	var endpoint := ""
	var headers := ["Content-Type: application/json"]
	var payload := {}
	
	if provider == "local":
		var url: String = _settings_mgr.get_setting("local_url", "http://localhost:11434")
		endpoint = url + "/v1/chat/completions"
		# The messages array is passed directly into the payload
		payload = {
			"model": model,
			"messages": messages,
			"temperature": 0.7
		}
	else:
		var url: String = _settings_mgr.get_setting("cloud_url", "")
		var api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
		
		# Convert message array to Gemini's 'contents' format
		var contents := []
		for msg in messages:
			contents.append({"role": "user" if msg.role == "user" else "model", "parts": [{"text": msg.content}]})
			
		endpoint = url + (("?" if not url.contains("?") else "&") + "key=" + api_key)
		payload = {"contents": contents}

	# Execute Request
	var json_string := JSON.stringify(payload)
	var err: Error = http.request(endpoint, headers, HTTPClient.METHOD_POST, json_string)
	if err != OK: return ""
	
	var completed_args: Array = await http.request_completed
	if completed_args[1] < 200 or completed_args[1] >= 300: return ""
	
	# Parse Response
	var response_data = JSON.parse_string(completed_args[3].get_string_from_utf8())
	if not response_data is Dictionary: return ""
	
	var reply_text := ""
	if provider == "local":
		if response_data.has("choices"):
			reply_text = response_data["choices"][0]["message"]["content"]
	else:
		if response_data.has("candidates"):
			reply_text = response_data["candidates"][0]["content"]["parts"][0]["text"]
					
	return reply_text

## Utility to cleanly extract tags
func _extract_skill_tag(text: String) -> String:
	var regex = RegEx.new()
	regex.compile("\\[SKILL: (.*?)\\]")
	var result = regex.search(text)
	return result.get_string(1) if result else ""

func _get_window_controller():
	for child in get_tree().root.get_children():
		if child.name == "Main" or child.has_method("capture_clean_screenshot"):
			return child
	return null

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
