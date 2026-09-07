extends GutTest
## Test suite for checking transparent borderless window properties.

var main_scene: Node2D

func before_each() -> void:
	# Load and instantiate the main scene to test its controller logic
	main_scene = load("res://scenes/Main.tscn").instantiate()
	add_child_autofree(main_scene)

func test_viewport_transparency() -> void:
	# Verify that the viewport transparent background flag is active
	var viewport := main_scene.get_viewport()
	assert_true(viewport.transparent_bg, "Viewport transparent_bg should be active.")

func test_window_flags() -> void:
	# Verify that the Window properties are correctly initialized by the controller
	var window := main_scene.get_window()
	
	# In headless mode, OS/Window flags are not supported by the dummy display server
	if DisplayServer.get_name() == "headless":
		pending("Skipping window state checks (borderless, transparent, always_on_top) because DisplayServer is headless.")
		assert_eq(window.size, Vector2i(200, 200), "Window size should still be initialized to 200x200 pixels.")
		return
		
	assert_true(window.transparent, "Window transparent flag should be set to true.")
	assert_true(window.borderless, "Window borderless flag should be set to true.")
	assert_true(window.always_on_top, "Window always_on_top flag should be set to true.")
	assert_eq(window.size, Vector2i(200, 200), "Window size should be initialized to 200x200 pixels.")


func test_greeting_mode_passthrough_and_follow() -> void:
	var window := main_scene.get_window()
	
	# Initial state
	assert_eq(main_scene._active_panel, 0, "Initial active panel should be NONE (0).")
	
	# Show greeting
	main_scene.show_startup_greeting("Test greeting text")
	assert_eq(main_scene._active_panel, 1, "Active panel should be CHAT (1) during greeting.")
	if DisplayServer.get_name() != "headless":
		assert_true(window.mouse_passthrough, "Greeting mode should enable mouse passthrough.")
	
	# Reset
	main_scene._reset_to_follow_mode()
	assert_eq(main_scene._active_panel, 0, "Active panel should revert to NONE (0).")
	if DisplayServer.get_name() != "headless":
		assert_false(window.mouse_passthrough, "Passthrough should be disabled on follow mode reset.")


func test_cursor_frozen_at_hotkey_press() -> void:
	# NAV-99: the crop anchor is the cursor position sampled the instant the hotkey fires,
	# not wherever the fairy ends up once follow mode stops.
	var mock_pos := Vector2i(400, 250)
	main_scene.get_cursor_position_func = func() -> Vector2i: return mock_pos

	await main_scene._on_hotkey_pressed()
	assert_eq(main_scene._frozen_cursor_pos, Vector2(mock_pos),
		"Frozen cursor position should be sampled from get_cursor_position_func on hotkey press.")

	# Moving the mouse after the fact must not retroactively change the frozen anchor.
	mock_pos = Vector2i(900, 900)
	assert_eq(main_scene._frozen_cursor_pos, Vector2(400, 250),
		"Frozen cursor position must not track later mouse movement.")

	main_scene._reset_to_follow_mode()


func test_crop_anchor_ignores_fairy_position() -> void:
	# The crop rectangle must be computed from the frozen cursor point alone — the fairy's
	# position is not consulted at all.
	main_scene._frozen_cursor_pos = Vector2(1000, 500)
	main_scene._fairy.position = Vector2(9999, 9999) # Far away; must have no effect.

	var img := Image.create(2000, 1000, false, Image.FORMAT_RGB8)
	var crop_rect := main_scene._compute_crop_rect(img, main_scene._frozen_cursor_pos, Vector2i.ZERO, Vector2i(2000, 1000), 600)

	# A 600px crop centered on (1000, 500) in a 2000x1000 image should sit at (700, 200).
	assert_eq(crop_rect, Rect2i(700, 200, 600, 600),
		"Crop rect should center on the frozen cursor point regardless of fairy position.")


func test_crop_rect_clamps_to_image_bounds() -> void:
	# Anchoring near an edge must clamp the crop into the image instead of going out of bounds.
	var img := Image.create(800, 600, false, Image.FORMAT_RGB8)
	var crop_rect := main_scene._compute_crop_rect(img, Vector2(10, 10), Vector2i.ZERO, Vector2i(800, 600), 600)

	assert_eq(crop_rect.position, Vector2i(0, 0), "Crop should clamp to the image origin near an edge.")
	assert_eq(crop_rect.size, Vector2i(600, 600), "Crop size should be unaffected by clamping.")
