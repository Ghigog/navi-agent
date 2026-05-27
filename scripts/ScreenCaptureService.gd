extends Node
## Service that captures screenshots of the user's desktop to provide visual context to the AI model.
## Uses the macOS command-line 'screencapture' tool as the primary path, and falls back to Godot's DisplayServer API.

const TEMP_FILENAME := "navi_capture.png"


## Captures the current screen and returns an Image, or null if the capture fails.
func capture_screen() -> Image:
	var img: Image = null
	var current_screen := DisplayServer.window_get_current_screen()

	# --- Primary path: macOS native screencapture utility ---
	# -x  silences the camera shutter sound.
	# -t  sets output format to png.
	if OS.get_name() == "macOS":
		var temp_path := OS.get_user_data_dir() + "/" + TEMP_FILENAME
		var output: Array = []
		var exit_code := OS.execute(
			"/usr/sbin/screencapture",
			["-x", "-t", "png", temp_path],
			output, true
		)
		if exit_code == 0:
			# Load the screenshot file and remove the temporary disk asset immediately
			img = Image.load_from_file(temp_path)
			DirAccess.remove_absolute(temp_path)
			print("ScreenCaptureService: Captured via macOS screencapture tool.")
		else:
			printerr("ScreenCaptureService: screencapture failed (exit ", exit_code, "). Output: ", output)

	# --- Fallback path: Godot built-in DisplayServer (cross-platform / headful only) ---
	if img == null or img.get_width() == 0:
		if DisplayServer.get_name() != "headless":
			img = DisplayServer.screen_get_image(current_screen)
			if img and img.get_width() > 0:
				print("ScreenCaptureService: Captured via DisplayServer.screen_get_image().")
			else:
				printerr("ScreenCaptureService: Both capture methods failed. Returning null.")
				img = null

	return img
