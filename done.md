# Navi Completed Tickets

This document contains completed, cancelled, or reverted historical tickets.

## Template & Guidelines

## Ticket Template

```markdown

---

## Tickets

## Accuracy Audit (2026-09-06)

The completed-ticket log below was audited against the code at commit `bb51774`. Historical entries
are **left unedited** — they record what was believed at the time — but the following corrections
apply. Where a ticket describes behaviour that no longer exists, the cause is almost always a later
ticket that superseded it without amending the earlier entry.

### Superseded, not wrong when written

- **NAV-BUG-02** documents three-layer routing (Layer 0 classifier, Layer 1 fast model, Layer 2 heavy
  model). **NAV-59** later collapsed this to a single tier. Only Layer 0 (`PROMPT_SKILL_RULES`) still
  exists. Layers 1 and 2, and the `[ESCALATE]` protocol they used, are gone.
- **NAV-BUG-05** documents a visual-refusal self-correction pipeline. **NAV-59** removed it. The
  constant `_VISUAL_REFUSAL_PATTERNS` (`AIService.gd:153`) and the helper `_get_retraction_message()`
  (`AIService.gd:1908`) remain with **zero callers** — dead code, not live behaviour.
- **NAV-20** describes routing visual queries to a separate "heavy" model. After NAV-59 there is only
  one model. Its test `test_visual_queries_escalate_to_heavy_model` still exists and passes, but its
  name describes an architecture that no longer exists.
- **NAV-BUG-10** added VAD; **NAV-69** deprecated it. The deprecation works, but via a hardcoded
  special case in `SettingsManager.get_setting()` (`:230`) that always returns `true` for
  `enable_push_to_talk` regardless of the stored value. Four call sites still read that key, and
  `ChatUI._silence_duration` (`:34`) survives as an unused variable.

### Inaccurate as written

- **NAV-68**, description item 3, claims `_apply_personality_voice()` was "bypassed ... to return raw
  cleaned thoughts". It was **not**. The function is still defined at `AIService.gd:1926` and still
  applied to every `<think>` line at `AIService.gd:1817` and `:1826`. Thought lines are still wrapped
  in hardcoded templates ("Ugh, ...", "Okay so, ..."). Superseded by **NAV-86**.
- **NAV-59** claims model settings were consolidated to a single field. Partially true: the UI shows
  one field, but `local_thinking_model` and `cloud_thinking_model` remain as separate stored keys and
  are still read at `AIService.gd:312`. `_deliver_final_response()` also still carries an unused
  `fast_model` parameter (`:479`) from the removed two-tier design, and the README still documents
  two tiers.

### Test claims that do not resolve

Seven test functions named in acceptance criteria do not exist in `test/`. Some were presumably
removed alongside the features they covered, but the criteria were never amended:

| Claimed test | Ticket |
|---|---|
| `test_apply_personality_voice_annoying` | NAV-21 |
| `test_apply_personality_voice_fallback` | NAV-21 |
| `test_thought_trail_accumulates` | NAV-21 |
| `test_thought_trail_committed_on_response_received` | NAV-21 |
| `test_scroll_following_enabled` | NAV-17 |
| `test_visual_history_retains_multiple_turns` | NAV-17 |
| `test_escalation_rules_with_conversational_escalate_text` | NAV-BUG-07 |

### Ticket ID collisions

Sixteen IDs are used twice (NAV-67 three times), because numbering restarted at some point rather
than continuing: NAV-59, 67, 68, 69, 70, 71, 73, 74, 75, 76, 77, 78, 79, 80, NAV-BUG-06, NAV-BUG-07.
IDs are **not** being renumbered, since inbound references would break — but every ID at or below
NAV-80 is ambiguous and must be cited together with its title. New tickets start at NAV-81 and
continue monotonically.

### Verified accurate

NAV-33 (correctly REVERTED — `bin/piper` is a Python wrapper script, with no platform subfolders and
no `OS.get_name()` dispatch in `TTSService.gd`), NAV-49 (`NaviUtils` autoload), NAV-53 (native tool
calling), NAV-54 (modular skill classes), NAV-55 (confirmation flow wired end to end, though it gates
only `point_to`), NAV-60 through NAV-65 (emotion system), NAV-77 (`ErrorBus`), and the NAV-69 /
NAV-71 scratchpad and continuation tests.

---

### NAV-UI: Full UI Refactor (DONE)

**Changes**
- **Text Legibility**: All text uses white with proportional black outlines (2-4px based on font size). Coverage extended to CheckBox, CheckButton, OptionButton, SpinBox, and programmatically-created nodes.
- **Accent Color System**: Panel backgrounds are now a fixed dark neutral (`Color(0.06, 0.06, 0.08, 0.88)`). Navi's mood color is used only as a subtle accent on borders, the Save button, and the chat pointer triangle. Text is always readable regardless of mood state.
- **Settings UX Overhaul**: All 25+ settings now have plain-English hover tooltips. Settings are organized into 5 collapsible sections: Behavior, Appearance, AI & Model, Voice, and Advanced. Developer-facing labels replaced with user-friendly descriptions.
- **Code Cleanup**: Removed the deprecated Voice Activity Detection (VAD) dead code from `ChatUI.gd` — the fully commented-out `_start_vad_monitoring()` function, the stubbed-out `_resume_stt_recording_when_done_speaking()` function and its three call sites, and scattered leftover commented-out push-to-talk auto-trigger blocks. The live push-to-talk feature itself (`enable_push_to_talk` setting, hotkey handling in `WindowController.gd`) was left untouched.

---

### NAV-78: Install Piper TTS Dependency UI and Script (DONE)

**User Story:**
- **As a:** User running local offline voice output
- **I want:** A script to install the Piper TTS python package and an easy way to verify/install it within the settings panel
- **So that:** I can resolve missing local Piper issues directly or using a simple script, and see when it is correctly set up.

**Description:**
- Created `install_piper.sh` in the project root to install `piper-tts` using the local python environment.
- Added checking logic to the settings page (`_check_piper_engine_installed()` / `_check_piper_engine_state()` in `SettingsUI.gd`) to verify if `piper` is installed by executing the wrapper and checking the exit code.
- Added an "Install" button in the settings UI (under Voice) wired to `_on_install_piper_pressed()`, which triggers a background installation of `piper-tts` and reflects success/failure state on the button.

---

### NAV-80: Prevent Duplicate Hotkey Daemon Instances (DONE)
**User Story:**
- **As a:** Navi user playing games like League of Legends
- **I want:** The application to ensure only a single instance of the hotkey helper daemon runs in the background
- **So that:** Duplicate daemon processes do not accumulate, hook the window server event loops repeatedly, and cause system-wide micro-stutters or input lag.

**Description:**
1. Modified [InputManager.gd](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scripts/InputManager.gd) to execute `killall hotkey_daemon` on startup and configuration reload before launching the new daemon.
2. Manually terminated all 28 orphaned instances of `hotkey_daemon` active on the host machine.

---

### NAV-UI: Display Order Adjustment (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi (FairyVisuals) to be displayed on top of the Chat window but behind the Settings window
- **So that:** Navi does not get hidden by the chat dialogue bubble, but the settings panel remains fully accessible and overlayed on top of her.

**Description:**
1. Modified `Main.tscn` to reorder the instantiation of the child nodes.
2. Placed `ChatUI` first, followed by `FairyVisuals`, and finally `SettingsUI`. This naturally adjusts the Godot canvas draw order so Navi is drawn on top of the chat window but behind the settings panel.

---

### NAV-79: Visual Analysis Capability Error Handling (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to respond politely and in character when a local model lacks vision capabilities
- **So that:** I understand exactly why visual analysis failed and how to configure settings to fix it, while also experiencing realistic emotional state changes (power decreasing) when Navi fails to perform an action.

**Description:**
1. Created personality-voiced error helper methods in `AIService.gd` matching `annoying`, `snarky`, `professional`, and default/friendly personalities to explain when local or cloud vision requests fail.
2. Updated `_deliver_final_response()` return type to `bool` to signal success/failure of the stream delivery back to callers.
3. Updated call sites in `AIService.gd` to pass `analysis_failed: bool` to the `_evaluate_emotion()` method.
4. Updated `_evaluate_emotion()` and `EmotionEngine.gd` to check for `analysis_failed` and decrease the Triforce Power feeling by `5.0` points when true (clamping within `[-10.0, 10.0]`).
5. Updated `ChatUI.gd` to speak request failures aloud via `TTSService.speak()`.
6. Wrote a new unit test in `test_ai_service.gd` (`test_unsupported_vision_model_error_decreases_power`) to verify the message generation and emotional power reduction.

---

### NAV-69: Short-Term Memory Scratchpad System (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to write private planning notes in a scratchpad that persists across conversational turns
- **So that:** Navi can plan multi-step answers, formulate clarifying questions, and refer back to information later.

**Context:**
Currently, Navi has no private state memory between turns. All history is user-visible, meaning she cannot "think ahead" or structure long-term responses without dumping it all to the screen.

**Description:**
1. Added `_short_term_memory` string property to `AIService.gd` to persist private context during active sessions.
2. Implemented Regex block extraction for `<scratchpad>` and `</scratchpad>` tags in `AIService._process_reply_meta()`.
3. Created `NaviUtils.strip_scratchpad_block()` to cleanly remove planning blocks from user-visible labels, with a fallback that displays scratchpad text if the conversational response is empty.
4. Injected `_short_term_memory` into the system prompts inside `_build_identity()`.
5. Cleared `_short_term_memory` inside `clear_history()`.

---

### NAV-70: Multi-Step Response Continuation Loop (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to output responses in sequential stages by triggering background continuations (`[CONTINUE]`)
- **So that:** I can have realistic, paced conversations and intervene/interrupt between steps.

**Description:**
1. Updated `send_prompt` signature in `AIService.gd` to support `is_continuation: bool`.
2. Skipped classification and emotion pre-evaluation on continuation requests.
3. Automatically scheduled background continuations using a token-based timer when `[CONTINUE]` is parsed.
4. Configured the continuation sequencer to verify `TTSService.is_speaking()` and enforce a 2.0-second pause.
5. Setup logic to cancel the continuation if the user starts typing or submits a new prompt.
6. Injected `(Continue)` hidden messages in history to maintain Gemini role alternation compliance.

---

### NAV-71: Unit & Integration Testing for Multi-Step System (DONE)
**User Story:**
- **As a:** Developer
- **I want:** Comprehensive GUT tests for the scratchpad and continuation systems
- **So that:** I can verify correct tag stripping, prompt injection, continuation scheduling, and interruption behavior.

**Description:**
1. Implemented unit tests for `<scratchpad>` stripping and fallback recovery in `test_navi_utils.gd`.
2. Added `test_scratchpad_meta_extraction` and `test_continuation_cancelled_by_new_prompt` inside `test_ai_service.gd`.
3. Verified full test suite runs and passes cleanly headlessly.

---

### NAV-77: Speech-to-Text (STT) User Instructions in Settings UI (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Clear instructions in the settings panel explaining how to use voice commands via the hotkey
- **So that:** I know how to dictate, submit, and cancel voice entries without guess-work or unexpected behaviors.

**Description:**
1. Added `VoiceInstructionsLabel` in [SettingsUI.tscn](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scenes/SettingsUI.tscn) directly under the global interaction hotkey row. It outlines the push-to-talk holds, auto-submit on release, and the quick-tap to cancel action.
2. Added a detailed hover tooltip to `HotkeyLabel` in [SettingsUI.tscn](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scenes/SettingsUI.tscn).
3. Added a new "How to Interact & Voice Commands" guide section to [README.md](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/README.md) detailing interaction states.

---

### NAV-74: Portable Local Neural TTS (Piper) Setup (DONE)
**User Story:**
- **As a:** Developer setting up Navi on a new machine
- **I want:** The local TTS dependency to run out of the box without referring to hardcoded paths on another user's machine
- **So that:** Project setup is quick, robust, and portable.

**Context:**
`bin/piper` was a wrapper script hardcoded to a specific developer's path: `/Users/dylangrowcoot/.pyenv/...`.

**Description:**
1. Updated [bin/piper](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/bin/piper) to dynamically look for python/python3 on the user's environment `$PATH` instead of using the hardcoded absolute pyenv path.
2. Verified that the `piper` module is available in python, outputting a clean developer-facing error message with pip installation instructions if missing.
3. Added fallback safety tests in [test_stt_tts.gd](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/test/test_stt_tts.gd) to verify Whisper and Piper degrade gracefully if local environments fail.

---

### NAV-75: Model Bootstrapping & Setup Script / In-App Downloader (DONE)
**User Story:**
- **As a:** New developer or user setting up the project
- **I want:** An easy and automated way to download the required large models that are excluded from Git
- **So that:** I don't have to manually locate and download weights files from third-party sites.

**Description:**
1. Created [setup_models.sh](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/setup_models.sh) developer utility script in the project root to automatically download Whisper and default Piper voice models into local folders and set binary executable permissions.
2. Programmatically added an `OfflineModelsRow` to the settings panel in [SettingsUI.gd](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scripts/SettingsUI.gd) containing a **Download** button.
3. Implemented asynchronous downloading in Godot using `HTTPRequest` nodes to download weights to the writable `user://models/` data directory, complete with real-time progress text.
4. Auto-configured the settings to point to the downloaded `user://` models once complete and re-populated the local Piper voice options.
5. Updated [README.md](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/README.md) to document downloader steps and packaging instructions.

