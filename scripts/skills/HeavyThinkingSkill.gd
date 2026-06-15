extends "res://scripts/skills/Skill.gd"

func get_name() -> String:
	return "heavy_thinking"

func get_description() -> String:
	return "Activates complex reasoning mode to think through a difficult programming, mathematical, or logic problem."

func get_schema() -> Dictionary:
	return {
		"name": "heavy_thinking",
		"description": get_description(),
		"parameters": {
			"type": "object",
			"properties": {},
			"required": []
		}
	}

func execute(context: Dictionary) -> String:
	var window_controller := _get_window_controller()
	var fairy: Node = null
	if window_controller and "_fairy" in window_controller:
		fairy = window_controller._fairy
	if fairy and fairy.has_method("set_status_light"):
		fairy.set_status_light(Color(0.6, 0.2, 1.0, 1.0), true) # Pulsing Purple

	return "Success: heavy thinking executed."
