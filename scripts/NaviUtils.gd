extends Node
## Global utility singleton providing shared string formatting, coordinate translations, and tag stripping.

## Maps coordinates in a normalized 0 to 1000 space back to physical logical screen coordinates.
static func map_normalized_coordinate_to_screen(normalized_pos: Vector2) -> Vector2:
	var screen := DisplayServer.window_get_current_screen()
	var screen_pos := DisplayServer.screen_get_position(screen)
	var screen_size := DisplayServer.screen_get_size(screen)
	var scale := DisplayServer.screen_get_scale(screen)
	if scale <= 0.0:
		scale = 1.0
	if screen_size.x <= 0 or screen_size.y <= 0:
		screen_pos = Vector2i.ZERO
		screen_size = Vector2i(1920, 1080)
		scale = 1.0
	var logical_screen_size := Vector2(screen_size) / scale
	return Vector2(
		screen_pos.x + (normalized_pos.x / 1000.0) * logical_screen_size.x,
		screen_pos.y + (normalized_pos.y / 1000.0) * logical_screen_size.y
	)



## Cleanly strips <think>...</think> blocks from response strings.
static func strip_thinking_block(text: String) -> String:
	var clean := text
	while clean.contains("<think>") and clean.contains("</think>"):
		var start := clean.find("<think>")
		var end := clean.find("</think>")
		clean = clean.substr(0, start) + clean.substr(end + 8)

	if clean.contains("<think>"):
		clean = clean.substr(0, clean.find("<think>"))
	return clean


## Cleanly strips <scratchpad>...</scratchpad> blocks from response strings.
static func strip_scratchpad_block(text: String) -> String:
	var clean := text
	while clean.contains("<scratchpad>") and clean.contains("</scratchpad>"):
		var start := clean.find("<scratchpad>")
		var end := clean.find("</scratchpad>")
		clean = clean.substr(0, start) + clean.substr(end + 13)

	if clean.contains("<scratchpad>"):
		clean = clean.substr(0, clean.find("<scratchpad>"))
	return clean


## Strips skill tags, pause tags, continue tags, scratchpad, and thinking blocks from text for presentation or speech synthesis.
static func strip_skill_and_pause_tags(input_text: String) -> String:
	var no_think := strip_thinking_block(input_text)
	var no_scratch := strip_scratchpad_block(no_think)
	var tag_regex := RegEx.new()
	tag_regex.compile("\\[PAUSE\\]|\\[CONTINUE\\]|\\[(SKILL|SCREEN_CONTEXT|TOOL):[^\\]]*\\]")
	var cleaned := tag_regex.sub(no_scratch, "", true)
	
	# Fallback: if the cleaned text is empty, but there was a scratchpad block,
	# use the scratchpad content as a fallback so the user doesn't get a silent blank response.
	if cleaned.strip_edges() == "" and input_text.contains("<scratchpad>"):
		var start_idx := input_text.find("<scratchpad>")
		var end_idx := input_text.find("</scratchpad>", start_idx)
		var scratch_content := ""
		if end_idx != -1:
			scratch_content = input_text.substr(start_idx + 12, end_idx - start_idx - 12)
		else:
			scratch_content = input_text.substr(start_idx + 12)
		var clean_scratch = tag_regex.sub(strip_thinking_block(scratch_content), "", true)
		if clean_scratch.strip_edges() != "":
			return clean_scratch.strip_edges()

	return cleaned.strip_edges()



## Converts markdown bold segments (*text* and **text**) to BBCode [b]text[/b] format.
static func markdown_to_bbcode(input_text: String) -> String:
	var result := input_text
	
	# Convert double asterisks **bold** to [b]bold[/b]
	var db_regex := RegEx.new()
	db_regex.compile("\\*\\*(.*?)\\*\\*")
	if db_regex.is_valid():
		result = db_regex.sub(result, "[b]$1[/b]", true)
		
	# Convert single asterisks *bold* to [b]bold[/b]
	var sb_regex := RegEx.new()
	sb_regex.compile("\\*(.*?)\\*")
	if sb_regex.is_valid():
		result = sb_regex.sub(result, "[b]$1[/b]", true)
		
	return result


# ---------------------------------------------------------------------------
# Credential redaction (NAV-81)
# ---------------------------------------------------------------------------
#
# A real OpenAI key reached `test_run.log` because SettingsManager print()-ed the whole
# settings dictionary on load. Nothing about that call site looked dangerous — the danger
# was that a secret and a window size were being handled identically.
#
# The rule is deliberately blunt: any setting whose *name* contains key, token, secret,
# password or credential is masked, with no exceptions list. Exceptions are how this class
# of leak comes back. `hotkey_keycode` and friends get masked too; that is the intended
# trade, and the cost is a debug line that is less specific about a keycode.
#
# _VALUE_SECRET_PATTERN is the backstop for the other direction: a credential parked under
# an innocuous name still gets masked because the value itself looks like one.

## Setting names matching this are masked regardless of their value.
const _SECRET_NAME_PATTERN := "(?i)(key|token|secret|password|credential)"

## Values matching this are masked regardless of their name — provider key prefixes and
## bearer-ish opaque strings.
const _VALUE_SECRET_PATTERN := "^(sk-|pk-|rk-|xox[abprs]-|ghp_|gho_|github_pat_|AIza|Bearer\\s)"


## Returns [param data] with every credential-bearing value replaced by a length-only
## placeholder, recursing through nested dictionaries and arrays. Empty strings survive
## intact so a log line can still distinguish "not configured" from "configured".
##
## Use this on anything derived from settings before it reaches [method print], a log file,
## a crash report or a bug-report attachment. Never log a settings dictionary directly.
static func redact_secrets(data: Variant) -> Variant:
	if data is Dictionary:
		var out: Dictionary = {}
		for k in (data as Dictionary).keys():
			var value: Variant = (data as Dictionary)[k]
			if _is_secret_name(str(k)):
				out[k] = _mask(value)
			else:
				out[k] = redact_secrets(value)
		return out

	if data is Array:
		var arr: Array = []
		for item in (data as Array):
			arr.append(redact_secrets(item))
		return arr

	if data is String and _looks_like_secret_value(data as String):
		return _mask(data)

	return data


## True when a setting name indicates the value is a credential.
static func _is_secret_name(name: String) -> bool:
	var re := RegEx.new()
	re.compile(_SECRET_NAME_PATTERN)
	return re.search(name) != null


## True when a value looks like a credential irrespective of the name it is stored under.
static func _looks_like_secret_value(value: String) -> bool:
	var re := RegEx.new()
	re.compile(_VALUE_SECRET_PATTERN)
	return re.search(value) != null


## Replaces a secret with a placeholder that reveals its length and nothing else. An empty
## string stays empty — "no key set" is useful to see and gives nothing away.
static func _mask(value: Variant) -> Variant:
	if value is String:
		if (value as String).is_empty():
			return ""
		return "<redacted:%d chars>" % (value as String).length()
	if value is Dictionary or value is Array:
		return "<redacted>"
	return value
