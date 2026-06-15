extends RefCounted
class_name Skill

## Returns the unique name of the skill.
func get_name() -> String:
	return ""

## Returns a brief description of the skill for the LLM.
func get_description() -> String:
	return ""

## Returns the tool schema definition in standard JSON Schema format.
func get_schema() -> Dictionary:
	return {}

## Executes the skill with the provided context dictionary.
func execute(context: Dictionary) -> String:
	return ""

## Helper to retrieve the active WindowController or Main node.
func _get_window_controller() -> Node:
	var tree := Engine.get_main_loop() as SceneTree
	if tree:
		for child in tree.root.get_children():
			if child.name == "Main" or child.has_method("capture_clean_screenshot"):
				return child
	return null
