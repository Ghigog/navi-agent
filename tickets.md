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

### NAV-BUG-03: Deferred Thought Rephrasing Overwriting Streaming Response (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Live reasoning progress to appear in the speech bubble *before* the final response starts, not after
- **So that:** I can see what the model is thinking in real time without having the final response overwritten by stale thought summaries.

**Root Cause:**
The original `_parse_and_emit_thoughts_deferred()` function fired *after* the full `</think>` block was received, made secondary LLM calls to rephrase each bullet, then emitted `thinking_update`. By that point, `_is_response_streaming` was already `true` and the response was either streaming or fully complete, causing the thought overlays to race against and overwrite the real output.

**Final Fix (revised from earlier approach):**
The deferred rephrasing path was entirely removed. `_filter_stream_chunk` was updated to emit thoughts verbatim in real time:

1. While `new_thinking` is true, every `\n` encountered inside the `<think>` block flushes the current `new_think_buffer` line into `pending_think_lines[]`.
2. When `</think>` is matched, any remaining non-newline-terminated content is also flushed.
3. Callers (both Ollama and Gemini loops) iterate `filtered_word.get("think_lines", [])` and call `thinking_update.emit(line)` immediately — no secondary LLM call, no race condition, zero extra API cost.
4. `_parse_and_emit_thoughts_deferred` is removed and replaced with a comment stub documenting the future personality-transform approach (client-side string templates, no LLM needed).

**Acceptance Criteria:**
- **Manual Verification**: Ask a heavy-thinking query. Verify that individual reasoning bullet points appear in the speech bubble *while the model is still thinking*, before any final response text arrives. Confirm the final response streams cleanly without being overwritten.


---

### NAV-BUG-04: Session Memory Not Saved When Switching Chat → Settings (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to remember my last conversation even when I open Settings from within the chat
- **So that:** Navi can recall what we discussed when I ask about it in a future session.

**Root Cause — Two independent bugs:**

**Bug 1 — History silently discarded on Chat→Settings transition:**
`_on_fairy_clicked()` in `WindowController.gd` called `close_chat()` on the ChatUI to visually hide it, but never called `end_chat_session()` on AIService. This meant the entire conversation history was discarded without triggering summarization. Only the `_reset_to_follow_mode()` path (Escape / click outside) correctly called `end_chat_session()`. When Settings was opened from within a chat session, zero history was captured.

**Bug 2 — Small model ignores injected recall block:**
The previous session summary was injected into `system_prompt_user`, which was appended *after* the identity string in the system prompt. `llama3.2:3b` treats later instructions as lower priority and consistently ignored the recall block, responding "I don't have a record of our previous conversation" even when the summary was present.

**Fixes:**

*WindowController.gd — `_on_fairy_clicked()`*:
Before calling `close_chat()`, now explicitly calls `end_chat_session()` so the history snapshot is taken and background summarization is triggered:
```gdscript
if _active_panel == _ActivePanel.CHAT:
    if has_node("/root/AIService"):
        ai_service.call("end_chat_session")
    _chat_ui.call("close_chat")
```

*AIService.gd — `send_prompt()`*:
The recall block is now injected directly into `identity` at the highest-priority position of the system prompt, using direct imperative language:
```
PREVIOUS SESSION MEMORY — READ THIS FIRST:
You have a summary of what happened last time with this user. If the user asks
what you discussed last time, what they asked previously, or references the
previous session, use this summary to answer directly and confidently:
<summary>
```
Also added a `Recall: ...` log line to confirm summary injection per request.

**Acceptance Criteria:**
- **Manual Verification**: Have a conversation, then right-click the fairy to open Settings without pressing Escape. Close Settings. Open a new chat and ask "What did we talk about last time?" — verify Navi correctly recalls the session.
- Log should show `AIService: Triggering background summarization skill...` immediately after opening Settings from within a chat.
- Log should show `AIService:   Recall     : Previous session summary injected (N chars).` when a summary is active.



### NAV-BUG-05: Fast Model Refuses Visual Tasks Instead of Escalating (DONE)
**User Story:**
- **As a:** Navi user pointing at something on screen
- **I want:** Navi to actually look at my screen instead of saying "I'm a language model, I can't see images"
- **So that:** I don't have to rephrase my query with magic keywords just to get a useful answer.

**Root Cause — Two independent gaps:**

**Gap 1 — Missing classifier patterns:**
`PROMPT_SKILL_RULES` was missing common visual-intent signals: `"sticker"`, `"animal"`, `"what is this"`, `"what's this"`, `"identify"`, `"here"` (bare pointing gesture), `"use your skill"`, directional references (`"on your left"`, `"to your right"`, etc. → VISUAL_CROP). Without these, prompts like "What animal is on this sticker here?" fell through to the fast model with no image context.

**Gap 2 — Fast model refuses instead of `[ESCALATE]`ing:**
`llama3.2:3b` is trained to explain its limitations ("I'm a large language model, I can't see images") rather than output the terse `[ESCALATE]` token when a visual task arrives without image data. The refusal was treated as a valid response and delivered to the user verbatim.

**Fixes:**

*AIService.gd — `PROMPT_SKILL_RULES`*:
- **VISUAL_CROP**: Added `"on your left"`, `"to your left"`, `"on your right"`, `"to your right"`, `"left of you"`, `"right of you"`, `"to the left of you"`, `"to the right of you"`.
- **VISUAL_FULL**: Added `"sticker"`, `"badge"`, `"label"`, `"logo"`, `"symbol"`, `"sign"`, `"animal"`, `"creature"`, `"character"`, `"figure"`, `"identify"`, `"recognize"`, `"what kind of"`, `"what type of"`, `"what is this"`, `"what's this"`, `"what is that"`, `"what's that"`, `"this here"`, `"over here"`, `"right here"`, `"this thing"`, `"that thing"`, `"use your skill"`, `"take a screenshot"`, `"look at my screen"`, `"check my screen"`, `"here"` (bare deictic pointer).

*AIService.gd — `_VISUAL_REFUSAL_PATTERNS` constant + self-correction branch*:
A new `_VISUAL_REFUSAL_PATTERNS` constant lists ~16 phrases that indicate the model refused a visual task. In the TIER 1 handler, after receiving the fast reply, if no `[ESCALATE]` is present but the reply matches a refusal pattern:
1. The bad reply is suppressed (never emitted to ChatUI).
2. `_get_retraction_message(personality)` is called to produce a personality-voiced correction, emitted as a `thinking_update` bubble line (e.g. `"Ugh, wait — I take that back. I literally have skills for this, hold on."`).
3. `take_screenshot` is invoked immediately and the full response is delivered from the heavy model with the image context.

