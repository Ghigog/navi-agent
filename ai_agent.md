# AI Agent Guidelines & Architecture

Subsequent AI agents modifying this codebase must adhere to the following principles, coding style, and architectural patterns.

---

## 1. Scene Structure & Composition

- **Node Composition over Deep Inheritance**: Prefer combining small, single-responsibility nodes (composition) rather than building complex inheritance hierarchies.
- **Visual/Logic Separation**: Keep visuals (e.g., `GPUParticles2D`, `GPUParticles3D`, shaders, animations) isolated from business logic. A controller node should manage the state and drive the visual node.
- **Scene File Names**: Use `PascalCase` for scene names (e.g., `FairyVisuals.tscn`) and matching GDScript file names (e.g., `FairyVisuals.gd`).

---

## 2. GDScript 2.0 Coding Standards

All script modifications must follow these syntax and layout conventions:

```gdscript
class_name ClassType
extends SuperClass
## Short docstring explaining the purpose of this script.

# 1. Signals
signal something_changed(new_value: float)

# 2. Enums & Constants
enum State { IDLE, FOLLOW, INTERACT }
const OFFSET_DISTANCE := Vector2(25, 25)

# 3. Exported Variables (Grouped logically)
@export_group("Follow Parameters")
@export var follow_delay: float = 0.1
@export var lerp_speed: float = 5.0

# 4. Public Variables
var current_state: State = State.IDLE

# 5. Private/Onready Variables
var _initial_pos: Vector2
@onready var _particles: GPUParticles2D = $GPUParticles2D

# 6. Lifecycle Methods
func _ready() -> void:
	_initial_pos = global_position

func _process(delta: float) -> void:
	_update_position(delta)

# 7. Public Methods
func start_interaction() -> void:
	current_state = State.INTERACT

# 8. Private Methods
func _update_position(delta: float) -> void:
	pass
```

### Static Typing
Static typing is **mandatory** for all variables, function arguments, and return types. Avoid implicit dynamic variables:
- **Correct**: `var pos: Vector2 = Vector2.ZERO`
- **Correct**: `var value := 10.0` (inferred float)
- **Incorrect**: `var value = 10`

---

## 3. Communication Patterns

- **"Signal Up, Call Down"**: A parent node calls public methods on child nodes directly. A child node emits signals to communicate state changes upward, keeping child nodes decoupled and reusable.
- **Autoload Singletons**: Use singletons only for persistent services that cross-cut scenes (e.g., `AIService` for LLM requests, `SettingsManager` for configs, `InputManager` for hotkeys). Do not store local UI state in singletons.

---

## 4. UI & Theme Guidelines

All user interfaces must implement a modern, premium dark glassmorphism style:
- **Aesthetics**: Dark translucent backdrops (e.g., deep navy or charcoal at ~15–25% opacity) using glassmorphism (via a `Panel` or `ColorRect` with a CanvasItem shader sampling `screen_texture` for a blur effect). Accent borders should use a cool teal-to-purple gradient glow with thin hairlines (1–2 px) to create depth.
- **Typography**: Use modern sans-serif typography (e.g., Outfit or Inter fonts) with consistent sizing. Do not use browser/OS system default fonts where possible.
- **Micro-Animations**: All button presses, settings menus, and chat panels must scale or fade smoothly (using `Tween` or `AnimationPlayer`) rather than instantly popping onto the screen.

---

## 5. Transparent Window Configuration

Because Navi runs as a transparent desktop assistant:
- Use a small borderless window for follow mode, positioned dynamically at an offset from the mouse position via:
  ```gdscript
  DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
  get_viewport().transparent_bg = true
  ```
- Position updates are driven via `_process()` using `DisplayServer.window_set_position(target_screen_position)`.
- When the chat prompt opens, the window size should adjust to accommodate the UI and request focus via `DisplayServer.window_move_to_foreground()`.

---

## 6. Unit Testing with GUT

We use the **GUT (Godot Unit Testing)** framework.
- **Unit Testing Rules**:
  - All tests must be placed in the `res://test/` directory.
  - Test script names must begin with `test_` (e.g., `test_ai_service.gd`).
  - All test classes must extend `GutTest` and use static types.
  - For asynchronous tests (like API requests or timers), use `yield_to` or await signals properly to ensure tests do not hang.
  - Mock any external API endpoints instead of making real network requests.

- **Headless Execution Command (macOS)**:
  On macOS workspaces, the Godot binary is typically located inside the application bundle at `/Applications/Godot.app/Contents/MacOS/Godot`. Use the GUT CLI runner `gut_cmdln.gd` to run tests headlessly from the project root:
  ```bash
  /Applications/Godot.app/Contents/MacOS/Godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test/ -gexit
  ```

- **Example Test Skeleton**:
  ```gdscript
  extends GutTest

  var _fairy: Node2D

  func before_each() -> void:
  	_fairy = load("res://scenes/Fairy.tscn").instantiate()
  	add_child_ref(_fairy)

  func test_initial_state_is_follow() -> void:
  	assert_eq(_fairy.current_state, 0, "Fairy should start in FOLLOW state.")
  ```
- **Code Coverage**: Ensure helper methods, state changes, UI signal mappings, and API endpoints are tested using mock data inputs rather than calling actual external API endpoints.