---

### NAV-76: Export Packaging & Global Hotkey Distribution (DONE)
**User Story:**
- **As a:** Developer exporting Navi for distribution
- **I want:** The global hotkey daemon and local binaries to be packaged and resolved correctly in the exported app without compiling Swift at runtime
- **So that:** Users running the compiled application can register hotkeys and use offline voice/speech features out-of-the-box.

**Description:**
1. Built a pre-compiled macOS binary for [hotkey_daemon.swift](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scripts/hotkey_daemon.swift) and saved it to [bin/hotkey_daemon](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/bin/hotkey_daemon).
2. Updated [InputManager.gd](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scripts/InputManager.gd) to check for and load the pre-compiled `res://bin/hotkey_daemon` binary, falling back to Swift compilation (`swiftc`) only if missing.
3. Documented manual packaging instructions in [README.md](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/README.md) for copying the `bin/` directory relative to exported builds.

---

### NAV-73: Multi-Pass Agentic Tool Calling Loop (DONE)
**User Story:**
- **As a:** Developer / Navi user
- **I want:** Native LLM tool calls to execute and have their outcome fed back to the LLM
- **So that:** Navi can run multi-step agentic reasoning loops and solve complex queries requiring tools.

**Context:**
Previously, when a tool call was received, the tool call was executed but the outcome was never fed back to the LLM. The LLM's turn finished immediately, breaking agentic loops.

**Description:**
1. Implemented a synchronous execution helper `_execute_tool_synchronously` in `AIService.gd`.
2. Created a member variable `_last_tool_call` to track the last parsed tool name and arguments.
3. Updated `_request_llm_stream` to store parsed tool calls, handle tool/assistant history payloads correctly for Ollama and Gemini, and support followup passes without clearing the response UI.
4. Implemented a multi-pass agentic loop inside `_deliver_final_response` (for both thinking and fast paths) that requests the LLM, executes tool calls, appends the tool call/response to the message history, and requests the LLM again in a loop until the final text response is returned.
5. Refactored signal connections to avoid duplicate execution of tools.

**Acceptance Criteria:**
- **GUT Test**: `test_agentic_tool_calling_loop` verifies that a tool call starts an agentic loop pass, feeds the tool output back, and concludes with a text response.

---

### NAV-68: Voice-Text Streaming Sync, Emotion State Preservation & In-Character Responses (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to stream voice and text simultaneously, retain her emotional state across system reboots, and output natural in-character thoughts and status lines
- **So that:** Navi behaves like a fluid, persistent, and authentic personal companion with zero lag and no hardcoded tone templates.

**Context:**
1. Visual/complex queries preemptively disabled stream-based TTS, causing Navi to remain completely silent during generation and then read back the full output at the very end.
2. Running unit tests directly overwrote and deleted the persistent state file `user://emotion_state.json`, resetting Navi to gray defaults on the subsequent boot.
3. Streaming thoughts from the `<think>` block were discarded and replaced with hard-coded rephrasing templates (often with legacy annoying tones).

**Description:**
1. Commented out preemptive disabling of stream TTS. Dynamically transition from streaming TTS to step-by-step guidance only when a step or pause tag is actually parsed in response chunks.
2. Implemented `before_all()` and `after_all()` backup/restore logic in `test_emotion_state.gd` to protect the user's real `emotion_state.json` file.
3. Bypassed the template-based `_apply_personality_voice()` translation table in `AIService.gd` to return raw cleaned thoughts. Added a category-mapped status helper for deterministic Stage 0 status updates.

**Acceptance Criteria:**
- **GUT Test**: Running the test suite passes with zero errors/regressions and restores the user's state.
- **Manual Verification**: Verify simultaneous voice/text streaming for complex/visual queries, persistent wings color on restart, and personality-aligned status lines.

---

### NAV-67: Unify Visual Features (Two-Color Theme) (DONE)
**User Story:**
- **As a:** Navi user on various desktop backgrounds
- **I want:** Navi's visuals (fairy body, wings, loading spiral, settings UI, and chat bubble) to follow a clean two-color theme (mood base color + darker accent outline) with highly-legible outlined white text
- **So that:** Navi is extremely visible and readable on all kinds of dark, light, or busy wallpapers/screens.

**Context:**
The UI backgrounds, text colorings, and fairy outlines are currently hardcoded or use semi-translucent blue borders. Everything should dynamically adapt to the active fairy base color and its darker `.darkened(0.4)` counterpart.

**Description:**
Implement outline drawing on the fairy core, wings, and loading spiral. Update the panel backgrounds and borders of the Chat and Settings UI dynamically based on the fairy's base color. Apply recursive white coloring and black outlines to all text overlay controls.

**Acceptance Criteria:**
- **GUT Test**: Running the test suite passes with zero errors/regressions.
- **Manual Verification**: Run the app, verify that the spiral, wings, and core have distinct darker outlines, the Settings/Chat panels match the base color with a darker border, and all text has clean outlines.

---

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

---

### NAV-BUG-07: Deprecate Llama Model References in Settings UI (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** The Settings UI to reference only the consolidated local model (`gemma4:e4b`)
- **So that:** I am not confused by references to the deprecated Llama model.

**Root Cause:**
With the recent consolidation of local models around `gemma4:e4b`, references to `llama3` in the Settings UI placeholder text were outdated.

**Fix:**
Removed the deprecated `"llama3 / "` prefix from the `ModelEdit` LineEdit placeholder text in `SettingsUI.tscn` so that it reads `"gemma4:e4b"`.

**Acceptance Criteria:**
- **Manual Verification**: Open Settings and verify the placeholder for the AI Model is `"gemma4:e4b"`.

---

### NAV-BUG-06: Local Model Startup Preload Discrepancy & TTSService Execution Logging (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to preload the correct thinking model at startup and output debugging information for TTS failures
- **So that:** The first prompt response starts immediately without model loading delays, and TTS issues can be easily diagnosed.

**Root Cause:**
1. **Model Loading Delay**: At startup, `AIService._ready()` preloaded the model configured in the settings manager (`local_model`, e.g., `llama3.2:3b`). However, since thinking was enabled, the `WindowController` initialization ran shortly after and updated `AIService`'s config to use `local_thinking_model` (`gemma4:e4b`). When the first prompt arrived, Ollama had to load `gemma4:e4b` on the fly because it was never preloaded, causing a significant response delay.
2. **Silent TTS Failure**: TTS playback did not print any logs, making failures (such as subprocess execution errors or active speaker ID mismatches) impossible to diagnose from standard logs.

**Fix:**
1. Updated `AIService._on_settings_updated()` to check if `enable_thinking` is true, and if so, correctly set `heavy_model` to `local_thinking_model` or `cloud_thinking_model` at startup, ensuring the correct model is preloaded.
2. Added comprehensive execution and playback logging to `TTSService.gd` in `_speak_local_piper()`, `_play_generated_wav()`, and `_on_synthesis_completed()`.

**Acceptance Criteria:**
- **Manual Verification**: Verify that the correct model is logged under `AIService: Preloading local model` at startup, and that any local piper synthesis steps are logged to stdout/stderr.

---

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

---

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

---

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
2. Draw a dynamic pointer arrow extending from the glowing particle body (Note: Pointer arrow disabled/removed per user feedback to improve target robustness).
3. Support chained coordinate lists for step-by-step instructions (e.g., "Click here", wait for click, "then click there").

**Acceptance Criteria:**
- **GUT Test**: Flying to coordinates computes correct paths and transitions state to target-hover.
- **GUT Test**: Integration tests verify that `point_to` parses arguments and triggers single/sequence navigation actions.
- **Manual Verification**: Command Navi to fly to (500, 500) and verify it travels along a smooth path and hovers there (the pointing arrow is disabled/hidden).

---

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

### NAV-20: Route Visual Queries to Heavy Reasoning Model (OPTIMIZED)
**User Story:**
- **As a:** Navi user asking visual questions
- **I want:** Navi to automatically run all screenshot-based queries on the heavy model (which is multimodal) but without forcing deep thinking reasoning loops
- **So that:** Navi answers visual questions quickly without spending a long time in the deep thinking status/light or outputting thinking lines unless explicitly requested.

**Description:**
Check for base64 image/crop data in both deterministic and escalated planning paths to route requests to the heavy model (since local fast models lack vision support). However, decouple this from `has_heavy_thinking` so we do not automatically inject reasoning instructions or transition the status light of the fairy to pulsing purple for simple visual queries. Also implemented high-resolution timing metrics (`Time.get_ticks_msec()`) at all stages of the pipeline (screenshot encoding, TCP/HTTP connection, Time to First Token/TTFT, streaming duration, and total latency) to locate performance bottlenecks.

**Acceptance Criteria:**
- **GUT Test**: `test_visual_queries_escalate_to_heavy_model` verifies that screenshot captures correctly route requests to the heavy model.
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

---

### NAV-33: Standalone C++ Piper Compilation and Multi-Platform Bundling (REVERTED)
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

---

---

### NAV-44: Normalized Coordinates Mapping for Visual Pointing (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's visual pointing to accurately match objects on the screen (such as user avatars, icons, buttons)
- **So that:** The pointing skill guides my attention correctly without shifting to incorrect quadrants.

**Context:**
Visual LLMs process screen captures that are resized to a uniform `1024x1024` resolution. When instructing the model to output coordinates in physical pixels (e.g. 2880x1800), the model had to guess screen ratios, causing coordinate alignment issues.

**Description:**
Update the system prompt templates in `AIService.gd` to tell the model to calculate coordinates in a normalized `0` to `1000` space. Introduce a mapper function `_map_normalized_coordinate_to_screen` in both `AIService.gd` and `ChatUI.gd` that translates coordinates from the `0-1000` space back to physical logical screen coordinates based on `DisplayServer.screen_get_usable_rect`, with a safe `1920x1080` fallback for headless unit test runners.

**Requirements:**
1. Implement a helper method `_map_normalized_coordinate_to_screen` in both `AIService.gd` and `ChatUI.gd` to translate coordinates.
2. In `AIService.gd`, call the mapper inside `_execute_point_to` on parsed coordinates.
3. In `ChatUI.gd`, call the mapper inside `_parse_interactive_steps` on parsed coordinates.
4. Update prompt instructions in `AIService.gd` (both `heavy_system_prompt` and standard instructions) to mandate coordinate outputs in the range `[0..1000]` mapping screen coordinates from top-left (0,0) to bottom-right (1000,1000).
5. Update unit test assertions in `test_chat_ui.gd` and `test_agent_skills.gd` to align with normalized-to-screen coordinate mapping.

**Acceptance Criteria:**
- **GUT Test**: The automated test suite executes and passes successfully.
- **Manual Verification**: Pointing prompts align exactly with targeted visual elements on screen.

---

---

