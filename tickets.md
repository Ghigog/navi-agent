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

## Bug Fix Tickets

### NAV-BUG-01: HTTPClient Streaming Hang — Missing `client.poll()` Calls (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Responses to stream character-by-character immediately
- **So that:** I'm not left staring at "Thinking..." with no output indefinitely.

**Root Cause:**
Godot's `HTTPClient` is a **manual state machine** — unlike `HTTPRequest`, it does NOT advance automatically. It requires explicit `client.poll()` calls every frame to drive its internal state transitions. Two polling loops in `_request_llm_stream` were missing this call:
1. The `STATUS_CONNECTING/RESOLVING` loop (line ~484) — awaited frames without polling, so connection could stall on slow DNS.
2. The `STATUS_REQUESTING` loop (line ~556) — awaited frames without polling. Since the client never polled, it **never transitioned to `STATUS_BODY`**, causing an **infinite loop** that appeared as an indefinite hang.

**Fix:**
- Added `client.poll()` before every `await get_tree().process_frame` in both polling loops.
- Added a diagnostic log line after the request loop exits to confirm the response body is ready.
- Pre-compiled the Gemini SSE `RegEx` as a class member `_gemini_text_regex` (initialized in `_ready`) instead of allocating a new `RegEx` object per chunk, eliminating per-frame allocation overhead.

**Acceptance Criteria:**
- **Manual Verification**: Send "Hey what's up" to local Ollama. Verify streaming text appears within 1–2 seconds of the model producing its first token, without any indefinite hang.
- Log should show `AIService: Request sent, waiting for response body...` followed by `AIService: [Ollama Chunk]` lines.

---

### NAV-BUG-02: Deterministic Prompt Classifier — `PROMPT_SKILL_RULES` Library (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to immediately know when a query needs screen access or deep reasoning
- **So that:** It never hallucinates answers to visual questions or ignores the need for tools.

**Root Cause:**
Small LLMs (e.g. `llama3.2:3b`) are overconfident. Asking them to self-assess whether they need a tool (via `[ESCALATE]`) is unreliable — they pattern-match to "sound like a helpful assistant" and fabricate answers to visual questions they cannot possibly know ("I can see a cloud emoji above me!").

**Fix — Three-Layer Routing in `send_prompt()`:**

**Layer 0 — Deterministic Classifier (zero LLM cost):**
A `PROMPT_SKILL_RULES` constant library maps trigger patterns directly to skills. The prompt is lowercased and checked against each rule's pattern list before any model is called. First match wins. Rules are ordered most-specific-first (crop before full screenshot).

```
VISUAL_CROP  → take_crop_screenshot  (e.g. "right above you", "zoom in")
VISUAL_FULL  → take_screenshot       (e.g. "can you see", "emoji", "screen")
COMPLEX      → heavy_thinking        (e.g. "code", "calculate", "explain why")
```

**Layer 1 — Fast Model (LLM fallback, minimal prompt):**
Only reached if no pattern matched. Fast model gets identity + user prompt + `[ESCALATE]` safety net.

**Layer 2 — Heavy Model (full skills prompt):**
Only reached if the fast model self-escalated.

**New helpers:**
- `_classify_prompt(prompt) -> Dictionary` — walks the library and returns the matching rule + matched pattern key
- `_deliver_final_response(...)` — extracted Stage 4 shared between classified and escalated paths
- `_cleanup_request()` — clears fairy status light, prints end banner

**Acceptance Criteria:**
- **Manual Verification**: "Can you see the emoji above you?" → log shows `[ROUTER] 🎯 Classified as 'VISUAL_FULL' — matched pattern: 'can you see'` with no LLM routing call.
- "Help me debug this code" → `COMPLEX` classification, `heavy_thinking` invoked directly.
- "Hey what's up?" → no match, fast model answers conversationally.
- Disabling screenshots in settings → classifier still matches but SKIPPED log line shown, falls back to fast model.

---



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

---

### NAV-13: Full Skill-Agent Workflow (DONE)
**User Story:**
- **As a:** User interacting with Navi
- **I want:** Navi to dynamically plan which skills to use, validate the planned tools against a list of available skills, sequentially execute them in a background loop (like screen capture or deep thinking), and keep me updated on its thoughts in real-time
- **So that:** Navi functions as an incredibly smart, highly-interactive autonomous companion.

**Context:**
The agent flow should use a two-tier model approach: a Fast Model front-end for receiving and planning, and a modular plug-and-play skills registry for running background tools. The fairy should stay visible in captured screenshots to preserve visual pointing coordinates.

**Description:**
Implement the planning and execution loop, build a modular callable dictionary of skills in `AIService.gd`, and verify all logic via automated GUT test scripts.

**Requirements:**
1. Call the Fast Model with planning prompts to get structured plans (`[PLAN: skill1, skill2]`) and clean conversational announcements.
2. Validate skill checklist tags against the modular callable registry in `AIService.gd` before executing them to prevent hallucinated actions.
3. Emit conversational announcements instantly to keep the user engaged while executing skills in the background.
4. Loop through planned skills sequentially, calling their execution callbacks to update the shared context.
5. In `heavy_thinking`, parse thoughts from `<think>` blocks, rephrase them, and output intermediate updates to the speech bubble.
6. Support a plug-and-play skills pattern where adding a new skill is as simple as adding a key-value mapping to `_skills_registry`.

**Acceptance Criteria:**
- **GUT Test**: Verify that the planning parser correctly extracts and validates tags from structured outputs.
- **GUT Test**: Verify that hallucinated or unregistered tools are rejected.
- **GUT Test**: Verify that intermediate status updates are emitted correctly.
- **Manual Verification**: Submit a query about the screen; confirm Navi immediately announces its plan, sequentially executes the capture and reasoning skills, and shows live rephrased status updates in its speech bubble.

---

### NAV-14: Asynchronous Streaming & Direct Conversational Routing (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Conversational responses to start streaming immediately (under 3s) without pre-planning pre-calls, and thoughts to append to speech bubble sections
- **So that:** Navi responds with zero perceived interface lag and behaves like a fluid, real-time companion.

**Context:**
Utilize HTTPClient for SSE chunked stream reading. Intercept and buffer skill tags. Add a status dot above the fairy's head and settings toggles for enabling/disabling screenshots or thinking.

**Description:**
Optimize prompt dispatch to go directly to the fast model. Filter `[SKILL: ...]` tags on-the-fly, dispatching screenshots/thinking, and showing status lights (pulsing Amber for screenshot/capture, pulsing Purple for thinking).

**Requirements:**
1. Direct fast model dispatch.
2. Low-level HTTPClient SSE chunk parsing with defensive host parameter check.
3. Stream character-by-character filtering to suppress skill tags from user view.
4. Non-destructive paragraph appending in ChatUI to maintain full dialog history.
5. Settings configuration and UI checkboxes for `enable_screenshots` and `enable_thinking`.
6. Dynamically update the status indicator light above Navi's head (FairyVisuals).

**Acceptance Criteria:**
- **GUT Test**: Verify greetings response finishes within 3 seconds under mock server conditions.
- **GUT Test**: Verify status light changes color correctly and clears.
- **GUT Test**: Verify toggles successfully load and save settings parameters.
- **Manual Verification**: Submit a basic message ("hello"); verify response streams in instantly. Submit a visual query ("what is this?"); verify Navi immediately says she is checking the screen, status light glows amber, screenshot is captured, then glows purple as the heavy model streams its analysis.
