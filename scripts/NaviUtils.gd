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