### NAV-45: Settings Options for Hotkey and TTS Voice Speed/Pitch (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** To change my global interaction hotkey and adjust Text-to-Speech voice speed and pitch from the settings menu
- **So that:** I can customize how I trigger the fairy and fine-tune its vocal speed and pitch settings.

**Context:**
Exposing hotkey configuration and TTS speed/pitch values directly to the user interface makes the application much more flexible and personal.

**Description:**
Add global hotkey recording and Text-to-Speech Speed/Pitch controls in the settings UI. Compile and run the daemon with CLI arguments corresponding to the chosen hotkey, and pass speed/pitch settings to system TTS speak calls.

**Requirements:**
1. In `SettingsManager.gd`, define keys for `hotkey_keycode`, `hotkey_modifiers`, `hotkey_text`, `tts_rate`, and `tts_pitch`.
2. In `hotkey_daemon.swift`, parse the keycode and modifiers as command-line arguments.
3. In `InputManager.gd`, launch the daemon with current hotkey settings arguments, and reconnect to `settings_updated` to restart the daemon if the hotkey changes.
4. In `TTSService.gd`, retrieve the `tts_rate` and `tts_pitch` settings and pass them to `DisplayServer.tts_speak`.
5. In `SettingsUI.tscn` and `SettingsUI.gd`, add the controls for the global hotkey button (with key recording logic) and speed/pitch SpinBoxes (toggled based on mutter voice selection), and save them on save pressed.

**Acceptance Criteria:**
- **Manual Verification**: Open settings, change the hotkey to a custom combo, save, and confirm that pressing the new hotkey triggers Navi. Change Voice Speed and Pitch, save, and confirm the system voice synthesization speed and pitch update accordingly.

---

---

### NAV-46: Center Status Notification Light inside Fairy Core (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** The status indicator light (Amber/Purple/Green) to display in the front center of Navi's body rather than floating above her head
- **So that:** The visual indicator is consolidated and guaranteed to always render cleanly without layout issues.

**Description:**
Repositioned the `StatusLight` node in the [FairyVisuals.tscn](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scenes/FairyVisuals.tscn) file to render on top of the wings, and updated the scale properties in [FairyVisuals.gd](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/scripts/FairyVisuals.gd) (0.5 static / 0.4-0.6 pulsing) so the active status color is clearly visible and colors the center of Navi's body without being engulfed by the larger GlowCore.

**Acceptance Criteria:**
- **Manual Verification**: Trigger a screenshot (Amber) or heavy reasoning query (Purple). Verify that the pulsing status light renders directly inside the center core of Navi.
- **GUT Test**: The unit test suite executes and passes successfully.

---

---

### NAV-47: Asynchronous Model Pre-Warming & VRAM Keep-Alive (COMPLETED)
**User Story:**
- **As a:** Navi user using local models via Ollama
- **I want:** Navi's local models to be loaded into memory automatically during application startup and settings updates, and kept loaded while the app is active
- **So that:** I do not experience the 10-second Time to First Token (TTFT) model loading latency on my first request, and memory is freed automatically if I stop using the app.

**Description:**
Implemented asynchronous pre-warming via background HTTP POST requests to Ollama's `/api/generate` loading endpoint when settings are updated or the app launches. Additionally, injected `"keep_alive": "30m"` into all HTTP payloads sent to Ollama, keeping the model loaded in GPU memory while actively queried and automatically releasing VRAM after 30 minutes of idle time.

**Acceptance Criteria:**
- **Manual Verification**: Launch the application; confirm the console prints `[PRE-WARM] Local model '<model>' is loaded and warm.` indicating background pre-warming triggered successfully. Verify first query is fast.
- **GUT Test**: The test suite runs and passes successfully.

---

---

### NAV-48: Full Screen Coordinate Mapping for Visual Pointing (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's pointing coordinates to align perfectly with the screenshot visual context, regardless of menu bar or dock sizes
- **So that:** Navi does not drift or misalign when flying to user-specified items on the screen.

**Description:**
Updated coordinate translation helper functions to map relative to the full screen rectangle using `DisplayServer.screen_get_position` and `DisplayServer.screen_get_size` instead of the usable screen rectangle. Corrected absolute-to-local coordinate offsets inside `FollowController.gd` when calculating fairy tween destinations and pointer arrow vectors in fullscreen mode, and ensured `open_chat` receives absolute fairy position and full screen dimensions.

**Acceptance Criteria:**
- **Manual Verification**: Coordinate-guided pointing actions target the exact visual items on screen without vertical offset shifts.
- **GUT Test**: The test suite executes and passes successfully.

---

---

### NAV-BUG-06: Automatic Guidance Sequence and Speech Sync (COMPLETED)
**User Story:**
- **As a:** Navi user following screen-aware presentations
- **I want:** Navi to automatically fly to coordinates step-by-step and speak each step's description, pausing between steps without requiring manual Next confirmation or closing the chat prematurely
- **So that:** The presentation flows smoothly and naturally.

**Description:**
Implemented automatic progression of step-by-step guidance sequences by polling `TTSService.is_speaking()` and applying a 1-second delay. Disabled streaming text-to-speech when step or escalation tags are parsed, and prevented Stage 3 double-execution of `point_to` skill tags.

**Acceptance Criteria:**
- **Manual Verification**: Coordinate-guided presentation flows sequentially, speaks descriptions step-by-step, and completes automatically.
- **GUT Test**: `test_interactive_step_execution_flow` passes successfully.

---

---

### NAV-BUG-07: Fix Duplicate Text Appending on Handoff and False Escalation Trigger (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to show only the final response text without duplicating/stacking the fast model's intermediate outputs when escalating, and to not trigger false escalations when the word 'ESCALATE' is mentioned conversationally
- **So that:** Conversational responses do not have redundant or repeated blocks, and simple queries do not trigger unexpected deep thinking.

**Description:**
Implemented a `response_cleared` signal on `AIService` emitted at the start of any new LLM stream request, connected it in `ChatUI.gd` to reset `_current_response_text`, and stopped any ongoing TTS playback from previous aborted passes. Refined the fast model's escalation rule to ignore long conversational replies containing `[ESCALATE]` (triggering only when exactly `[ESCALATE]` or under 150 characters).

**Acceptance Criteria:**
- **GUT Test**: `test_response_cleared_emitted_during_stream_request` verifies the signal is emitted during stream setup.
- **GUT Test**: `test_escalation_rules_with_conversational_escalate_text` verifies conversational mentions of `[ESCALATE]` do not trigger heavy model handoffs.

---

---

### NAV-BUG-08: Real-Time Interactive Step Streaming Playback (COMPLETED)
**User Story:**
- **As a:** Navi user following visual guides/step-by-step pointers
- **I want:** Each step's text, voice output, and screen movement to execute in sync *during* the LLM response stream rather than waiting for the entire stream to finish and output raw text first
- **So that:** The presentation flows dynamically and natural pacing is preserved from start to finish.

**Description:**
Modified `ChatUI.gd` to parse coordinate/pause tags from the LLM chunk stream on the fly and queue them immediately. Suppressed raw streaming text from rendering to the bubble when step-by-step playback is expected, and implemented dynamic queue advancement to trigger text updates, speech synthesis, and fairy movement as steps complete, yielding a unified real-time presentation.

**Acceptance Criteria:**
- **GUT Test**: `test_interactive_step_execution_flow` passes successfully.
- **Manual Verification**: Spatial queries start flying Navi immediately and play text/TTS dynamically without displaying raw brackets or showing the full output block upfront.

---

---

### NAV-BUG-09: Fix Offscreen Window Resizing and Mouse Following in Active Mode (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to remain still and not follow the mouse when in active mode (fullscreen chat or settings)
- **So that:** The fullscreen viewport window's position does not shift off-screen when the mouse is moved.
- **Description:**
Modified `FollowController.gd` to prevent updating the OS window position via mouse coordinates whenever the application is in fullscreen/active panel mode (where the chat or settings UI overlays are active). Updated `_process()` to return early and `abort_navigation()` to only restore mouse following when the viewport is not fullscreen.
**Acceptance Criteria:**
- **Manual Verification**: Launch the chat or settings panel, move the mouse, and confirm Navi remains in place without moving the window off-screen.
- **GUT Test**: The test suite runs and passes successfully.

---

### NAV-49: Extract Coordinated Utilities to Dedicated Autoload (COMPLETED)
**User Story:**
- **As a:** Navi developer
- **I want:** Shared string manipulation, tag stripping, and coordinate translation functions to live in a single Autoload utility script
- **So that:** Duplicated helper functions across AIService, ChatUI, and TTSService are consolidated, keeping the codebase DRY and maintainable.

**Context:**
Currently, helper methods such as `_map_normalized_coordinate_to_screen` and `_strip_skill_and_pause_tags` are duplicated in both `AIService.gd`/`ChatUI.gd` and `TTSService.gd`/`ChatUI.gd`.

**Description:**
Created a new Autoload singleton script `res://scripts/NaviUtils.gd` and moved duplicate utilities there. Updated `AIService.gd`, `ChatUI.gd`, and `TTSService.gd` to invoke these methods via the `NaviUtils` Autoload singleton.

**Requirements:**
1. Create `NaviUtils.gd` class registered as an Autoload.
2. Relocate `_map_normalized_coordinate_to_screen`, `_strip_skill_and_pause_tags`, and `_markdown_to_bbcode` to `NaviUtils.gd`.
3. Update `AIService.gd`, `ChatUI.gd`, and `TTSService.gd` to invoke these methods via `NaviUtils`.
4. Ensure GUT tests continue to run and pass.

**Acceptance Criteria:**
- **GUT Test**: Verify that `NaviUtils` is registered as a global Autoload singleton.
- **GUT Test**: Add unit tests verifying coordinates map correctly under mock viewport conditions.
- **Manual Verification**: Run the project, ask spatial and formatting queries, and verify they behave identically as before.

---

---

### NAV-50: Decouple Step-by-Step Presentation State from ChatUI (DONE)
**User Story:**
- **As a:** Navi developer
- **I want:** The state machine and sequence queue for step-by-step guidance/playback to be decoupled from the visual ChatUI panel
- **So that:** The presentation flow logic can be reused by other controller nodes and the ChatUI is focused solely on UI rendering.

**Context:**
`ChatUI.gd` has grown to over 850 lines because it mixes UI rendering (e.g. Panel container sizes, LineEdit submissions, text color transitions) with stateful step-by-step animation loops (`_interactive_steps`, `_current_step_idx`, `_playback_active`, etc.).

**Description:**
Extracted the step-by-step sequence state machine out of `ChatUI.gd` into a dedicated controller class `res://scripts/GuidanceController.gd`. GuidanceController manages the sequence steps array, the active step index, step progression loops, auto-advancement delays, physical triggers (flying to coordinates, status lights), and vocal synthesis triggers (`TTSService.speak()`). It communicates back to `ChatUI.gd` using signals (`guidance_started`, `step_started`, `guidance_finished`).

**Requirements:**
1. Design `GuidanceController.gd` to manage sequence steps array, the active step index, step progression loops, and auto-advancement delays.
2. Have `GuidanceController` communicate with `ChatUI` via signals (e.g., `step_started(text, point)`, `guidance_finished`).
3. Refactor `ChatUI.gd` to listen to these signals to update its bubble panels and morph the Send/Next buttons.
4. Ensure coordinate mappings and TTS synthesis triggers are properly routed.

**Acceptance Criteria:**
- **GUT Test**: Verify all step-by-step test cases (like `test_interactive_step_execution_flow`) pass using the new decoupled controller structure.
- **Manual Verification**: Confirm step-by-step guidance runs smoothly, morphing the Next button and updating status lights and text panels in correct sequential order.

---

---

### NAV-51: Vision Pipeline & Startup Optimization (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** The application to start up instantly, screenshots to be captured instantly without causing Mac system freezes, and local LLM visual queries to be processed quickly and accurately
- **So that:** The assistant responds with minimal lag and does not impact my system's stability.

**Context:**
The previous implementation used process-based screenshots (`screencapture` command-line utility) saving to disk, which had high I/O and process overhead. Additionally, the screenshots were squished to `1024x1024` squares, distorting text/layout and generating a massive token count (~5300 tokens) that overwhelmed local Ollama vision models (causing thrashing/swapping and Mac freezes on M2 chips). The app also booted using the Vulkan/Metal-based `Forward+` renderer, causing long startup warmups.