*AIService.gd — `_get_retraction_message(personality)`*:
New helper returning personality-specific retraction lines. Variants for Annoying, Snarky, Friendly, Professional, and a neutral fallback.

**Acceptance Criteria:**
- **Manual Verification**: Ask "What animal is on this sticker here?" — verify log shows `[ROUTER] Classified as VISUAL_FULL — matched pattern: 'sticker'` and the screenshot is taken without going to the fast model at all.
- **Manual Verification**: Ask a visual question that the classifier misses. Verify the fast model's refusal is suppressed, log shows `[SELF-CORRECT] Visual refusal detected`, a retraction appears in the thought trail, and the heavy model answers with screen context.
- Log pattern for self-correction: `AIService: [SELF-CORRECT] Visual refusal detected in fast reply — forcing screenshot skill. Retraction: '...'`


### NAV-09: Speech-to-Text (STT) Voice Inputs (COMPLETED)
**User Story:**
- **As a:** User who prefers speaking over typing
- **I want:** To dictate my prompt to Navi using my microphone
- **So that:** I can interact with the assistant in natural spoken language.

**Context:**
Integrate audio recording capabilities in Godot to send voice prompts to local Whisper or cloud STT endpoints.

**Description:**
Create an audio capture recorder that records microphone input when a hotkey is held down and transcribes the audio. This uses a compiled local `whisper-cli` executable and the bundled `ggml-base.en.bin` model running fully offline in a background thread to prevent UI freezing, falling back to Gemini Cloud STT if credentials are provided.

**Requirements:**
1. Enable Microphone input in Godot project audio settings.
2. Create an `AudioStreamRecord` instance to capture mic input.
3. Implement a voice button in `ChatUI` that records input while held.
4. Export the audio data as a WAV file and run transcription offline using `OS.execute()` against the bundled `whisper-cli` binary and `ggml-base.en.bin` model.
5. Populate the Chat input box with the transcribed text.

**Acceptance Criteria:**
- **GUT Test**: Verify audio capture buffer fills during recording and handles file conversion correctly.

---

### NAV-10: Text-to-Speech (TTS) Voice Responses (COMPLETED)
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

### NAV-11: Screen Navigation and Pointer Guidance (DONE)
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
- **GUT Test**: Integration tests verify that `point_to` parses arguments and triggers single/sequence navigation actions.
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

---

### NAV-15: Global Font Size Adjustment & Response Box Resizing (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** To be able to adjust the font size in the entire application from the Settings screen, and to resize the AI response box by dragging its corner
- **So that:** I can optimise readability for my screen size and expand the response bubble as needed.

**Context:**
Two independent UX improvements: a global font size control visible in Settings, and a corner drag handle on the ChatUI response panel.

**Description:**
1. Add a `font_size_offset` integer setting (range -4 to +12, default 0) to `SettingsManager.gd`.
2. Expose a `FontSizeRow` with a labelled `SpinBox` in `SettingsUI.tscn` / `SettingsUI.gd`.
3. In `WindowController._apply_global_settings()`, call a new recursive `_apply_font_size_offset(root, offset)` that walks the entire Control tree, caches original per-node font sizes on first visit (preventing drift across repeated settings saves), and applies the cumulative offset.
4. Add a `ResizeHandle` Control node anchored to the bottom-right corner of `ResponsePanel` in `ChatUI.tscn` with `mouse_default_cursor_shape = CURSOR_FDIAGSIZE (12)` and a small visual indicator polygon.
5. Connect `ResizeHandle.gui_input` in `ChatUI.gd` to a `_on_resize_handle_input` handler; on drag, update `response_panel.custom_minimum_size` and call `reposition_ui()`.
6. Guard `is_position_inside_ui` to return `true` while `_is_resizing` is active, preventing accidental chat-close on drag release.

**Acceptance Criteria:**
- **GUT Test**: `test_font_size_offset_default_is_zero` — confirms `font_size_offset` key is present in SettingsManager dict.
- **GUT Test**: `test_font_size_offset_stored_and_retrieved` — setting and retrieving the offset returns the correct int.
- **GUT Test**: `test_resize_handle_node_exists` — `ResponsePanel/ResizeHandle` exists in the ChatUI scene.
- **GUT Test**: `test_resize_guard_prevents_dismiss_while_resizing` — `is_position_inside_ui` returns true while `_is_resizing` is active.
- **Manual Verification**: Open Settings, adjust Font Size Adjustment from 0 to +6, save — confirm all text across Chat and Settings UI scales up proportionally. Hover over the bottom-right corner of the response bubble and verify cursor changes to a diagonal resize arrow. Click-drag to enlarge the response box and confirm it resizes smoothly.

---

### NAV-16: Conversation Context Memory in AIService (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to remember previous turns of the conversation during an active session
- **So that:** I can ask follow-up questions and have a continuous dialog with the assistant.

**Context:**
Currently, each prompt submission is completely stateless. We need to store conversation history and include it in Ollama/Gemini request payloads.

**Description:**
Update `AIService.gd` to store `_conversation_history`, adapt the request signature, format history into message arrays for each provider, and clean/append successful replies.

**Requirements:**
1. Declare `_conversation_history: Array[Dictionary] = []` in `AIService.gd`.
2. Update signatures of `_request_llm` and `_request_llm_stream` to accept `history: Array[Dictionary] = []`.
3. In `_request_llm` and `_request_llm_stream`, format the messages (Ollama) and contents (Gemini) lists using the history turns.
4. Implement `_clean_response_for_history(text: String) -> String` to strip `<think>` and `[SKILL]` tags using regex.
5. In `send_prompt()`, pass `_conversation_history` to LLM requests and call `_append_to_history()` with the current prompt and cleaned response upon success.
6. Provide public method `clear_history() -> void`.

**Acceptance Criteria:**
- **GUT Test**: `test_history_appending` verifies that prompts and cleaned responses are correctly stored in `_conversation_history`.
- **GUT Test**: `test_clear_history` verifies that calling `clear_history()` resets the array.
- **Manual Verification**: Submit a greeting, then a follow-up query referencing the first message, and verify in logs that history is sent.

---

### NAV-17: Visual Chat History Thread in ChatUI (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** The chat speech bubble to display the ongoing history thread of our active chat session
- **So that:** I can scroll up and see what we previously discussed without it disappearing.

