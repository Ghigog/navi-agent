# ADR 0001 — Rebuild Navi on Electron, retiring Godot

- **Status:** Accepted
- **Date:** 2026-09-07
- **Ticket:** NAV-94
- **Supersedes:** the Godot 4 implementation at `bb51774`

## Context

Navi is a desktop AI companion built in Godot 4: a transparent, always-on-top fairy that follows the
cursor and answers questions about what is on screen. Godot serves the overlay well, but three
pressures made the platform a live question.

1. **Godot cannot do computer use at all.** It has no API for synthesizing input outside its own
   window, enumerating other applications' windows, or reading an accessibility tree.
   `Input.parse_input_event` only feeds Godot's own queue. Since screenshot-derived pixel coordinates
   have proven unreliable in practice, the agreed fix is the macOS Accessibility API (NAV-90) — which
   requires a native helper regardless of host framework.
2. **UI iteration is expensive.** `SettingsUI.gd` is 1455 lines of imperative `Control` construction
   and is reported as painful to change. HTML mockups cannot be brought into a Godot UI without full
   manual reimplementation, which taxes every UI change.
3. **The remaining hard problems have libraries elsewhere.** SSE parsing, tool loops, retries,
   structured outputs, an accessibility bridge, MCP — all have maintained implementations in
   TypeScript and none in GDScript. `AIService.gd` had grown to 2320 lines, most of it a hand-written
   agent framework. NAV-87 and NAV-88 existed only because that infrastructure was being written by
   hand.

## Decision

**Rebuild on Electron + TypeScript**, with a stateless Swift helper for native macOS work
(accessibility tree reads, input synthesis, global hotkeys).

The Swift helper is deliberately *not* a second brain. It holds no conversation state and makes no
model calls; it is an actuator with a narrow, platform-neutral API. That is a materially different
proposition from splitting the app into two stateful halves, which was considered and rejected.

**Ollama remains the primary target and the core path must work offline.** Any hosted provider is an
optional extra behind the same seam, never a dependency. Where a hosted SDK would supply the agent
loop, the local path gets a small tool-call loop written once against the OpenAI-compatible endpoint
Ollama already serves.

## Validating evidence

A throwaway spike (`spike/`) split the risk in two and ran both halves before any porting began.

### Risk B — rendering cost: PASS

A canvas reimplementation of `FairyVisuals.gd`, measured headless on CPU raster with no GPU;
200x200 at dpr 2, 48 particles plus wings, aura, core and a pulsing status light.

```
mean frame        0.208 ms
p50 / p95 / p99   0.200 / 0.300 / 0.600 ms
worst frame       1.700 ms
60fps budget      16.67 ms
p99 headroom      27.8x
est. load @60fps  1.2% of one core
```

`FairyVisuals.gd` is 520 lines; `fairy.js` is about 100 and includes the Triforce emotion tint.
Rendering was never a reason to stay in Godot.

### Risk A — macOS window behaviour: PASS

Run on macOS (Apple Silicon MacBook Air), Electron 33.

```
PASS  window created with transparent:true
PASS  always-on-top at screen-saver level          isAlwaysOnTop=true
PASS  setIgnoreMouseEvents(forward) accepted
PASS  backgroundColor is fully transparent
PASS  global shortcut registered                   Shift+Cmd+N
PASS  global shortcut fired while unfocused
PASS  background genuinely transparent (observed)  user-confirmed
PASS  click-through toggles both ways (observed)   user-confirmed

idle CPU  avg 2.4-2.6%   peak 4.6%
memory    peak 356 MB

VERDICT: GO
```

## Consequences

### Accepted costs

- **Resource headroom is the weakest result.** Idle CPU averaged 2.4-2.6% against a 5% bar, and peak
  memory was 356 MB against a 400 MB bar. Both pass, neither comfortably, and the sample was only
  ~1.5 minutes. Godot would likely use less. **Mitigation, required during the port:** throttle the
  render loop when idle — the fairy does not need 60fps when nothing is happening, and 30fps roughly
  halves the CPU figure. Re-measure over a longer window early in the port and treat a regression
  past these numbers as a defect.
- `FairyVisuals.gd` must be rebuilt in canvas. The spike shows this is cheap and the result is easier
  to iterate on visually. `spike/fairy.js` is a working starting point and should be carried into the
  port rather than discarded with the rest of the spike.
- Roughly 8000 lines of GDScript retired.

### Discovered constraints

- **Click-through cannot be toggled from inside the window.** A window in click-through mode cannot
  receive keystrokes — that is what click-through means — so an in-window binding can enable it and
  never disable it. Navi must drive click-through from outside: a global shortcut, or the usual
  desktop-companion pattern of click-through on by default, disabled only while the cursor is over
  the fairy's opaque pixels. Design for this up front.
- **macOS native fullscreen moves an app to its own Space** and the overlay stays behind, even with
  `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true })`. Zoom fullscreen keeps it visible.
  This is desirable: NAV-96 already requires that ambient presence never interrupt during full-screen
  presentations, so the OS enforces a rule the design wanted.
- **`Shift+Ctrl+Alt+Space` collides with macOS input-source switching.** Navi's configured hotkey
  (`Shift+Cmd+N`) registers and fires reliably while unfocused; the Swift daemon's original default
  does not.

### Ticket consequences

- **NAV-87** (replace hand-rolled SSE parsing) — closed as superseded. The SDK supplies streaming as
  an async iterator; the parser is never written.
- **NAV-88** (decompose `AIService.gd`) — closed as superseded. The file is not ported.
- **NAV-98** (dead code) — largely moot; code that is never ported needs no deletion. Verify the
  `enable_push_to_talk` and thinking-model-key items do not reappear in the new settings layer.
- **NAV-83, 84, 85, 86** — no longer refactors. They become constraints on the port: never port the
  substring router, never port the in-band control tags, build the layered prompt assembler correctly
  the first time, and put personality in the identity layer rather than post-processing.
- **NAV-82** (tests and CI) — rebuilt on the new stack rather than on GUT.

## Alternatives considered

**Stay in Godot.** Rejected. It cannot do computer use at all, the settings UI is already the main
source of friction, and it forces continued hand-maintenance of agent infrastructure that exists as
libraries elsewhere. Rendering quality and cost — Godot's genuine strength — turned out not to be a
differentiator once measured.

**Tauri + Rust.** A reasonable option with a smaller footprint, and it would have addressed the one
weak spot in the Electron result. Rejected because the native accessibility work belongs in Swift
either way, which removes Tauri's main advantage, while adding a language to a solo project. Worth
revisiting only if the idle-resource mitigation above fails.

**Split Godot shell + separate agent process.** Rejected. Conversation state and UI state would live
on opposite sides of a socket and drift. Electron's main process hosts the agent directly, so no such
split exists.

**Native Swift / SwiftUI.** Best window control and smallest footprint, but no HTML, which forfeits
the design-to-code workflow that is a primary motivation for moving at all.
