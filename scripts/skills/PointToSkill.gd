extends "res://scripts/skills/Skill.gd"

func get_name() -> String:
	return "point_to"

func get_description() -> String:
	return "Moves Navi's physical position on the user's screen to the specified normalized coordinate (x, y from 0 to 1000) and points at it. Only call this tool when the user explicitly asks you to point to, locate, navigate to, or highlight a specific element on screen, or when you are referencing a visual element you can see in a screenshot. Do not call this speculatively or for general positioning."

func get_schema() -> Dictionary:
	return {
		"name": "point_to",
		"description": get_description(),
		"parameters": {
			"type": "object",
			"properties": {
				"x": {
					"type": "number",
					"description": "The X screen coordinate normalized from 0 to 1000."
				},
				"y": {
					"type": "number",
					"description": "The Y screen coordinate normalized from 0 to 1000."
				}
			},
			"required": ["x", "y"]
		}
	}

func execute(context: Dictionary) -> String:
	var window_controller := _get_window_controller()
	if not window_controller:
		return "Failure: WindowController not found."

	var follow_ctrl = window_controller.get_node_or_null("FollowController")
	if not follow_ctrl:
		return "Failure: FollowController not found."

	var fairy: Node = null
	if window_controller and "_fairy" in window_controller:
		fairy = window_controller._fairy
	if fairy and fairy.has_method("set_status_light"):
		fairy.set_status_light(Color(0.2, 0.8, 0.2, 1.0), true) # Pulsing Green

	# 1. Native arguments (from function calling parameter dictionaries)
	var args_dict = context.get("args", {})
	if args_dict is Dictionary and args_dict.has("x") and args_dict.has("y"):
		var x := float(args_dict["x"])
		var y := float(args_dict["y"])
		var screen_point := NaviUtils.map_normalized_coordinate_to_screen(Vector2(x, y))
		print("PointToSkill: [MOVEMENT] Flying to screen coordinate: ", screen_point)
		follow_ctrl.call("fly_to_screen_coordinate", screen_point)
		return "Success: flying to screen coordinate " + str(screen_point)

	# 2. Legacy string args (from Stage 0 deterministic matching or tag parser)
	var raw_args: String = context.get("skill_args", "").strip_edges()
	if raw_args == "":
		return "Failure: no coordinates provided for point_to skill."

	var coordinate_pairs := raw_args.split(";")
	var points: Array[Vector2] = []
	for pair in coordinate_pairs:
		var trimmed := pair.strip_edges()
		if trimmed == "":
			continue
		var coords := trimmed.split(",")
		if coords.size() >= 2:
			var x := float(coords[0].strip_edges())
			var y := float(coords[1].strip_edges())
			points.append(NaviUtils.map_normalized_coordinate_to_screen(Vector2(x, y)))

	if points.is_empty():
		return "Failure: could not parse coordinates from '" + raw_args + "'."

	if points.size() == 1:
		print("PointToSkill: [MOVEMENT] Flying to screen coordinate: ", points[0])
		follow_ctrl.call("fly_to_screen_coordinate", points[0])
		return "Success: flying to screen coordinate " + str(points[0])
	else:
		print("PointToSkill: [MOVEMENT] Navigating sequence of points: ", points)
		follow_ctrl.call("navigate_sequence", points)
		return "Success: navigating sequence of points: " + str(points)
