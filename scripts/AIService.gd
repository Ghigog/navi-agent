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
## Emitted at the start of any new LLM stream request.
signal response_cleared
## Emitted when a tool call is received from the LLM.
signal tool_call_received(tool_name: String, args: Dictionary)
## Emitted when a sensitive skill requires confirmation.
signal skill_confirmation_requested(skill_name: String, description: String)


# Internal helper references
var _settings_mgr: Node
# Internal cache to avoid constant Dictionary lookups
var _config_cache := {
	"system_prompt" : "",
	"personality": "",
	"llm_provider": "local",
	"heavy_model": ""
}
var _is_response_streaming := false
var _model_override: String = ""
var _last_request_had_tool_call := false
var _last_tool_call: Dictionary = {}
var _is_tool_followup := false
var _request_in_progress := false

# Active conversation history in the current session
var _conversation_history: Array[Dictionary] = []
# Cache of the previous conversation summary
var _cached_summary: String = ""
# Short-term memory scratchpad notes (persisted during the active chat session)
var _short_term_memory: String = ""
var _continuation_token: int = 0

# The plug-and-play skills registry mapping skill tags to Callable execution handlers.
var _skills_registry: Dictionary = {}
# Emotion scoring engine — evaluates each response and updates EmotionState.
var _emotion_engine: Node = null
# Last response text — used by pre-evaluation for hedging detection on subsequent turns.
var _last_response_text: String = ""
# Last detected user sentiment (kind, mean, neutral)
var _last_user_sentiment: String = "neutral"
# Active request context
var _active_context: Dictionary = {}
var _deferred_skill: Dictionary = {}
var is_warming_up: bool = true
var is_greeting_active: bool = false

## Deterministic prompt classification library.
## Each rule maps a set of trigger patterns to a skill and a UI status message.
## Rules are evaluated top-to-bottom — more specific rules must come before general ones.
## To add a new skill trigger: add an entry here and register the skill in _initialize_skills_registry().
const PROMPT_SKILL_RULES: Array = [
	# ── Crop screenshot: user points at something directly next to Navi ──────
	{
		"label":   "VISUAL_CROP",
		"skill":   "take_crop_screenshot",
		"status":  "Let me zoom in on that for you...",
		"patterns": [
			"next to you", "beside you", "right beside", "right next",
			"right above you", "just above you", "directly above you",
			"right below you", "just below you", "directly below you",
			"that detail", "this detail", "zoom in", "close up", "close-up",
			"that thing next", "this thing next",
			# Directional spatial references — user pointing at something near Navi
			"on your left", "to your left", "on my left", "left of you",
			"on your right", "to your right", "on my right", "right of you",
			"to the left of you", "to the right of you"
		]
	},
	# ── Full screenshot: user asks about anything visual on screen ───────────
	{
		"label":   "VISUAL_FULL",
		"skill":   "take_screenshot",
		"status":  "Let me check what's on your screen...",
		"patterns": [
			# Seeing / looking verbs
			"can you see", "do you see", "what do you see", "what can you see",
			"look at", "look at this", "take a look", "have a look",
			"show me", "show what", "read this", "read what",
			"watch", "observe", "notice",
			# Screen / display references
			"screen", "display", "monitor", "desktop", "my screen",
			"on screen", "on the screen",
			# Spatial references implying visual context
			"above you", "below you", "near you",
			"what is above", "what's above", "what is below", "what's below",
			# Pointing / deictic gestures — user indicating something nearby
			"what is this", "what's this", "what is that", "what's that",
			"this here", "that there", "over here", "right here",
			"this thing", "that thing", "this one", "that one",
			# Visual identification requests
			"identify", "recognize", "what kind of", "what type of",
			"sticker", "badge", "label", "logo", "symbol", "sign",
			"animal", "creature", "character", "figure",
			# Objects only knowable by sight
			"emoji", "icon", "image", "photo", "picture", "thumbnail",
			"color", "colour", "font", "layout", "design",
			"window", "tab", "app", "application", "browser",
			"error", "warning", "crash", "popup", "dialog",
			"text on", "words on", "what does it say", "what does this say",
			"describe what", "describe the", "tell me what you see",
			# Explicit skill override — user telling Navi to use its abilities
			"use your skill", "use a skill", "take a screenshot",
			"look at my screen", "check my screen", "check the screen",
			# Bare pointing gesture — user indicating something is physically present
			"here",
			# Visual pointers to overlay context
			"behind you", "behind", "chat", "saying",
			# Spatial pointing and finding requests
			"point to", "point at", "navigate to", "where is", "where are", "find the", "find ", "find",
			"move", "move to", "point", "point out"
		]
	},
	# ── Heavy thinking: programming, math, logic, deep analysis ─────────────
	{
		"label":   "COMPLEX",
		"skill":   "heavy_thinking",
		"status":  "Let me think carefully about this...",
		"patterns": [
			# Programming
			"code", "program", "script", "function", "method", "class",
			"algorithm", "implement", "refactor", "debug", "fix this bug",
			"write a", "build a", "create a function", "create a class",
			"syntax", "compile", "runtime error", "stack trace",
			# Mathematics
			"math", "maths", "calculate", "computation", "formula",
			"equation", "solve", "integral", "derivative", "matrix",
			# Logic and reasoning
			"prove", "proof", "logical", "reasoning", "step by step",
			"step-by-step", "in detail", "explain why", "explain how",
			"analyze", "analyse", "compare", "difference between",
			"trade-off", "tradeoff", "pros and cons"
		]
	}
]

## Phrases in a fast-model reply that indicate it refused a visual task instead of escalating.
## When detected, the response is suppressed and the screenshot skill is forced automatically.
const _VISUAL_REFUSAL_PATTERNS: Array = [
	"can't see", "cannot see", "unable to see",
	"can't view", "cannot view", "unable to view",
	"don't have eyes", "no eyes",
	"don't have visual", "no visual",
	"don't have the ability to see", "i lack visual",
	"large language model", "text-based ai", "text based ai",
	"i'm a language model", "i am a language model",
	"no access to your screen", "can't access your screen",
	"cannot access your screen", "don't have access to your screen",
	"i don't have a physical", "i don't have a screen",
	"i exist solely as", "running in the background",
	"describe the sticker", "describe what's on"
]


func _ready() -> void:
	# Initialize the plug-and-play skills registry
	_initialize_skills_registry()

	# Initialise the emotion scoring engine
	_emotion_engine = load("res://scripts/EmotionEngine.gd").new()
	add_child(_emotion_engine)

	# Fetch reference to SettingsManager Autoload if present in the scene tree
	if has_node("/root/SettingsManager"):
		_settings_mgr = get_node("/root/SettingsManager")
		_settings_mgr.settings_updated.connect(_on_settings_updated)
	if _settings_mgr:
		_on_settings_updated()
	
	preload_model()


## Registers all available skills dynamically by scanning res://scripts/skills/
func _initialize_skills_registry() -> void:
	_skills_registry = {}
	
	var is_mocked := false
	var script := get_script() as Script
	if script and script != load("res://scripts/AIService.gd"):
		is_mocked = true

	var path := "res://scripts/skills/"
	var dir := DirAccess.open(path)
	if dir:
		dir.list_dir_begin()
		var file_name := dir.get_next()
		while file_name != "":
			if not dir.current_is_dir() and file_name.ends_with(".gd") and file_name != "Skill.gd":
				var full_path := path + file_name
				var loaded_script = load(full_path)
				if loaded_script:
					var skill_instance = loaded_script.new()
					if skill_instance.has_method("get_name") and skill_instance.has_method("execute"):
						var skill_name := skill_instance.get_name() as String
						if skill_name != "":
							_skills_registry[skill_name] = skill_instance
			file_name = dir.get_next()
		dir.list_dir_end()
	else:
		print("AIService WARNING: Failed to open skills directory: ", path)

	# If we are in a test mock subclass, check if any skill method was explicitly overridden in the mock script.
	# If so, overwrite that specific skill's registry entry with the legacy Callable of the overridden method.
	if is_mocked and script:
		var legacy_methods := {
			"take_screenshot": "_execute_take_screenshot",
			"take_crop_screenshot": "_execute_take_crop_screenshot",
			"heavy_thinking": "_execute_heavy_thinking",
			"summarize_session": "_execute_summarize_session",
			"point_to": "_execute_point_to"
		}
		for skill_name in legacy_methods:
			var method_name: String = legacy_methods[skill_name]
			if script.source_code.contains("func " + method_name):
				_skills_registry[skill_name] = Callable(self, method_name)


var _confirmation_approved := false
var _confirmation_pending := false

func _should_confirm_skill(skill_name: String) -> bool:
	if not _settings_mgr:
		return false
	if not _settings_mgr.get_setting("require_skill_confirmation", true):
		return false
	# point_to (and clicking, writing files, running scripts if they exist)
	return skill_name == "point_to"

func _get_skill_confirmation_description(skill_name: String, args: Dictionary) -> String:
	if skill_name == "point_to":
		var x = args.get("x")
		var y = args.get("y")
		if x != null and y != null:
			return "Navi wants to point to (%s, %s)" % [str(x), str(y)]
		elif _active_context.has("skill_args") and _active_context["skill_args"] != "":
			return "Navi wants to point to (%s)" % [str(_active_context["skill_args"])]
	return "Navi wants to execute skill: " + skill_name

func confirm_skill(skill_name: String, description: String) -> bool:
	_confirmation_approved = false
	_confirmation_pending = true
	skill_confirmation_requested.emit(skill_name, description)
	while _confirmation_pending:
		await get_tree().process_frame
	return _confirmation_approved

func respond_to_confirmation(approved: bool) -> void:
	_confirmation_approved = approved
	_confirmation_pending = false


func _on_tool_call_received(tool_name: String, args: Dictionary) -> void:
	await _execute_tool_synchronously(tool_name, args)


