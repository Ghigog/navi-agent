# Navi Project Tickets

This document contains structured agile tickets for the development of Navi in Godot 4. Each ticket outlines the requirements and specific acceptance criteria that serve as the basis for GUT unit tests.

---

## Ticket Template

```markdown
### NAV-XX: [Ticket Title] ([Status])
**User Story:**
- **As a:** [Role]
- **I want:** [Goal]
- **So that:** [Reason/Value]

**Context:**
[Background details or architectural constraints]

**Description:**
[What features need to be built]

**Requirements:**
[How to implement the features technically in Godot 4]

**Acceptance Criteria:**
[Checklist of items that must pass verification, including GUT unit test definitions]
```

---

## MVP Tickets (In Implementation Order)

### NAV-01: Transparent Borderless Window Setup (DONE)
**User Story:**
- **As a:** Desktop user
- **I want:** Navi's viewport to have a transparent, borderless background
- **So that:** Navi appears directly on my desktop without an ugly OS window frame or gray background.

**Context:**
In Godot 4, window transparency and styling must be configured both in project settings and via `DisplayServer` APIs to render overlay screens.

**Description:**
Set up the Godot project configuration and a primary window controller scene that initiates the window as borderless, transparent, and floating on top of other applications.

**Requirements:**
1. Configure `project.godot` with:
   - `display/window/size/transparent=true`
   - `display/window/per_pixel_transparency/allowed=true`
   - `display/window/size/borderless=true`
   - `display/window/size/always_on_top=true`
2. Create a `WindowController.gd` script attached to the root node:
   - Call `get_viewport().transparent_bg = true` on `_ready()`.
   - Set the initial window size to a compact dimension appropriate for the fairy (e.g., 200x200 pixels).
   - Ensure these settings compile and run on macOS.

**Acceptance Criteria:**
- **GUT Test**: Verify `get_viewport().transparent_bg` is `true`.
- **GUT Test**: Verify `DisplayServer.window_get_flag(DisplayServer.WINDOW_FLAG_BORDERLESS)` is `true`.
- **GUT Test**: Verify `DisplayServer.window_get_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP)` is `true`.
- **Manual Verification**: Run the application and confirm the window background is transparent (revealing the desktop behind it) and lacks borders.

---

### NAV-02: Fairy Visuals - Glowing Particles & Animated Wings (DONE)
**User Story:**
- **As a:** User running Navi
- **I want:** Navi to look like a magical glowing particle light with two flapping wings
- **So that:** Navi feels alive and resembles a fairy.

**Context:**
Visual style should follow a modern premium glassmorphism aesthetic, using glowing translucent colors, soft particle trails, and smooth animations. Color parameters must be exposed so they can be modified dynamically from settings.

**Description:**
Build a `FairyVisuals.tscn` scene that handles the visual representation of Navi, consisting of a central glowing light, a trail of particles, and two wings that flap continuously.

**Requirements:**
1. Create a `GPUParticles2D` (or `CPUParticles2D`) node configured for a glowing circular light aura and a soft drift trail.
2. Create two `Polygon2D` or `Sprite2D` nodes representing the left and right wings.
3. Attach a script or use an `AnimationPlayer` / `Tween` to flap the wings (scaling on the X-axis back and forth).
4. Create a public method `set_fairy_color(color: Color) -> void` that updates the particle system's modulation/material color and the wing colors.

**Acceptance Criteria:**
- **GUT Test**: Calling `set_fairy_color()` updates the inner color property and matches the expected HSL tone.
- **GUT Test**: Wings cycle between maximum and minimum horizontal scales.
- **Manual Verification**: Observe the fairy visuals on desktop: check that the wings flap smoothly and a glowing trail follows Navi when moved.

---

### NAV-03: Mouse-Following Behavior (DONE)
**User Story:**
- **As a:** User working on other desktop apps
- **I want:** Navi to follow my mouse cursor smoothly with a slight delay at a bottom-right offset
- **So that:** Navi stays near my work area without covering my active cursor, allowing me to click underlying applications.

**Context:**
Since Navi is a small solid window (e.g. 200x200), keeping it offset from the mouse ensures the cursor is never actually over the Godot window during movement. Clicks therefore naturally bypass Navi and interact with desktop apps.

**Description:**
Implement the logic that polls the global OS mouse position and smoothly moves Navi's window coordinates to follow it with an offset.