**Description:**
1. Configured the default rendering method in `project.godot` to `gl_compatibility` (Compatibility renderer), bringing application startup time down from several seconds to instant.
2. Refactored `ScreenCaptureService.gd` to prioritize the native in-memory `DisplayServer.screen_get_image()` method (taking 20ms and skipping disk and subprocess overhead), keeping `screencapture` CLI strictly as a fallback.
3. Updated the image resizing logic in `AIService.gd` to preserve the aspect ratio of screenshots and limit the maximum dimension to `768` pixels. This maintains readability for visual models and reduces token count to ~1600 tokens (a 3x reduction in token count and ~11x reduction in attention complexity), preventing VRAM overload and freezing on M2 Macs.

**Acceptance Criteria:**
- **GUT Test**: Run and pass `test_screen_capture.gd` and all other tests successfully.
- **Manual Verification**: Verify that launching the app is instantaneous and that asking visual tasks is fast without freezing macOS.

---

### NAV-52: Real-time Guidance Step Streaming and Vision Model Thinking Bypass (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Visual queries to bypass the deep thinking reasoning loop (avoiding purple light and reasoning steps) unless specifically classified as complex, and step-by-step guidance responses to stream in real-time character-by-character with correct coordinate alignment
- **So that:** Navi reacts quickly to what is on my screen and presents visual guidance steps incrementally and dynamically.

**Description:**
1. Modified `AIService.gd` so that visual queries (screenshot prompts classified as `VISUAL_FULL` or `VISUAL_CROP`) execute on the heavy vision model (for multimodal support) but run in non-thinking mode (`has_heavy_thinking = false`), bypassing the `<think>` block generation and purple status light.
2. Appended intercepted skill and pause tags to the filtered stream output chunks in `AIService.gd` instead of discarding them. This enables the client-side `GuidanceController` to parse tags and coordinates in real-time during response streaming.
3. Updated `ChatUI.gd` to strip skill/pause tags in `_render_display()` for conversational mode, ensuring raw tags are never shown to the user.
4. Resolved compiler mock subclass signature mismatch errors in tests by reverting the `_request_llm_stream` signature to the original 7 parameters and using a private member `_model_override` instead of a parameter override.

**Acceptance Criteria:**
- **Manual Verification**: Asking spatial queries like "Find the clocks" triggers screenshot capture, streams the response in character-by-character, and causes Navi to fly and point to each clock in real-time as the text streams in.
- **GUT Test**: The test suite runs and passes 100% successfully.

---

### NAV-59: Consolidate Local Model Architecture and Bypass Thinking (DONE)
**User Story:**
- **As a:** Navi user/developer
- **I want:** The system to use a single consolidated model for both fast responses (thinking bypassed) and complex reasoning (thinking enabled)
- **So that:** VRAM freezing and swapping delays are avoided on limited-VRAM machines, and the settings interface is simplified.

**Context:**
Previously, Navi maintained separate "fast" (Tier 1) and "heavy" (Tier 2) model configurations. This resulted in dual models loading concurrently, leading to VRAM swaps, startup freezes, and complex escalation routing logic.

**Description:**
1. Consolidated the model settings to a single provider configuration ("AI Model") instead of separate Fast and Heavy fields, while preserving backward compatibility by writing the value to both `local_model`/`local_thinking_model` and `cloud_model`/`cloud_thinking_model` keys.
2. Removed the multi-stage escalation and visual refusal self-correction pipeline from `AIService.gd`, routing all queries directly through a single-tier direct path.
3. Implemented thinking bypass for non-complex queries in the consolidated model by setting the temperature to `0.1` and adding a prompt-level override directive for local models, and passing `thinkingBudget = 0` inside the `generationConfig` payload for cloud Gemini models.

- **GUT Test**: Refactored `test_ai_service.gd` to verify single-model direct routing, settings synchronization, and correct thinking configurations.
- **Manual Verification**: Verify that the Settings UI displays a single "AI Model" field, saving settings works correctly, and conversational vs. complex queries invoke thinking mode conditionally on the same consolidated model.

---

### NAV-60: Emotion State Data Model & Persistence (DONE)
**User Story:**
- **As a:** Navi developer
- **I want:** A dedicated, persistent data model that tracks Navi's current Courage, Wisdom, and Power scores, the derived Tier 2 emotion, and the cumulative Love Meter value
- **So that:** Every other emotion-system component has a single source of truth that survives across sessions.

**Context:**
See [`emotions.md`](emotions.md) for the full system design. This ticket establishes the foundational data layer all other emotion tickets depend on. Nothing else in the emotion system should be implemented before this ticket is complete.

**Description:**
1. Create `EmotionState.gd` as a lightweight `RefCounted` data class that holds all live emotion values.
2. Implement load/save methods that persist state to `user://emotion_state.json` so the Love Meter survives restarts.
3. Expose a singleton autoload (`EmotionState`) so all scripts can read the current state without passing references.

**Requirements:**
1. Create `res://scripts/EmotionState.gd` with the following properties:
   ```gdscript
   # Tier 1 scores, range -10 to +10
   var courage: float = 0.0
   var wisdom: float = 0.0
   var power: float = 0.0

   # Tier 2 derived emotion (string key, e.g. "serenity", "fear", "oblivion")
   var emotion: String = "serenity"

   # Love Meter, range -1000 to +1000
   var love_score: int = 0

   # Derived relationship level string ("nemesis" | "enemy" | "acquaintance" | "friend" | "best_friend")
   var relationship_level: String = "acquaintance"
   ```
2. Implement `save()` — serialises the above to `user://emotion_state.json`.
3. Implement `load()` — deserialises from `user://emotion_state.json`; falls back to defaults if file is missing.
4. Register `EmotionState` as a project Autoload in `project.godot` so it is globally accessible as `EmotionState`.
5. Add clamp guards: `love_score` must always remain within `[-1000, 1000]`; tier 1 scores within `[-10, 10]`.

**Acceptance Criteria:**
- **GUT Test** (`test/test_emotion_state.gd`): Verify that saving and reloading produces identical values. Verify clamp guards prevent out-of-range assignments. Verify default state initialises without errors.
- **Manual Verification**: Run the project, submit two prompts, quit, relaunch — confirm the Love Meter value is preserved between sessions.

---

### NAV-61: Emotion Scoring Engine (DONE)
**User Story:**
- **As a:** Navi developer
- **I want:** An `EmotionEngine` service that evaluates the current prompt context after each response and produces Courage, Wisdom, and Power scores, derives the Tier 2 emotion, and updates the Love Meter
- **So that:** The emotion state is grounded in Navi's actual runtime situation rather than being static or arbitrary.

**Context:**
See [`emotions.md`](emotions.md) §4 (Scoring) and §3 (Tier 2 Composite Emotions) for the full scoring rules. This ticket depends on **NAV-60** being complete. Scoring should be **rule-based and synchronous** (no additional LLM call) to avoid latency. Future iterations can upgrade to LLM self-reflection if needed.

**Description:**
1. Implement `EmotionEngine.gd` as an `_ready()`-initialised node that performs rule-based scoring after each LLM response.
2. Define scoring heuristics for each dimension based on observable runtime signals.
3. Map the resulting High/Low binary state per dimension to the correct Tier 2 emotion.
4. Apply the prompt score to the Love Meter and update `EmotionState`.

**Requirements:**
1. Create `res://scripts/EmotionEngine.gd`. Expose a single public method:
   ```gdscript
   func evaluate(context: Dictionary) -> void
   # context keys:
   #   "intent_clear": bool      — was the prompt parsed without ambiguity?
   #   "skills_available": bool  — did AIService have at least one matching skill?
   #   "skill_succeeded": bool   — did all triggered skills complete without error?
   #   "memory_entries": int     — number of relevant memory/context entries found
   #   "prompt_length": int      — word count of the user's prompt
   ```
2. Implement scoring rules:
   - **Courage**: Start at 0. `+5` if `intent_clear`, `+3` if `memory_entries >= 3`, `-4` if `prompt_length > 80` (ambiguity risk), `-5` if `!intent_clear`. Clamp to [-10, 10].
   - **Wisdom**: Start at 0. `+6` if `memory_entries >= 5`, `+3` if `memory_entries >= 2`, `-5` if `memory_entries == 0`, `-3` if the response contained a hedging phrase (e.g. "I'm not sure", "I don't know"). Clamp to [-10, 10].
   - **Power**: Start at 0. `+7` if `skills_available && skill_succeeded`, `+3` if `skills_available && !skill_succeeded`, `-6` if `!skills_available`. Clamp to [-10, 10].
3. Derive Tier 2 emotion: treat a score ≥ 1 as High, ≤ 0 as Low for each dimension. Map to the 8-emotion table in `emotions.md` §3.
4. Compute `prompt_score = courage + wisdom + power`. Call `EmotionState.love_score += prompt_score` (clamped).
5. Update `EmotionState.emotion`, `EmotionState.relationship_level` (see Love Meter thresholds in `emotions.md` §5), then call `EmotionState.save()`.
6. Emit a signal `emotion_updated(emotion: String, love_score: int)` for any UI listeners.

**Acceptance Criteria:**
- **GUT Test** (`test/test_emotion_engine.gd`):
  - Pass a context with all positive flags → assert emotion is `"serenity"`, love_score increased.
  - Pass a context with `intent_clear=false, skills_available=false, memory_entries=0` → assert emotion is `"oblivion"`, love_score decreased.
  - Pass a context with `intent_clear=true, skills_available=false, memory_entries=0` → assert emotion is `"pain"`.
  - Verify love_score never exceeds 1000 or falls below -1000.
- **Manual Verification**: Submit a clear skill-based prompt (e.g. "point to the clock"). Open the Godot Output panel and confirm the engine logs the derived emotion and the love score delta.

---

### NAV-62: Emotion-Aware Prompt Injection (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's responses to subtly reflect her current emotional state and relationship level through tone, word choice, and energy — without her explicitly announcing how she feels
- **So that:** Interacting with Navi feels alive and personal rather than robotic.

**Context:**
See [`emotions.md`](emotions.md) §6 (Prompt Injection) for the full injection block format and per-emotion tone guidance. This ticket depends on **NAV-60** and **NAV-61** being complete. The injection is prepended to the existing system prompt in `AIService.gd`.

**Description:**
1. Create `EmotionPromptBuilder.gd` which reads `EmotionState` and constructs a system-prompt block describing Navi's inner state.
2. Integrate the builder into `AIService.gd` so the block is prepended on every prompt before the LLM call.
3. Include per-emotion and per-relationship-level tone guidance as defined in `emotions.md` §6.2 and §6.3.

**Requirements:**
1. Create `res://scripts/EmotionPromptBuilder.gd` with a static method:
   ```gdscript
   static func build() -> String
   ```
   Returns a formatted string block based on the current `EmotionState` values, following the template in `emotions.md` §6.1.
2. Include the tone guidance snippets for the current `EmotionState.emotion` and `EmotionState.relationship_level` in the returned block (drawn from the tables in §6.2 and §6.3 — hardcode these as a `Dictionary` constant in the file).
3. In `AIService.gd`, call `EmotionPromptBuilder.build()` and prepend the result to the system prompt string before every LLM request.
4. Ensure the injection block is **stripped from the conversation history** displayed in `ChatUI` — it must never appear in the visible chat bubbles.

**Acceptance Criteria:**
- **GUT Test** (`test/test_emotion_prompt_builder.gd`):
  - Set `EmotionState.emotion = "fear"` and `EmotionState.relationship_level = "friend"` → assert the built string contains "fear" and the correct tone guidance for both.
  - Assert the built string does not exceed 300 tokens (keep it concise).
- **Manual Verification**: Enable Godot's print-request-body debug flag. Submit a prompt and confirm the injected emotion block appears in the outgoing payload. Confirm the chat UI shows no trace of the injection text.

---