**Context:**
Currently, `ChatUI` clears the response box whenever a new request is started, showing only the latest message.

**Description:**
Modify `ChatUI.gd` to maintain a visual history thread of the active session, prepend user prompts with `> `, and ensure the label auto-scrolls down when new content streams in.

**Requirements:**
1. Declare `_visual_history: String = ""` and `_current_response_text: String = ""` in `ChatUI.gd`.
2. Reset `_visual_history` to the initial greeting in `open_chat()`.
3. In `_on_prompt_submitted()`, append the user prompt prefixed with `> `.
4. In callbacks `_on_ai_request_started()`, `_on_ai_thinking_update()`, and `_on_ai_response_chunk()`, build the display text by appending the current status or chunks to `_visual_history`.
5. In `_on_ai_response_received()`, append the final reply to `_visual_history` and clear `_current_response_text`.
6. Enable `scroll_following` on `response_label` in `_ready()`.

**Acceptance Criteria:**
- **GUT Test**: `test_visual_history_retains_multiple_turns` verifies that submitting a new prompt doesn't erase the previous assistant response from the UI text.
- **GUT Test**: `test_scroll_following_enabled` verifies `response_label.scroll_following` is true.
- **Manual Verification**: Type a prompt, wait for response, type a second prompt, and verify that the bubble retains the first Q&A pair and scrolls to keep the active text visible.

---

### NAV-18: Background Chat Session Summarization Skill (DONE)
**User Story:**
- **As a:** Navi developer / system
- **I want:** Navi to automatically summarize the initial problem and final solution of a chat session when it is ended
- **So that:** The summary is saved to a temporary cache for other agent skills or features to query.

**Context:**
When the user clicks away or presses Escape to dismiss the chat, the active session ends. We want to execute a hidden summarization skill before resetting the chat memory.

**Description:**
Add a background summarization skill to `AIService`, register it as `"summarize_session"`, trigger it when the chat overlay is closed, copy and clear active history, and run the summary request asynchronously.

**Requirements:**
1. Register `"summarize_session"` in `_skills_registry` mapped to `_execute_summarize_session()`.
2. Implement `_execute_summarize_session()` to prompt the fast model to generate a concise summary based on the passed conversation transcript, saving it to `_cached_summary`.
3. Create `end_chat_session() -> void` which duplicates the history, clears `_conversation_history`, and runs `"summarize_session"` with the history copy deferredly.
4. Call `end_chat_session()` in `WindowController.gd` inside `_reset_to_follow_mode()`.
5. Call `clear_history()` in `WindowController.gd` inside `_on_hotkey_pressed()`.

**Acceptance Criteria:**
- **GUT Test**: `test_execute_summarize_session` mock-triggers the skill and verifies `_cached_summary` is populated.
- **GUT Test**: `test_end_chat_session_clears_history` verifies that calling `end_chat_session()` resets the active history immediately while launching the background task.
- **Manual Verification**: Close an active conversation, check logs to confirm `"summarize_session"` starts and saves a summary, and check that a subsequent chat starts with clean memory.

---

### NAV-19: Honesty Prompt Reinforcements (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to be extremely honest when unsure about screen details or lacking information
- **So that:** Navi does not hallucinate false information (such as Google Docs details or nonexistent passwords) and instead asks for clarification.

**Context:**
A global honesty prompt reinforcement is needed to prevent models from generating hallucinations under visual context, prioritizing current screens over past history.

**Description:**
Add strict honesty directives in `identity`, append applications summary warnings to the previous session recall block, and inject a vision sanity check guideline when visual screenshots are present.

**Acceptance Criteria:**
- **GUT Test**: `test_honesty_directives_in_system_prompt` verifies that honesty suffixes, recall warnings, and visual guidelines are correctly present in system prompts.
- **Manual Verification**: Submit visual prompts when the screen contents are unclear; confirm Navi admits its visual limitations and asks for clarification.

---

### NAV-20: Route Visual Queries to Heavy Reasoning Model (DONE)
**User Story:**
- **As a:** Navi user asking visual questions
- **I want:** Navi to automatically run all screenshot-based queries on the heavy reasoning model
- **So that:** The model has full multimodal capability and visual reasoning capacity to understand the screen context, changing its status light to pulsing purple.

**Description:**
Check for base64 image/crop data in both deterministic and escalated planning paths to promote requests to the heavy model. In `_deliver_final_response`, transition the status light of the fairy to pulsing purple if `has_heavy_thinking` is true.

**Acceptance Criteria:**
- **GUT Test**: `test_visual_queries_escalate_to_heavy_model` verifies that screenshot captures promote requests to the heavy reasoning model.
- **GUT Test**: `test_status_light_updates_to_purple_for_heavy_thinking` verifies the status light changes to Purple.

---

### NAV-21: Live Thought Trail with Personality Transform (DONE)
**User Story:**
- **As a:** Navi user watching Navi reason
- **I want:** Each step of the model's reasoning to appear as a separate line in the chat thread, styled in Navi's personality voice, and stay visible permanently above the final answer
- **So that:** I can scroll back and read the reasoning trail as a continuous inner-monologue → answer narrative.

**Context:**
The heavy thinking model outputs `<think>...</think>` blocks before answering. Previously, each thought line would overwrite the previous status message, leaving only the last one visible. This feature replaces that with an accumulating, permanently-committed trail.

**Description:**
1. Add a client-side `_apply_personality_voice(line, personality)` function to `AIService.gd` that maps common raw model reasoning patterns (e.g. "user is asking", "must focus", "will state") to first-person Navi-voice templates keyed by personality setting — zero extra LLM calls.
2. Wire the transform into `_filter_stream_chunk` at both `pending_think_lines.append` sites so every emitted thought line is personality-flavoured before being broadcast.
3. In `ChatUI.gd`, replace the single-overwrite thinking_update handler with a `_thought_trail: Array` accumulator.
4. Add a single `_render_display()` helper as the sole source-of-truth for label composition, combining: `_visual_history` + trail (faded italic `💭` lines) + `_current_response_text` + `Thinking...` placeholder.
5. On `_on_ai_response_received`, commit the full trail + response into `_visual_history` permanently so it survives into future turns.

