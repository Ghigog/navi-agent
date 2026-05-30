# Navi: Desktop AI Fairy Assistant (Godot 4)

Navi is a desktop AI companion designed using Godot 4. Inspired by the fairy Navi from *The Legend of Zelda: Ocarina of Time*, Navi floats on your desktop as a borderless, transparent-background window that follows the mouse cursor with a smooth interpolation and offset.

Pressing a hotkey freezes the fairy in place on your screen and opens a subtle text prompt box next to it. You can click and drag the fairy to any focus point on your screen; letting go of the fairy automatically takes a new desktop screenshot to focus the AI's visual context. When you submit a prompt, Navi's response appears as a screen-aware glassmorphic speech bubble pointing directly to the fairy. Navi connects to your choice of a local model (Ollama) or a cloud service (Gemini API) and streams the response back inside a modern, magical "Hextech" UI.


---

## 📖 Project Documentation

Please review the following design and architectural specifications:
- [AI Agent Guidelines](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/ai_agent.md): General architectural conventions, scene structures, styling rules, and GUT coding best practices.
- [Development Tickets](file:///Users/dylangrowcoot/Documents/Personal%20Apps/navi/tickets.md): Granular agile implementation tickets representing features in development order, with acceptance criteria for unit tests.

---

## 🛠 Project Architecture Overview

Navi utilizes a modular architecture to handle the desktop assistant workflow:
- **`WindowController`**: Sets up borderless window sizes, allows transparency, and manages window focus switches.
- **`FollowController`**: Tracks the global OS mouse coordinate and updates the window's position at a fixed offset so that it never overlaps the cursor (allowing mouse clicks to go to other desktop apps naturally).
- **`FairyVisuals`**: Manages the glowing particle effects and flapping wings (supporting color configurations).
- **`InputManager`**: Registers global macOS hotkeys to trigger actions when Navi is in the background.
- **`ScreenCaptureService`**: Captures high-fidelity desktop screen images via native OS APIs or Godot's DisplayServer, keeping Navi visible to preserve pointing context.
- **`AIService`**: Orchestrates the direct real-time response streaming pipeline. When a prompt is received, it dispatches directly to the fast model first (bypassing pre-call planning delays for conversational speed under 3s). It intercepts and filters skill tags (`[SKILL: ...]`) to trigger screen captures or handoffs to the heavy reasoning model dynamically, displaying a status indicator light (amber/purple) to represent thinking states.
- **`SettingsManager`**: Manages the configuration file (`user://settings.json`) saving settings like prompt text, API endpoints, keys, visual colors, and toggles for enabling screenshots or deep thinking.

---

## 📂 Folder Directory Layout

We organize the Godot project folder structure as follows:

```text
navi/
├── .godot/                # Godot internal cache
├── addons/
│   └── gut/               # GUT Unit testing addon
├── assets/
│   ├── fonts/             # Modern typography (Outfit, Inter)
│   ├── shaders/           # Glassmorphism blur shader, glows
│   └── textures/          # Sprite sheets/particles
├── scenes/
│   ├── Main.tscn          # Main orchestrator scene
│   ├── FairyVisuals.tscn  # Particle effects & wing flap visual
│   ├── ChatUI.tscn        # Translucent input/output panel
│   └── SettingsUI.tscn    # Settings control panel
├── scripts/
│   ├── WindowController.gd# Window state & transparency setup
│   ├── FollowController.gd# Mouse tracking & lerp calculations
│   ├── InputManager.gd    # Hotkey registration singleton
│   ├── AIService.gd       # API request backend singleton
│   ├── SettingsManager.gd # Local settings storage singleton
│   └── ScreenCapture.gd   # Screenshot utility class
├── test/                  # GUT Unit tests
│   ├── test_agent_skills.gd
│   ├── test_ai_service.gd
│   ├── test_chat_ui.gd
│   ├── test_fairy_visuals.gd
│   ├── test_follow.gd
│   ├── test_hotkey.gd
│   ├── test_screen_capture.gd
│   ├── test_settings.gd
│   └── test_window.gd
└── project.godot          # Godot project file
```

---

## 🚀 Setup & Execution

### Prerequisites
1. **Godot Engine**: Godot 4.3+ (Forward+ or Compatibility renderer).
2. **Local AI Model (Optional)**: Ollama running locally. Verify it's active at `http://localhost:11434`.

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