func _execute_tool_synchronously(tool_name: String, args: Dictionary) -> String:
	print("AIService: [TOOL CALL] Executing tool synchronously: ", tool_name, " args: ", args)
	if not _skills_registry.has(tool_name):
		return "Error: Tool '%s' not registered." % tool_name

	_active_context["args"] = args
	# Also map to legacy skill_args if it's point_to and has x/y, to maintain compatibility with anything expecting skill_args.
	if tool_name == "point_to" and args.has("x") and args.has("y"):
		_active_context["skill_args"] = "%s, %s" % [str(args["x"]), str(args["y"])]

	if _should_confirm_skill(tool_name):
		var description = _get_skill_confirmation_description(tool_name, args)
		var approved = await confirm_skill(tool_name, description)
		if not approved:
			print("AIService: [TOOL CALL] Skill execution denied by user: ", tool_name)
			var window_controller = _get_window_controller()
			if window_controller:
				var follow_ctrl = window_controller.get_node_or_null("FollowController")
				if follow_ctrl:
					follow_ctrl.call("abort_navigation", true)
			return "Error: Permission denied by user."

	# Execute the skill
	var skill_obj = _skills_registry[tool_name]
	var outcome := ""
	if skill_obj is Callable:
		outcome = await skill_obj.call(_active_context) as String
	elif skill_obj.has_method("execute"):
		outcome = await skill_obj.execute(_active_context) as String
	print("AIService: [TOOL CALL] Executed skill: ", tool_name, ". Outcome: ", outcome)
	return outcome



func _on_settings_updated() -> void:
	if not _settings_mgr:
		return
	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	var enable_thinking: bool = _settings_mgr.get_setting("enable_thinking", true)
	
	var model: String = ""
	if enable_thinking:
		model = _settings_mgr.get_setting("cloud_thinking_model" if provider == "cloud" else "local_thinking_model", "")
	
	if model == "":
		model = _settings_mgr.get_setting("local_model" if provider == "local" else "cloud_model", "")

	update_config({
		"system_prompt": _settings_mgr.get_setting("system_prompt", ""),
		"personality": _settings_mgr.get_setting("personality", ""),
		"llm_provider": provider,
		"heavy_model": model
	})


func update_config(new_config: Dictionary) -> void:
	_config_cache.merge(new_config, true)
	print("AIService: Configuration updated.")




## Formulates and dispatches a request using single-tier routing:
## 1. Deterministic: classifies the prompt via PROMPT_SKILL_RULES — zero LLM cost.
## 2. Direct Path: routes the prompt directly to the consolidated model.
func send_prompt(prompt: String, screen_img: Image = null, fairy_pos: Vector2 = Vector2.ZERO, window_size: Vector2 = Vector2.ZERO, is_continuation: bool = false) -> void:
	if not _settings_mgr:
		request_failed.emit("SettingsManager Autoload is missing.")
		return

	var system_prompt_user: String = _config_cache.get("system_prompt", "")
	var personality: String = _config_cache.get("personality", "")
	var provider: String = _config_cache.get("llm_provider", "local")
	var heavy_model: String = _config_cache.get("heavy_model", "")
	var enable_thinking: bool = _settings_mgr.get_setting("enable_thinking", true)
	var enable_screenshots: bool = _settings_mgr.get_setting("enable_screenshots", true)

	print("AIService: ── REQUEST START ──────────────────────────────────")
	print("AIService:   Provider   : ", provider)
	print("AIService:   AI model   : ", heavy_model, " (thinking enabled: ", enable_thinking, ")")
	print("AIService:   Prompt     : \"", prompt.left(80), ("…" if prompt.length() > 80 else ""), "\"")
	if is_continuation:
		print("AIService:   Mode       : [CONTINUE] Self-prompt continuation")
	print("AIService: ─────────────────────────────────────────────────────")

	if heavy_model == "":
		print("AIService ERROR: Configuration validation failed. Configured model is missing.")
		request_failed.emit("My model configuration is not set yet! Please right-click me to open settings and select your model. 😊")
		return

	request_started.emit()
	_last_request_had_tool_call = false
	_request_in_progress = true
	is_greeting_active = false

	if not is_continuation:
		_continuation_token += 1

	# Pre-evaluate emotion from incoming prompt context BEFORE building identity (NAV-65)
	var baseline_courage: float = EmotionState.courage
	var baseline_wisdom: float = EmotionState.wisdom
	var baseline_power: float = EmotionState.power
	
	if not is_continuation:
		await _pre_evaluate_emotion(prompt)

	var live_navi_mode: bool = _settings_mgr.get_setting("live_navi_mode", false)
	var identity := _build_identity(personality, live_navi_mode)

	var context := {
		"prompt": prompt,
		"base64_image": "",
		"base64_crop": "",
		"personality": personality,
		"system_prompt": system_prompt_user,
		"fairy_pos": fairy_pos,
		"window_size": window_size
	}
	_active_context = context

	# ── STAGE 0: Deterministic Prompt Classification ──────────────────────────
	var classification := {}
	if not is_continuation:
		classification = _classify_prompt(prompt)
	if not classification.is_empty():
		var forced_skill: String = classification["skill"]
		print("AIService: [ROUTER] 🎯 Classified as '", classification["label"],
			"' — matched pattern: '", classification["matched"],
			"' → forcing skill: '", forced_skill, "' (no LLM routing needed)")

		# Check settings gates before committing
		if (forced_skill == "take_screenshot" or forced_skill == "take_crop_screenshot") and not enable_screenshots:
			print("AIService: [ROUTER] Skill '", forced_skill, "' SKIPPED — screenshots are disabled. Falling back to direct path.")
		elif forced_skill == "heavy_thinking" and not enable_thinking:
			print("AIService: [ROUTER] Skill '", forced_skill, "' SKIPPED — deep thinking is disabled. Falling back to direct path.")
		else:
			thinking_update.emit(_get_personality_status_message(forced_skill, personality))
			var outcome := ""
			if forced_skill == "point_to":
				print("AIService: Deferring 'point_to' skill execution until response is ready to be spoken.")
				_deferred_skill = {
					"name": forced_skill,
					"context": context
				}
				outcome = "Success: deferred point_to"
			else:
				print("AIService: [STAGE 3] → Invoking '", forced_skill, "' directly...")
				var skill_obj = _skills_registry[forced_skill]
				if skill_obj is Callable:
					outcome = await skill_obj.call(context) as String
				elif skill_obj.has_method("execute"):
					outcome = await skill_obj.execute(context) as String
				print("AIService: [STAGE 3] ← '", forced_skill, "' finished. Outcome: ", outcome)
			var has_heavy_thinking: bool = forced_skill == "heavy_thinking"
			_evaluate_emotion(prompt, "", true, outcome.begins_with("Success"), true)
			identity = _build_identity(personality, live_navi_mode)
			
			var request_ok = await _deliver_final_response(prompt, context, has_heavy_thinking, identity, system_prompt_user, "", heavy_model, is_continuation)
			# Restore baseline before post-evaluation to prevent double-applying sentiment modifiers
			EmotionState.courage = baseline_courage
			EmotionState.wisdom = baseline_wisdom
			EmotionState.power = baseline_power
			_evaluate_emotion(prompt, _last_response_text, true, outcome.begins_with("Success") and request_ok, false, not request_ok)
			_cleanup_request()
			return

	# ── DIRECT PATH: Single-Tier Direct Request ──────────────────────────────
	print("AIService: [DIRECT PATH] Starting direct model pass.")
	var request_ok = await _deliver_final_response(prompt, context, false, identity, system_prompt_user, "", heavy_model, is_continuation)
	# Restore baseline before post-evaluation to prevent double-applying sentiment modifiers
	EmotionState.courage = baseline_courage
	EmotionState.wisdom = baseline_wisdom
	EmotionState.power = baseline_power
	_evaluate_emotion(prompt, _last_response_text, false, false, false, not request_ok)
	_cleanup_request()



# ---------------------------------------------------------------------------
# Prompt Classification
# ---------------------------------------------------------------------------

## Walks PROMPT_SKILL_RULES top-to-bottom and returns the first matching rule dict,
## augmented with a "matched" key showing which exact pattern triggered it.
## Returns an empty Dictionary if no rule matched (prompt is conversational).
func _classify_prompt(prompt: String) -> Dictionary:
	var lower := prompt.to_lower()
	for rule in PROMPT_SKILL_RULES:
		for pattern in rule["patterns"]:
			if lower.contains(pattern):
				var result: Dictionary = rule.duplicate()
				result["matched"] = pattern
				return result
	return {}


# ---------------------------------------------------------------------------
# Stage 4 — Final Response Delivery (shared by classified & escalated paths)
# ---------------------------------------------------------------------------