**Requirements:**
1. `_apply_personality_voice` supports personalities: `friendly`, `annoying`, `snarky`, `professional` with a neutral fallback.
2. Trait table covers ≥12 common reasoning patterns; unmatched lines fall back to the raw stripped line.
3. `_thought_trail` resets on each `_on_ai_request_started`.
4. `_render_display()` is called from `_on_ai_request_started`, `_on_ai_thinking_update`, `_on_ai_response_chunk`.
5. `_on_ai_request_failed` clears trail and current response text cleanly.
6. Trail color: `#4a4a5e` (faded purple-grey italic), separated by `\n` (no blank lines between steps).
7. Trail + response committed to `_visual_history` with `\n\n` separator between trail block and response text.

**Acceptance Criteria:**
- **GUT Test**: `test_thought_trail_accumulates` — emitting 3 `thinking_update` signals populates `_thought_trail` with 3 entries.
- **GUT Test**: `test_thought_trail_committed_on_response_received` — `_on_ai_response_received` appends the trail block to `_visual_history` and clears `_thought_trail`.
- **GUT Test**: `test_apply_personality_voice_annoying` — "The user is asking..." transforms to "Oh great, you're asking me something." for personality "Annoying".
- **GUT Test**: `test_apply_personality_voice_fallback` — a line matching no pattern is returned verbatim.
- **Manual Verification**: Ask a heavy-thinking query. Verify each thought step appears as a new `💭` italic line (not overwriting), the trail stays after the answer streams in, and the thought voice matches the configured personality.

---

### NAV-22: Redesigned Circular Core (Heart) and Orbiting Status Lights (CANCELLED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's main central core to be a glowing circle ("heart") that modulates to my custom settings color, and active skill status lights to orbit inside it
- **So that:** Navi's visual feedback is sleek, futuristic, and consolidated in the center.

**Description:**
Update `FairyVisuals.gd` and the node setup to display the status indicator light (for thinking, capturing screen) as an orbiting node rotating around the central core.

**Requirements:**
1. Position the status light inside the central circular core node area (orbit center `(0, 0)`).
2. In `_process(delta)`, if `status_light` is visible, rotate its position in a circular orbit (e.g. angle increments by `delta * orbit_speed`).
3. Keep full compatibility with existing colors and visibility triggers so tests pass.

**Acceptance Criteria:**
- **GUT Test**: `test_set_status_light` and `test_clear_status_light` pass successfully.
- **Manual Verification**: Check that status light orbits inside the center orb when active.

---

### NAV-23: Dynamic Flight Wings and Sparkle Motion Trail (CANCELLED)
**User Story:**
- **As a:** Navi user watching the fairy fly/drag
- **I want:** Navi's wings to dynamically sweep backwards trailing the direction of motion, and a sparkle trail to follow her
- **So that:** Her flight looks organic, alive, and responsive to movement.

**Description:**
Compute movement velocity from screen coordinates and dynamically adjust wing rotation, position, and flip scales, as well as updating the particle emitter to produce a sparkle trail when moving.

**Requirements:**
1. Calculate velocity from the frame-to-frame change in global screen position.
2. Smooth the velocity with a lerp to prevent jitter.
3. Map the smoothed velocity's horizontal direction to a wing sweep parameter between -1.0 and 1.0.
4. Scale, position, and rotate wings dynamically using the sweep parameter so they trail behind the direction of travel, and return to perpendicular symmetrical flapping when still.
5. Create a dynamic sparkle trail using a CPUParticles2D node that trails behind the fairy as she moves.

**Acceptance Criteria:**
- **GUT Test**: `test_wing_flapping_range` passes successfully.
- **Manual Verification**: Drag/move Navi and observe wings reacting and the sparkle trail following.

---

### NAV-24: Mouse Cursor Capture in Screen Capture (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's screen capture to include the mouse cursor
- **So that:** The vision model knows exactly where I am pointing on screen and doesn't get confused by text/block cursors in terminals.

**Description:**
Enable the `-C` (capture cursor) flag on the macOS native `screencapture` command in `ScreenCaptureService.gd`.

**Requirements:**
1. Modify the native OS.execute call arguments to include `-C`.

**Acceptance Criteria:**
- **Manual Verification**: Take a screenshot request while pointing at a specific app, and verify the mouse pointer/cursor is present in the captured image.

---

### NAV-25: Application Startup & Screen Capture Efficiency Optimization (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to boot up instantly and capture screenshots without freezing my Mac
- **So that:** Navi behaves like a modern, lightweight, high-performance desktop assistant.

**Description:**
Optimize application startup times by caching the compiled hotkey daemon Swift binary, and resolve screen capture freezing by introducing background threading and JPEG compression to the macOS native capture workflow.

**Requirements:**
1. Check modification timestamps of `hotkey_daemon.swift` and the destination user directory binary, skipping compilation in `InputManager.gd` if the binary is up-to-date.
2. In `ScreenCaptureService.gd`, change the file output format to JPEG (`-t jpg` and `.jpg` extension) to reduce CPU-heavy image compression times.
3. Wrap the synchronous `OS.execute` call to `screencapture` in a background `Thread` and yield frames using `process_frame` in the main loop to keep the Godot process responsive.
4. Add state guards to `ChatUI.gd` to prevent deferred thinking updates from overriding the committed speech bubble layout.
5. Fix recall summary prompt honesty guidelines in `AIService.gd`.

**Acceptance Criteria:**
- **Manual Verification**: Boot the application and verify it launches instantaneously (under 100ms).
- **Manual Verification**: Request a screenshot and verify the capture is completed without freezing the Mac or showing the beachball cursor.
- **GUT Test**: The test suite executes and reports 100% success (0 failures).

---

### NAV-26: Fix Hotkey Window Activation & Spurious Collapse (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to reliably expand to fullscreen and open the chat window when I press the global hotkey
- **So that:** I can instantly interact with Navi without the window immediately collapsing/flashing back to follow mode.

**Description:**
Introduce an input guard in `WindowController.gd` that ignores incoming mouse click events for a brief frame transition buffer during window resizing and setup.

**Requirements:**
1. Maintain a boolean state `_ignore_click_until_ready` inside `WindowController.gd`.
2. Return early in `_input()` for mouse clicks if `_ignore_click_until_ready` is true.
3. Toggle the flag `true` at the start of `_on_hotkey_pressed()` and `_on_fairy_clicked()`, and toggle it `false` one frame after the transition completes.

**Acceptance Criteria:**
- **Manual Verification**: Press the global hotkey (Ctrl+Shift+Option+Space) to open the chat window. The window must expand to fullscreen and remain open.
- **Manual Verification**: Click outside the chat panel or press Escape. The window must shrink back to follow mode (200x200).
- **GUT Test**: Running the test suite passes with 0 errors.

