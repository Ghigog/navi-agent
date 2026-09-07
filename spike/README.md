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

### If it says "Electron failed to install correctly"

npm 11 and later block package install scripts by default. The `electron` npm package is only a
stub — its `postinstall` is what downloads the actual binary — so when that script is blocked you
get a stub with no Electron behind it. The clue appears in the `npm install` output, above the
error:

```
npm warn allow-scripts   electron@33.4.11 (postinstall: node install.js)
```

Approving the script is necessary but **not sufficient**, because the blocked first attempt leaves a
partial `dist/` directory behind with no `path.txt`. After that, `install.js` sees `dist/` and skips
the download (exiting silently with status 0), while `index.js` looks for `path.txt` and fails. A
plain `rm -rf node_modules && npm install` does not clear it. Do this instead:

```bash
npm approve-scripts electron
rm -rf node_modules/electron/dist node_modules/electron/path.txt
node node_modules/electron/install.js
npm run spike
```

Confirm it worked before running the spike — `ls node_modules/electron/dist/` should show
`Electron.app` on macOS. If `install.js` prints nothing and `dist/` is still missing, the download
itself is being blocked (proxy or network), which is a different problem.

### If `dist/Electron.app` exists but it still says "failed to install correctly"

`install.js` downloaded the binary but never wrote `path.txt`, the one-line file `index.js` reads to
locate it. Either bypass the wrapper, which does not consult `path.txt` at all:

```bash
npm run spike:direct
```

or write the file and use the normal script:

```bash
npm run fix-path && npm run spike
```

`path.txt` must have **no trailing newline** — `index.js` reads it raw and does not trim, so `echo`
produces a path ending in `\n` and the spawn fails with `ENOENT`. Use `printf`, which is what
`fix-path` does.

**Do not spend more time than this on it.** The spike answers a question about macOS window
behaviour; Electron's installer is not that question. If `spike:direct` does not start, say so and
move on — the same checks can be run another way.

`npm audit` will also report vulnerabilities in Electron's build-time dependency tree. Ignore them:
this is a throwaway dev dependency that is never distributed.

A fairy appears near your cursor. **Every control is a global shortcut**, on purpose — see the
finding below.

1. **Drag it over a bright window, then a dark one.** Genuinely transparent, or just dark-coloured?
   This is the one that fails silently and matters most.
2. **`Shift+Cmd+T`** toggles click-through. Click a window underneath, then press it again. Does it
   toggle *both* ways? (It auto-restores after 10s so you cannot get stuck.)
3. **Focus another app and press `Shift+Cmd+N`.** Does the HUD acknowledge it?
4. **Leave it idling several minutes** so the CPU average means something.
5. **`Shift+Cmd+0`**, or `Ctrl+C` in the terminal. It asks the two questions only your eyes can
   answer, then prints a verdict.

### Finding: click-through cannot be toggled from inside the window

A window in click-through mode cannot receive keystrokes — that is precisely what click-through
means. An in-window key binding can therefore turn it *on* and never turn it *off*. This is inherent
to the mechanism, not a bug.

**Consequence for Navi:** click-through state must be driven from outside the window. Either a global
shortcut, or — the usual pattern for desktop companions — automatically from cursor position, with
click-through on by default and disabled only while the cursor is over the fairy's opaque pixels.
Design for this before the port, not after.

### Finding: macOS native fullscreen

An app entering *native* fullscreen moves to its own Space, and the overlay stays behind on the
original Space, even with `setVisibleOnAllWorkspaces(..., { visibleOnFullScreen: true })`. Zoom
fullscreen (double-clicking the title bar) keeps the overlay visible.

This is **expected and desirable**: NAV-96 requires that ambient presence never interrupt during
full-screen presentations, so the OS is enforcing a rule the design already wanted.

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