**Requirements:**
1. In `WindowController.gd` (or a dedicated `FollowController.gd`), track the global mouse position using `DisplayServer.mouse_get_position()`.
2. Compute the target position: `target_pos = mouse_position + offset` (where default offset is bottom-right, e.g., Vector2i(25, 25)).
3. Smoothly interpolate (lerp) the window position in `_process(delta)`:
   - `var current_pos = DisplayServer.window_get_position()`
   - `var new_pos = current_pos.lerp(target_pos, speed * delta)`
   - `DisplayServer.window_set_position(new_pos)`
 4. Expose a boolean `is_following` to toggle this tracking behavior.

**Acceptance Criteria:**
- **GUT Test**: When `is_following` is true, moving the mock mouse updates the target window position.
- **GUT Test**: When `is_following` is false, moving the mock mouse does not alter the window position.
- **Manual Verification**: Move the mouse cursor around the screen; confirm that Navi glides smoothly to follow the cursor at a stable bottom-right offset. Confirm you can click desktop icons/apps directly.

---

### NAV-04: Global Hotkey Listener & Window Focus Toggle (DONE)
**User Story:**
- **As a:** User working in external applications
- **I want:** To press a keyboard hotkey to stop Navi, bring its window to the foreground, and open the input text box
- **So that:** I can immediately type queries without manually hunting down or clicking the fairy.

**Context:**
Because Navi runs unfocused in the background, standard Godot input events will not register. We need a way to listen to global shortcut events in macOS and bring the window to the foreground.

**Description:**
Integrate a macOS global hotkey listener. When the designated hotkey (`Ctrl+Shift+Option+Space`) is pressed, trigger state changes to stop follow-mode, position the window, and request focus.

**Requirements:**
1. Create an `InputManager.gd` Autoload.
2. For macOS, implement global keyboard listening (using a GDExtension, OS hook, or registering a local hotkey handler combined with a background helper process).
3. Upon receiving the hotkey event:
   - Toggle `is_following = false`.
   - Resize the window to support the text input UI.
   - Position the window directly near the cursor.
   - Force focus using `DisplayServer.window_move_to_foreground()`.
4. Pressing `Escape` or clicking outside should restore `is_following = true`, shrink the window back to fairy size, and release focus.

**Acceptance Criteria:**
- **GUT Test**: Triggering the hotkey action updates the controller state to `INTERACT` and sets `is_following = false`.
- **GUT Test**: Exiting the interaction state sets `is_following = true`.
- **Manual Verification**: Click on an external app (like Chrome). Press `Ctrl+Shift+Option+Space`. Verify that the Navi window pops up at the cursor, stops following, and lets you immediately type text.

---

### NAV-05: Viewport Hide & Screen Capture Utility (DONE)
**User Story:**
- **As a:** User seeking contextual AI answers
- **I want:** Navi to automatically capture a screenshot of my screen when I press the hotkey
- **So that:** The AI has visual context of what I was looking at.

**Context:**
To take a screenshot of the actual screen instead of capturing Navi's own UI, we must hide the Godot window, take the capture, and then restore the window.

**Description:**
Create a utility class `ScreenCaptureService.gd` that handles hiding the transparent Godot window, taking an OS-level capture of the desktop, storing it in memory, and showing the window again.

**Requirements:**
1. In `ScreenCaptureService.gd`, implement a method `capture_screen() -> Image`.
2. Execution sequence:
   - Set `DisplayServer.window_set_visible(false)`.
   - Await a process frame (`await get_tree().process_frame`) to ensure the OS window manager hides the window.
   - Capture the desktop: Use `DisplayServer.screen_get_image(screen_index)` to obtain a screen image. (On macOS, if not fully supported, fall back to executing `/usr/sbin/screencapture -x tmp_shot.png` and loading the file).
   - Set `DisplayServer.window_set_visible(true)`.
   - Return the captured `Image` resource.

**Acceptance Criteria:**
- **GUT Test**: Verify that the capture sequence correctly toggles window visibility state and returns a valid `Image` object.
- **Manual Verification**: Trigger the hotkey. Inspect the captured cache (we can render a thumbnail in the chat UI). Verify that the screenshot contains the correct desktop image and does not contain Navi itself.

---

### NAV-06: Local & Cloud AI Connection Service (DONE)
**User Story:**
- **As a:** User with specific privacy or cloud preferences
- **I want:** Navi to connect to either a local model (via Ollama) or a cloud service (via Gemini API)
- **So that:** I can customize my AI backend to run offline or use larger cloud models.

**Context:**
We must support multimodal requests, packaging the user's text prompt and the screenshot taken in NAV-05, and sending them to the LLM.

**Description:**
Develop a central `AIService.gd` Autoload to handle API communication with local and cloud endpoints.