## Streams the final reply to the user after all skills have been executed.
## Uses the thinking configuration when has_heavy_thinking is true,
## otherwise streams from the consolidated model with thinking bypassed and any captured image context.
func _deliver_final_response(
	prompt: String,
	context: Dictionary,
	has_heavy_thinking: bool,
	identity: String,
	system_prompt_user: String,
	fast_model: String,
	heavy_model: String,
	is_continuation: bool = false
) -> bool:
	var personality: String = context.get("personality", "")
	# Add spatial self-awareness guidelines
	var spatial_guidelines := ""
	if context.has("fairy_pos") and context.has("window_size"):
		var f_pos: Vector2 = context["fairy_pos"]
		var w_size: Vector2 = context["window_size"]
		var color_hex := "light blue"
		if _settings_mgr:
			color_hex = "#" + _settings_mgr.get_setting("fairy_color", "66b2ff")
		if w_size.x > 0 and w_size.y > 0:
			spatial_guidelines = "\n\n### SPATIAL AWARENESS:\n"
			spatial_guidelines += "You are physically rendered on the user's screen as a glowing fairy at position %s relative to a total screen size of %s.\n" % [str(f_pos), str(w_size)]
			spatial_guidelines += "In the captured screenshot, your body is visible at these coordinates. You look like a magical glowing particle aura centered around a core with hex color '%s', with two flapping wings extending horizontally. If your status indicator is active, a small pulsing light of color Amber or Purple will appear directly above you.\n" % color_hex
			spatial_guidelines += "If the user asks about something 'above you', look at coordinates directly above Y = %d. If they say 'below you', look below Y = %d. If they say 'next to you' or 'beside you', look near X = %d, Y = %d. If they ask about an emoji/icon to your right, look directly to the right of your position (higher X value, same Y).\n" % [int(f_pos.y), int(f_pos.y), int(f_pos.x), int(f_pos.y)]
			spatial_guidelines += "Always use this spatial reference to locate the user's focus on the screen screenshot. You ARE the fairy, and you can see what is above, below, or near you."

	var vision_guideline := ""
	if context.get("base64_image", "") != "" or context.get("base64_crop", "") != "":
		vision_guideline = "\n\n### SCREEN ANALYSIS SANITY CHECK:\n"
		vision_guideline += "You are performing a visual analysis of the user's screen capture. If you cannot see the screen clearly, if you have no eyes/vision capabilities, or if the screen contents are ambiguous, you MUST be honest and ask the user for clarification or state that you cannot see the screen. Never guess, assume, or hallucinate applications, code, or documents."
		if context.get("base64_crop", "") != "":
			vision_guideline += " This cropped image is centered exactly on where the user's cursor was the moment they asked — not on your own position. Treat 'this', 'here', and 'near my cursor' as referring to its center. That is a different question from 'next to you' or 'beside you', which means near the fairy."

	if has_heavy_thinking:
		# Update status light to Purple to indicate thinking/generation is in progress
		var window_controller := _get_window_controller()
		var fairy: Node = null
		if window_controller and "_fairy" in window_controller:
			fairy = window_controller._fairy
		if fairy and fairy.has_method("set_status_light"):
			fairy.set_status_light(Color(0.6, 0.2, 1.0, 1.0), true) # Pulsing Purple

		var thinking_system_prompt := identity
		if system_prompt_user != "":
			thinking_system_prompt += "\n\n" + system_prompt_user
		thinking_system_prompt += spatial_guidelines + vision_guideline
		thinking_system_prompt += """

IMPORTANT: First, outline your reasoning in bullet points inside a <think>...</think> block.
Example:
<think>
- Finding the issue on screen
- Fixing the error
</think>
Write your final conversational response directly after the </think> block.

When answering visual questions about the screen contents, focus primarily on the main, foreground application window (such as the IDE, web browser, or coding application currently open in the center) rather than the desktop background, task bars, or general operating system background.

CONVERSATIONAL STEP-BY-STEP FLOW & SPATIAL POINTING:
- If you need to point to a single target/element on the screen, you MUST call the `point_to` tool natively.
- However, if you are explaining multiple points step-by-step, or if you need to point to different coordinates at different times in your response, you MUST split your explanation into multiple segments separated by the tag [PAUSE]. In this step-by-step case, do NOT call `point_to` as a native tool call. Instead, you MUST output bracket tags like `[SKILL: point_to: X, Y]` (normalized from 0 to 1000) directly in your conversational text adjacent to the description of each step.
- Each segment must describe the specific element or part. Connect them naturally using conversational transitions (e.g., "...then...", "...also...") and ellipses to indicate more is coming.
- Calculate the coordinates (X, Y) normalized from 0 to 1000:
  - Top-left corner is near (0, 0).
  - Top-right corner is near (1000, 0).
  - Bottom-left corner is near (0, 1000).
  - Bottom-right corner is near (1000, 1000).
- Example response for a multi-step pointing explanation:
  "First, I have pointed to the clock in the top-left widget for you: [SKILL: point_to: 125, 125] [PAUSE]
  Next, I am pointing to the calendar in the middle widget: [SKILL: point_to: 125, 350] [PAUSE]
  Finally, here is the bottom aquarium widget: [SKILL: point_to: 125, 700]"

### MULTI-STEP CONVERSATION & SCRATCHPAD CONSTRAINTS:
1. ALWAYS start your response (immediately after the </think> block) with a `<scratchpad>...</scratchpad>` block containing your planning bullet points.
2. Immediately after the closing `</scratchpad>` tag, write your actual conversational response to the user. Do NOT write your conversational response inside the scratchpad block.
3. Keep each individual conversational response stage/turn extremely short, conversational, and punchy (strictly maximum 1 to 2 brief sentences per stage/turn). Avoid long monologues, structured introductions, body paragraphs, or outlines.
4. At the end of your conversational response, if you have more steps/information to present in subsequent stages, output `[CONTINUE]` (at the very end, outside `<scratchpad>`).
5. If you have fully made your point, omit `[CONTINUE]`.
6. Conclude complex topics by checking if the user understood (e.g. "Does that make sense?").

"""
		print("AIService: [STAGE 4] Streaming final response from heavy thinking model: ", heavy_model)
		var active_prompt := prompt
		var active_image: String = context.get("base64_image", "")
		var active_crop: String = context.get("base64_crop", "")
		var active_history := _conversation_history.duplicate(true)
		var final_heavy_reply := ""
		var max_iterations := 5
		var iteration := 0
		var has_tool_calls_this_turn := false

		while iteration < max_iterations:
			iteration += 1
			print("AIService: [AGENT LOOP] Iteration ", iteration, " / ", max_iterations)
			var is_followup = (iteration > 1)
			_is_tool_followup = is_followup
			
			_is_response_streaming = false
			var reply := await _request_llm_stream(
				active_prompt,
				thinking_system_prompt,
				true,
				active_image,
				active_crop,
				0.7,
				active_history,
				is_continuation and not is_followup
			)
			_is_response_streaming = false
			
			if _last_tool_call.is_empty():
				final_heavy_reply = reply
				if _last_request_had_tool_call:
					has_tool_calls_this_turn = true
				break
				
			has_tool_calls_this_turn = true
			var tool_name = _last_tool_call["name"]
			var tool_args = _last_tool_call["args"]
			
			if iteration == 1:
				active_history.append({
					"role": "user",
					"text": active_prompt,
					"image": active_image,
					"crop": active_crop
				})
				
			var outcome = await _execute_tool_synchronously(tool_name, tool_args)
			var tool_call_id := "call_" + str(Time.get_ticks_msec()) + "_" + str(iteration)
			
			var clean_reply_part := _clean_response_for_history(reply)
			active_history.append({
				"role": "assistant",
				"text": clean_reply_part,
				"image": "",
				"crop": "",
				"tool_calls": [
					{
						"id": tool_call_id,
						"name": tool_name,
						"args": tool_args
					}
				]
			})
			
			active_history.append({
				"role": "tool",
				"tool_call_id": tool_call_id,
				"name": tool_name,
				"text": outcome
			})
			
			active_prompt = ""
			active_image = ""
			active_crop = ""

		if final_heavy_reply == "" and not has_tool_calls_this_turn:
			print("AIService ERROR: [STAGE 4] Heavy thinking model returned empty reply.")
			var error_msg := _get_general_error_message(personality)
			request_failed.emit(error_msg)
			return false
		else:
			print("AIService: [STAGE 4] ✅ Heavy thinking complete. Reply length: ", final_heavy_reply.length(), " chars.")
			_process_reply_meta(final_heavy_reply, context)
			if has_tool_calls_this_turn:
				var clean_final_reply := _clean_response_for_history(final_heavy_reply)
				active_history.append({
					"role": "assistant",
					"text": clean_final_reply,
					"image": "",
					"crop": ""
				})
				_conversation_history = active_history
			else:
				_append_to_history(prompt, context.get("base64_image", ""), context.get("base64_crop", ""), final_heavy_reply)
			_last_response_text = final_heavy_reply
			await _execute_deferred_skill()
			response_received.emit(final_heavy_reply)
			return true
	else:
		var analysis_system_prompt := identity
		if system_prompt_user != "":
			analysis_system_prompt += "\n\n" + system_prompt_user
		analysis_system_prompt += spatial_guidelines + vision_guideline
		
		var has_image: bool = context.get("base64_image", "") != "" or context.get("base64_crop", "") != ""
		if has_image:
			analysis_system_prompt += """

When answering visual questions about the screen contents, focus primarily on the main, foreground application window (such as the IDE, web browser, or coding application currently open in the center) rather than the desktop background, task bars, or general operating system background.

CONVERSATIONAL STEP-BY-STEP FLOW & SPATIAL POINTING:
- If you need to point to a single target/element on the screen, you MUST call the `point_to` tool natively.
- However, if you are explaining multiple points step-by-step, or if you need to point to different coordinates at different times in your response, you MUST split your explanation into multiple segments separated by the tag [PAUSE]. In this step-by-step case, do NOT call `point_to` as a native tool call. Instead, you MUST output bracket tags like `[SKILL: point_to: X, Y]` (normalized from 0 to 1000) directly in your conversational text adjacent to the description of each step.
- Each segment must describe the specific element or part. Connect them naturally using conversational transitions (e.g., "...then...", "...also...") and ellipses to indicate more is coming.
- Calculate the coordinates (X, Y) normalized from 0 to 1000:
  - Top-left corner is near (0, 0).
  - Top-right corner is near (1000, 0).
  - Bottom-left corner is near (0, 1000).
  - Bottom-right corner is near (1000, 1000).
- Example response for a multi-step pointing explanation:
  "First, I have pointed to the clock in the top-left widget for you: [SKILL: point_to: 125, 125] [PAUSE]
  Next, I am pointing to the calendar in the middle widget: [SKILL: point_to: 125, 350] [PAUSE]
  Finally, here is the bottom aquarium widget: [SKILL: point_to: 125, 700]"
"""
		analysis_system_prompt += """

### MULTI-STEP CONVERSATION & SCRATCHPAD CONSTRAINTS:
1. ALWAYS start your response with a `<scratchpad>...</scratchpad>` block containing your planning bullet points.
2. Immediately after the closing `</scratchpad>` tag, write your actual conversational response to the user. Do NOT write your conversational response inside the scratchpad block.
3. Keep each individual conversational response stage/turn extremely short, conversational, and punchy (strictly maximum 1 to 2 brief sentences per stage/turn). Avoid long monologues, structured introductions, body paragraphs, or outlines.
4. At the end of your conversational response, if you have more steps/information to present in subsequent stages, output `[CONTINUE]` (at the very end, outside `<scratchpad>`).
5. If you have fully made your point, omit `[CONTINUE]`.
6. Conclude complex topics by checking if the user understood (e.g. "Does that make sense?").

"""
		var model_to_use: String = heavy_model
		
		print("AIService: [STAGE 4] Streaming final visual analysis from model: ", model_to_use)
		var active_prompt := prompt
		var active_image: String = context.get("base64_image", "")
		var active_crop: String = context.get("base64_crop", "")
		var active_history := _conversation_history.duplicate(true)
		var final_fast_reply := ""
		var max_iterations := 5
		var iteration := 0
		var has_tool_calls_this_turn := false

		while iteration < max_iterations:
			iteration += 1
			print("AIService: [AGENT LOOP] Iteration ", iteration, " / ", max_iterations)
			var is_followup = (iteration > 1)
			_is_tool_followup = is_followup
			
			_is_response_streaming = false
			_model_override = model_to_use
			var reply := await _request_llm_stream(
				active_prompt,
				analysis_system_prompt,
				false,
				active_image,
				active_crop,
				0.7,
				active_history,
				is_continuation and not is_followup
			)
			_model_override = ""
			_is_response_streaming = false
			
			if _last_tool_call.is_empty():
				final_fast_reply = reply
				if _last_request_had_tool_call:
					has_tool_calls_this_turn = true
				break
				
			has_tool_calls_this_turn = true
			var tool_name = _last_tool_call["name"]
			var tool_args = _last_tool_call["args"]
			
			if iteration == 1:
				active_history.append({
					"role": "user",
					"text": active_prompt,
					"image": active_image,
					"crop": active_crop
				})
				
			var outcome = await _execute_tool_synchronously(tool_name, tool_args)
			var tool_call_id := "call_" + str(Time.get_ticks_msec()) + "_" + str(iteration)
			
			var clean_reply_part := _clean_response_for_history(reply)
			active_history.append({
				"role": "assistant",
				"text": clean_reply_part,
				"image": "",
				"crop": "",
				"tool_calls": [
					{
						"id": tool_call_id,
						"name": tool_name,
						"args": tool_args
					}
				]
			})
			
			active_history.append({
				"role": "tool",
				"tool_call_id": tool_call_id,
				"name": tool_name,
				"text": outcome
			})
			
			active_prompt = ""
			active_image = ""
			active_crop = ""

		var is_visual_request: bool = context.get("base64_image", "") != "" or context.get("base64_crop", "") != ""
		var provider := "local"
		if _settings_mgr:
			provider = _settings_mgr.get_setting("llm_provider", "local")

		if final_fast_reply == "" and not has_tool_calls_this_turn:
			print("AIService ERROR: [STAGE 4] Analysis model returned empty reply.")
			var error_msg := "Analysis model failed."
			if is_visual_request:
				if provider == "local":
					error_msg = _get_unsupported_vision_message(personality, heavy_model)
				else:
					error_msg = _get_cloud_vision_error_message(personality)
			else:
				error_msg = _get_general_error_message(personality)
			request_failed.emit(error_msg)
			return false
		else:
			print("AIService: [STAGE 4] ✅ Visual analysis complete. Reply length: ", final_fast_reply.length(), " chars.")
			_process_reply_meta(final_fast_reply, context)
			if has_tool_calls_this_turn:
				var clean_final_reply := _clean_response_for_history(final_fast_reply)
				active_history.append({
					"role": "assistant",
					"text": clean_final_reply,
					"image": "",
					"crop": ""
				})
				_conversation_history = active_history
			else:
				_append_to_history(prompt, context.get("base64_image", ""), context.get("base64_crop", ""), final_fast_reply)
			_last_response_text = final_fast_reply
			await _execute_deferred_skill()
			response_received.emit(final_fast_reply)
			return true


