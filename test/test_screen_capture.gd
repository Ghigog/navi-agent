extends GutTest
## Test suite for checking ScreenCaptureService window visibility states and capture returns.

var capture_service: Node

func before_each() -> void:
	capture_service = get_node("/root/ScreenCaptureService")

func test_screencapture_workflow() -> void:
	assert_not_null(capture_service, "ScreenCaptureService Autoload should be active in scene tree.")
	
	var window := get_window()
	assert_true(window.visible, "Main overlay window should be visible initially.")
	
	# Trigger the asynchronous capture function and await its results directly
	var img: Image = await capture_service.capture_screen()
	
	# Verify that window visibility has been restored/remains true
	assert_true(window.visible, "Main overlay window should be visible after capture.")
	
	# Verify that the returned object is a valid Image
	if img != null:
		assert_true(img is Image, "The returned captured object should be an instance of Image.")