---

### NAV-27: Fixed Window Positioning and Enabled Dragging during Chat Overlay (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi and her chat bubble to stay still in their respective positions when I press the hotkey, and to be able to drag Navi's body to move both her and the chat window
- **So that:** The overlay remains stationary on screen and can be moved interactively without disappearing or drifting off-screen with the mouse.

**Description:**
Fix the follow-mode abort logic so it does not toggle mouse-following back to active on the next frame during chat activation, and fix the fairy click-guard so that dragging is correctly enabled.

**Requirements:**
1. Update `FollowController.gd`'s `abort_navigation()` to accept an optional `restore_follow` argument (defaulting to `true`). Wrap the `is_following = true` re-enabler and the fairy centering tween (`Vector2(100, 100)`) inside this condition.
2. In `WindowController.gd`'s `_on_hotkey_pressed()` and `_on_fairy_clicked()`, call `abort_navigation(false)` to prevent follow mode from being restored during activation.
3. In `WindowController.gd`'s `_set_following()`, set `_fairy.click_enabled` directly without checking for a custom `set` method.

**Acceptance Criteria:**
- **Manual Verification**: Press the global hotkey. The window and fairy must remain static.
- **Manual Verification**: Click-drag the fairy. Both the fairy and the chat UI panels must follow the mouse movement.
- **Manual Verification**: Click outside the chat panel or press Escape. The window must shrink and resume mouse-following.
- **GUT Test**: The test suite runs and passes successfully.

---

### NAV-28: STT Toggle Mode and Whisper Output Cleanups (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** The Speech-To-Text button to behave as a toggle rather than a hold-to-talk button, and to automatically send my voice input upon untoggling, while disabling the text input bar during active recording.
- **So that:** Recording is easier to control and immediately submits my transcribed queries without manual copy-pasting or clutter from Whisper's internal logs.

**Description:**
Update the voice button setup in `ChatUI.gd` to be a toggle-enabled button. Connect it to `_on_voice_toggled(toggled_on: bool)` which disables typing in `input_edit` when active, stops recording when untoggled, transcribes it, and automatically submits the prompt. Clean the transcription output in `STTService.gd` by stripping lines starting with diagnostic prefixes (like `read_audio_data:`).

**Requirements:**
1. Update `_voice_button` in `ChatUI.gd` to use `toggle_mode = true` and connect to the `toggled` signal.
2. In `_on_voice_toggled(toggled_on)`, set `input_edit.editable = !toggled_on`. If untoggled, stop recording, run transcription, and if the output is not empty, call `_on_prompt_submitted(text)`.
3. In `STTService.gd`, filter out Whisper logs/diagnostics by splitting output by newlines and stripping lines starting with `read_audio_data:`, `system_info:`, `whisper_`, `main:`, or `read_wav:`.
4. In `ChatUI.gd`'s `close_chat()`, use `set_pressed_no_signal(false)` to reset the button state without firing a new transcription if closed during active recording.

**Acceptance Criteria:**
- **GUT Test**: Running the test suite passes with 0 errors.
- **Manual Verification**: Click the STT microphone button. It toggles to red, and the text box is disabled. Click it again. The text is transcribed, the box re-enables, and the text is automatically sent right away as a chat message. Any log text from the CLI like `read_audio_data:` is removed, leaving only the transcribed text.

---

### NAV-29: TTS Voice Option Dropdown and Custom Mutter Management (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** A single cohesive voice option dropdown in the settings screen that lists all available platform voices, default procedural mutter, and custom uploaded mutter sounds, along with the ability to add and remove custom mutters with file validation.
- **So that:** I can customize Navi's TTS output voice easily and use custom blip/mutter sound effects that playback with organic Animal Crossing style pitch variations.

**Description:**
Update the Settings UI to replace the separate TTS mode option and manual file path edits with a unified `VoiceOption` dropdown containing platform/system voices, default procedural retro mutter, and custom uploaded mutters. Add a path LineEdit with `+` and `-` buttons to add and delete custom mutter files, validating that files exist and are shorter than 1 second. Update `TTSService.gd` to play back custom paths or fallback appropriately using the `tts_voice` setting.

**Requirements:**
1. Add `tts_voice` and `custom_mutters` keys to `SettingsManager.gd` defaults and migration logic.
2. In `SettingsUI.tscn`, replace the old `MutterRow` layout with a cohesive `VoiceOption` dropdown, a custom mutter path line edit with `+` (add) and `-` (remove) buttons, and an error label.
3. In `SettingsUI.gd`, retrieve system voices using `DisplayServer.tts_get_voices()`, construct the options list, validate loaded streams' durations are under 1.0 seconds when adding new paths, support deleting, and toggle pitch/speed slider visibility depending on whether the selected item is a mutter sound.
4. Update `TTSService.gd` to check `tts_voice` and play back custom mutters or fallback to system TTS appropriately.

**Acceptance Criteria:**
- **GUT Test**: The test suite runs and passes successfully.
- **Manual Verification**: Open settings. Confirm the "Voice Option" dropdown lists available system voices and the procedural retro mutter. Type a valid audio path (e.g. `.wav` under 1s) and click `+` — confirm it is added to the list and selected. Select it and save settings; confirm responses now play using the custom blip. Select a custom voice and click `-` — confirm it is removed from the settings list.

---

### NAV-30: Real-time Asynchronous Stream-based TTS Vocalization (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Responses to be spoken out loud in real time as they stream in character-by-character or sentence-by-sentence
- **So that:** I don't have to wait for the entire text block to compile before hearing the response.

**Description:**
Implement a streaming buffer system inside `TTSService.gd` and connect it to `ChatUI.gd`'s LLM chunk signals. Accumulate sentence clauses (split on punctuations like `.`, `?`, `!`, `\n`) for system voices to queue natural-sounding speech sequentially, and process characters instantly on a streaming character queue in NPC mutter mode while filtering out tag constructs like `<think>...</think>` and BBCode on the fly.

**Requirements:**
1. In `TTSService.gd`, implement `start_speech_stream()`, `add_speech_chunk(chunk)`, and `end_speech_stream()`.
2. In `ChatUI.gd`, hook these streaming endpoints into `_on_ai_request_started()`, `_on_ai_response_chunk()`, and `_on_ai_response_received()`.
3. In `TTSService.gd`'s mutter stream loop, implement a character queue state machine that strips tags (such as thinking blocks and BBCode brackets) on-the-fly.
4. For system TTS, buffer characters until punctuation matches, then call `DisplayServer.tts_speak()` to queue the completed sentence.

