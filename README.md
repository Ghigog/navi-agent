# Navi: Desktop AI Fairy Assistant (Godot 4)

Navi is a desktop AI companion designed using Godot 4. Inspired by the fairy Navi from *The Legend of Zelda: Ocarina of Time*, Navi floats on your desktop as a borderless, transparent-background window that follows the mouse cursor with a smooth interpolation and offset.

Pressing a hotkey freezes the fairy in place on your screen and opens a subtle text prompt box next to it. You can click and drag the fairy to any focus point on your screen; letting go of the fairy automatically takes a new desktop screenshot to focus the AI's visual context. When you submit a prompt, Navi's response appears as a screen-aware glassmorphic speech bubble pointing directly to the fairy. Navi connects to your choice of a local model (Ollama) or a cloud service (Gemini API) and streams the response back inside a modern, magical "Hextech" UI.


---

## 📖 Project Documentation

Please review the following design and architectural specifications:
- [AI Agent Guidelines](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/ai_agent.md): General architectural conventions, scene structures, styling rules, and GUT coding best practices.
- [Emotion System Design](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/emotions.md): Full specification for the Triforce Emotion System — Courage/Wisdom/Power dimensions, Tier 2 composite emotions, Love Meter, prompt injection, and visual feedback.
- Development Tickets:
  - [Active / In Progress Tickets](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/in_progress.md): Tickets currently in development.
  - [Backlog Tickets](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/backlog.md): Future tickets scheduled for implementation.
  - [Completed Tickets](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/done.md): Log of all completed, cancelled, or reverted tickets.

---

## 🛠 Project Architecture Overview

Navi utilizes a modular architecture to handle the desktop assistant workflow:
- **`WindowController`**: Sets up borderless window sizes, allows transparency, and manages window focus switches.
- **`FollowController`**: Tracks the global OS mouse coordinate and updates the window's position at a fixed offset so that it never overlaps the cursor (allowing mouse clicks to go to other desktop apps naturally).
- **`FairyVisuals`**: Manages the glowing particle effects, flapping wings, and the **Triforce Emotion visual system** — dynamically tints the fairy body using a RGB colour formula derived from Courage (green), Wisdom (blue), and Power (red) scores, with overall brightness controlled by the Love Meter. Also spawns transient floating emoji notifications when the emotion state changes.
- **`InputManager`**: Registers global macOS hotkeys to trigger actions when Navi is in the background.
- **`ScreenCaptureService`**: Captures high-fidelity desktop screen images via native OS APIs or Godot's DisplayServer, keeping Navi visible to preserve pointing context.
- **`AIService`**: Orchestrates the direct real-time response streaming pipeline. When a prompt is received, it dispatches directly to the fast model first (bypassing pre-call planning delays for conversational speed under 3s). It intercepts and filters skill tags (`[SKILL: ...]`) to trigger screen captures or handoffs to the heavy reasoning model dynamically, displaying a status indicator light (amber/purple) to represent thinking states. After every response it calls **`EmotionEngine`** to score the interaction and injects the current emotion state into every outgoing system prompt via **`EmotionPromptBuilder`**.
- **`SettingsManager`**: Manages the configuration file (`user://settings.json`) saving settings like prompt text, API endpoints, keys, visual colors, toggles for enabling screenshots or deep thinking, and a global font size offset that scales all UI text up or down.
- **`EmotionState`** *(Autoload)*: Persistent data model for the Triforce Emotion System. Stores Courage, Wisdom, and Power dimension scores (−10 to +10), the derived Tier 2 composite emotion, the cumulative Love Meter score (−1000 to +1000), and the relationship level. Persisted to `user://emotion_state.json`.
- **`EmotionEngine`**: Rule-based scoring engine. After each LLM response it evaluates the interaction context using relevance flags, updates dimension scores, derives the composite emotion, updates the Love Meter, and emits `emotion_updated` to drive the visual system.
- **`EmotionPromptBuilder`**: Constructs a first-person inner-state character prompt block injected into every LLM system prompt so Navi's replies naturally reflect her current emotional tone and relationship level.
- **`EmojiNotification`**: Transient scene spawned by `FairyVisuals` when the emotion changes. Plays a grow → hold → shrink tween animation above the fairy, then auto-frees.