## Calculates a retrieval-relevance quality score based on word overlap with history/summary.
func _calculate_retrieval_relevance(prompt: String) -> float:
	if _conversation_history.is_empty() and _cached_summary.is_empty():
		return 0.0
	
	var words := []
	var raw_words := prompt.to_lower().split(" ", false)
	for w in raw_words:
		var clean_w := ""
		for i in range(w.length()):
			var c := w[i]
			if (c >= "a" and c <= "z") or (c >= "0" and c <= "9"):
				clean_w += c
		if clean_w.length() > 3:
			words.append(clean_w)
			
	if words.is_empty():
		return 0.0
		
	var corpus := _cached_summary.to_lower()
	for msg in _conversation_history:
		corpus += " " + msg.get("text", "").to_lower()
		
	var matches := 0
	for word in words:
		if corpus.contains(word):
			matches += 1
			
	return float(matches) / float(words.size())


## Clears the fairy status light and prints the request end banner.
## Builds an emotion evaluation context from the completed response and calls
## [method EmotionEngine.evaluate]. Safe to call even if the engine is null.
func _evaluate_emotion(prompt: String, response: String, skill_was_available: bool, skill_did_succeed: bool, is_pre_eval: bool = false, analysis_failed: bool = false) -> void:
	if not _emotion_engine:
		return
	# Only score when Live Navi Mode is active (NAV-65)
	if not _settings_mgr.get_setting("live_navi_mode", false):
		return
	var word_count: int = prompt.split(" ", false).size()
	# Treat history size as memory entry proxy.
	# Use max(1, size) on the first message of a session so an empty conversation
	# window doesn't wrongly hammer Wisdom — Navi has persisted EmotionState and
	# is not truly memoryless just because the chat window is fresh.
	var raw_mem: int = _conversation_history.size()
	var mem: int = max(1, raw_mem) if (has_node("/root/EmotionState") and get_node("/root/EmotionState").love_score != 0) else raw_mem
	# Heuristic: intent is clear when the prompt is short enough to be specific
	var intent_clear: bool = word_count <= 80 and prompt.strip_edges() != ""

	# Calculate dimension relevance flags (NAV-61 relevance logic)
	var courage_relevant: bool = (word_count > 80) or (not intent_clear)
	var wisdom_relevant: bool = _conversation_history.size() > 0 or _cached_summary != ""
	var power_relevant: bool = skill_was_available

	var retrieval_relevance: float = _calculate_retrieval_relevance(prompt)

	_emotion_engine.evaluate({
		"intent_clear":     intent_clear,
		"skills_available": skill_was_available,
		"skill_succeeded":  skill_did_succeed,
		"analysis_failed":  analysis_failed,
		"memory_entries":   mem,
		"retrieval_relevance": retrieval_relevance,
		"prompt_length":    word_count,
		"response_text":    response,
		"courage_relevant": courage_relevant,
		"wisdom_relevant":  wisdom_relevant,
		"power_relevant":   power_relevant,
		"is_pre_eval":      is_pre_eval,
		"user_sentiment":    _last_user_sentiment,
	})


## Pre-evaluates emotion from incoming prompt context BEFORE sending the LLM request (NAV-65).
## Uses the previous response (_last_response_text) for hedging detection so the
## emotion is up-to-date when the identity block is assembled.
## Skill availability is unknown at this point, so both flags are false.
func _pre_evaluate_emotion(prompt: String) -> void:
	if not _emotion_engine:
		return
	if not _settings_mgr.get_setting("live_navi_mode", false):
		return
	print("AIService:   Emotion    : Pre-evaluating from prompt context before LLM call...")
	_last_user_sentiment = await _classify_user_sentiment(prompt)
	print("AIService:   Emotion    : Detected user sentiment: ", _last_user_sentiment)
	_evaluate_emotion(prompt, _last_response_text, false, false, true)


func _classify_user_sentiment(prompt: String) -> String:
	# Define a strict system prompt for sentiment classification
	var classifier_system_prompt := (
		"You are a precise sentiment classifier. Analyze the user's message and classify its tone/intent. "
		+ "Classify it as:\n"
		+ "- 'kind' (friendly, appreciative, polite, praising, or saying nice things to Navi)\n"
		+ "- 'mean' (rude, hostile, insulting, angry, complaining, or dismissive)\n"
		+ "- 'neutral' (informational, objective question, coding request, or general dialogue)\n\n"
		+ "Respond with EXACTLY one word: 'kind', 'mean', or 'neutral'. Do not write anything else, no explanations, no punctuation."
	)
	
	# Determine the fastest non-thinking model to use based on the provider
	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	var model_to_use := ""
	if provider == "cloud":
		model_to_use = _settings_mgr.get_setting("cloud_model", "gemini-2.5-flash")
	else:
		model_to_use = _settings_mgr.get_setting("local_model", "")
		if model_to_use == "":
			model_to_use = _config_cache.get("heavy_model", "")
			
	_model_override = model_to_use
	var result := await _request_llm(prompt, classifier_system_prompt, false, "", "", 0.1, [], true)
	_model_override = ""
	
	var sentiment := result.strip_edges().to_lower()
	if sentiment.contains("kind"):
		return "kind"
	elif sentiment.contains("mean"):
		return "mean"
	else:
		return "neutral"


func _build_identity(personality: String, live_navi_mode: bool) -> String:
	var identity := ""
	if FileAccess.file_exists("res://mission_statement.md"):
		var file := FileAccess.open("res://mission_statement.md", FileAccess.READ)
		if file:
			identity = file.get_as_text()
			file.close()

	if identity == "":
		identity = "You are Navi, the desktop assistant."
		if live_navi_mode:
			var live_personality = EmotionPromptBuilder.get_live_personality()
			identity = "You are Navi, a " + live_personality + " desktop assistant."
		elif personality != "":
			identity = "You are Navi, a " + personality + " desktop assistant."
			
		identity += "\n\nCRITICAL: Be extremely honest and realistic. If you do not know something, are unsure, do not see the screen clearly, or if you lack sufficient information, DO NOT make up facts, apps, or passwords. Instead, ask the user for clarification or state your limitations. Trust current screen captures over any previous conversation history."

	if _cached_summary != "":
		identity += "\n\nPREVIOUS SESSION MEMORY — READ THIS FIRST:\nYou have a summary of what happened last time with this user. If the user asks what you discussed last time, what they asked previously, or references the previous session, use this summary to answer directly and confidently:\n" + _cached_summary + "\nDo NOT assume any of these applications or problems are still active in the current session unless you see them in the current screen capture."

	if live_navi_mode:
		var emotion_block: String = EmotionPromptBuilder.build()
		if emotion_block != "":
			identity += emotion_block
			var es_emotion: String = ""
			var tree := Engine.get_main_loop() as SceneTree
			if tree and tree.root.has_node("EmotionState"):
				es_emotion = str(tree.root.get_node("EmotionState").get("emotion"))
			var live_personality = EmotionPromptBuilder.get_live_personality()
			print("AIService:   Emotion    : [LIVE] Injected block (", emotion_block.length(), " chars). Personality: '", live_personality, "'  Feeling: ", es_emotion)
		else:
			print("AIService:   Emotion    : [LIVE] WARNING — build() returned empty. Block not injected.")
	else:
		print("AIService:   Emotion    : Live Navi Mode OFF — skipping emotion injection.")
		
	identity += "\n\n### SHORT-TERM MEMORY & CONVERSATIONAL SCRATCHPAD:"
	identity += "\nYou have a private <scratchpad>...</scratchpad> section to plan your responses, take notes, and keep track of steps (mapping the 'full point') across multiple turns during this active conversation. Any notes you output inside `<scratchpad>...</scratchpad>` will be saved and injected here on subsequent turns, but will be completely hidden from the user."
	identity += "\n- ALWAYS write your plan/notes inside the `<scratchpad>...</scratchpad>` block, and then write your actual conversational response to the user OUTSIDE and AFTER the closing `</scratchpad>` tag."
	identity += "\n- Use the scratchpad to store complex context, plan what to say next, or list questions you need to ask."
	identity += "\n- If you have more to say but want to break it up to give the user a chance to speak or intervene, output only the first part of your response and append the tag `[CONTINUE]` at the very end. The system will automatically prompt you again in the background to provide the next step."
	identity += "\n- Keep each individual stage/turn extremely short, conversational, and punchy (maximum 1 to 2 brief sentences). Break down complex concepts into multiple very brief turns separated by `[CONTINUE]`, so the user has frequent opportunities to intervene or respond."
	identity += "\n- When you have sufficiently made the point without requiring clarification, do NOT output `[CONTINUE]`. This will naturally stop the continuation loop."
	identity += "\n- If you just explained something particularly complex or difficult, conclude by asking the user to clarify if they understood (e.g. 'Does that make sense?')."
	identity += "\n- Do not output everything in a single turn if a natural multi-turn conversation is more realistic."

	if _short_term_memory != "":
		identity += "\n\nCURRENT SCRATCHPAD NOTES:\n" + _short_term_memory
		
	return identity


