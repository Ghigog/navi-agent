# Navi Backlog Tickets

This document contains outstanding tasks and features in the backlog.

## Template & Guidelines

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

## Tickets

### NAV-53: Migrate to Native LLM Tool Calling (Function Calling) (BACKLOG)
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

### NAV-54: Decouple Skills into Standalone Modular Classes (BACKLOG)
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

---

### NAV-55: Interactive Skill Confirmation Overlay (BACKLOG)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to ask for my consent before executing sensitive skills (like clicking, writing files, or running scripts)
- **So that:** I have complete control and transparency over the automated actions happening on my desktop.

**Context:**
Currently, skills execute automatically as soon as they are resolved. As we build more advanced system integration capabilities, executing arbitrary tasks without user confirmation poses security and usability risks.

**Description:**
1. Introduce a user preference setting to toggle action confirmation requirements.
2. Design a confirmation card in `ChatUI.tscn` to display target action details and choice buttons.
3. Pause step playback or skill execution and await user confirmation before invoking the skill callback.

**Requirements:**
1. Add a setting `require_skill_confirmation: bool` (defaulting to `true` for security-sensitive tools) in `SettingsManager`.
2. Create a scene `res://scenes/SkillConfirmationCard.tscn` (matching the glassmorphic dark theme) containing description text ("Navi wants to click at (100, 200)") and `Approve` / `Deny` buttons.
3. When a skill is resolved for execution:
   * If `require_skill_confirmation` is active for that tool, pause `GuidanceController` or the execution loop.
   * Spawn and anchor the confirmation card in the response panel.
   * Await the user's action.
   * If approved: resume execution. If denied: discard the action queue and return Navi to follow mode.

**Acceptance Criteria:**
- **GUT Test**: Verify that enabling `require_skill_confirmation` suspends skill execution, and clicking approve completes it successfully.
- **Manual Verification**: Run the app, request a pointing guide, confirm the popup appears, click Approve, and verify Navi only flies to the location after approval.

---

### NAV-56: Consolidated Single-Window UI Overlay (BACKLOG)
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

### NAV-57: Direct-Activation STT with Live Editor Ingestion (BACKLOG)
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

### NAV-58: Settings UI Overlay Simplification (BACKLOG)
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

### NAV-59: Consolidate Local Model Architecture and Bypass Thinking (BACKLOG)
**User Story:**
- **As a:** Navi user
- **I want:** Navi to query a single consolidated multimodal model that handles both conversational queries and visual skill tasks, with the option to bypass the deep thinking reasoning loop for fast conversational replies
- **So that:** The application does not experience model-swapping VRAM freezes, does not require a complex multi-stage escalation/handoff pipeline, and responds with low latency.

**Context:**
Currently, Navi uses a fast model (e.g. `llama3.2:3b`) for lightweight conversational replies, and escalates to a heavy model (e.g. `gemma4:e4b`) when visual screenshot skills are needed. Loading two separate models into local memory (Ollama) on desktop systems with limited VRAM causes performance swaps and startup freezes. Consolidating to a single multimodal model that can run in both fast conversational mode (thinking bypassed) and complex reasoning mode (thinking enabled) solves this issue.

**Description:**
1. Investigate and verify parameter options in Ollama and Gemini APIs to dynamically suppress/bypass the `<think>` reasoning block generation for the heavy model (e.g., using system prompt constraints or parameter flags).
2. Refactor `AIService.gd` to consolidate model routing to a single configured model (`heavy_model`), removing the fast-to-heavy model escalation stages (`[ESCALATE]` signals).
3. Update settings UI to require configuration of only one consolidated model, simplifying user setup.

**Requirements:**
1. In `AIService.gd`, replace the multi-tiered model dispatch (`T1` fast model, escalation check, `T2` heavy model) with a single-tier direct request structure.
2. In the consolidated direct path:
   * By default, instruct the model (via system prompt injection and/or lowering the completion `temperature`) to bypass reasoning loops and output its conversational/skill response immediately without `<think>` tags.
   * If the user prompt is classified as `COMPLEX` (requiring code, math, or deep reasoning), trigger the model with thinking mode enabled (allowing `<think>` blocks and setting status light to purple).
3. If a screenshot is captured, pass the image directly to this consolidated model (since it is multimodal).
4. Update `SettingsUI.gd` and settings panels to display only one model selection drop-down/field (e.g., "AI Model") instead of separate fields for Fast and Heavy models.

**Acceptance Criteria:**
- **Manual Verification**: Verify that only one model is loaded in settings. Ask a conversational question, verify the response starts streaming immediately (under 3 seconds) without any thinking state. Ask a spatial pointing question, verify screenshot captures and Navi points immediately. Ask a complex math/code question, verify the status light turns purple and the model reasons before answering.
- **GUT Test**: Re-engineer and verify unit tests in `test_ai_service.gd` to mock the single-model dispatch route, asserting that no escalations are triggered.

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

*

---

### NAV-66: Decouple Wisdom Scoring from Memory Heuristic (BACKLOG)
**User Story:**
- **As a:** Navi developer
- **I want:** The Wisdom base dimension score to be evaluated using a dedicated retrieval-quality check rather than relying on conversation history size (`memory_entries`)
- **So that:** Wisdom is a more accurate reflection of the relevance and quality of context available for the specific prompt, regardless of current chat length.

**Context:**
Currently, `memory_entries` is a proxy count of how many items are in the chat history. In larger conversations, this value is always high, artificially pushing Wisdom to positive scores. Moving to a retrieval-quality score or semantic search match metric yields a truer reflection of whether she has the actual context to answer the user's specific request.

**Description:**
1. Introduce a retrieval-relevance scoring heuristic (or key-value context flag) indicating if the memory entries retrieved contain semantic matches.
2. Update `EmotionEngine.gd` to evaluate Wisdom based on semantic match relevance instead of a flat memory count.
3. Update unit tests to match.

**Acceptance Criteria:**
- **GUT Test**: Verify that a long conversation history with low retrieval relevance scores low Wisdom.