---

## 📂 Folder Directory Layout

We organize the Godot project folder structure as follows:

```text
navi/
├── .godot/                      # Godot internal cache
├── addons/
│   └── gut/                     # GUT Unit testing addon
├── assets/
│   ├── fonts/                   # Modern typography (Outfit, Inter)
│   ├── shaders/                 # Glassmorphism blur shader, glows
│   └── textures/                # Sprite sheets/particles
├── scenes/
│   ├── Main.tscn                # Main orchestrator scene
│   ├── FairyVisuals.tscn        # Particle effects & wing flap visual
│   ├── ChatUI.tscn              # Translucent input/output panel
│   ├── SettingsUI.tscn          # Settings control panel
│   └── EmojiNotification.tscn  # Transient floating emoji notification
├── scripts/
│   ├── WindowController.gd      # Window state & transparency setup
│   ├── FollowController.gd      # Mouse tracking & lerp calculations
│   ├── InputManager.gd          # Hotkey registration singleton
│   ├── AIService.gd             # API request backend singleton
│   ├── SettingsManager.gd       # Local settings storage singleton
│   ├── ScreenCaptureService.gd  # Screenshot utility class
│   ├── EmotionState.gd          # Emotion system data model (Autoload)
│   ├── EmotionEngine.gd         # Rule-based emotion scoring engine
│   ├── EmotionPromptBuilder.gd  # LLM system prompt injection builder
│   └── EmojiNotification.gd     # Floating emoji animation controller
├── test/                        # GUT Unit tests
│   ├── test_agent_skills.gd
│   ├── test_ai_service.gd
│   ├── test_chat_ui.gd
│   ├── test_emotion_engine.gd
│   ├── test_emotion_prompt_builder.gd
│   ├── test_emotion_state.gd
│   ├── test_emoji_notification.gd
│   ├── test_fairy_visuals.gd
│   ├── test_follow.gd
│   ├── test_hotkey.gd
│   ├── test_navigation.gd
│   ├── test_navi_utils.gd
│   ├── test_screen_capture.gd
│   ├── test_settings.gd
│   ├── test_stt_tts.gd
│   └── test_window.gd
├── emotions.md                  # Triforce Emotion System design spec
├── backlog.md                   # Future feature tickets
├── done.md                      # Completed ticket log
└── project.godot                # Godot project file
```

---

## 🚀 Setup & Execution

### Prerequisites
1. **Godot Engine**: Godot 4.3+ (Forward+ or Compatibility renderer).
2. **Local AI Model (Optional)**: Ollama running locally. Verify it's active at `http://localhost:11434`.
3. **Local Neural TTS (Piper)**: 
   - The application bundles standalone C++ and PyInstaller Piper binaries for macOS (Apple Silicon/Intel), Windows, and Linux under `bin/`. No Python, pip, or external system libraries are required.
   - Simply download a Piper voice model (e.g., `en_US-amy-medium.onnx` and its companion `.onnx.json` config file) and place them in the `bin/voices/` folder. The app dynamically detects your OS/architecture and runs local neural TTS out-of-the-box.

### Running the App
Open the project in the Godot Editor:
1. Double-click `project.godot` or import it via Godot Project Manager.
2. Press **F5** (or click the Play button in the top right) to run the application.

### Running Unit Tests
Unit tests are written with the GUT addon. You can run them via the Godot editor or the command line:

#### Editor Method
1. Click the **GUT** tab at the bottom of the Godot Editor.
2. Select the tests directory (`res://test/`).
3. Click **Run All** in the GUT panel.

#### Command Line Method (macOS)
Run the following command from the project root directory:
```bash
/Applications/Godot.app/Contents/MacOS/Godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test/ -gexit
```
*(On other OS layouts, ensure `godot` is added to your system PATH and call `godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test/ -gexit` instead).*
