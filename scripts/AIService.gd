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
var _is_response_streaming := false

# Active conversation history in the current session
var _conversation_history: Array[Dictionary] = []
# Cache of the previous conversation summary
var _cached_summary: String = ""

# The plug-and-play skills registry mapping skill tags to Callable execution handlers.
var _skills_registry: Dictionary = {}
# Pre-compiled regex for Gemini SSE chunk text extraction (avoid per-chunk allocation)
var _gemini_text_regex := RegEx.new()

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
			"here"
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
	# Pre-compile Gemini chunk regex once at startup
	_gemini_text_regex.compile("\"text\"\\s*:\\s*\"([^\"]*)\"")

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
		"heavy_thinking": _execute_heavy_thinking,
		"summarize_session": _execute_summarize_session
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




## Formulates and dispatches a request using three-stage routing:
## 1. Deterministic: classifies the prompt via PROMPT_SKILL_RULES — zero LLM cost.
## 2. Tier 1 (LLM fallback): fast model with minimal prompt + [ESCALATE] safety net.
## 3. Tier 2: heavy model with full skills-aware prompt (only if escalated).
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
	var enable_screenshots: bool = _settings_mgr.get_setting("enable_screenshots", true)

	print("AIService: ── REQUEST START ──────────────────────────────────")
	print("AIService:   Provider   : ", provider)
	print("AIService:   Fast model : ", fast_model)
	print("AIService:   Heavy model: ", heavy_model, " (thinking enabled: ", enable_thinking, ")")
	print("AIService:   Prompt     : \"", prompt.left(80), ("…" if prompt.length() > 80 else ""), "\"")
	print("AIService: ─────────────────────────────────────────────────────")

	if fast_model == "" or (enable_thinking and heavy_model == ""):
		print("AIService ERROR: Configuration validation failed. One or more configured models is missing.")
		request_failed.emit("My model configuration is not set yet! Please right-click me to open settings and select your models. 😊")
		return

	request_started.emit()

	# Build identity — personality voice + honesty rules + recall memory (if any)
	var identity := "You are Navi, the desktop assistant."
	if personality != "":
		identity = "You are Navi, a " + personality + " desktop assistant."
	identity += "\n\nCRITICAL: Be extremely honest and realistic. If you do not know something, are unsure, do not see the screen clearly, or if you lack sufficient information, DO NOT make up facts, apps, or passwords. Instead, ask the user for clarification or state your limitations. Trust current screen captures over any previous conversation history."

	# Inject previous session recall directly into identity so even small models see it
	# at the highest-priority position in the system prompt.
	if _cached_summary != "":
		print("AIService:   Recall     : Previous session summary injected (", _cached_summary.length(), " chars).")
		identity += "\n\nPREVIOUS SESSION MEMORY — READ THIS FIRST:\nYou have a summary of what happened last time with this user. If the user asks what you discussed last time, what they asked previously, or references the previous session, use this summary to answer directly and confidently:\n" + _cached_summary
	else:
		print("AIService:   Recall     : No previous session summary.")

	var context := {
		"prompt": prompt,
		"base64_image": "",
		"base64_crop": "",
		"personality": personality,
		"system_prompt": system_prompt_user,
		"fairy_pos": fairy_pos,
		"window_size": window_size
	}

	# ── STAGE 0: Deterministic Prompt Classification ──────────────────────────
	# Checks the prompt against PROMPT_SKILL_RULES before any LLM call.
	# A pattern match forces the mapped skill directly — no model needed to decide.
	var classification := _classify_prompt(prompt)
	if not classification.is_empty():
		var forced_skill: String = classification["skill"]
		print("AIService: [ROUTER] 🎯 Classified as '", classification["label"],
			"' — matched pattern: '", classification["matched"],
			"' → forcing skill: '", forced_skill, "' (no LLM routing needed)")

		# Check settings gates before committing
		if (forced_skill == "take_screenshot" or forced_skill == "take_crop_screenshot") and not enable_screenshots:
			print("AIService: [ROUTER] Skill '", forced_skill, "' SKIPPED — screenshots are disabled. Falling back to fast model.")
		elif forced_skill == "heavy_thinking" and not enable_thinking:
			print("AIService: [ROUTER] Skill '", forced_skill, "' SKIPPED — deep thinking is disabled. Falling back to fast model.")
		else:
			thinking_update.emit(classification["status"])
			print("AIService: [STAGE 3] → Invoking '", forced_skill, "' directly...")
			var outcome: String = await _skills_registry[forced_skill].call(context) as String
			print("AIService: [STAGE 3] ← '", forced_skill, "' finished. Outcome: ", outcome)

			# Escalates to heavy model if it's heavy_thinking or contains screen image data
			var is_heavy: bool = forced_skill == "heavy_thinking" or context.get("base64_image", "") != "" or context.get("base64_crop", "") != ""
			await _deliver_final_response(prompt, context, is_heavy, identity, system_prompt_user, fast_model, heavy_model)
			_cleanup_request()
			return

	# ── TIER 1: Fast Model — Minimal Prompt ──────────────────────────────────
	# Reached only when no pattern matched. The fast model gets just identity +
	# user instructions + a single [ESCALATE] escape for edge-case self-detection.
	var fast_system_prompt := identity
	if system_prompt_user != "":
		fast_system_prompt += "\n" + system_prompt_user
	fast_system_prompt += "\n\nKeep answers short and conversational. If you cannot answer confidently without seeing the screen or doing deep reasoning, respond with only: [ESCALATE]"

	print("AIService: [TIER 1] No pattern match — starting fast model pass.")
	print("AIService: [TIER 1] System prompt length: ", fast_system_prompt.length(), " chars (minimal — no skill definitions).")

	var fast_reply := await _request_llm_stream(prompt, fast_system_prompt, false, "", "", 0.7, _conversation_history)

	if fast_reply == "":
		print("AIService ERROR: [TIER 1] Fast model returned an empty reply.")
		request_failed.emit("Model failed to respond.")
		return

	print("AIService: [TIER 1] Fast model stream complete. Raw reply length: ", fast_reply.length(), " chars.")

	var needs_escalation := fast_reply.strip_edges() == "[ESCALATE]" or fast_reply.contains("[ESCALATE]")

	# ── VISUAL REFUSAL SELF-CORRECTION ────────────────────────────────────────
	# Detect when the fast model wrongly said "I can't see / I'm a language model"
	# instead of escalating. Suppress the reply, emit a personality retraction,
	# then force the screenshot skill so the model gets to actually try.
	if not needs_escalation:
		var reply_lower := fast_reply.to_lower()
		var is_refusal := false
		for pattern in _VISUAL_REFUSAL_PATTERNS:
			if reply_lower.contains(pattern):
				is_refusal = true
				break
		if is_refusal:
			var retraction := _get_retraction_message(personality)
			print("AIService: [SELF-CORRECT] Visual refusal detected in fast reply — forcing screenshot skill. Retraction: '", retraction, "'")
			thinking_update.emit(retraction)
			var outcome: String = await _skills_registry["take_screenshot"].call(context) as String
			print("AIService: [SELF-CORRECT] ← Screenshot taken. Outcome: ", outcome)
			await _deliver_final_response(prompt, context, true, identity, system_prompt_user, fast_model, heavy_model)
			_cleanup_request()
			return

	if not needs_escalation:
		print("AIService: [TIER 1] ✅ No escalation needed. Direct conversational reply delivered.")
		_append_to_history(prompt, "", "", fast_reply)
		response_received.emit("")
		_cleanup_request()
		return

	print("AIService: [TIER 1] ⬆️  Fast model signalled [ESCALATE]. Handing off to heavy model...")
	thinking_update.emit("Let me think about that more carefully...")

	# ── TIER 2: Heavy Model — Full Skills Prompt ──────────────────────────────
	# Reached only when the fast model self-escalated. The heavy model gets the
	# complete skill definitions and can select + invoke the right tool.
	var heavy_system_prompt := identity
	if system_prompt_user != "":
		heavy_system_prompt += "\n" + system_prompt_user
	heavy_system_prompt += """

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

	print("AIService: [TIER 2] Starting heavy model pass. Model: ", heavy_model)
	print("AIService: [TIER 2] System prompt length: ", heavy_system_prompt.length(), " chars (full skill definitions included).")

	var heavy_reply := await _request_llm_stream(prompt, heavy_system_prompt, true, "", "", 0.7, _conversation_history)

	if heavy_reply == "":
		print("AIService ERROR: [TIER 2] Heavy model returned an empty reply.")
		request_failed.emit("Model failed to respond.")
		return

	print("AIService: [TIER 2] Heavy model stream complete. Raw reply length: ", heavy_reply.length(), " chars. Checking for skill tags...")

	# ── STAGE 2: Skill Validation & Settings Filtering ────────────────────────
	var skill_tag := _extract_skill_tag(heavy_reply)
	if skill_tag == "":
		print("AIService: [TIER 2] No skill tags found. Heavy model answered directly — done.")
		_append_to_history(prompt, "", "", heavy_reply)
		response_received.emit("")
		_cleanup_request()
		return

	print("AIService: [STAGE 2] Skill tag detected: '", skill_tag, "'. Validating against registry and settings...")
	var verified_skills: Array[String] = []

	if skill_tag in _skills_registry:
		if (skill_tag == "take_screenshot" or skill_tag == "take_crop_screenshot") and not enable_screenshots:
			print("AIService: [STAGE 2] Skill '" + skill_tag + "' SKIPPED — screenshots are disabled in settings.")
		elif skill_tag == "heavy_thinking" and not enable_thinking:
			print("AIService: [STAGE 2] Skill '" + skill_tag + "' SKIPPED — deep thinking is disabled in settings.")
		else:
			verified_skills.append(skill_tag)
			print("AIService: [STAGE 2] Skill '" + skill_tag + "' ✅ verified and queued for execution.")
	else:
		print("AIService: [STAGE 2] Skill '" + skill_tag + "' ❌ not found in registry — ignoring (hallucinated tag).")

	if verified_skills.size() == 0:
		print("AIService: [STAGE 2] All detected skills were filtered or disabled. Finalising.")
		response_received.emit("")
		_cleanup_request()
		return

	# ── STAGE 3: Skill Execution ──────────────────────────────────────────────
	print("AIService: [STAGE 3] Executing ", verified_skills.size(), " skill(s) sequentially...")
	var has_heavy_thinking := false
	for skill in verified_skills:
		if skill == "heavy_thinking":
			has_heavy_thinking = true
		print("AIService: [STAGE 3] → Invoking '", skill, "'...")
		var outcome: String = await _skills_registry[skill].call(context) as String
		print("AIService: [STAGE 3] ← '", skill, "' finished. Outcome: ", outcome)

	# Promote to heavy reasoning if screenshot image context was retrieved
	if context.get("base64_image", "") != "" or context.get("base64_crop", "") != "":
		has_heavy_thinking = true

	# ── STAGE 4: Final Response Delivery ──────────────────────────────────────
	await _deliver_final_response(prompt, context, has_heavy_thinking, identity, system_prompt_user, fast_model, heavy_model)
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
## Uses the heavy thinking model (with <think> blocks) when has_heavy_thinking is true,
## otherwise streams from the fast model with any captured image context.
func _deliver_final_response(
	prompt: String,
	context: Dictionary,
	has_heavy_thinking: bool,
	identity: String,
	system_prompt_user: String,
	fast_model: String,
	heavy_model: String
) -> void:
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

	if has_heavy_thinking:
		# Update status light to Purple for heavy model execution
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
"""
		print("AIService: [STAGE 4] Streaming final response from heavy thinking model: ", heavy_model)
		_is_response_streaming = false
		var final_heavy_reply := await _request_llm_stream(
			prompt,
			thinking_system_prompt,
			true,
			context.get("base64_image", ""),
			context.get("base64_crop", ""),
			0.7,
			_conversation_history
		)
		_is_response_streaming = false
		if final_heavy_reply == "":
			print("AIService ERROR: [STAGE 4] Heavy thinking model returned empty reply.")
			request_failed.emit("Heavy thinking model failed.")
		else:
			print("AIService: [STAGE 4] ✅ Heavy thinking complete. Reply length: ", final_heavy_reply.length(), " chars.")
			_append_to_history(prompt, context.get("base64_image", ""), context.get("base64_crop", ""), final_heavy_reply)
			response_received.emit("")
	else:
		var analysis_system_prompt := identity
		if system_prompt_user != "":
			analysis_system_prompt += "\n\n" + system_prompt_user
		analysis_system_prompt += vision_guideline
		print("AIService: [STAGE 4] Streaming final visual analysis from fast model: ", fast_model)
		_is_response_streaming = false
		var final_fast_reply := await _request_llm_stream(
			prompt,
			analysis_system_prompt,
			false,
			context.get("base64_image", ""),
			context.get("base64_crop", ""),
			0.7,
			_conversation_history
		)
		_is_response_streaming = false
		if final_fast_reply == "":
			print("AIService ERROR: [STAGE 4] Analysis model returned empty reply.")
			request_failed.emit("Analysis model failed.")
		else:
			print("AIService: [STAGE 4] ✅ Visual analysis complete. Reply length: ", final_fast_reply.length(), " chars.")
			_append_to_history(prompt, context.get("base64_image", ""), context.get("base64_crop", ""), final_fast_reply)
			response_received.emit("")


