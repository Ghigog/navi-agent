extends "res://scripts/skills/Skill.gd"

func get_name() -> String:
	return "take_crop_screenshot"

func get_description() -> String:
	return "Captures a zoomed-in cropped screenshot centered around Navi's current position to analyze details next to her."

func get_schema() -> Dictionary:
	return {
		"name": "take_crop_screenshot",
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
		fairy.set_status_light(Color(1.0, 0.75, 0.0, 1.0), true) # Pulsing Amber

	if window_controller and window_controller.has_method("capture_crop_screenshot"):
		var img: Image = await window_controller.capture_crop_screenshot()
		if img:
			img.resize(512, 512, Image.INTERPOLATE_BILINEAR)
			context["base64_crop"] = Marshalls.raw_to_base64(img.save_jpg_to_buffer())
			return "Success: captured crop image centered around Navi."
	return "Failure: window controller or crop failed."
