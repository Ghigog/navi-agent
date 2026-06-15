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