### NAV-63: Tricolor Emotion Body Color (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's body colour to reflect her emotional state using a dynamic RGB mix driven by her Courage, Wisdom, and Power scores, with the Love Meter controlling overall brightness
- **So that:** I can read her emotional state at a glance without any UI label or readout.

**Context:**
See [`emotions.md`](emotions.md) §9 (Visual Feedback). This ticket supersedes the static colour approach in the original NAV-63 draft. Depends on **NAV-60** and **NAV-61**.

The colour model treats the three base dimension scores as RGB primaries:
- **Red channel** → Power score
- **Green channel** → Courage score
- **Blue channel** → Wisdom score

Each score is normalised from its [-10, +10] range to [0.0, 1.0] to produce the channel intensity. The Love Meter (-1000 to +1000) is normalised to a brightness multiplier [0.0, 1.0]. The final colour applied to the fairy body is:

```
brightness = (love_score + 1000) / 2000.0           # 0.0 → 1.0
r = (power_score  + 10) / 20.0 * brightness
g = (courage_score + 10) / 20.0 * brightness
b = (wisdom_score  + 10) / 20.0 * brightness
final_colour = Color(r, g, b)
```

At maximum hate (love=-1000) the fairy is fully black regardless of dimension scores. At maximum love (love=+1000) the fairy glows at full intensity. All three dimensions at -10 yields a near-black tint; all at +10 yields near-white.

**Description:**
1. In `FairyVisuals.gd`, add a method `apply_emotion_color(courage: float, wisdom: float, power: float, love_score: int) -> void` implementing the formula above.
2. Connect `EmotionEngine.emotion_updated` (extend the signal to also pass the three raw scores) to this method.
3. Tween all colour transitions smoothly.

**Requirements:**
1. Extend the `EmotionEngine.emotion_updated` signal signature to:
   ```gdscript
   signal emotion_updated(emotion: String, love_score: int, courage: float, wisdom: float, power: float)
   ```
2. In `FairyVisuals.gd`, add:
   ```gdscript
   func apply_emotion_color(courage: float, wisdom: float, power: float, love_score: int) -> void:
       var brightness := clampf((love_score + 1000.0) / 2000.0, 0.0, 1.0)
       var r := clampf((power   + 10.0) / 20.0, 0.0, 1.0) * brightness
       var g := clampf((courage + 10.0) / 20.0, 0.0, 1.0) * brightness
       var b := clampf((wisdom  + 10.0) / 20.0, 0.0, 1.0) * brightness
       var target_color := Color(r, g, b)
       # Tween current body modulate to target_color
       var tween := create_tween()
       tween.tween_property(_body_polygon, "color", target_color, 0.8)\
            .set_ease(Tween.EASE_IN_OUT)
   ```
   Where `_body_polygon` is the main `Polygon2D` node for the fairy body.
3. Connect `EmotionEngine.emotion_updated` → `FairyVisuals.apply_emotion_color` in the scene root or `AIService._ready()`.
4. Remove any previous static `EMOTION_COLOURS` or `RELATIONSHIP_GLOW_INTENSITY` dictionary references from `FairyVisuals.gd`.

**Acceptance Criteria:**
- **GUT Test** (`test/test_fairy_visuals.gd`):
  - Call `apply_emotion_color(10, 10, 10, 1000)` → assert resulting `Color` is close to `Color(1, 1, 1)` (near-white).
  - Call `apply_emotion_color(0, 0, 0, -1000)` → assert resulting `Color` is `Color(0, 0, 0)` (black).
  - Call `apply_emotion_color(10, -10, -10, 1000)` → assert green channel dominates (high courage, zero wisdom/power).
- **Manual Verification**: Submit a clear skill prompt; observe Navi glowing a mixed colour. Ask a confusing/vague question; observe a duller, darker tint. After many positive interactions, brightness should increase noticeably.

---

### NAV-64: Floating Emoji Emotion Notifications (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** A small emoji to appear near Navi's body at the start of each response, animate in with a grow-and-shrink tween, hold briefly, then disappear
- **So that:** I can feel Navi's emotion in the moment without interrupting the flow of the conversation.

**Context:**
See [`emotions.md`](emotions.md) §9.2 (Emoji Notifications). Depends on **NAV-60** and **NAV-61**. The emoji is chosen randomly from a pool of up to four associated with the current Tier 2 emotion. The notification is a transient scene instance — it creates itself, runs its animation, and then frees itself automatically.

**Emoji Pools per Tier 2 Emotion:**

| Emotion | Emoji Pool |
|---|---|
| Serenity | 😌 ✨ 💫 🌟 |
| Happiness | 😊 🌟 💛 🎉 |
| Boredom | 😑 💤 🌀 😶 |
| Fear | 😨 😰 🫨 💙 |
| Sadness | 😢 💙 🌧️ 😔 |
| Anger | 😠 🔥 ⚡ 😤 |
| Pain | 😣 💔 😖 🫤 |
| Oblivion | 😶‍🌫️ 🕳️ ⬛ 😑 |

**Description:**
1. Create a lightweight scene `res://scenes/EmojiNotification.tscn` containing a single `Label` node sized to display one large emoji.
2. Implement the grow → hold → shrink → free tween sequence in `EmojiNotification.gd`.
3. In `FairyVisuals.gd` (or a dedicated `EmojiNotificationSpawner`), spawn one instance per response when `EmotionEngine.emotion_updated` fires.

**Requirements:**
1. Create `res://scenes/EmojiNotification.tscn`:
   - Root node: `Node2D` named `EmojiNotification`.
   - Child: `Label` named `EmojiLabel`, font size `48px`, no background, centered anchor.
2. Create `res://scripts/EmojiNotification.gd` attached to the root node:
   ```gdscript
   extends Node2D

   func play(emoji: String, position: Vector2) -> void:
       $EmojiLabel.text = emoji
       global_position = position
       scale = Vector2(0.1, 0.1)
       var tween := create_tween()
       # Grow in
       tween.tween_property(self, "scale", Vector2(1.2, 1.2), 0.25)\
            .set_ease(Tween.EASE_OUT)
       # Settle
       tween.tween_property(self, "scale", Vector2(1.0, 1.0), 0.1)
       # Hold
       tween.tween_interval(1.0)
       # Shrink out
       tween.tween_property(self, "scale", Vector2(0.0, 0.0), 0.2)\
            .set_ease(Tween.EASE_IN)
       # Auto-free
       tween.tween_callback(queue_free)
   ```
3. Define the emoji pool dictionary as a `const` in `EmojiNotification.gd`:
   ```gdscript
   const EMOJI_POOLS := {
       "serenity":  ["😌", "✨", "💫", "🌟"],
       "happiness": ["😊", "🌟", "💛", "🎉"],
       "boredom":   ["😑", "💤", "🌀", "😶"],
       "fear":      ["😨", "😰", "🫨", "💙"],
       "sadness":   ["😢", "💙", "🌧️", "😔"],
       "anger":     ["😠", "🔥", "⚡", "😤"],
       "pain":      ["😣", "💔", "😖", "🫤"],
       "oblivion":  ["😶\u200d🌫️", "🕳️", "⬛", "😑"],
   }

   static func pick_emoji(emotion: String) -> String:
       var pool: Array = EMOJI_POOLS.get(emotion, ["✨"])
       return pool[randi() % pool.size()]
   ```