**Requirements:**
1. Read configurations (model selection, endpoint URLs, API keys) from `SettingsManager`.
2. Format the screenshot image into a base64 encoded JPG/PNG.
3. For **Local (Ollama)**:
   - Target API endpoint: `http://localhost:11434/api/chat` or `/v1/chat/completions`.
   - Send the message JSON structure containing system prompts, user text, and base64 images.
4. For **Cloud (Gemini API)**:
   - Target API endpoint: `https://generativelanguage.googleapis.com/v1beta/models/...:generateContent`.
   - Format the request payload according to the Gemini API spec.
5. Use Godot's `HTTPRequest` node to send the request asynchronously. Stream responses or emit a `response_received(text: String)` signal when complete.

**Acceptance Criteria:**
- **GUT Test**: Mock the `HTTPRequest` responses for both Ollama and Gemini formats, verifying that the payload includes the system prompt, user prompt, and image data.
- **GUT Test**: Verify that request failures trigger appropriate error signals and user-facing messages.
- **Manual Verification**: Run Ollama locally (e.g. `llama3`) or supply a cloud API key. Type a prompt and verify Navi returns a coherent text response.

---

### NAV-07: Hextech Chat UI Popup (DONE)
**User Story:**
- **As a:** User interacting with Navi
- **I want:** A visually appealing text input box and response window to appear at my cursor
- **So that:** I can enter prompts and read answers in a premium, fluid UI.

**Context:**
Implement the UI using a premium dark glassmorphism style: translucent dark backdrop, glowing teal/purple accent borders, Outfit/Inter fonts, and smooth scale transitions.

**Description:**
Build a `ChatUI.tscn` control scene that opens near the cursor, receives focus, contains a text input editor, and displays the response streamed from `AIService`.

**Requirements:**
1. UI Elements:
   - A `PanelContainer` with a custom StyleBox (glassmorphism shader, dark translucent background, glowing teal/purple border).
   - An `LineEdit` or `TextEdit` for user prompt input.
   - A `RichTextLabel` with BBCode enabled for markdown/rich responses from Navi.
   - A thumbnail container showing a mini-preview of the captured screen.
2. Show/Hide animations: Use `Tween` to scale the panel from `0.0` to `1.0` and fade alpha from `0.0` to `1.0` when opened.
3. Bind the "Enter" key (or Cmd+Enter) to submit the prompt, and "Escape" to close the UI.

**Acceptance Criteria:**
- **GUT Test**: Opening the Chat UI transitions its control scale and triggers focus on the input field.
- **GUT Test**: Emitting response chunks from `AIService` updates the `RichTextLabel` text properly.
- **Manual Verification**: Press hotkey. The Chat UI should expand gracefully. Type a query, see the screenshot thumbnail, press Enter, and see the streaming text.

---

### NAV-08: Configuration & Settings UI (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** To click the fairy and open a settings window to change its color, system prompt, personality, and LLM credentials
- **So that:** I can personalize my assistant and configure my models.

**Context:**
Configurations must be persisted to a local file (`user://settings.cfg` or `.json`) so they load automatically on app startup.

**Description:**
Create a `SettingsUI.tscn` panel that opens when clicking the fairy in stationary mode. It contains forms for LLM type, keys, custom personality, system prompt, and a color selector for Navi's particles.

**Requirements:**
1. Detect clicks on the fairy in stationary mode (using a `CollisionObject2D` or `Control` mouse filter).
2. UI controls:
   - System Prompt (TextEdit)
   - Personality/Behavior (LineEdit)
   - Color Selection (ColorPicker or preset buttons)
   - LLM Provider (OptionButton: "Local Ollama", "Cloud Gemini")
   - API Endpoint URL & API Key (LineEdits)
3. Connect UI changes to a `SettingsManager.gd` singleton that writes/reads to `user://settings.json`.
4. Emitting settings updates triggers events to adjust fairy color dynamically.

**Acceptance Criteria:**
- **GUT Test**: Saving settings writes to `user://settings.json` and updates the active settings dictionary.
- **GUT Test**: Modifying the color updates the `FairyVisuals` node color state.
- **Manual Verification**: Open Settings, change Navi's color to purple, change provider to Ollama, and save. Restart the app; verify Navi starts as purple and retains Ollama settings.

---

## Future Roadmap Tickets (Planned)

### NAV-09: Speech-to-Text (STT) Voice Inputs (BACKLOG)
**User Story:**
- **As a:** User who prefers speaking over typing
- **I want:** To dictate my prompt to Navi using my microphone
- **So that:** I can interact with the assistant in natural spoken language.

**Context:**
Integrate audio recording capabilities in Godot to send voice prompts to local Whisper or cloud STT endpoints.

