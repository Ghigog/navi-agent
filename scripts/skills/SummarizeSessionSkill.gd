extends "res://scripts/skills/Skill.gd"

func get_name() -> String:
	return "summarize_session"

func get_description() -> String:
	return "Summarizes the conversation history, outlining the initial problem and final solution."

func get_schema() -> Dictionary:
	return {
		"name": "summarize_session",
		"description": get_description(),
		"parameters": {
			"type": "object",
			"properties": {},
			"required": []
		}
	}

func execute(context: Dictionary) -> String:
	var ai_service: Node = context.get("ai_service")
	if not ai_service:
		return "Failure: AIService reference not found in context."

	var history: Array = context.get("history", [])
	if history.is_empty():
		return "Failure: empty history."

	var history_text := ""
	for msg in history:
		var role: String = "User" if msg.get("role", "user") == "user" else "Navi"
		var text: String = msg.get("text", "")
		history_text += "%s: %s\n" % [role, text]

	var prompt := "Review the following conversation history. Summarize the initial problem and the solution in a concise format (e.g., 'Problem: [summary]\nSolution: [summary]'). Keep it brief.\n\nConversation:\n" + history_text

	var system_prompt := "You are a summarizing utility. Keep your response extremely concise."

	print("SummarizeSessionSkill: [SUMMARIZE SESSION] Requesting session summary...")
	# Call the private request method on AIService
	var summary := await ai_service.call("_request_llm", prompt, system_prompt, false, "", "", 0.2) as String

	if summary != "":
		ai_service.set("_cached_summary", summary.strip_edges())
		print("SummarizeSessionSkill: [SUMMARIZE SESSION] Saved summary to temporary cache:\n", summary.strip_edges())
		return "Success: session summarized."
	else:
		print("SummarizeSessionSkill ERROR: [SUMMARIZE SESSION] Summary request returned empty response.")
		return "Failure: summary generation failed."