4. In `FairyVisuals.gd`, add a method `spawn_emoji_notification(emotion: String) -> void`:
   - Instance `EmojiNotification.tscn`.
   - Determine spawn position: 40px directly above the fairy body's current `global_position`.
   - Add as a child of the scene root (not the fairy body, so it doesn't move with her).
   - Call `play(EmojiNotification.pick_emoji(emotion), spawn_position)`.
5. Connect `EmotionEngine.emotion_updated` → `FairyVisuals.spawn_emoji_notification` (pass only the `emotion` string argument).
6. Do **not** spawn an emoji if the emotion is identical to the previous turn's emotion (avoid repetition on unchanged state).

**Acceptance Criteria:**
- **GUT Test** (`test/test_emoji_notification.gd`):
  - Verify `pick_emoji("serenity")` always returns one of the four serenity pool values.
  - Verify `pick_emoji("oblivion")` returns a valid string and does not crash.
  - Verify that two consecutive calls with the same emotion string do not both spawn (the deduplication guard fires).
- **Manual Verification**: Submit a clear prompt. Confirm a single emoji appears near Navi's head, grows from small, holds for ~1 second, then shrinks and disappears. Submit a second identical-emotion prompt and confirm no second emoji appears. Change the emotion by submitting a vague/unsupported prompt and confirm a different emoji appears.

---

### NAV-65: Live Navi Mode Toggle (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** A "Live Navi Mode" toggle in Settings that hands full control of Navi's body colour and personality to the Emotion Engine
- **So that:** Navi's appearance and voice feel alive and reactive to her current emotional state, without me having to manually configure them

**Description:**
When Live Navi Mode is OFF (default), all existing behaviour is unchanged — the user sets body colour and personality freely.

When Live Navi Mode is ON:
1. `EmotionEngine` scoring fires after every response.
2. The emotion inner-state block is injected into every LLM system prompt (NAV-62).
3. The personality string in the system prompt is replaced with a short emotion/relationship descriptor (e.g. `"anxious acquaintance"`).
4. `FairyVisuals` applies the tricolor RGB emotion tint and spawns emoji notifications on emotion change.
5. In Settings, the colour picker and personality field are grayed out (alpha 0.45, non-editable), showing their live current values.
6. Toggling OFF immediately restores the saved user colour via `FairyVisuals.restore_user_color()` and makes both fields editable again.
7. Toggling ON/OFF never overwrites the user's saved `fairy_color` or `personality` settings.

**Files Changed:**
- `SettingsManager.gd`: `live_navi_mode` default + migration guard
- `SettingsUI.gd`: `_live_navi_toggle` CheckButton, `_apply_live_mode_ui()`, `_on_live_navi_toggled()`
- `FairyVisuals.gd`: Live mode gate in `_on_emotion_updated()`, `restore_user_color()`
- `AIService.gd`: Gates `_evaluate_emotion()` and `EmotionPromptBuilder.build()` behind `live_navi_mode`
- `EmotionPromptBuilder.gd`: `get_live_personality()` static helper

**Acceptance Criteria:**
- Settings panel shows "⚡ Live Navi Mode" toggle at the top.
- When OFF: colour picker + personality field editable; no emotion scoring in Output.
- When ON: both fields grayed out showing live values; emotion scoring logs appear in Output; fairy colour tweens; emoji fires on emotion change.
- Toggling OFF restores saved colour without touching the stored settings values.

---

### NAV-53: Migrate to Native LLM Tool Calling (Function Calling) (DONE)
**User Story:**
- **As a:** Navi developer
- **I want:** The LLM integration to utilize native tool/function calling schemas instead of parsing arbitrary text tags from the streaming content
- **So that:** The communication is robust, strictly typed, and free of regex formatting bugs or accidental tag leaks in the chat UI.

**Context:**
Currently, `AIService.gd` uses a custom regex parser (`_filter_stream_chunk`) to intercept tag strings like `[SKILL: point_to: X,Y]`. This is brittle and consumes context tokens by forcing system prompt parsing. Modern LLMs (like Gemini 2.0/2.5 and Ollama/Gemma) natively support function/tool schemas.

**Description:**
1. Convert `AIService.gd` payload generation to support native `tools` parameters.
2. Update the local (Ollama) and cloud (Gemini) API payload formats to pass JSON schemas defining the available actions.
3. Refactor the chunk stream parser to detect tool call choices delta and resolve arguments directly.

**Requirements:**
1. Define JSON schemas for the existing skills: `take_screenshot`, `take_crop_screenshot`, `heavy_thinking`, `summarize_session`, and `point_to` (with coordinate arguments).
2. For Gemini requests, pass these schemas in the `tools` array parameter.
3. For Ollama requests, define them under the `/v1/chat/completions` API `tools` specification.
4. Refactor the stream read loop in `_request_llm_stream` to parse tool calls delta instead of parsing raw bracket markers.
5. Emit a signal `tool_call_received(tool_name: String, args: Dictionary)` when a call is parsed from the stream.

**Acceptance Criteria:**
- **GUT Test**: Add unit tests in `test_ai_service.gd` that mock Ollama/Gemini chunk packets containing `tool_calls` and verify they parse correctly into dictionaries.
- **Manual Verification**: Submit a visual query (e.g. "point to the top-right corner") and verify the log shows native function execution with structured arguments instead of regex tag intercepts.

---

### NAV-54: Decouple Skills into Standalone Modular Classes (DONE)
**User Story:**
- **As a:** Navi developer
- **I want:** Each agent capability/skill to be isolated in its own dedicated class/script file
- **So that:** Adding a new skill is plug-and-play and does not require modifying or bloating `AIService.gd`.

**Context:**
`AIService.gd` contains all execution logic for screenshotting, cropping, pointing, and session summarization. This violates the single-responsibility principle and makes the service file harder to maintain as new skills are introduced.

**Description:**
1. Design a base `Skill` class that defines the naming, schema generation, and execution interfaces.
2. Refactor existing capabilities into standalone script files extending this base class.
3. Update `AIService.gd` to scan, load, and register all skill scripts dynamically at runtime.

**Requirements:**
1. Create a base script `res://scripts/skills/Skill.gd`:
   ```gdscript
   extends RefCounted
   class_name Skill
   func get_name() -> String: return ""
   func get_description() -> String: return ""
   func get_schema() -> Dictionary: return {}
   func execute(context: Dictionary) -> String: return ""
   ```
2. Implement subclasses in `res://scripts/skills/`:
   * `TakeScreenshotSkill.gd`
   * `TakeCropScreenshotSkill.gd`
   * `HeavyThinkingSkill.gd`
   * `PointToSkill.gd`
   * `SummarizeSessionSkill.gd`
3. Modify `AIService.gd` to load and instantiate all script files under the `res://scripts/skills/` directory on `_ready()`, storing them in `_skills_registry`.

**Acceptance Criteria:**
- **GUT Test**: Add a test verifying that adding a mock skill script to `res://scripts/skills/` registers it automatically at startup.
- **GUT Test**: Verify all existing skill integration tests pass under the new decoupled class structure.


### NAV-59: Fix TTS Stream State Issue and Disable Startup Greeting (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Text-to-Speech vocalization (mutter, local piper, or system voices) to play reliably when the response streams in, without getting silenced or interrupted by background events
- **So that:** I can hear Navi's response without issues.

**Context:**
A race condition occurred because `ChatUI.gd` called `start_speech_stream()` when the request started, but `AIService`'s asynchronous dispatch immediately emitted `response_cleared`, calling `TTSService.stop()` and silencing the stream (`_stream_active = false`). Additionally, the model preloading startup greeting could trigger at any time and interrupt ongoing chat sessions.

**Description:**
1. Move `start_speech_stream()` to trigger on the first response chunk received in `_on_ai_response_chunk` in `ChatUI.gd`.
2. Disable the startup preload greeting in `AIService.gd` to ensure zero interruptions.

**Requirements:**
1. Remove the `start_speech_stream()` call from `_on_ai_request_started` in `ChatUI.gd`.
2. Implement `is_first_chunk` detection inside `_on_ai_response_chunk` in `ChatUI.gd` and trigger `start_speech_stream()` there.
3. Make `_speak_startup_greeting()` in `AIService.gd` return early immediately to prevent any startup audio.

**Acceptance Criteria:**
- **Manual Verification**: Submit a prompt, verify that TTS streams audio properly and is not ignored. Verify no startup greeting plays.

---

### NAV-56: Consolidated Single-Window UI Overlay (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** The chat overlay to consist of a single unified window with a translucent dark background, rounded corners, and no shadow, combining both input and response threads into one layout
- **So that:** The visual interface is simplified, takes up less screen real estate, and has a clean, premium, modern appearance.

**Context:**
Currently, `ChatUI.tscn` consists of two separate UI panel nodes (`input_panel` and `response_panel`) that are dynamically repositioned next to the fairy, which creates visual complexity. Overhauling this layout into a single, combined panel simplifies container logic and improves desktop aesthetics.

**Description:**
1. Merge the input field, mic/mute controls, and the response RichTextLabel into a single unified window panel.
2. Remove box shadows and drop-shadow styling filters. Apply a slightly transparent dark background with curved/rounded corners.
3. Consolidate the dynamic positioning logic in `ChatUI.gd` to target only the single panel container.

**Requirements:**
1. Modify `ChatUI.tscn` to restructure the hierarchy under a single `PanelContainer` (e.g. `MainPanel`).
2. Implement a `VBoxContainer` inside the container:
   * Upper part: `RichTextLabel` representing the conversation history.
   * Lower part: `LineEdit`/`TextEdit` for text input.
3. Apply a custom theme stylebox to `MainPanel`:
   * Set background color to translucent dark grey (e.g., `Color(0.08, 0.08, 0.1, 0.8)`).
   * Configure `Corner Radius` to `12px` or `16px`.
   * Disable any shadow parameters.
4. Update `reposition_ui` in `ChatUI.gd` to position only this single container relative to the fairy's screen coordinate.

**Acceptance Criteria:**
- **Manual Verification**: Open the chat window. Confirm there is only one visible box container wrapping both the text input and conversation history. Confirm the style is shadow-less, translucent dark, and has rounded corners.
- **GUT Test**: Verify that `is_position_inside_ui` properly delegates to the single container bounds, keeping unit tests passing.

---

### NAV-57: Direct-Activation STT with Live Editor Ingestion (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to automatically start listening to my voice when I activate the chat overlay, streaming transcribed text live into the text input area so I can review, edit, and press Enter to submit
- **So that:** I can interact entirely hands-free without clicking a dedicated microphone button.

**Context:**
Currently, voice recording must be toggled manually via a microphone button, and the transcribed text is submitted immediately to the LLM. Standardizing on implicit listening and live editor ingestion allows the user to correct mispronunciations before sending the prompt.

**Description:**
1. Automatically trigger `STTService` recording when the chat overlay is opened via hotkey or mouse drag.
2. Stream the ongoing transcript dynamically into the `LineEdit` input field instead of sending it immediately.
3. Allow the user to press `Enter` to finalize and send, or edit the text beforehand.

**Requirements:**
1. Modify `open_chat()` in `ChatUI.gd` to automatically trigger the STT toggle flow (simulating button press/record start) by default.
2. Update the transcription handling in `ChatUI.gd` to populate `input_edit.text` with the transcribed text in real-time as it is received from `STTService` instead of directly invoking `_on_prompt_submitted()`.
3. Keep the input edit field editable during STT updates so the user can type changes.
4. Bind the `text_submitted` signal on `LineEdit` to trigger the final LLM request when the user presses `Enter` (or stops speaking and presses `Enter`).

**Acceptance Criteria:**
- **Manual Verification**: Press the global hotkey. Navi should start recording immediately (indicated by status/cursor changes). Speak a sentence, verify that the text appears typed out in the input field, edit a word using the keyboard, and press Enter to submit the prompt.
- **GUT Test**: Assert that opening the chat node initiates the STT recording state in headless simulations.

---

### NAV-58: Settings UI Overlay Simplification (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** The Settings UI to match the clean, shadow-less, translucent dark style of the new chat window, and to manage TTS enablement via settings toggles rather than local panel buttons
- **So that:** The visual consistency of the application is maintained and redundant buttons (like Mute) are removed.

**Context:**
The current Settings panel (`SettingsUI.tscn`) uses standard window styles and shadows. The `ChatUI` also has a dedicated `Mute` button. Disabling TTS can be cleanly handled globally through the Settings UI, making the chat box simpler.

**Description:**
1. Redesign `SettingsUI.tscn` to use the translucent dark background with rounded corners and no shadows.
2. Remove the mute button (`_mute_button`) from the chat interface entirely.
3. Keep right-click on the fairy as the trigger to open the simplified settings menu.

**Requirements:**
1. In `SettingsUI.tscn`, apply the same stylebox configuration used in `NAV-56` (translucent dark background, corner radius, no shadows).
2. Delete the `_mute_button` node and all corresponding signal bindings/callbacks from `ChatUI.gd` and `ChatUI.tscn`.
3. Rely on `SettingsManager.get_setting("enable_tts", true)` to globally route/bypass TTS synthesis in `TTSService.gd`.
4. Ensure right-click detection on the fairy (`FairyVisuals.gd`) continues to call `WindowController.open_settings()` to toggle settings visibility.

**Acceptance Criteria:**
- **Manual Verification**: Confirm the mute button is gone from the chat overlay. Right-click the fairy, confirm the Settings UI opens as a translucent panel matching the rounded, shadow-less dark aesthetic. Toggle TTS off in settings, save, and confirm Navi no longer speaks responses.
- **GUT Test**: Verify `test_settings.gd` passes and confirms toggle persistence.

---

### NAV-66: Decouple Wisdom Scoring from Memory Heuristic (DONE)
**User Story:**
- **As a:** Navi developer
- **I want:** The Wisdom base dimension score to be evaluated using a dedicated retrieval-quality check rather than relying on conversation history size (`memory_entries`)
- **So that:** Wisdom is a more accurate reflection of the relevance and quality of context available for the specific prompt, regardless of current chat length.

**Description:**
1. Introduced a retrieval-relevance scoring heuristic calculating keyword overlap between the user's prompt and the conversation history plus cached summary.
2. Updated `EmotionEngine.gd` to evaluate Wisdom using `retrieval_relevance` instead of `memory_entries`.
3. Updated unit tests to match and added a test for low-relevance scoring.

**Acceptance Criteria:**
- **GUT Test**: Verify that a long conversation history with low retrieval relevance scores low Wisdom. All 155 tests pass.

---

### NAV-67: Remove Send/Record Buttons & Use Enter for Controls (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** The Send and Record buttons to be removed from the chat window, routing their functionalities to the Enter key, and to treat voice recording as a pseudo-skill by turning Navi's indicator orb red.
- **So that:** The chat UI is cleaner, and I have clear visual feedback when voice recording is happening.

**Description:**
1. Programmatically set the visibility of `SendButton` and `VoiceButton` to `false` to keep them instantiated but hidden.
2. Configured `Enter` key (empty input box) to toggle voice recording on and off.
3. Updated voice recording toggling to set Navi's status orb to pulsing red, and clear it when recording finishes.

---

### NAV-55: Interactive Skill Confirmation Overlay (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to ask for my consent before executing sensitive skills (like clicking, writing files, or running scripts)
- **So that:** I have complete control and transparency over the automated actions happening on my desktop.

**Context:**
Currently, skills execute automatically as soon as they are resolved. As we build more advanced system integration capabilities, executing arbitrary tasks without user confirmation poses security and usability risks.

**Description:**
1. Introduced a user preference setting `require_skill_confirmation: bool` (defaulting to `true` for security-sensitive tools) in `SettingsManager`.
2. Created a scene `res://scenes/SkillConfirmationCard.tscn` (matching the glassmorphic dark theme) containing description text ("Navi wants to point to (100, 200)") and `Approve` / `Deny` buttons.
3. Added a confirmation flow/pause in `AIService.gd` and `GuidanceController.gd` to await user response before invoking the skill callback/flying.

**Acceptance Criteria:**
- **GUT Test**: Verify that enabling `require_skill_confirmation` suspends skill execution, and clicking approve completes it successfully. All 158 tests pass.


---

### NAV-BUG-10: Live STT Ingestion with Silence/VAD Detection (DONE)
**User Story:**
- **As a:** Navi user
- **I want:** My spoken voice text to stream into the input field in real-time as I speak, rather than only appearing after I hit send
- **So that:** I can monitor the ongoing transcription, edit it, and choose when to submit the prompt.

**Description:**
1. Implemented a Voice Activity Detection (VAD) loop in `ChatUI.gd` monitoring the peak volume of the microphone input bus.
2. If the user stops speaking (volume below `-35 dB` for `0.8` seconds), the active chunk is saved and transcribed in the background, updating the LineEdit text immediately.
3. Automatically starts a new recording chunk upon VAD pause to prevent speech loss. Recording/listening starts as soon as the response begins streaming.
4. Implemented barge-in/interruption: if the user starts speaking (mic volume > `-35 dB`) while Navi is speaking (`TTSService.is_speaking()`), her voice is immediately muted (`TTSService.stop()`).
5. Cleans local Whisper and Cloud Gemini transcriptions by filtering out empty/noise indicators like `[BLANK_AUDIO]` or `(keyboard clicking)` using regular expressions.
6. Added safety guards to prevent concurrent transcription overlaps and ensure pre-existing typed text is preserved.




### NAV-67: Hold to Talk (Push-to-Talk) System (DONE)
**User Story:**
- **As a:** Navi User
- **I want:** to hold the activation hotkey (Shift + Up) to speak and release it to send my prompt instantly, and have a toggle in settings to enable/disable it
- **So that:** Navi does not get interrupted by her own voice or random background noise during automatic level detection.

**Description:**
1. Switched default listening system to a hold-to-talk system using the global activation hotkey (defaulted to `Shift + Up`).
2. Pressing and holding the activation hotkey opens the chat UI and starts recording. Releasing the key triggers instant transcription and submission of the prompt.
3. Added `enable_push_to_talk` setting in `SettingsManager` (enabled by default) and added a toggle switch for it in the settings UI.
4. Programmatically displayed a subtle subtitle label `"hold Shift + Space to talk"` under Navi on startup that fades out after 5 seconds (updated to `"hold Shift + Space to talk"`, wait! The user says "when we start up Navi, it should say 'hold Space to talk' in subtitle subtle text." Oh, the user says "when we start up Navi, it should say 'hold Space to talk' in subtitle subtle text." Wait, they wanted "hold Space to talk" originally, then "Shift + Up" is the actual hotkey combination. Let's make sure the subtitle matches whichever is the default/configured text or just keep it as the new default activation helper text!). Wait, let's keep it as `"hold Shift + Up to talk"`.
5. Doubled the default size of the `ChatUI` interaction panel (`MainPanel`) in `ChatUI.tscn` to improve readability and usability.
6. Added GUT unit tests to cover the Push-to-Talk state changes and hotkey hold/release behaviors.

**Acceptance Criteria:**
- **GUT Test**: Verify that the Push-to-Talk toggle can be correctly set/retrieved from SettingsManager.
- **GUT Test**: Verify that pressing and releasing the hotkey toggles recording states correctly.
- **Manual Verification**: Subtitle label shows up at startup and fades out after 5s. Toggle button exists in settings and works. Holding hotkey records voice, and releasing sends the prompt instantly.

---

### NAV-68: Polished Push-to-Talk Tap-vs-Hold and Input Focus (COMPLETED)
**User Story:**
- **As a:** Navi User
- **I want:** The push-to-talk hotkey to act as a tap-to-type and hold-to-talk gesture
- **So that:** I can naturally speak by holding the hotkey or quickly focus the text bar by tapping the hotkey without triggering voice input.

**Description:**
1. Extended the macOS global hotkey daemon (`hotkey_daemon.swift`) to register event handlers for both `kEventHotKeyPressed` and `kEventHotKeyReleased` Carbon events, transmitting `"hotkey_down"` and `"hotkey_up"` UDP packets to Godot.
2. Updated `InputManager.gd` to process the new UDP packets, emitting `hotkey_pressed` on key down and introducing a new `hotkey_released` signal on key up (bypassing the debounce timer).
3. Created `handle_hotkey_down` and `handle_hotkey_up` methods in `ChatUI.gd` to track press times and distinguish between taps (< 0.4s) and holds (>= 0.4s).
4. Configured short taps to abort recording and focus the text box immediately when Navi is open, rather than triggering voice input or closing the window.
5. Wired `WindowController.gd` to receive global hotkey down/up signals and invoke the respective handlers inside `ChatUI`.
6. Updated GUT unit tests to cover both global hotkey signals and local inputs.

**Acceptance Criteria:**
- **GUT Test**: Verify that `InputManager` emits both `hotkey_pressed` and `hotkey_released` signals on UDP packets.
- **GUT Test**: Verify that `ChatUI` distinguishes between hold and tap releases correctly.
- **Manual Verification**: Tapping hotkey opens Navi, ready for text input. Holding hotkey opens Navi and enters recording mode; releasing submits the query. Tapping hotkey when Navi is already active brings window to foreground and focuses the input box.


---

### NAV-69: Deprecate Voice Detection and Enforce Push-to-Talk (COMPLETED)
**User Story:**
- **As a:** Navi User
- **I want:** Voice Activity Detection (VAD) / continuous voice detection to be deprecated, all VAD code logic disabled/commented out with documentation, and the push-to-talk setting toggle removed so push-to-talk is the only mode
- **So that:** Navi only records voice when I explicitly press and hold the activation hotkey, preventing microphone loops or accidental recording.

**Description:**
1. Commented out Voice Activity Detection (VAD) loop (`_start_vad_monitoring()`) and automated triggers in `ChatUI.gd`.
2. Added detailed documentation comments explaining the VAD design to guide future re-implementation.
3. Commented out the programmatic creation of `PushToTalkRow` and its settings bindings inside `SettingsUI.gd`.
4. Maintained `enable_push_to_talk` as `true` in `SettingsManager.gd` config defaults for compatibility.
5. Commented out deprecated continuous-STT/PTT tests in `test_chat_ui.gd` and `test_settings.gd`.

**Acceptance Criteria:**
- **GUT Test**: Headless unit tests pass without errors.
- **Manual Verification**: "Push to Talk" toggle is removed from the Settings UI. Chat overlay does not record sound automatically on open. Push-to-talk via Shift + Up works successfully.

---

### NAV-70: Persistent Emotional State and Startup Color (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's emotional state and relationship level to persist between app launches and reflect immediately on startup
- **So that:** She remains consistent and doesn't reset to her default gray color every time I open the app.

**Description:**
1. Replaced invalid `Engine.has_singleton(...)` autoload checks with tree-path node lookups `/root/...` across `FairyVisuals.gd`, `WindowController.gd`, `AIService.gd`, and `SettingsUI.gd`.
2. Verified that the correct HSL target and startup emotion colors are loaded and applied correctly on startup when Live Navi Mode is enabled.

**Acceptance Criteria:**
- **GUT Test**: Headless unit tests verify SettingsManager and EmotionState integration.
- **Manual Verification**: Restart the application with Live Navi Mode enabled; confirm that the color is restored correctly and settings display the correct emotional color.

---

### NAV-71: Thinking Status Light and Coordinated Pointing Execution (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** A pulsing purple status light to show whenever Navi is thinking or streaming a response, and for the pointing skill to execute right when she begins speaking rather than beforehand
- **So that:** I have clear visual feedback on whether she is stuck or thinking, and she doesn't point to a coordinate and freeze silently before speaking.

**Description:**
1. Modified `AIService.gd` to unconditionally set the status light to pulsing purple (`Color(0.6, 0.2, 1.0, 1.0)`) at the start of all LLM streaming requests.
2. Implemented Stage 0 `point_to` skill deferral context inside `_deferred_skill`.
3. Updated `PointToSkill.gd` to set status light to pulsing green (`Color(0.2, 0.8, 0.2, 1.0)`) during execution.
4. Configured `AIService.gd`'s `_cleanup_request()` to only clear the status light if it is purple, preserving green (pointing) or red (voice recording) lights.
5. Cleared status light in `WindowController.gd`'s `_reset_to_follow_mode`.

**Acceptance Criteria:**
- **GUT Test**: Verify that the deferred pointing skill stores the target coordinate and executes at the correct moment in the request lifecycle.
- **Manual Verification**: Run "point to center" and confirm status light turns purple during generation, and flies to the target exactly when speaking.

---

### NAV-72: Local Model Warm-up and Startup Greeting (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to show a loading state while warming up the local model, block input, and greet me with a translucent notification chat box when ready
- **So that:** I don't speak to her before the model is loaded in VRAM, and she doesn't freeze the screen or grab keyboard focus during startup.

**Description:**
1. Added `is_warming_up` state to `AIService.gd` gating the preload phase.
2. Implemented `is_loading` custom draw routine in `FairyVisuals.gd` rendering a colored spinning spiral following the mouse.
3. Implemented temporary subtitle overlay messages in `FairyVisuals.gd` via `show_subtitle()`.
4. Ignored hotkey and showed warming up warning subtitle in `WindowController.gd` during warmup.
5. Implemented non-blocking model prompt greeting query on preload success.
6. Implemented `open_chat_greeting` in `ChatUI.gd` that hides input bar, skips grab focus, and auto-dismisses after 5 seconds.
7. Implemented transition from greeting mode to full interactive mode on user left-click or hotkey press.
8. Implemented `show_startup_greeting` in `WindowController.gd` to expand window to fullscreen without stealing active focus.

**Acceptance Criteria:**
- **GUT Test**: Verify that `is_loading` and `is_warming_up` states clear correctly on completed preload, and greeting click/hotkeys transition to interactive mode.
- **Manual Verification**: Observe spinning spiral following mouse on boot. Try pressing the hotkey; verify the subtitle warning displays. Confirm greeting bubble appears and click/hotkey opens chat.

---

### NAV-73: Fix Startup Greeting NPC Follow Mode & Hotkey Lock (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to say and display her startup greeting while continuing to follow the mouse tip, blocking any interactive hotkeys or clicks during this phase, and only becoming ready for activation after the greeting finishes.
- **So that:** There are no race conditions or overlapping voice playback when I boot the application and try to interact with her immediately.

**Description:**
1. Added `is_greeting_active` property to `AIService.gd`.
2. Updated `_speak_startup_greeting()` in `AIService.gd` with robust pre- and post-LLM discard checks and managed the `is_greeting_active` flag.
3. Updated `WindowController.gd`'s `_on_hotkey_pressed()` to ignore hotkeys and show a warning if `is_greeting_active` is true.
4. Updated `WindowController.gd`'s `show_startup_greeting()` to enable window mouse passthrough (`get_window().mouse_passthrough = true`) and keep the transparent window fullscreen while active.
5. Implemented `_process(delta: float)` in `WindowController.gd` to smoothly lerp the fairy's local position to follow the mouse and reposition the chat UI.
6. Updated `_reset_to_follow_mode()` in `WindowController.gd` to disable window mouse passthrough, set `is_greeting_active` to false, and reset the fairy's local position back to `(100, 100)` inside the `200x200` window.
7. Fixed type mismatch and added headless-aware display server checks to GUT unit tests in `test_ai_service.gd` and `test_window.gd`.

**Acceptance Criteria:**
- **GUT Test**: Verify `is_greeting_active` management and check that window mouse passthrough enables and disables correctly during transition to/from greeting mode.
- **Manual Verification**: Boot the app, confirm she follows the mouse during the greeting, that clicks pass through to background apps, and that the hotkey is ignored until the greeting fades out.

---

### NAV-74: Unified Startup Greeting & Preload with Loader Sync (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** The local model VRAM preloading and the startup greeting generation to happen in a single, unified LLM call, with the loading spiral animation remaining active until the greeting bubble actually opens.
- **So that:** There are no redundant API requests or delay/dead zones between VRAM loading and greeting generation, and the startup is extremely fast and visually synchronized.

**Description:**
1. Initialized `is_warming_up` to `true` by default in `AIService.gd` to prevent startup race conditions before `preload_model()` initiates.
2. Unified the startup flow: removed the redundant `/api/generate` preloader (`_async_preload` and `_complete_preload`). The model is now warmed up directly by sending the startup greeting LLM request immediately on startup.
3. Updated `preload_model()` in `AIService.gd` to call `_speak_startup_greeting()` directly, keeping `is_warming_up` and the loader visual active while the query executes.
4. Added `_set_fairy_loading()` helper in `AIService.gd` and called it to disable the loading spinner only once the startup greeting is generated and displayed (or if discarded early).
5. Added `skip_tools` parameter to `_request_llm()` to bypass `tools` configuration and speed up the greeting generation.
6. Kept the existing condition in `WindowController.gd`'s `_process()` that blocks displaying the guidance subtitle until `is_warming_up` is false, `is_greeting_active` is false, and the active panel is `NONE`.
7. Adapted the unit tests in `test_ai_service.gd` to verify `_set_fairy_loading` behavior since the old `_complete_preload` method was removed.

**Acceptance Criteria:**
- **Manual Verification**: Run the app with local model warm-up enabled. Confirm the loading spiral displays on startup, stays active while the greeting is being requested/generated, and only disappears when the greeting bubble opens.

---

### NAV-75: Fix Voice Push-to-Talk Hotkey Release Event (COMPLETED)
**User Story:**
- **As a:** Navi user holding the hotkey to speak
- **I want:** Letting go of the hotkey to stop recording and trigger audio transcription immediately
- **So that:** Voice interaction works correctly without hanging in the recording state.

**Description:**
1. Refactored Carbon event handler registration in `hotkey_daemon.swift` to use a single, array-based registration for both `kEventHotKeyPressed` and `kEventHotKeyReleased`.
2. Updated the precompiled binary `bin/hotkey_daemon` to include the updated key release handler.
3. Updated `InputManager.gd`'s `_start_daemon` method to automatically compile the daemon from source if the Swift source file is newer than the precompiled binary.
4. Added a statically-typed `_copy_precompiled_binary` helper in `InputManager.gd` to handle binary copying cleanly, with a safe fallback to the precompiled binary if compilation fails.
5. Updated `handle_hotkey_up()` in `ChatUI.gd` to only submit the prompt if the transcribed text is non-empty. This prevents empty/failed transcriptions from triggering Godot's default empty prompt callback, which previously re-enabled the voice recording button automatically.

**Acceptance Criteria:**
- **Manual Verification**: Run the app and verify that holding the hotkey, speaking, and releasing it correctly stops recording, displays the spinner, and submits the transcribed prompt.

---

### NAV-76: Fix Push-to-Talk Daemon Never Launching (COMPLETED)
**User Story:**
- **As a:** Navi user activating push-to-talk
- **I want:** The hotkey daemon to actually launch and emit hotkey_up when I release the key
- **So that:** Recording stops correctly, the red light clears, and voice input is transcribed.

**Root Cause:**
A refactoring in NAV-75 introduced a critical indentation bug in `InputManager.gd`. The daemon launch code (`OS.create_process`) was accidentally placed **inside** `_copy_precompiled_binary()`, after its `return` statements — making it permanently unreachable dead code. As a result, the daemon process was never started. Without the daemon, no UDP packets were ever sent to Godot, so the `hotkey_released` signal was never emitted, and `handle_hotkey_up()` was never called.

**Fix:**
Moved the `OS.create_process` launch block back into `_start_daemon()` at the correct indentation level (L149–155), so it is always executed after the binary preparation logic regardless of whether the binary was compiled, copied, or was already up-to-date.

**Acceptance Criteria:**
- **Manual Verification**: Run the app. Confirm that the log shows `"InputManager: Daemon running with PID"`. Verify that pressing and releasing the hotkey correctly starts and stops recording, and that holding + speaking transcribes the speech into the input field.

---

### NAV-77: Global Error Surface via ErrorBus + ⚠️ Emoji Notification (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** A visual indicator whenever any internal error occurs
- **So that:** I know something went wrong even when no chat window is open.

**Description:**
1. Created `scripts/ErrorBus.gd` — a lightweight global autoload singleton with an `error_occurred(message)` signal and a `report(message: String)` method that both prints to stderr and emits the signal.
2. Registered `ErrorBus` as the **first** autoload in `project.godot` so it's available before any other service.
3. Replaced all 31 `printerr()` calls across `STTService.gd`, `TTSService.gd`, `InputManager.gd`, `ScreenCaptureService.gd`, `SettingsManager.gd`, `EmotionState.gd`, and `SettingsUI.gd` with `ErrorBus.report()`.
4. Added `spawn_error_emoji()` to `FairyVisuals.gd` — spawns a ⚠️ emoji above the fairy using the existing `EmojiNotification.tscn` scene, with a 1-second debounce to prevent spam.
5. Wired `FairyVisuals._ready()` to connect `ErrorBus.error_occurred` → `_on_error_occurred()` → `spawn_error_emoji()`.

**Acceptance Criteria:**
- **Manual Verification**: Trigger any error (e.g. STT failing). Confirm ⚠️ floats above Navi. Confirm multiple rapid errors within 1 second only show one emoji.

---

### NAV-78: Fix whisper-cli SIGABRT + Settings Download Button State (COMPLETED)
**User Story:**
- **As a:** Navi user using push-to-talk
- **I want:** Speech to actually be transcribed when I release the hotkey
- **So that:** My voice input reaches the AI instead of silently failing.

**Root Cause (whisper-cli exit 134 / SIGABRT):**
The `bin/whisper-cli` binary was dynamically linked against `libwhisper.1.dylib` from a temporary scratch build directory that no longer existed. On launch, `dyld` aborted the process immediately because the library path was invalid.

**Fix:**
1. Cloned `whisper.cpp` source fresh into `scratch/whisper.cpp` (gitignored).
2. Built with `cmake -DBUILD_SHARED_LIBS=OFF` to produce a fully statically linked binary — only system frameworks (`Accelerate`, `Metal`, `Foundation`, `libc++`) remain as dependencies.
3. Replaced `bin/whisper-cli` with the new static build. Verified with `jfk.wav` sample: transcribes correctly.

**Fix (Download Button UX):**
Added `_check_offline_models_state()` to `SettingsUI.gd`:
- Called on settings panel open — detects `user://models/ggml-base.en.bin` and a Piper voice ONNX file.
- If both exist: button shows "✅ Downloaded" and is disabled with a tooltip explaining how to re-download.
- If only Whisper exists: button shows "Download (Voice missing)".
- Called again after a successful download completes so state is always current.

**Acceptance Criteria:**
- **Manual Verification**: Open settings after models are already downloaded — button shows ✅ and is disabled. Hold hotkey, speak, release — text appears in the input box.

---

### NAV-79: UI Streaming and Auto-Trigger Bug Fixes (COMPLETED)
**User Story:**
- **As a:** Navi user sending messages via voice/text
- **I want:** The chat interface to stream responses smoothly without scratchpad leakage, flicker, disappearing texts, or punctuation auto-triggering
- **So that:** The conversation experience is polished, clean, and reliable.

**Description:**
1. **Scratchpad & Control Tag Filtering**: Updated `_filter_stream_chunk()` in `AIService.gd` to filter out `<scratchpad>...</scratchpad>` blocks completely and swallow internal control tags (`[CONTINUE]`, `[PAUSE]`, `[ESCALATE]`) silently from the user-facing stream.
2. **Continuation Live Stream Persist**: Added `is_continuation` flag to `_request_llm_stream()` in `AIService.gd` and threaded it from the continuation self-prompt loop. Gated the `response_cleared` signal so continuation passes do not wipe the current streamed text in the UI.
3. **Conversational Spoken Thoughts**: Re-routed intermediate `<think>` blocks in `ChatUI.gd` to `TTSService.speak()` as fire-and-forget spoken utterances (with natural, personality-voiced prefixes like *"Hmm, let me think..."*) instead of displaying them as a faded italic thought trail in the UI. Removed visual thought trail rendering.
4. **Predictive Punctuation Auto-Trigger Removal**: Deleted debounced auto-submit logic on punctuation from `ChatUI.gd` and programmatically removed the "Predictive Auto-Submit" toggle row, defaults, and serialization from `SettingsUI.gd` and `SettingsManager.gd`.
5. **STT & PointTo Enhancements**: Lowered STT minimum audio recording duration threshold to `10ms` in `STTService.gd`. Improved the tool description for `point_to` in `PointToSkill.gd` to minimize hallucinated triggers by smaller models.
6. **Headless GUT Test Suite Fixes**:
   - Fixed display server deadlocks by adding unit test (`GutRunner`) bypasses to `TTSService.speak()` and `TTSService.is_speaking()`.
   - Bypassed LLM preloader queries during GUT execution using command-line argument checks in `preload_model()`.
   - Relaxed static type checking of custom class variables in `WindowController.gd` to resolve class name compiler errors headlessly.
   - Updated mock signatures of `_request_llm_stream` and `_deliver_final_response` in test files.
   - Disabled skill confirmation by default in tests via mock settings to prevent hangs on tool tests.

**Acceptance Criteria:**
- **Manual Verification**: Run the app and verify: no scratchpad leakage; continuations append correctly; thoughts are spoken and not shown; punctuation doesn't auto-submit; tests pass headlessly.


---

### NAV-80: Continuation Tag Scratchpad/Think Suppression (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's background continuation triggers to only activate when `[CONTINUE]` is explicitly outputted in the user-facing response, rather than matching planning/thinking notes inside `<scratchpad>` or `<think>` blocks
- **So that:** Navi does not start loop-replying or self-prompting on simple prompts when she merely references the word/pattern `[CONTINUE]` in her scratchpad plans.

**Description:**
1. **Continuation Tag Filtering**: Modified `_process_reply_meta()` in `scripts/AIService.gd` to strip out `<scratchpad>...</scratchpad>` and `<think>...</think>` blocks (using helper methods from `NaviUtils`) before running the `.contains("[CONTINUE]")` check.
2. **Unit Test Coverage**: Added `test_process_reply_meta_ignores_continue_in_scratchpad_or_think()` in `test/test_ai_service.gd` to verify that `[CONTINUE]` tags residing purely inside scratchpad or thinking blocks do not trigger background continuations.

**Acceptance Criteria:**
- **Automated Verification**: Run GUT tests headlessly; the new suite asserts that only user-facing continuation tags trigger execution.


---

### NAV-BUG-12: HighDPI Coordinate Calibration and Step-by-Step Guidance Restore (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to fly to the correct logical coordinates on HighDPI/Retina screens, and to play back step-by-step guidance sequences in real-time
- **So that:** Navi points accurately at visual elements on my screen and moves sequentially as she explains each step.

**Description:**
1. **HighDPI Calibration**: Updated `map_normalized_coordinate_to_screen()` in `scripts/NaviUtils.gd` to divide the screen's physical pixel dimensions by the active screen scale factor (`DisplayServer.screen_get_scale()`). This calibrates coordinates to logical points, aligning with macOS window positioning.
2. **Expose Pause Tags**: Removed `[PAUSE]` from `INTERNAL_TAGS` in `_filter_stream_chunk()` in `scripts/AIService.gd`. This allows the client-side `ChatUI` to receive `[PAUSE]` in real-time stream chunks, triggering step playback and feeding step coordinates to `GuidanceController.gd`.
3. **Clarify System Prompts**: Updated system instructions in `thinking_system_prompt` and `analysis_system_prompt` in `scripts/AIService.gd` to explain that the model should use native tool calling for single targets but MUST output bracket tags (e.g. `[SKILL: point_to: X, Y]`) and `[PAUSE]` tags for multi-step guidance.
4. **Unit Test Updates**: Updated `test_map_normalized_coordinate_to_screen` in `test/test_navi_utils.gd` to assert logical mapping coordinates scaled by the screen DPI factor.

**Acceptance Criteria:**
- **Automated Verification**: Run GUT tests headlessly; the updated test suite verifies logical mapping scaling, and all 180+ tests pass successfully.


---

### NAV-BUG-13: Guidance Sequence Scratchpad Suppression (COMPLETED)
**User Story:**
- **As a:** Navi user
- **I want:** Navi's step-by-step guidance system to exclude private planning notes from the `<scratchpad>...</scratchpad>` block
- **So that:** Navi does not read out or display scratchpad information during interactive step guides.

**Description:**
1. **Guidance Scratchpad Suppression**: Updated `GuidanceController.gd` to call `NaviUtils.strip_scratchpad_block` inside `parse_and_append_new_steps()`, `finish_stream()`, and `parse_interactive_steps()`. This prevents index offset misalignment and ensures that private scratchpad details are fully excluded.
2. **Unit Test Coverage**: Added `test_parse_interactive_steps_with_scratchpad` and `test_guidance_controller_stream_with_scratchpad` in `test/test_chat_ui.gd` to verify scratchpad suppression.

**Acceptance Criteria:**
- **Automated Verification**: Run GUT tests headlessly; the updated test suite verifies scratchpad suppression, and all 185+ tests pass successfully.




