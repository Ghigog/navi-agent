extends "res://scripts/skills/Skill.gd"

func get_name() -> String:
	return "take_screenshot"

func get_description() -> String:
	return "Captures a full screenshot of the user's desktop screen to provide visual context."

func get_schema() -> Dictionary:
	return {
		"name": "take_screenshot",
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

	if window_controller:
		var img: Image = await window_controller.capture_clean_screenshot()
		if img:
			# Keep Navi visible in the capture to maintain pointing context!
			# Maintain aspect ratio to prevent squishing text/layout, and limit max dimension to 768px.
			var max_dim := 768
			var w := img.get_width()
			var h := img.get_height()
			if w > 0 and h > 0:
				if w > h:
					h = int(float(h) * max_dim / w)
					w = max_dim
				else:
					w = int(float(w) * max_dim / h)
					h = max_dim
				img.resize(w, h, Image.INTERPOLATE_BILINEAR)
			context["base64_image"] = Marshalls.raw_to_base64(img.save_jpg_to_buffer())
			return "Success: captured screen image."
	return "Failure: window controller or capture failed."