func _cleanup_request() -> void:
	print("AIService: ── REQUEST END ────────────────────────────────────────")
	var window_controller := _get_window_controller()
	var fairy: Node = null
	if window_controller and "_fairy" in window_controller:
		fairy = window_controller._fairy
	if fairy and fairy.has_method("clear_status_light"):
		var status_node = fairy.get_node_or_null("StatusLight")
		if status_node and status_node.visible and status_node.self_modulate.is_equal_approx(Color(0.6, 0.2, 1.0, 1.0)):
			fairy.clear_status_light()
	_request_in_progress = false


func _execute_deferred_skill() -> void:
	if not _deferred_skill.is_empty():
		var skill_name: String = _deferred_skill["name"]
		var skill_ctx: Dictionary = _deferred_skill["context"]
		_deferred_skill = {}
		print("AIService: [DEFERRED SKILL] Executing deferred skill '", skill_name, "' now that response is ready.")
		var skill_obj = _skills_registry.get(skill_name)
		if skill_obj:
			var outcome := ""
			if skill_obj is Callable:
				outcome = await skill_obj.call(skill_ctx) as String
			elif skill_obj.has_method("execute"):
				outcome = await skill_obj.execute(skill_ctx) as String
			print("AIService: [DEFERRED SKILL] Finished executing. Outcome: ", outcome)


# ---------------------------------------------------------------------------
# Plug-and-Play Skill Handlers
# ---------------------------------------------------------------------------

func _execute_take_screenshot(context: Dictionary) -> String:
	if _skills_registry.has("take_screenshot"):
		var skill_obj = _skills_registry["take_screenshot"]
		if skill_obj is Callable:
			return await skill_obj.call(context) as String
		elif skill_obj.has_method("execute"):
			return await skill_obj.execute(context) as String
	return "Failure: take_screenshot skill not registered."


func _execute_take_crop_screenshot(context: Dictionary) -> String:
	if _skills_registry.has("take_crop_screenshot"):
		var skill_obj = _skills_registry["take_crop_screenshot"]
		if skill_obj is Callable:
			return await skill_obj.call(context) as String
		elif skill_obj.has_method("execute"):
			return await skill_obj.execute(context) as String
	return "Failure: take_crop_screenshot skill not registered."


func _execute_heavy_thinking(context: Dictionary) -> String:
	if _skills_registry.has("heavy_thinking"):
		var skill_obj = _skills_registry["heavy_thinking"]
		if skill_obj is Callable:
			return await skill_obj.call(context) as String
		elif skill_obj.has_method("execute"):
			return await skill_obj.execute(context) as String
	return "Failure: heavy_thinking skill not registered."


func _execute_point_to(context: Dictionary) -> String:
	if _skills_registry.has("point_to"):
		var skill_obj = _skills_registry["point_to"]
		if skill_obj is Callable:
			return await skill_obj.call(context) as String
		elif skill_obj.has_method("execute"):
			return await skill_obj.execute(context) as String
	return "Failure: point_to skill not registered."


func _execute_summarize_session(context: Dictionary) -> String:
	if _skills_registry.has("summarize_session"):
		var skill_obj = _skills_registry["summarize_session"]
		if not context.has("ai_service"):
			context["ai_service"] = self
		if skill_obj is Callable:
			return await skill_obj.call(context) as String
		elif skill_obj.has_method("execute"):
			return await skill_obj.execute(context) as String
	return "Failure: summarize_session skill not registered."


# ---------------------------------------------------------------------------
# Asynchronous Isolated HTTP Client Requests (Non-Streaming Fallback)
# ---------------------------------------------------------------------------

func _extract_json_objects(buffer: String) -> Array:
	var objects := []
	var start_idx := 0
	while true:
		var open_brace = buffer.find("{", start_idx)
		if open_brace == -1:
			break
		
		# Find the matching closing brace
		var brace_count := 0
		var in_string := false
		var escape_next := false
		var close_brace := -1
		
		for j in range(open_brace, buffer.length()):
			var c = buffer[j]
			if escape_next:
				escape_next = false
				continue
			if c == "\\":
				escape_next = true
				continue
			if c == "\"":
				in_string = not in_string
				continue
			if not in_string:
				if c == "{":
					brace_count += 1
				elif c == "}":
					brace_count -= 1
					if brace_count == 0:
						close_brace = j
						break
		
		if close_brace != -1:
			var json_str = buffer.substr(open_brace, close_brace - open_brace + 1)
			var json = JSON.new()
			if json.parse(json_str) == OK:
				objects.append(json.get_data())
			start_idx = close_brace + 1
		else:
			# The brace is not closed yet, wait for more data
			break
			
	# Remove parsed objects from buffer
	if start_idx > 0:
		buffer = buffer.substr(start_idx)
	return [objects, buffer]


func _get_ollama_tools() -> Array:
	var tools := []
	for skill_name in _skills_registry:
		var skill_obj = _skills_registry[skill_name]
		if skill_obj.has_method("get_schema"):
			var schema: Dictionary = skill_obj.get_schema()
			if not schema.is_empty():
				tools.append({
					"type": "function",
					"function": schema
				})
	return tools


func _to_gemini_schema(schema: Dictionary) -> Dictionary:
	var copy := schema.duplicate(true)
	_uppercase_types(copy)
	return copy


func _uppercase_types(dict: Dictionary) -> void:
	if dict.has("type") and dict["type"] is String:
		dict["type"] = dict["type"].to_upper()
	if dict.has("properties") and dict["properties"] is Dictionary:
		var props: Dictionary = dict["properties"]
		for key in props:
			if props[key] is Dictionary:
				_uppercase_types(props[key])


func _get_gemini_tools() -> Array:
	var declarations := []
	for skill_name in _skills_registry:
		var skill_obj = _skills_registry[skill_name]
		if skill_obj.has_method("get_schema"):
			var schema: Dictionary = skill_obj.get_schema()
			if not schema.is_empty():
				declarations.append(_to_gemini_schema(schema))
	if declarations.is_empty():
		return []
	return [{
		"functionDeclarations": declarations
	}]


