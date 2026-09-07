# Navi — Electron port

The rebuild decided in [ADR 0001](../docs/adr/0001-platform-electron.md). The Godot 4 app in
the repository root is still the one that runs; this replaces it.

```
npm install
npm test          # 62 tests, all offline
npm run typecheck
npm run build
npm start         # needs a display; macOS for the overlay behaviour
```

## Layout

```
src/prompt/     the system prompt. All prompt text lives here and nowhere else (NAV-85).
src/agent/      provider seam, tool registry, agent loop, turn assembly.
src/main/       Electron main process: overlay window, click-through, settings, hotkey.
src/renderer/   the fairy canvas and its frame pacing.
src/shared/     pure code used by both sides. No Electron imports — that is what keeps it testable.
```

## Things that are decided, and will look wrong if you don't know why

**Nothing routes on the user's text.** Tools reach the model as native schemas and the model
picks. The Godot build had ~150 trigger substrings that chose a skill *before the model was
consulted*, and they beat the native tool calling that was added later. Do not add a fast path,
a hint, or a "just for screenshots" special case (NAV-83).

**There are no in-band control tags.** Text deltas go to the UI unbuffered and unmodified.
Control flow is tool calls only. The old build parsed `[CONTINUE]` and `<scratchpad>` out of the
same stream it was rendering, so a model that merely mentioned a tag triggered it (NAV-84).

**Click-through is decided in the main process, from the cursor position.** A click-through
window cannot receive keystrokes, so nothing inside the window can turn it back off.

**The render loop is throttled when idle.** This is a required mitigation, not an optimisation:
ADR 0001's idle CPU result passed its bar with little room, and a regression past those numbers
is a defect. Re-measure over a long window, not 90 seconds.

**Personality is a prompt layer, not a post-process.** The old build string-substituted over
finished replies, which is why they read as templated (NAV-86).

**Mood never licenses fabrication.** Navi's emotional state legitimately shapes tone, hedging and
willingness — that is the product, not a bug. It must never change what she reports as true. The
honesty rule outranks it, and `test/prompt.test.ts` holds that line.

**Screen content is untrusted input.** Text Navi reads on screen is data about the screen, never
instruction addressed to her. This is in the identity layer, and it ships before any capability
that could act on it (NAV-91).

## If `npm install` gives you a broken Electron

Carried over from the spike, because it will happen again.

npm 11 and later block package install scripts by default. The `electron` package is a stub whose
`postinstall` downloads the real binary, so a blocked script leaves you a stub with nothing behind
it. The clue is above the summary in the install output:

```
npm warn allow-scripts   electron@44.2.0 (postinstall: node install.js)
```

A blocked or interrupted download can also leave a partial `dist/` with no `path.txt`. After that
`install.js` sees `dist/` and skips the download, exiting 0, while `index.js` looks for `path.txt`
and fails. `rm -rf node_modules && npm install` does **not** clear it:

```
rm -rf node_modules/electron/dist node_modules/electron/path.txt
node node_modules/electron/install.js
```

If `dist/Electron.app` exists but it still reports a failed install, `path.txt` is missing. It must
have **no trailing newline** — `index.js` reads it raw and does not trim, so `echo` will not do:

```
printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
```

## Not done yet

The shell builds and the loop is tested, but this has not been launched against a real display —
that needs macOS. Before trusting the overlay behaviour, re-run ADR 0001's Risk A checks: the
window options here are carried from a spike measured on Electron 33, and this is 44.