## Clears the fairy status light and prints the request end banner.
func _cleanup_request() -> void:
	print("AIService: ── REQUEST END ────────────────────────────────────────")
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

	return "Success: heavy thinking executed."


# ---------------------------------------------------------------------------
# Asynchronous Isolated HTTP Client Requests (Non-Streaming Fallback)
# ---------------------------------------------------------------------------

func _request_llm(prompt: String, system_prompt: String, is_thinking_model: bool = false, base64_image: String = "", base64_crop: String = "", temperature: float = 0.7, history: Array[Dictionary] = []) -> String:
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

		var contents := []
		var is_first_user_msg := true

		for msg in history:
			var msg_role: String = msg.get("role", "user")
			var msg_text: String = msg.get("text", "")
			var msg_img: String = msg.get("image", "")
			var msg_crp: String = msg.get("crop", "")

			var parts := []
			if msg_role == "user":
				if is_first_user_msg and system_prompt != "":
					parts.append({"text": "SYSTEM INSTRUCTIONS:\n" + system_prompt + "\n\nUSER PROMPT:\n" + msg_text})
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
		if is_first_user_msg and system_prompt != "":
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

		contents.append({
			"role": "user",
			"parts": cloud_parts
		})

		payload = {
			"contents": contents
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

func _request_llm_stream(prompt: String, system_prompt: String, is_thinking_model: bool = false, base64_image: String = "", base64_crop: String = "", temperature: float = 0.7, history: Array[Dictionary] = []) -> String:
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
		client.poll()
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

		var contents := []
		var is_first_user_msg := true

		for msg in history:
			var msg_role: String = msg.get("role", "user")
			var msg_text: String = msg.get("text", "")
			var msg_img: String = msg.get("image", "")
			var msg_crp: String = msg.get("crop", "")

			var parts := []
			if msg_role == "user":
				if is_first_user_msg and system_prompt != "":
					parts.append({"text": "SYSTEM INSTRUCTIONS:\n" + system_prompt + "\n\nUSER PROMPT:\n" + msg_text})
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
		if is_first_user_msg and system_prompt != "":
			cloud_parts.append({"text": "SYSTEM INSTRUCTIONS:\n" + system_prompt + "\n\nUSER PROMPT:\n" + prompt})
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

		payload = {
			"contents": contents
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
	var is_buffering_tag := false
	var tag_buffer := ""
	var is_thinking := false
	var think_buffer := ""
	var tag_boundary_buffer := "" # Accumulates split indicators like '<', '[', etc. across chunks
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
				if is_stream_finished:
					break
			else:
				# Gemini stream parsing (regex compiled once outside loop)
				var matches := _gemini_text_regex.search_all(text)
				for m in matches:
					var word: String = m.get_string(1).replace("\\n", "\n").replace("\\\"", "\"")
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

		await get_tree().process_frame

	client.close()
	print("AIService: HTTP connection closed. Full text length: ", full_text.length())
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

		# 1. Handle Active Thinking Block Buffering
		# Characters inside <think>...</think> are emitted as live status updates (one per line)
		# so the user can see what the model is reasoning about in real time.
		#
		# TODO (future): apply a lightweight client-side personality transform here instead of
		# raw model output — e.g. strip bullet markers and reformat each line as a short
		# first-person Navi status message ("I'm checking line 12...") using a simple
		# string template based on the configured personality, with zero extra LLM calls.
		if new_thinking:
			new_think_buffer += char
			if new_think_buffer.ends_with("</think>"):
				new_thinking = false
				# Emit any remaining partial thought that wasn't newline-terminated
				var remaining := new_think_buffer.substr(0, new_think_buffer.length() - 8).strip_edges()
				if remaining.begins_with("-"):
					remaining = remaining.substr(1).strip_edges()
				if remaining != "":
					pending_think_lines.append(_apply_personality_voice(remaining, personality))
				new_think_buffer = ""
				print("AIService: [THINK BLOCK ENDED]")
			elif char == "\n":
				# Emit the completed thought line in real time
				var line := new_think_buffer.strip_edges()
				if line.begins_with("-"):
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
				new_buffer_text = ""
			i += 1
			continue

		# 3. Handle Indicator Boundary Matching (not currently in a tag/think block)
		if char == "<" or char == "[":
			new_boundary = char
			i += 1
			continue

		if new_boundary != "":
			new_boundary += char

			# Check if we matched the full opening of a tag
			if new_boundary == "<think>":
				new_thinking = true
				new_think_buffer = ""
				new_boundary = ""
				print("AIService: [THINK BLOCK STARTED]")
				i += 1
				continue
			elif new_boundary.begins_with("["):
				# Skill tags can contain arbitrary characters, switch to general buffering
				new_buffering = true
				new_buffer_text = new_boundary
				new_boundary = ""
				i += 1
				continue

			# Check if the boundary is still a partial match for "<think>"
			if "<think>".begins_with(new_boundary):
				# Keep accumulating characters in next loops
				i += 1
				continue
			else:
				# It was a false indicator (e.g. "<something else"). Spill the buffered boundary to output.
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


## Maps common reasoning patterns to first-person Navi-voice status messages
## based on the configured personality. Zero extra LLM calls.
func _apply_personality_voice(line: String, personality: String) -> String:

	if line.length() < 4:
		return line
	var lower := line.to_lower()
	var p := personality.to_lower()

	# Each row: [match_pattern, friendly, annoying, snarky, professional]
	# Rules evaluated top-to-bottom — more specific patterns first.
	var patterns: Array = [
		["user is asking",   "Got your question!",           "Oh great, you're asking me something.",    "So you have a question. Cool.",         "Request received."],
		["user wants",       "On it!",                       "You WANT something. Shocker.",              "Another request, naturally.",           "Acknowledged."],
		["need to identify", "Let me figure this out...",    "Fine, I'll identify it.",                  "I suppose I have to identify this.",    "Identifying..."],
		["need to describe", "Let me describe this...",      "Ugh, description time.",                   "Fine, I'll describe it.",               "Describing..."],
		["must focus",       "Zeroing in...",                "I GUESS I have to focus here.",             "Oh, focusing. Great.",                  "Directing analysis..."],
		["focus on",         "Focusing in...",               "Fine, focusing on it.",                    "Alright, focusing.",                    "Focusing..."],
		["strongly suggest", "I think I know!",              "It's probably what you'd expect.",          "Pretty obvious actually.",              "High-confidence identification."],
		["looks like",       "I think I see it!",            "Probably something boring.",                "Yep, it's a thing.",                    "Pattern matched."],
		["title bar",        "Reading the title bar...",     "Staring at the title bar. Fascinating.",   "Oh, a title bar. Very exciting.",       "Parsing title bar..."],
		["will state",       "Almost ready!",                "Okay FINE, here we go...",                 "Alright, let's get this over with.",    "Finalizing..."],
		["will describe",    "Ready to answer!",             "OKAY here it comes...",                    "Getting there.",                        "Compiling output..."],
		["screenshot",       "Reading your screen...",       "Staring at your screen. As instructed.",   "Oh wow, a screenshot.",                 "Processing capture..."],
		["visible",          "I can see something...",       "Oh, things exist on screen. Amazing.",      "Yep, I see stuff.",                     "Analyzing visible content..."],
		["content",          "Checking this out...",         "There's content here. Fascinating.",        "More content to wade through.",         "Content analysis..."],
	]

	for row in patterns:
		if lower.contains(row[0]):
			match p:
				"friendly":     return row[1]
				"annoying":     return row[2]
				"snarky":       return row[3]
				"professional": return row[4]
				_:              return row[1]

	return line


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
	var clean := text

	# Strip <think>...</think> blocks
	var think_regex := RegEx.new()
	think_regex.compile("(?s)<think>.*?</think>")
	clean = think_regex.sub(clean, "", true)

	# Strip [SKILL: ...] or other tool tags
	var skill_regex := RegEx.new()
	skill_regex.compile("\\[(SKILL|SCREEN_CONTEXT|TOOL):\\s*(.*?)\\]")
	clean = skill_regex.sub(clean, "", true)

	return clean.strip_edges()


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
	print("AIService: Conversation history cleared.")


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
		"history": _conversation_history.duplicate(true)
	}
	clear_history()

	if _skills_registry.has("summarize_session"):
		print("AIService: Triggering background summarization skill...")
		_skills_registry["summarize_session"].call_deferred(context)
	else:
		print("AIService WARNING: summarize_session skill is not registered.")


func _execute_summarize_session(context: Dictionary) -> String:
	var history: Array = context.get("history", [])
	if history.is_empty():
		return "Failure: empty history."

	var history_text := ""
	for msg in history:
		var role: String = "User" if msg.get("role", "user") == "user" else "Navi"
		var text: String = msg.get("text", "")
		history_text += "%s: %s\n" % [role, text]

	var prompt := "Review the following conversation history. Summarize the initial problem and the solution in a concise format (e.g., 'Problem: [summary]\nSolution: [summary]'). Keep it brief.\n\nConversation:\n" + history_text

	# Prompt the fast model to do the summary
	var system_prompt := "You are a summarizing utility. Keep your response extremely concise."

	print("AIService: [SUMMARIZE SESSION] Requesting session summary...")
	var summary := await _request_llm(prompt, system_prompt, false, "", "", 0.2)

	if summary != "":
		_cached_summary = summary.strip_edges()
		print("AIService: [SUMMARIZE SESSION] Saved summary to temporary cache:\n", _cached_summary)
		return "Success: session summarized."
	else:
		print("AIService ERROR: [SUMMARIZE SESSION] Summary request returned empty response.")
		return "Failure: summary generation failed."