func _request_llm(prompt: String, system_prompt: String, is_thinking_model: bool = false, base64_image: String = "", base64_crop: String = "", temperature: float = 0.7, history: Array[Dictionary] = [], skip_tools: bool = false) -> String:
	if not _settings_mgr:
		return ""

	var final_system_prompt := system_prompt
	var final_temperature := temperature
	if not is_thinking_model:
		final_temperature = 0.1
		final_system_prompt += "\n\nIMPORTANT: Respond directly to the user. Do NOT write any thoughts or reasoning inside <think>...</think> tags. Just output the final response."

	var provider: String = _settings_mgr.get_setting("llm_provider", "local")

	# Dynamically spawn HTTPRequest to ensure request isolation and headless safety
	var http := HTTPRequest.new()
	add_child(http)

	var endpoint := ""
	var headers := ["Content-Type: application/json"]
	var payload := {}

	if provider == "local":
		var url: String = _settings_mgr.get_setting("local_url", "http://localhost:11434")
		var model: String = _model_override if _model_override != "" else _config_cache.get("heavy_model", "gemma4:e4b")

		endpoint = url + "/v1/chat/completions"

		var messages := []
		if final_system_prompt != "":
			messages.append({
				"role": "system",
				"content": final_system_prompt
			})

		for msg in history:
			var msg_role: String = msg.get("role", "user")
			var msg_text: String = msg.get("text", "")
			var msg_img: String = msg.get("image", "")
			var msg_crp: String = msg.get("crop", "")

			if msg_role == "user":
				var msg_content := []
				msg_content.append({"type": "text", "text": msg_text})
				if msg_img != "":
					msg_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + msg_img}})
				if msg_crp != "":
					msg_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + msg_crp}})
				messages.append({
					"role": "user",
					"content": msg_content
				})
			else:
				messages.append({
					"role": "assistant",
					"content": msg_text
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

		var ollama_tools := [] if skip_tools else _get_ollama_tools()
		payload = {
			"model": model,
			"messages": messages,
			"temperature": final_temperature
		}
		if not ollama_tools.is_empty():
			payload["tools"] = ollama_tools
	else:
		var url: String = _settings_mgr.get_setting("cloud_url", "")
		var api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
		if api_key == "":
			api_key = OS.get_environment("GEMINI_API_KEY")
		var model: String = _model_override if _model_override != "" else _config_cache.get("heavy_model", "gemini-2.5-flash")

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

		var contents := []
		var is_first_user_msg := true

		for msg in history:
			var msg_role: String = msg.get("role", "user")
			var msg_text: String = msg.get("text", "")
			var msg_img: String = msg.get("image", "")
			var msg_crp: String = msg.get("crop", "")

			var parts := []
			if msg_role == "user":
				if is_first_user_msg and final_system_prompt != "":
					parts.append({"text": "SYSTEM INSTRUCTIONS:\n" + final_system_prompt + "\n\nUSER PROMPT:\n" + msg_text})
					is_first_user_msg = false
				else:
					parts.append({"text": msg_text})
				if msg_img != "":
					parts.append({"inlineData": {"mimeType": "image/jpeg", "data": msg_img}})
				if msg_crp != "":
					parts.append({"inlineData": {"mimeType": "image/jpeg", "data": msg_crp}})
				contents.append({
					"role": "user",
					"parts": parts
				})
			else:
				parts.append({"text": msg_text})
				contents.append({
					"role": "model",
					"parts": parts
				})

		var cloud_parts: Array = []
		if is_first_user_msg and final_system_prompt != "":
			cloud_parts.append({
				"text": "SYSTEM INSTRUCTIONS:\n" + final_system_prompt + "\n\nUSER PROMPT:\n" + prompt
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

		contents.append({
			"role": "user",
			"parts": cloud_parts
		})

		var gemini_tools := [] if skip_tools else _get_gemini_tools()
		payload = {
			"contents": contents
		}
		if not gemini_tools.is_empty():
			payload["tools"] = gemini_tools
		if not is_thinking_model:
			payload["generationConfig"] = {
				"thinkingConfig": {
					"thinkingBudget": 0
				}
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

func _request_llm_stream(prompt: String, system_prompt: String, is_thinking_model: bool = false, base64_image: String = "", base64_crop: String = "", temperature: float = 0.7, history: Array[Dictionary] = [], is_continuation: bool = false) -> String:
	_last_tool_call = {}
	# Do not clear the UI during tool follow-up iterations or [CONTINUE] continuation passes.
	# Clearing would erase the in-progress streamed response that the user is already reading.
	if not _is_tool_followup and not is_continuation:
		response_cleared.emit()
	if not _settings_mgr:
		return ""

	var final_system_prompt := system_prompt
	var final_temperature := temperature
	if not is_thinking_model:
		final_temperature = 0.1
		final_system_prompt += "\n\nIMPORTANT: Respond directly to the user. Do NOT write any thoughts or reasoning inside <think>...</think> tags. However, you MUST still ALWAYS start your response with a `<scratchpad>...</scratchpad>` block and use `[CONTINUE]` tags to split your response into stages as instructed in the MULTI-STEP CONVERSATION & SCRATCHPAD CONSTRAINTS."

	var provider: String = _settings_mgr.get_setting("llm_provider", "local")
	var url_setting: String = _settings_mgr.get_setting("cloud_url" if provider == "cloud" else "local_url", "")
	var model: String = _model_override if _model_override != "" else _config_cache.get("heavy_model", "gemma4:e4b")

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
		client.poll()
		await get_tree().process_frame

	if client.get_status() != HTTPClient.STATUS_CONNECTED:
		print("AIService ERROR: Client status is not connected: ", client.get_status())
		return ""

	var headers := ["Content-Type: application/json"]
	var payload := {}

	if provider == "local":
		var messages := []
		if final_system_prompt != "":
			messages.append({"role": "system", "content": final_system_prompt})

		for msg in history:
			var msg_role: String = msg.get("role", "user")
			var msg_text: String = msg.get("text", "")
			var msg_img: String = msg.get("image", "")
			var msg_crp: String = msg.get("crop", "")

			if msg_role == "user":
				var msg_content := []
				msg_content.append({"type": "text", "text": msg_text})
				if msg_img != "":
					msg_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + msg_img}})
				if msg_crp != "":
					msg_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + msg_crp}})
				messages.append({
					"role": "user",
					"content": msg_content
				})
			elif msg_role == "assistant":
				var m := {
					"role": "assistant",
					"content": msg_text
				}
				if msg.has("tool_calls") and not msg["tool_calls"].is_empty():
					var tool_calls := []
					for tc in msg["tool_calls"]:
						tool_calls.append({
							"id": tc.get("id", ""),
							"type": "function",
							"function": {
								"name": tc.get("name", ""),
								"arguments": JSON.stringify(tc.get("args", {}))
							}
						})
					m["tool_calls"] = tool_calls
				messages.append(m)
			elif msg_role == "tool" or msg_role == "function":
				messages.append({
					"role": "tool",
					"tool_call_id": msg.get("tool_call_id", ""),
					"name": msg.get("name", ""),
					"content": msg_text
				})

		if prompt != "" or base64_image != "" or base64_crop != "":
			var user_content := []
			user_content.append({"type": "text", "text": prompt})
			if base64_image != "":
				user_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64_image}})
			if base64_crop != "":
				user_content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64_crop}})
			messages.append({"role": "user", "content": user_content})

		var ollama_tools := _get_ollama_tools()
		payload = {
			"model": model,
			"messages": messages,
			"temperature": final_temperature,
			"stream": true,
			"think": is_thinking_model
		}
		if not ollama_tools.is_empty():
			payload["tools"] = ollama_tools
	else:
		var api_key: String = _settings_mgr.get_setting("cloud_api_key", "")
		if api_key == "":
			api_key = OS.get_environment("GEMINI_API_KEY")
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

		var contents := []
		var is_first_user_msg := true

		for msg in history:
			var msg_role: String = msg.get("role", "user")
			var msg_text: String = msg.get("text", "")
			var msg_img: String = msg.get("image", "")
			var msg_crp: String = msg.get("crop", "")

			var parts := []
			if msg_role == "user":
				if is_first_user_msg and final_system_prompt != "":
					parts.append({"text": "SYSTEM INSTRUCTIONS:\n" + final_system_prompt + "\n\nUSER PROMPT:\n" + msg_text})
					is_first_user_msg = false
				else:
					parts.append({"text": msg_text})
				if msg_img != "":
					parts.append({"inlineData": {"mimeType": "image/jpeg", "data": msg_img}})
				if msg_crp != "":
					parts.append({"inlineData": {"mimeType": "image/jpeg", "data": msg_crp}})
				contents.append({
					"role": "user",
					"parts": parts
				})
			elif msg_role == "assistant":
				if msg_text != "":
					parts.append({"text": msg_text})
				if msg.has("tool_calls") and not msg["tool_calls"].is_empty():
					for tc in msg["tool_calls"]:
						parts.append({
							"functionCall": {
								"name": tc.get("name", ""),
								"args": tc.get("args", {})
							}
						})
				contents.append({
					"role": "model",
					"parts": parts
				})
			elif msg_role == "tool" or msg_role == "function":
				contents.append({
					"role": "function",
					"parts": [
						{
							"functionResponse": {
								"name": msg.get("name", ""),
								"response": {
									"output": msg_text
								}
							}
						}
					]
				})

		if prompt != "" or base64_image != "" or base64_crop != "":
			var cloud_parts: Array = []
			if is_first_user_msg and final_system_prompt != "":
				cloud_parts.append({"text": "SYSTEM INSTRUCTIONS:\n" + final_system_prompt + "\n\nUSER PROMPT:\n" + prompt})
			else:
				cloud_parts.append({"text": prompt})

			if base64_image != "":
				cloud_parts.append({"inlineData": {"mimeType": "image/jpeg", "data": base64_image}})
			if base64_crop != "":
				cloud_parts.append({"inlineData": {"mimeType": "image/jpeg", "data": base64_crop}})

			contents.append({
				"role": "user",
				"parts": cloud_parts
			})

		var gemini_tools := _get_gemini_tools()
		payload = {
			"contents": contents
		}
		if not gemini_tools.is_empty():
			payload["tools"] = gemini_tools
		if not is_thinking_model:
			payload["generationConfig"] = {
				"thinkingConfig": {
					"thinkingBudget": 0
				}
			}

	var json_payload := JSON.stringify(payload)
	print("AIService: Dispatching LLM request. Host: ", host, " Path: ", path)
	var req_err := client.request(HTTPClient.METHOD_POST, path, headers, json_payload)
	if req_err != OK:
		print("AIService ERROR: Request dispatch failed: ", req_err)
		return ""

	while client.get_status() == HTTPClient.STATUS_REQUESTING:
		client.poll()
		await get_tree().process_frame
	print("AIService: Request sent, waiting for response body...")

	if not client.has_response():
		print("AIService ERROR: No response received from client.")
		return ""

	var response_code := client.get_response_code()
	print("AIService: HTTP response code received: ", response_code)
	if response_code < 200 or response_code >= 300:
		return ""

	var full_text := ""
	var current_line_buffer := ""
	var gemini_buffer := ""
	var is_buffering_tag := false
	var tag_buffer := ""
	var is_thinking := false
	var think_buffer := ""
	var tag_boundary_buffer := "" # Accumulates split indicators like '<', '[', etc. across chunks
	var personality: String = _config_cache.get("personality", "")
	var is_stream_finished := false

	var current_tool_name := ""
	var current_tool_args_accumulated := ""
	var current_tool_args_dict := {}

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
							if choice.has("delta"):
								if choice["delta"].has("content"):
									var word: String = choice["delta"]["content"]
									full_text += word

									# Only print chunk logs if they contain actual content
									if word != "":
										print("AIService: [Ollama Chunk] \"", word, "\"")

									var filtered_word := _filter_stream_chunk(word, is_buffering_tag, tag_buffer, is_thinking, think_buffer, personality, tag_boundary_buffer)
									is_buffering_tag = filtered_word["is_buffering"]
									tag_buffer = filtered_word["tag_buffer"]
									is_thinking = filtered_word["is_thinking"]
									think_buffer = filtered_word["think_buffer"]
									tag_boundary_buffer = filtered_word["boundary_buffer"]
									# Emit real-time thought lines as they complete inside the <think> block
									for think_line: String in filtered_word.get("think_lines", []):
										thinking_update.emit(think_line)

									if filtered_word["text"] != "":
										_is_response_streaming = true
										response_chunk.emit(filtered_word["text"])
								
								if choice["delta"].has("tool_calls"):
									var tool_calls = choice["delta"]["tool_calls"]
									if tool_calls is Array and tool_calls.size() > 0:
										var tc = tool_calls[0]
										if tc.has("function"):
											var func_data = tc["function"]
											if func_data.has("name") and func_data["name"] != "":
												current_tool_name = func_data["name"]
											if func_data.has("arguments"):
												current_tool_args_accumulated += func_data["arguments"]
				if is_stream_finished:
					break
			else:
				# Gemini stream parsing
				gemini_buffer += text
				var extraction = _extract_json_objects(gemini_buffer)
				var json_objs: Array = extraction[0]
				gemini_buffer = extraction[1]

				for obj in json_objs:
					if obj is Dictionary and obj.has("candidates") and obj["candidates"].size() > 0:
						var candidate = obj["candidates"][0]
						if candidate.has("content") and candidate["content"].has("parts"):
							for part in candidate["content"]["parts"]:
								if part.has("text") and part["text"] != "":
									var word: String = part["text"]
									full_text += word

									if word != "":
										print("AIService: [Gemini Chunk] \"", word, "\"")

									var filtered_word := _filter_stream_chunk(word, is_buffering_tag, tag_buffer, is_thinking, think_buffer, personality, tag_boundary_buffer)
									is_buffering_tag = filtered_word["is_buffering"]
									tag_buffer = filtered_word["tag_buffer"]
									is_thinking = filtered_word["is_thinking"]
									think_buffer = filtered_word["think_buffer"]
									tag_boundary_buffer = filtered_word["boundary_buffer"]
									# Emit real-time thought lines as they complete inside the <think> block
									for think_line: String in filtered_word.get("think_lines", []):
										thinking_update.emit(think_line)

									if filtered_word["text"] != "":
										_is_response_streaming = true
										response_chunk.emit(filtered_word["text"])
								
								if part.has("functionCall"):
									var func_call = part["functionCall"]
									if func_call.has("name") and func_call["name"] != "":
										current_tool_name = func_call["name"]
										if func_call.has("args") and func_call["args"] is Dictionary:
											current_tool_args_dict = func_call["args"]

		await get_tree().process_frame

	client.close()
	print("AIService: HTTP connection closed. Full text length: ", full_text.length())

	if current_tool_name != "":
		_last_request_had_tool_call = true
		var parsed_args := {}
		if not current_tool_args_dict.is_empty():
			parsed_args = current_tool_args_dict
		elif current_tool_args_accumulated != "":
			var parse_res = JSON.parse_string(current_tool_args_accumulated)
			if parse_res is Dictionary:
				parsed_args = parse_res
			else:
				print("AIService ERROR: Failed to parse tool arguments: ", current_tool_args_accumulated)
		
		_last_tool_call = {
			"name": current_tool_name,
			"args": parsed_args
		}
		print("AIService: Emitting tool_call_received for tool: ", current_tool_name, " with args: ", parsed_args)
		tool_call_received.emit(current_tool_name, parsed_args)

	return full_text