**Acceptance Criteria:**
- **GUT Test**: The test suite runs and passes successfully.
- **Manual Verification**: Submit a query. Confirm that in system voice mode, Navi begins speaking out loud as soon as the first complete sentence is printed. In mutter mode, verify Navi blips dynamically with randomized pitch and timing alongside the incoming stream of characters.

---

### NAV-31: Deterministic Visual Router & Fast Prompt Tool Awareness (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to automatically detect pointers/visual keywords (like 'behind you', 'behind', 'chat', 'saying') and immediately route to screenshot capturing, and also to be aware in the fast-prompt fallback that tools are available via [ESCALATE]
- **So that:** Navi does not refuse visual tasks or say she is unable to see the screen when asked about elements behind or in front of her.

**Description:**
Add new deterministic visual pointers and chat/speech keywords to the prompt router, and update the Tier 1 Fast Model system prompt instructing the model that screenshots and thinking tools are available.

**Requirements:**
1. Update `PROMPT_SKILL_RULES` in `scripts/AIService.gd`'s `VISUAL_FULL` block to include `"behind you"`, `"behind"`, `"chat"`, and `"saying"`.
2. Update the fallback `fast_system_prompt` in `send_prompt()` to explicitly let the model know that screenshot and thinking tools are accessible via `[ESCALATE]` when visual/reasoning context is requested.
3. Write test cases in `test/test_ai_service.gd` verifying that these keywords match the deterministic screenshot trigger.

**Acceptance Criteria:**
- **GUT Test**: `test_deterministic_classification_patterns_match` passes.
- **Manual Verification**: Ask "what is Pablo saying in the chat behind you?" — verify it is classified directly as `take_screenshot` (VISUAL_FULL) in Layer 0.


---

### NAV-32: Hybrid Local & Cloud TTS Voice Integration with Toggle Filtering (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** To choose between Local Neural (Piper), Cloud Neural (OpenAI / Edge / Gemini fallback), System default voices, and retro Mutter sounds, and filter the voice option dropdown dynamically via checkable list tags.
- **So that:** I can enjoy natural-sounding neural speech offline or online, filter out unwanted voice categories, and keep settings neat.

**Description:**
Add checkboxes to filter voice options in Settings UI, integrate a local Piper TTS subprocess running asynchronously on a background thread, support OpenAI-compatible TTS endpoints, and implement keyless free cloud TTS streaming (Google Translate fallback).

**Requirements:**
1. In `SettingsManager.gd`, define keys for `tts_provider`, `piper_bin_path`, `piper_model_path`, `piper_speed`, `cloud_tts_provider`, etc.
2. In `SettingsUI.tscn`, add `ShowNeuralCheck`, `ShowSystemCheck`, and `ShowMutterCheck`.
3. In `SettingsUI.gd`, link the checks to rebuild `VoiceOption` containing `local_piper`, `cloud_openai`, `cloud_edge`, `cloud_gemini`, Mutter, and System options.
4. In `TTSService.gd`, run the `piper` CLI executable in a background thread, write to a WAV file, and play via `AudioStreamPlayer`. Implement OpenAI TTS POST requesting and free Google GET requesting with direct memory MP3 streaming.
5. Bug Fix: Update `_speak_system_sentence` to route to `_speak_local_piper` and `_speak_cloud_tts` so streaming text correctly uses the selected local/cloud neural voice instead of falling back to system default.
6. Bug Fix: Implement an audio stream playback queue (`_playback_queue`) to play streamed sentences sequentially instead of cutting each other off. Pass the text to Piper as a positional argument (removing the invalid `--text` flag) to prevent the literal word "text" from being spoken, and generate unique WAV file names that are deleted immediately after loading into memory to avoid conflicts. Implement strict sequence indexing (`_next_sequence_id` / `_synthesis_results`) to ensure sentences are queued for playback in their correct reading order, even if parallel background threads complete synthesis out of order.
7. Bug Fix: In `SettingsUI.tscn` and `SettingsUI.gd`, add `CustomVoiceHBox` allowing users to input a local path to import custom `.onnx` Piper voice models (and their config files) to `res://bin/voices/`, or delete custom model files directly from disk by clicking the minus (`-`) button.

**Acceptance Criteria:**
- **GUT Test**: The test suite runs and passes successfully.
- **Manual Verification**: Toggle the Neural, System, and Mutter checkboxes and confirm the dropdown updates immediately. Save with a local or cloud voice selected and confirm vocalization plays back successfully.


---

### NAV-33: Standalone C++ Piper Compilation and Multi-Platform Bundling (BACKLOG)
**User Story:**
- **As a:** Navi developer / package distributor
- **I want:** To bundle standalone pre-compiled C++ Piper binaries for macOS, Windows, and Linux inside the app's binary distribution
- **So that:** End-users can run high-fidelity local neural TTS out-of-the-box without needing Python, pip, or system compilation tools installed.

**Context:**
Currently, local testing relies on system Python packages installed via `pip install piper-tts`. To package and distribute the app as a self-contained application, we must bundle standalone C++ Piper executables.

**Description:**
Build/obtain the compiled C++ standalone Piper binaries for macOS (Apple Silicon/Intel), Windows (`.exe`), and Linux, place them in platform-specific subfolders under `bin/`, and update `TTSService.gd` to invoke the correct platform binary.

**Requirements:**
1. Compile or download compiled standalone C++ Piper executable binaries for Target OS platforms.
2. Structure the `bin/` directory to hold platform-specific executables (e.g. `bin/osx/piper`, `bin/windows/piper.exe`, `bin/x11/piper`).
3. Update `TTSService.gd` to dynamically check the current platform using `OS.get_name()` and execute the correct relative path.

**Acceptance Criteria:**
- **Manual Verification**: Run the compiled app bundle on a machine without Python/pip installed, select "Neural: Local Piper", and verify speech synthesis functions successfully.

---

### NAV-34: Prompt Classifier Expansion for Visual Pointers (COMPLETED)
**User Story:**
- **As a:** Navi user asking where things are on my screen
- **I want:** Navi to automatically trigger a full screen capture when I request coordinate pointing or finding
- **So that:** Navi has the visual context needed to locate and point out the requested objects.

**Context:**
The deterministic prompt classification layer routes visual intents directly to `take_screenshot` before calling LLMs to avoid model refusal or overconfidence.

