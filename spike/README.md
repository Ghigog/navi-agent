# NAV-94 overlay spike

Decides whether Electron can host the Navi overlay before any porting begins.
The spike exists so a **NO-GO is cheap**. Do not start the migration until it passes.

The risk splits in two.

| | Question | Where it can be answered |
|---|---|---|
| **Risk A** | Can Electron do the *window*? Transparent per-pixel, borderless, always on top, click-through, above full-screen apps. | **macOS only.** These are AppKit behaviours; nothing about them can be verified on Linux or CI. |
| **Risk B** | Is a canvas fairy cheap enough to leave running all day? | Anywhere. Same Blink renderer that Electron ships. |

## Risk B — already answered

Run it yourself with `npm run bench` (no dependencies, uses a local Chromium).

Measured on Linux CPU raster, no GPU, 200x200 @ dpr 2, 48 particles plus wings, aura, core
and a pulsing status light:

```
mean frame        0.208 ms
p50 / p95 / p99   0.200 / 0.300 / 0.600 ms
worst frame       1.700 ms
60fps budget      16.67 ms
p99 headroom      27.8x
est. load @60fps  1.2% of one core

VERDICT: PASS — comfortably cheap
```

**Conclusion: the fairy is not a reason to stay in Godot.** With 27.8x headroom on CPU raster
alone, and GPU compositing available on macOS, rendering cost is not a differentiator between
the two platforms. `FairyVisuals.gd` is 520 lines; `fairy.js` is about 100 and does the same
job including the Triforce emotion tint.

This does **not** measure Electron's own idle overhead — the compositor, the main process, IPC.
That is part of Risk A.

## Risk A — run this on your Mac

```bash
cd spike
npm install     # pulls Electron, ~250 MB, one time
npm run spike
```

A fairy appears near your cursor. Then:

1. **Drag it over a bright window, then a dark one.** Is the background genuinely transparent,
   or just dark-coloured? This is the one that fails silently and matters most.
2. **Press `T`** to toggle click-through, then click a window underneath. Do the clicks land?
3. **Put an app in full screen.** Does the fairy stay visible?
4. **Focus another app and press `Shift+Ctrl+Alt+Space`.** Does the shortcut fire?
5. **Leave it running several minutes** so the idle CPU average means something.
6. **`Cmd+Q`.** It asks the three questions only your eyes can answer, then prints a verdict.

### Pass bar

- Every automated check PASS
- All three observed checks confirmed
- Global shortcut fires while unfocused
- Idle CPU **< 5%** average
- Peak memory **< 400 MB**

A GO means proceed with the migration. A NO-GO means do not port — re-run against Tauri, or
stay in Godot and schedule NAV-82 and NAV-98 instead. **Paste the output into the NAV-94 ADR
either way**; a recorded NO-GO is as valuable as a GO.

## Known macOS pitfalls this is checking for

- `transparent: true` **cannot be toggled after window creation** in Electron. If transparency
  is broken it is broken permanently for that window, so it must be right at construction.
- Transparent windows can disable some GPU compositing paths, which is precisely why idle CPU
  is measured rather than assumed.
- `setIgnoreMouseEvents(true, { forward: true })` is the click-through mechanism. Without
  `forward: true` the window stops receiving the hover events the fairy needs.
- Floating above full-screen apps requires **both** `setAlwaysOnTop(true, 'screen-saver')` and
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`. One without the other
  silently under-delivers.
- Tauri, if it comes to that, needs `macOSPrivateApi: true` for transparent windows, which has
  App Store implications. Not a concern for direct distribution.

## Files

| File | Purpose |
|---|---|
| `fairy.js` | The renderer. Shared by the benchmark and the spike app; no framework, no build step. |
| `bench.mjs` | Risk B. Drives Chromium over CDP, reports frame-time percentiles. |
| `main.js` | Risk A. Window configuration, automated checks, resource sampling, verdict. |
| `index.html` | Spike UI: fairy plus a live HUD. |
| `preload.js` | Context-isolated IPC bridge. |

This directory is a **throwaway**. It answers one question and is deleted once NAV-94 is
recorded, whichever way it goes.