func _filter_stream_chunk(word: String, is_buffering: bool, tag_buffer_in: String, is_thinking: bool, think_buffer_in: String, personality: String = "", boundary_buffer_in: String = "") -> Dictionary:
	var out_text := ""
	# Collects completed thought lines to be emitted as thinking_update signals by the caller.
	var pending_think_lines: Array = []
	var new_buffering := is_buffering
	var new_buffer_text := tag_buffer_in
	var new_thinking := is_thinking
	var new_think_buffer := think_buffer_in
	var new_boundary := boundary_buffer_in

	var i := 0
	while i < word.length():
		var char := word[i]

		# 1. Handle Active Thinking Block OR Scratchpad Suppression
		# <think>...</think> lines are emitted as spoken thinking_update events (no UI display).
		# <scratchpad>...</scratchpad> is fully suppressed — private cross-turn memory, never shown.
		if new_thinking or new_think_buffer.begins_with("__scratchpad__"):
			var in_scratchpad := new_think_buffer.begins_with("__scratchpad__")
			new_think_buffer += char

			if in_scratchpad:
				# Scratchpad suppression — watch for closing tag, emit nothing
				if new_think_buffer.ends_with("</scratchpad>"):
					new_think_buffer = ""
					print("AIService: [SCRATCHPAD BLOCK ENDED]")
			else:
				# Think block — collect lines and emit as spoken personality utterances
				if new_think_buffer.ends_with("</think>"):
					new_thinking = false
					# Emit any remaining partial thought that wasn't newline-terminated
					var remaining := new_think_buffer.substr(0, new_think_buffer.length() - 8).strip_edges()
					if remaining.begins_with("-") or remaining.begins_with("*"):
						remaining = remaining.substr(1).strip_edges()
					if remaining != "":
						pending_think_lines.append(_apply_personality_voice(remaining, personality))
					new_think_buffer = ""
					print("AIService: [THINK BLOCK ENDED]")
				elif char == "\n":
					# Emit the completed thought line as a spoken update
					var line := new_think_buffer.strip_edges()
					if line.begins_with("-") or line.begins_with("*"):
						line = line.substr(1).strip_edges()
					if line != "":
						pending_think_lines.append(_apply_personality_voice(line, personality))
					new_think_buffer = ""
			i += 1
			continue

		# 2. Handle Active Skill Tag Buffering
		if new_buffering:
			new_buffer_text += char
			if char == "]":
				new_buffering = false
				print("AIService: [SKILL TAG INTERCEPTED] Buffer: ", new_buffer_text)
				# Swallow internal control tags silently — they are handled by _process_reply_meta()
				# and must never appear in the streamed output visible to the user.
				const INTERNAL_TAGS := ["[CONTINUE]", "[ESCALATE]"]
				if new_buffer_text not in INTERNAL_TAGS:
					out_text += new_buffer_text
				new_buffer_text = ""
			i += 1
			continue

		# 3. Handle Indicator Boundary Matching (not currently in a tag block)
		if char == "<" or char == "[":
			new_boundary = char
			i += 1
			continue

		if new_boundary != "":
			new_boundary += char

			# Check if we matched the full opening of a known suppressed block
			if new_boundary == "<think>":
				new_thinking = true
				new_think_buffer = ""
				new_boundary = ""
				print("AIService: [THINK BLOCK STARTED]")
				i += 1
				continue
			elif new_boundary == "<scratchpad>":
				# Enter scratchpad suppression — content is private cross-turn memory, never shown.
				# _process_reply_meta() reads scratchpad from the full raw reply after streaming ends.
				new_think_buffer = "__scratchpad__" # Sentinel value distinguishes scratchpad from think
				new_boundary = ""
				print("AIService: [SCRATCHPAD BLOCK STARTED — suppressing from output]")
				i += 1
				continue
			elif new_boundary.begins_with("["):
				# Control/skill tags can contain arbitrary characters — switch to general buffering
				new_buffering = true
				new_buffer_text = new_boundary
				new_boundary = ""
				i += 1
				continue

			# Check if the boundary is still a partial match for a known suppressed tag opener
			var is_partial_match := "<think>".begins_with(new_boundary) or "<scratchpad>".begins_with(new_boundary)
			if is_partial_match:
				i += 1
				continue
			else:
				# False indicator (e.g. "<b>" or "<something else"). Spill boundary to output.
				out_text += new_boundary
				new_boundary = ""
				i += 1
				continue
		else:
			out_text += char
			i += 1

	return {
		"text": out_text,
		"think_lines": pending_think_lines,
		"is_buffering": new_buffering,
		"tag_buffer": new_buffer_text,
		"is_thinking": new_thinking,
		"think_buffer": new_think_buffer,
		"boundary_buffer": new_boundary
	}


## Client-side personality transform for raw model thought lines.
## Returns a personality-voiced retraction shown in the thought trail when the fast model
## wrongly refused a visual task. Suppresses the bad reply and re-routes to screenshots.
func _get_retraction_message(personality: String) -> String:
	match personality.to_lower():
		"annoying":
			return "Ugh, wait — I take that back. I literally have skills for this, hold on."
		"snarky":
			return "...Actually, scratch that. I can just look. Watch."
		"friendly":
			return "Oh wait, I can actually peek at your screen! Let me try that instead!"
		"professional":
			return "Correction — I do have screen access capabilities. Retrying with visual context."
		_:
			return "Wait, actually — I can check your screen! Let me try that..."


## Transforms a raw model thought line into a natural spoken utterance.
## Applied before think lines are emitted as thinking_update signals and spoken via TTS.
## Uses rotating personality-aware phrasing templates so Navi sounds like a real person
## thinking out loud — no extra LLM calls, purely client-side string templating.
func _apply_personality_voice(line: String, personality: String) -> String:
	var clean := line.strip_edges()
	if clean.begins_with("-") or clean.begins_with("*"):
		clean = clean.substr(1).strip_edges()

	if clean == "":
		return ""

	# Capitalize the first letter
	if clean.length() > 0:
		clean = clean.left(1).to_upper() + clean.substr(1)

	# Wrap in a natural spoken phrasing based on personality.
	# Rotating selection uses the text hash so it's consistent per line but varies across turns.
	var slot := (clean.hash() & 0x7FFFFFFF) % 4
	var p := personality.to_lower()
	match p:
		"annoying":
			match slot:
				0: return "Okay so, " + clean.to_lower() + "..."
				1: return "Ugh, " + clean.to_lower() + "."
				2: return "Let me just — " + clean.to_lower() + "."
				_: return "Hold on, " + clean.to_lower() + "."
		"snarky":
			match slot:
				0: return "Right, so... " + clean.to_lower() + "."
				1: return "Obviously, " + clean.to_lower() + "."
				2: return clean + ". Duh."
				_: return "Let me think... " + clean.to_lower() + "."
		"professional":
			match slot:
				0: return "Analyzing: " + clean
				1: return "Processing — " + clean
				2: return "Noted. " + clean
				_: return "Working on: " + clean
		_: # friendly / serene / default
			match slot:
				0: return "Hmm, " + clean.to_lower() + "..."
				1: return "Let me think... " + clean.to_lower() + "."
				2: return "Oh, " + clean.to_lower() + "."
				_: return "One sec — " + clean.to_lower() + "."


func _get_personality_status_message(skill_name: String, personality: String) -> String:
	var p := personality.to_lower()
	match skill_name:
		"take_screenshot":
			match p:
				"friendly":     return "Let me check what's on your screen..."
				"annoying":     return "Let me look at your screen, I guess."
				"snarky":       return "Let's see what mess is on your screen..."
				"professional": return "Initiating screen capture analysis..."
				_:              return "Let me check what's on your screen..."
		"take_crop_screenshot":
			match p:
				"friendly":     return "Let me zoom in on that for you..."
				"annoying":     return "Fine, let's zoom in on that."
				"snarky":       return "Zooming in. Try to make it interesting."
				"professional": return "Executing cropped region capture..."
				_:              return "Let me zoom in on that for you..."
		"heavy_thinking":
			match p:
				"friendly":     return "Let me think carefully about this..."
				"annoying":     return "Ugh, heavy thinking time. Hold on."
				"snarky":       return "Thinking. Don't hold your breath."
				"professional": return "Processing complex analytical query..."
				_:              return "Let me think carefully about this..."
		_:
			return "Thinking..."


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


## Cleans the reasoning and skill tags out of the response before storing in history.
func _clean_response_for_history(text: String) -> String:
	return NaviUtils.strip_skill_and_pause_tags(text)


## Appends a conversational turn (both user query and AI response) to the history.
func _append_to_history(user_prompt: String, img: String, crop: String, ai_reply: String) -> void:
	_conversation_history.append({
		"role": "user",
		"text": user_prompt,
		"image": img,
		"crop": crop
	})

	var clean_reply := _clean_response_for_history(ai_reply)
	_conversation_history.append({
		"role": "assistant",
		"text": clean_reply,
		"image": "",
		"crop": ""
	})


