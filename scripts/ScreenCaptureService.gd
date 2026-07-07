extends Node
## Service that captures screenshots of the user's desktop to provide visual context to the AI model.
## Uses the macOS command-line 'screencapture' tool as the primary path, and falls back to Godot's DisplayServer API.

const TEMP_FILENAME := "navi_capture.jpg"


## Captures the current screen and returns an Image, or null if the capture fails.
func capture_screen() -> Image:
	var img: Image = null
	var current_screen := DisplayServer.window_get_current_screen()

	# --- Primary path: Godot built-in DisplayServer (cross-platform, fast in-memory) ---
	if DisplayServer.get_name() != "headless":
		img = DisplayServer.screen_get_image(current_screen)
		if img and img.get_width() > 0:
			print("ScreenCaptureService: Captured via DisplayServer.screen_get_image().")
			return img

	# --- Fallback path: macOS native screencapture utility (if DisplayServer fails or is headless) ---
	if OS.get_name() == "macOS":
		var temp_path := OS.get_user_data_dir() + "/" + TEMP_FILENAME
		
		# Run the blocking screencapture command in a background thread to prevent UI freezing
		var thread := Thread.new()
		var callable := Callable(self, "_run_screencapture_background").bind(temp_path)
		var err := thread.start(callable)
		if err == OK:
			if is_inside_tree():
				while thread.is_alive():
					# Yield control to the main loop to keep the Godot process running,
					# preventing OS event queuing beachballs/freezes.
					await get_tree().process_frame
			else:
				while thread.is_alive():
					OS.delay_msec(5)
			
			var exit_code: int = thread.wait_to_finish()
			if exit_code == 0:
				if FileAccess.file_exists(temp_path):
					# Load the screenshot file and remove the temporary disk asset immediately
					img = Image.load_from_file(temp_path)
					DirAccess.remove_absolute(temp_path)
					print("ScreenCaptureService: Captured via macOS screencapture tool in background thread.")
				else:
					ErrorBus.report("ScreenCaptureService: screencapture finished but temp file not found.")
			else:
				ErrorBus.report("ScreenCaptureService: screencapture background thread failed (exit code " + str(exit_code) + ").")
		else:
			ErrorBus.report("ScreenCaptureService: Failed to start background thread for screencapture. Error: " + str(err))

	if img == null:
		ErrorBus.report("ScreenCaptureService: Both capture methods failed. Returning null.")
	return img


func _run_screencapture_background(temp_path: String) -> int:
	var output: Array = []
	# -C  captures the mouse cursor.
	# -x  silences the camera shutter sound.
	# -t  sets output format to jpg.
	var exit_code := OS.execute(
		"/usr/sbin/screencapture",
		["-C", "-x", "-t", "jpg", temp_path],
		output, true
	)
	return exit_code