**Description:**
Add new spatial pointing keywords to the prompt classification rules.

**Requirements:**
1. Update `PROMPT_SKILL_RULES` in `scripts/AIService.gd` under the `VISUAL_FULL` block to include `"point to"`, `"point at"`, `"navigate to"`, `"where is"`, `"where are"`, `"find the"`.

**Acceptance Criteria:**
- **Manual Verification**: Ask "where is my terminal?" and verify the request is classified directly as `take_screenshot` (VISUAL_FULL).

---

### NAV-35: Interactive Step-by-Step Response Parser (COMPLETED)
**User Story:**
- **As a:** Navi user interacting with Navi
- **I want:** Navi to break its long descriptions or sequence pointers into distinct steps
- **So that:** I can follow them one by one without being overwhelmed by a wall of text.

**Context:**
Rather than generating chunks sequentially (which would consume excessive time and tokens), the model returns the entire response structure. Slicing happens client-side before rendering.

**Description:**
Implement segment parsing inside the Chat UI to split LLM replies into interactive step lists.

**Requirements:**
1. In `ChatUI.gd`, implement `_parse_interactive_steps(text: String) -> Array[Dictionary]` to search for both `[PAUSE]` tags and coordinate tags (`[SKILL: point_to: X, Y]`).
2. Squeeze the parsed output into segments holding text and coordinate vector properties.

**Acceptance Criteria:**
- **GUT Test**: Verifies that a response text with multiple point tags and pauses compiles into the correct sequence of step objects.

---

### NAV-36: Dynamic 'Next' Button & User Confirmation Flow (COMPLETED)
**User Story:**
- **As a:** Navi user following step-by-step guidance
- **I want:** The chat interface to wait for my confirmation before showing the next step, and show a clear "Next" button
- **So that:** I can read and follow the current step at my own pace before Navi moves on.

**Context:**
The Send button serves double-duty to save screen space, morphing to "Next" dynamically based on conversational state.

**Description:**
Create the interactive multi-step navigation loop, morphing Send button to Next, and allowing Enter key progression.

**Requirements:**
1. Connect `text_changed` on the input LineEdit to dynamically morph Send to "Next" when a step sequence is active and text is empty.
2. Advance the step index and execute the next segment on Enter or clicking Next.
3. If the user types a new query and submits it, abort/preempt the active sequence, returning Navi to follow mode, and submit the new query.

**Acceptance Criteria:**
- **GUT Test**: Verifies that Send button text morphs to "Next" when sequence is active and input is empty.
- **GUT Test**: Verifies that submitting an empty prompt advances steps, and submitting a non-empty prompt preempts and aborts.

---

### NAV-37: Coordinated Navigation and Status Colors (COMPLETED)
**User Story:**
- **As a:** Navi user watching the fairy help me
- **I want:** The status light above Navi's head to accurately represent its current action color (Amber for screen check, Purple for thinking, Green for moving)
- **So that:** I have clear visual feedback on Navi's physical activity.

**Context:**
Fairy status light visual states are pulsed dynamically using Tweens on the `StatusLight` sprite above the fairy's center node.

**Description:**
Map status indicator colors to active workflows, and ensure follow-mode is restored upon guide completion.

**Requirements:**
1. Use `Color(1.0, 0.75, 0.0)` (Amber) during screenshot captures.
2. Use `Color(0.6, 0.2, 1.0)` (Purple) during heavy model reasoning.
3. Use `Color(0.2, 0.8, 0.2)` (Green) during guide coordination movement.
4. On guide sequence completion or abort, call `abort_navigation(true)` to reset Navi back to follow mode.

**Acceptance Criteria:**
- **GUT Test**: Verifies that setting and clearing guide states triggers correct color mods.

---

### NAV-38: Heavy LLM Prompt Update for Sequence Planning (COMPLETED)
**User Story:**
- **As a:** Navi user requesting guide sequences
- **I want:** Navi's reasoning brain to structure its guides using step breaks and point tags
- **So that:** The guide flows naturally as a multi-turn conversation.

**Context:**
The system instructions guide model output layouts to guarantee the presence of coordinate tags and pauses for guide flows.

**Description:**
Teach the heavy model how to format step-by-step pauses and coordinates in its system prompts.

**Requirements:**
1. In `AIService.gd`'s `heavy_system_prompt`, instruct the model to use `[PAUSE]` for conversational text pauses and `[SKILL: point_to: X, Y]` for coordinate-based pauses.

**Acceptance Criteria:**
- **Manual Verification**: Run a query and check logs to confirm the heavy system instructions contain the formatting definitions.

---

### NAV-39: GUT Integration Tests for Multi-Turn Step Guidance (COMPLETED)
**User Story:**
- **As a:** Navi developer
- **I want:** To ensure the step-by-step guide feature functions reliably under all circumstances
- **So that:** The codebase remains clean, robust, and free from regression bugs.

**Context:**
All additions to the visual guide loops must be fully covered by the GUT test runner to verify coordination safety and prevent window positioning leaks.

**Description:**
Create GUT automated tests to verify the complete interactive multi-turn guide flow.

**Requirements:**
1. Add new automated test suites in `test_agent_skills.gd` covering classifier routing, tag parsing, button state shifts, status colors, and flow completion.

**Acceptance Criteria:**
- **GUT Test**: The test suite runs and passes successfully.

---

### NAV-40: Step-by-Step Movement Log and Prompt Robustness (COMPLETED)
**User Story:**
- **As a:** Navi developer / user
- **I want:** Clear movement logs in the console output and highly-explicit prompt instructions for pointing coordinates
- **So that:** I can easily trace and verify Navi's coordinate-guided movement transitions, and the AI model consistently formats pointing locations with coordinate tags.

**Context:**
Visual queries routing to Stage 4 heavy models could occasionally output conversational paragraphs without the necessary step tag formatting. Furthermore, tracking movement transitions was difficult due to a lack of console feedback.

**Description:**
Add console log prints in ChatUI for step-by-step guidance transitions, and expand thinking_system_prompt guidelines with highly-detailed coordinates format examples.

**Requirements:**
1. In `ChatUI.gd`, print `ChatUI: [MOVEMENT] Moving to step coordinate: ...` when `point != null`, and `ChatUI: [MOVEMENT] Aborting step movement` when `point == null`.
2. Print `ChatUI: [MOVEMENT] closing/preempting guidance sequence.` inside preemption blocks of `close_chat()` and `_on_prompt_submitted()`.
3. In `AIService.gd`, reinforce `thinking_system_prompt` with strict rules on screen corner coordinates mapping (e.g. (10, 70) for top-left, etc.).
4. In `AIService.gd`, expand `PROMPT_SKILL_RULES` under `VISUAL_FULL` to include pointing and movement verbs: `"move"`, `"move to"`, `"point"`, and `"point out"`.
5. Add unit test assertions in `test_ai_service.gd` for the new classification verbs.