## Public method to clear the current chat history.
func clear_history() -> void:
	_conversation_history.clear()
	_short_term_memory = ""
	_continuation_token += 1
	is_greeting_active = false
	print("AIService: Conversation history and scratchpad cleared.")


## Getter for the cached session summary.
func get_cached_summary() -> String:
	return _cached_summary


## Public method called when a chat session ends.
## Grabs a copy of the active history, clears it, and runs summarization in the background.
func end_chat_session() -> void:
	if _conversation_history.is_empty():
		print("AIService: end_chat_session called, but history is empty.")
		return

	var context := {
		"history": _conversation_history.duplicate(true),
		"ai_service": self
	}
	clear_history()

	if _skills_registry.has("summarize_session"):
		print("AIService: Triggering background summarization skill...")
		var skill_obj = _skills_registry["summarize_session"]
		if skill_obj is Callable:
			skill_obj.call_deferred(context)
		elif skill_obj.has_method("execute"):
			skill_obj.call_deferred("execute", context)
	else:
		print("AIService WARNING: summarize_session skill is not registered.")


## Triggers a startup greeting LLM request. For local models, this request serves
## as the VRAM warmup call itself, eliminating redundant pre-load endpoints.
func preload_model() -> void:
	# Bypass loading if we are running unit tests (GUT)
	for arg in OS.get_cmdline_args():
		if arg.contains("gut") or arg.contains("test"):
			is_warming_up = false
			return

	var tree = Engine.get_main_loop() as SceneTree
	if not tree or (tree.root and tree.root.has_node("GutRunner")):
		is_warming_up = false
		return

	var provider: String = _settings_mgr.get_setting("llm_provider", "local") if _settings_mgr else "local"
	if provider != "local":
		is_warming_up = false
		_set_fairy_loading(false)
		_speak_startup_greeting()
		return

	var url_setting: String = _settings_mgr.get_setting("local_url", "") if _settings_mgr else ""
	var model: String = _config_cache.get("heavy_model", "")
	if model == "":
		model = _settings_mgr.get_setting("local_model", "") if _settings_mgr else ""

	if url_setting == "" or model == "":
		is_warming_up = false
		_set_fairy_loading(false)
		return

	print("AIService: Preloading local model '", model, "' into VRAM via greeting request...")
	is_warming_up = true
	_set_fairy_loading(true)
	_speak_startup_greeting()


func _set_fairy_loading(loading: bool) -> void:
	var window_controller := _get_window_controller()
	if window_controller and "_fairy" in window_controller and window_controller._fairy:
		var fairy = window_controller._fairy
		if "is_loading" in fairy:
			fairy.is_loading = loading


func _speak_startup_greeting() -> void:
	if not _settings_mgr:
		is_warming_up = false
		_set_fairy_loading(false)
		return
	is_greeting_active = true
	
	# Early discard checks before making the request
	if not _conversation_history.is_empty():
		print("AIService: Discarding startup greeting before LLM request because conversation history is not empty.")
		is_greeting_active = false
		is_warming_up = false
		_set_fairy_loading(false)
		return
	if _request_in_progress:
		print("AIService: Discarding startup greeting before LLM request because a request is already in progress.")
		is_greeting_active = false
		is_warming_up = false
		_set_fairy_loading(false)
		return
	var window_controller := _get_window_controller()
	if window_controller and "_active_panel" in window_controller:
		if window_controller._active_panel != 0: # NONE = 0
			print("AIService: Discarding startup greeting before LLM request because an interaction panel is active.")
			is_greeting_active = false
			is_warming_up = false
			_set_fairy_loading(false)
			return

	var live_navi_mode: bool = _settings_mgr.get_setting("live_navi_mode", false)
	var personality: String = _settings_mgr.get_setting("personality", "cheerful and glowing")
	
	var identity := _build_identity(personality, live_navi_mode)
	var prompt := "Please greet the user in one short sentence. Keep it under 15 words. Greet the user according to your personality."
	
	print("AIService: Requesting startup greeting prompt...")
	var reply := await _request_llm(prompt, identity, false, "", "", 0.7, [], true)
	
	is_warming_up = false
	
	# Late discard checks after LLM request resolves
	if not _conversation_history.is_empty():
		print("AIService: Discarding startup greeting because conversation history is not empty.")
		is_greeting_active = false
		_set_fairy_loading(false)
		return
	if _request_in_progress:
		print("AIService: Discarding startup greeting because a request is already in progress.")
		is_greeting_active = false
		_set_fairy_loading(false)
		return
	window_controller = _get_window_controller()
	if window_controller and "_active_panel" in window_controller:
		if window_controller._active_panel != 0: # NONE = 0
			print("AIService: Discarding startup greeting because an interaction panel is active.")
			is_greeting_active = false
			_set_fairy_loading(false)
			return

	var cleaned_reply := _clean_response_for_history(reply).strip_edges()
	if cleaned_reply == "":
		cleaned_reply = "I'm ready!"
		
	print("AIService: Startup greeting generated: \"", cleaned_reply, "\"")
	
	_set_fairy_loading(false)
	
	if has_node("/root/TTSService"):
		get_node("/root/TTSService").speak(cleaned_reply)
		
	if window_controller and window_controller.has_method("show_startup_greeting"):
		window_controller.call("show_startup_greeting", cleaned_reply)
	else:
		is_greeting_active = false


func _process_reply_meta(reply: String, context: Dictionary) -> void:
	# 1. Extract and save scratchpad notes
	var scratch_regex := RegEx.new()
	scratch_regex.compile("(?s)<scratchpad>(.*?)</scratchpad>")
	var scratch_match := scratch_regex.search(reply)
	if scratch_match:
		_short_term_memory = scratch_match.get_string(1).strip_edges()
		print("AIService: [SCRATCHPAD] Updated short-term memory:\n", _short_term_memory)
	
	# 2. Check for continuation tag
	var reply_sans_scratchpad := NaviUtils.strip_scratchpad_block(reply)
	var reply_sans_think := NaviUtils.strip_thinking_block(reply_sans_scratchpad)
	var has_continue := reply_sans_think.contains("[CONTINUE]")
	if has_continue:
		print("AIService: [CONTINUE] Continuation tag detected in raw reply. Scheduling next stage...")
		_schedule_continuation(context)


func _schedule_continuation(context: Dictionary) -> void:
	_continuation_token += 1
	var token := _continuation_token
	
	# Wait for TTS to finish speaking if active, and wait for streaming to complete
	var tts = get_node_or_null("/root/TTSService")
	if tts and tts.has_method("is_speaking"):
		# Wait a frame to ensure speech tasks have queued/started
		await get_tree().process_frame
		while tts.get("_stream_active") or tts.is_speaking():
			await get_tree().create_timer(0.2).timeout
			if _continuation_token != token:
				print("AIService: [CONTINUE] Continuation cancelled (new user prompt sent during speaking/streaming).")
				return
	
	# Pause to let the user read and intervene
	print("AIService: [CONTINUE] Pausing 2.0s for user intervention...")
	await get_tree().create_timer(2.0).timeout
	if _continuation_token != token:
		print("AIService: [CONTINUE] Continuation cancelled (new user prompt sent during pause).")
		return
		
	# Check if user has typed anything, focused the chat, started voice recording, or is transcribing
	var window_ctrl = _get_window_controller()
	if window_ctrl and "_chat_ui" in window_ctrl:
		var chat_ui = window_ctrl._chat_ui
		if chat_ui:
			if chat_ui.get("input_edit") and chat_ui.input_edit.get("text") != null:
				if chat_ui.input_edit.text.strip_edges() != "":
					print("AIService: [CONTINUE] Continuation cancelled (user is typing: '", chat_ui.input_edit.text, "').")
					return
			if chat_ui.get("_voice_button") and chat_ui._voice_button and chat_ui._voice_button.button_pressed:
				print("AIService: [CONTINUE] Continuation cancelled (user is recording voice).")
				return
			if chat_ui.get("_is_transcribing") or chat_ui.get("_space_held"):
				print("AIService: [CONTINUE] Continuation cancelled (user is transcribing or holding hotkey).")
				return
				
	print("AIService: [CONTINUE] Triggering self-prompt pass.")
	# Call send_prompt as a continuation pass (hidden trigger "(Continue)")
	send_prompt("(Continue)", null, context.get("fairy_pos", Vector2.ZERO), context.get("window_size", Vector2.ZERO), true)


func _get_unsupported_vision_message(personality: String, model_name: String) -> String:
	var clean_model := model_name.strip_edges()
	match personality.to_lower():
		"annoying":
			return "Ugh, seriously? My current local model '" + clean_model + "' is text-only! I don't even have eyes right now to look at your screen. You have to go to my settings and give me a vision model or switch to a cloud model, okay?"
		"snarky":
			return "Well, this is awkward. You're asking me to look at your screen, but the model I'm using ('" + clean_model + "') is blind. Switch me to a model that actually has vision capabilities in the settings, unless you want me to just make stuff up."
		"professional":
			return "Visual analysis failed. The active local model ('" + clean_model + "') is a text-only model and lacks vision capabilities. Please configure a multimodal model or switch to a cloud provider in the settings to enable screen analysis."
		_: # friendly / serene / default
			return "Oh! I'm sorry, but my current model '" + clean_model + "' doesn't support vision, so I can't see your screen right now. If you open my settings, you can switch to a vision-capable local model or a cloud provider and I'll be happy to help!"


func _get_cloud_vision_error_message(personality: String) -> String:
	match personality.to_lower():
		"annoying":
			return "Ugh, the cloud service failed to look at your screen. Probably a bad connection or something. Try again later?"
		"snarky":
			return "The cloud vision service decided to ignore us. Maybe check your internet connection or API key, because I'm getting nothing."
		"professional":
			return "Cloud visual analysis request failed. Please check your internet connectivity and verify your API credentials in settings."
		_:
			return "I had trouble analyzing your screen using the cloud service. Please make sure you have a stable internet connection and that your API settings are configured correctly!"


func _get_general_error_message(personality: String) -> String:
	match personality.to_lower():
		"annoying":
			return "Ugh, something went wrong and I couldn't get a response. Can you check if my settings are right?"
		"snarky":
			return "Well, that failed. I couldn't get a response. Maybe check if the server is even running?"
		"professional":
			return "Request execution failed. Unable to retrieve a valid response from the configured model."
		_:
			return "I'm sorry, but I had trouble getting a response. Please check if your settings or local server are configured correctly!"
