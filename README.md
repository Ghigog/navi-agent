# Navi: Desktop AI Fairy Assistant (Godot 4)

Navi is a desktop AI companion designed using Godot 4. Inspired by the fairy Navi from *The Legend of Zelda: Ocarina of Time*, Navi floats on your desktop as a borderless, transparent-background window that follows the mouse cursor with a smooth interpolation and offset.

Pressing a hotkey freezes the fairy in place on your screen and opens a subtle text prompt box next to it. You can click and drag the fairy to any focus point on your screen; letting go of the fairy automatically takes a new desktop screenshot to focus the AI's visual context. When you submit a prompt, Navi's response appears as a screen-aware glassmorphic speech bubble pointing directly to the fairy. Navi connects to your choice of a local model (Ollama) or a cloud service (Gemini API) and streams the response back inside a modern, magical "Hextech" UI.


---

## 📖 Project Documentation

Please review the following design and architectural specifications:
- [AI Agent Guidelines](ai_agent.md): General architectural conventions, scene structures, styling rules, and GUT coding best practices.
- [Emotion System Design](emotions.md): Full specification for the Triforce Emotion System — Courage/Wisdom/Power dimensions, Tier 2 composite emotions, Love Meter, prompt injection, and visual feedback.
- Development Tickets:
  - [Backlog Tickets](backlog.md): Active and planned work, from NAV-81 onward.
  - [Completed Tickets](done.md): Historical index of completed, cancelled, and reverted tickets.

---

## 🛠 Project Architecture Overview

Navi utilizes a modular architecture to handle the desktop assistant workflow:
- **`WindowController`**: Sets up borderless window sizes, allows transparency, and manages window focus switches. It also applies the global text visibility outline system to ensure all UI elements remain readable regardless of the active accent color.
- **`FollowController`**: Tracks the global OS mouse coordinate and updates the window's position at a fixed offset so that it never overlaps the cursor (allowing mouse clicks to go to other desktop apps naturally).
- **`FairyVisuals`**: Manages the glowing particle effects, flapping wings, and the **Triforce Emotion visual system** — dynamically tints the fairy body using a RGB colour formula derived from Courage (green), Wisdom (blue), and Power (red) scores, with overall brightness controlled by the Love Meter. Also spawns transient floating emoji notifications when the emotion state changes.
- **`InputManager`**: Registers global macOS hotkeys to trigger actions when Navi is in the background.
- **`ScreenCaptureService`**: Captures high-fidelity desktop screen images via native OS APIs or Godot's DisplayServer, keeping Navi visible to preserve pointing context.
- **`AIService`**: Orchestrates the direct real-time response streaming pipeline. When a prompt is received, it dispatches directly to the consolidated AI model (bypassing model-swapping VRAM freezes and startup delays). It supports native LLM tool/function calling (sending schemas to Gemini and Ollama) and maps incoming tool calls to modular skills. It also provides fallback/backward-compatible parsing of legacy tag structures (`[SKILL: ...]`), and dynamically enables thinking mode (activating a purple status indicator light). After every response it calls **`EmotionEngine`** to score the interaction and injects the current emotion state into every outgoing system prompt via **`EmotionPromptBuilder`**. It also manages the **Conversational Short-Term Memory (Scratchpad)** and **Multi-Step Continuation Loop (`[CONTINUE]`)** to allow Navi to formulate responses sequentially in stages while letting the user intervene.
- **`SettingsManager`**: Manages the configuration file (`user://settings.json`) saving settings like prompt text, API endpoints, keys, visual colors, toggles for enabling screenshots or deep thinking, and a global font size offset that scales all UI text up or down.
- **`SettingsUI` & `ChatUI`**: Provide the user interface. Features a **fixed dark background** with the dynamically changing mood color applied strictly as a **subtle accent** (on borders, focus rings, headers, and buttons) to prevent eye strain and ensure absolute text readability. Settings are organized into 5 collapsible sections (Behavior, Appearance, AI & Model, Voice, and Advanced) with helpful hover tooltips for every option.
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
│   ├── EmojiNotification.gd     # Floating emoji animation controller
│   └── skills/                  # Decoupled agent skills/tools
│       ├── Skill.gd             # Base class for modular skills
│       ├── TakeScreenshotSkill.gd
│       ├── TakeCropScreenshotSkill.gd
│       ├── HeavyThinkingSkill.gd
│       ├── PointToSkill.gd
│       └── SummarizeSessionSkill.gd
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
├── done.md                      # Completed ticket index
└── project.godot                # Godot project file
```

---

## 🚀 Setup & Execution

### Prerequisites
1. **Godot Engine**: Godot 4.3+ (Forward+ or Compatibility renderer).
2. **Local AI Model (Optional)**: Ollama running locally. Verify it's active at `http://localhost:11434`.
3. **Local Offline Speech-to-Text (STT) and Text-to-Speech (TTS)**:
   - **In-App Downloader (Recommended)**: Open the application's Settings panel, and under the voice options, click the **Download** button. This automatically downloads the Whisper base model and the default Piper voice files directly to your writable local user directory.
   - **Command Line Setup (Developers)**: Alternatively, run the setup script from the project root:
     ```bash
     ./setup_models.sh
     ```
     This script creates the `bin/` subdirectories and downloads the Whisper base model and default Piper voices.
   - **Environment Dependencies**: The local TTS engine wrapper uses Python. Ensure `python3` or `python` is installed in your environment `$PATH`.
     - **In-App**: In the Settings panel under the voice options, click the **Install** button next to **Piper TTS Engine** to install the required `piper-tts` module.
     - **Command Line / Script**: Run the install script from the project root:
       ```bash
       ./install_piper.sh
       ```
       Alternatively, run `pip install piper-tts` manually.

### Exporting & Packaging
When exporting the application for release/distribution, keep in mind:
1. **Non-Resource Exports**: Add `*.bin, *.onnx, *.json` to your Godot export filters in `export_presets.cfg` so the data files are recognized.
2. **Binary Packaging**: Because external binaries cannot be executed by the OS from inside the virtual Godot `.pck` file directly, the `bin/` folder containing the executable binaries (`whisper-cli`, `piper`, and `hotkey_daemon`) **must be manually copied** to the following location:
   - **macOS**: Place the `bin/` directory inside the exported app bundle at `Navi.app/Contents/MacOS/bin/`.
   - **Windows/Linux**: Place the `bin/` directory directly adjacent to the exported executable file.

### Running the App
Open the project in the Godot Editor:
1. Double-click `project.godot` or import it via Godot Project Manager.
2. Press **F5** (or click the Play button in the top right) to run the application.

### How to Interact & Voice Commands
1. **Focus/Interaction Hotkey**: Press the Global Interaction Hotkey (default `Shift + Up`) to activate Navi.
2. **Dictating Voice Commands (Push-to-Talk)**:
   - **Hold** down the hotkey to start recording. Navi's status light will pulse red.
   - **Speak** your command/query while holding the key.
   - **Release** the hotkey to stop recording. The audio will automatically transcribe and submit the prompt.
3. **Refocusing/Cancelling**:
   - A quick **tap** of the hotkey (less than 0.4 seconds) will cancel any active voice recording and focus the text input box, allowing you to type manually.

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