**Description:**
Create an audio capture recorder that records microphone input when a hotkey is held down and sends the audio file to an STT service.

**Requirements:**
1. Enable Microphone input in Godot project audio settings.
2. Create an `AudioStreamRecord` instance to capture mic input.
3. Implement a voice button in `ChatUI` that records input while held.
4. Export the audio data as a WAV/MP3 file and upload to STT API.
5. Populate the Chat input box with the transcribed text.

**Acceptance Criteria:**
- **GUT Test**: Verify audio capture buffer fills during recording and handles file conversion correctly.

---

### NAV-10: Text-to-Speech (TTS) Voice Responses (BACKLOG)
**User Story:**
- **As a:** User multi-tasking on my screen
- **I want:** Navi to read its responses back to me in a natural-sounding voice
- **So that:** I don't have to stop working and read the text box.

**Context:**
Use Godot 4's built-in `DisplayServer.tts_speak()` or external cloud TTS APIs (e.g. ElevenLabs) for vocalizing responses.

**Description:**
Implement a vocalization service that takes output text and streams it through a speech synthesis engine.

**Requirements:**
1. Create a `TTSService.gd` class.
2. Offer two options:
   - Local: Use Godot's built-in platform speech synthesis `DisplayServer.tts_speak()`.
   - Cloud: Send requests to a TTS API and play returned audio stream.
3. Add a mute/unmute toggle to the UI.

**Acceptance Criteria:**
- **GUT Test**: Verify TTS queue is populated with sentences and triggers speech synthesis calls.

---

### NAV-11: Screen Navigation and Pointer Guidance (BACKLOG)
**User Story:**
- **As a:** User following step-by-step instructions
- **I want:** Navi to fly to specific elements on my screen and point at them
- **So that:** I can easily navigate complex application layouts.

**Context:**
Requires coordinates of UI elements. This will coordinate with LLM tool-calling (where the LLM returns coordinate bounding boxes on the screen for items to click).

**Description:**
Extend Navi's position controllers to accept coordinate paths. Navi will exit hover-follow mode and fly along a vector path to a designated screen position, carrying a pointer visual.

**Requirements:**
1. Add a pathing system to `FollowController.gd` supporting target points: `fly_to_screen_coordinate(coord: Vector2)`.
2. Draw a dynamic pointer arrow extending from the glowing particle body.
3. Support chained coordinate lists for step-by-step instructions (e.g., "Click here", wait for click, "then click there").

**Acceptance Criteria:**
- **GUT Test**: Flying to coordinates computes correct paths and transitions state to target-hover.
- **Manual Verification**: Command Navi to fly to (500, 500) and verify it travels along a smooth path and hovers there with a pointing arrow.

---

### NAV-12: Redesigned Interactive Fairy UI & Screen-Aware Chat (DONE)
**User Story:**
- **As a:** User interacting with Navi
- **I want:** Navi to freeze in place on hotkey press, let me drag it to refocus, and show its response in a screen-aware glassmorphic speech bubble
- **So that:** I can visually point the AI to specific screen content without having the UI jump, and read responses next to the focus point.

**Context:**
The overlay window should expand to full-screen while active. Clicks outside the panels and the fairy should exit interaction mode. Left-click is for dragging, right-click opens settings.

**Description:**
Split the Chat UI into user input and speech bubble panels, reposition them dynamically next to the fairy, support dragging to update focus screenshot context, and implement right-click settings.

**Requirements:**
1. Rescale the transparent window to full screen in `WindowController` when CHAT or SETTINGS is active, maintaining the fairy's screen position.
2. In `FollowController`, add a position reset method to resume following smoothly.
3. In `FairyVisuals`, implement mouse dragging (left-click) and settings trigger (right-click).
4. In `ChatUI`, create separate `InputPanel` and `ResponsePanel` (speech bubble) with a dynamic pointed triangle tail.
5. Place panels next to the fairy, auto-switching sides if close to the screen edges, and clamp vertical positions.
6. Enable text selection on the response label for copy-paste.
7. Click outside the panels and fairy in full-screen mode to close the chat.

**Acceptance Criteria:**
- **GUT Test**: Dragging the fairy emits the correct drag and drag_finished signals.
- **GUT Test**: Repositioning the UI correctly places panels on the left/right and clamps them to screen edges.
- **GUT Test**: Resetting the follow controller smoothly sets target float coordinate.
- **Manual Verification**: Open the chat, drag the fairy, let go (confirm new screenshot is taken), verify speech bubble tail points to the fairy, verify right-click opens settings, and clicking outside/Esc dismisses it.