**Acceptance Criteria:**
- **GUT Test**: The test run displays the new print logs when invoking interactive guidance steps.
- **GUT Test**: Assertions confirm that prompts containing "move to" or "point out" successfully resolve to the "take_screenshot" skill.
- **Manual Verification**: Submit pointing prompts and confirm the heavy model correctly emits coordinate tags and logs are printed.

---

### NAV-41: Full-Screen Interactive Movement and Thought Reformatting (COMPLETED)
**User Story:**
- **As a:** Navi user following step-by-step pointers
- **I want:** Navi to physically glide to coordinate points inside the full-screen chat window, and the intermediate thoughts to render as normal text blocks
- **So that:** Navi visually guides my attention to target regions, and the thoughts read cleanly as standard textual logs.

**Context:**
Moving the window itself during full-screen interactive panels shifts the entire canvas off-screen. Instead, the FairyVisuals node must travel relative to the viewport. Also, thought trails were wrapped in custom italic gray emoji formatting that cluttered the speech bubble.

**Description:**
Update `FollowController` to detect fullscreen panels and interpolate the `FairyVisuals` node coordinates rather than the OS window bounds. Remove BBCode thought wraps in `ChatUI` to output plain text.

**Requirements:**
1. In `FollowController.gd`, check `main_node._active_panel` to determine if full-screen mode is active.
2. If full-screen, lerp the `FairyVisuals` node's local position towards the target coordinates (applying quadrant-based margin offsets) in `_process(delta)`.
3. In full-screen mode, draw pointer arrows dynamically pointing from the moving fairy to the exact target coordinates, and trigger `ChatUI.reposition_ui` per frame.
4. In `ChatUI.gd`, strip `[color=#4a4a5e][i]💭 ` formatting wrappers from all thinking update rendering code block pipelines.

**Acceptance Criteria:**
- **Manual Verification**: Run spatial pointing queries; verify the fairy moves inside the full-screen window and intermediate thoughts show as clean text.

---

### NAV-42: Raw Response Streaming Transmission and Thought Leak Suppression (COMPLETED)
**User Story:**
- **As a:** Navi developer / user
- **I want:** The raw completed LLM response to be passed to the Chat UI upon request completion, and raw internal reasoning thoughts to be suppressed from display
- **So that:** Interactive guidance coordinates and pause tags are properly parsed and executed client-side, and only rephrased first-person thoughts are displayed in the bubble.

**Context:**
Streaming response chunks are filtered on-the-fly to strip skill tags from the text stream, which caused the client to receive a plain text string devoid of instruction tags at request completion. Additionally, thought lines that did not match rephrasing patterns leaked verbatim into the user bubble.

**Description:**
Update `AIService` to emit the raw unfiltered response string in the `response_received` signal, and to suppress unmatched thought lines by returning `""` in `_apply_personality_voice`.

**Requirements:**
1. In `AIService.gd`, update `response_received.emit(text)` to pass the actual raw response text rather than empty strings `""`.
2. In `_apply_personality_voice`, add patterns for spatial keywords: `"pointing"`, `"coordinates"`, `"point to"`.
3. Return `""` for unmatched thought lines in `_apply_personality_voice` so they are excluded from the display.

**Acceptance Criteria:**
- **GUT Test**: The automated test suite executes and passes successfully.
- **Manual Verification**: Submit pointing prompts and confirm that coordinate movement steps now execute properly in fullscreen mode, and raw reasoning bullets are suppressed.

---

### NAV-43: Conversational Tag Stripping and Auto-Advancement in Guidance Steps (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Raw internal skill tags to be completely stripped from all visual and vocal interfaces, and the fairy to automatically start coordinate guidance sequences.
- **So that:** I only see/hear conversational replies, and Navi immediately moves to target positions without requiring manual input to skip introductory steps.

**Context:**
Previously, completed raw responses could leak internal bracketed tags (e.g. `[SKILL: ...]`) to the Chat UI and the system TTS engine. Additionally, when a guidance sequence began with an introductory conversation block, its step had no coordinates (`point = null`), requiring the user to press "Next" once before Navi would actually start moving, which caused confusion.

**Description:**
Implement regex-based tag stripping in `ChatUI.gd` and `TTSService.gd` to hide skill/pause markup from visual history and native synthesization. Add auto-advancement for Step 0 when its coordinate is null to trigger immediate flight/movement on sequence start. Refactor the movement logic to use smooth Tween-based transitions instead of frame-by-frame lerping in fullscreen mode, and prevent the fairy from prematurely resetting back to follow mode at the end of sequences.

**Requirements:**
1. Implement a helper method `_strip_skill_and_pause_tags` in both `ChatUI.gd` and `TTSService.gd` to clean text using regex.
2. In `ChatUI.gd`, apply stripping to the committed text block in `_on_ai_response_received` and interactive steps in `_execute_current_interactive_step`.
3. In `ChatUI.gd`'s `_execute_current_interactive_step`, if Step 0 is non-pointing and there are more steps, automatically advance to Step 1 and execute the step.
4. In `TTSService.gd`, apply stripping in `speak` and `_speak_system_sentence` functions.
5. In `ChatUI.gd`, only abort/reset navigation at the end of interactive steps if the last step does not point to any target (`point == null`), allowing the fairy to stay parked at the final destination. Unconditionally reset navigation on new prompt submissions.
6. Refactor `FollowController.gd` to use `create_tween()` to animate the fairy's position to the target in fullscreen mode, track active tweens via `_active_tween`, and prevent tweening to `(100,100)` when aborting navigation from fullscreen.
7. Rephrase misleading console logs from `"Aborting step movement"` to `"Step has no coordinate; maintaining position."`.
8. Add unit tests for tag stripping and auto-advancement in `test_chat_ui.gd` and verify that the full test suite passes.

**Acceptance Criteria:**
- **GUT Test**: The automated test suite executes and passes successfully.
- **Manual Verification**: Spatial pointing queries start moving Navi immediately with a smooth Tween animation, she remains parked at the final coordinate, and no raw brackets/tags are visible in the chat bubble or read aloud by system voices.
