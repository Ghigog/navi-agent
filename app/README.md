# Navi — Electron port

The rebuild decided in [ADR 0001](../docs/adr/0001-platform-electron.md). The Godot 4 app in
the repository root is still the one that runs; this replaces it.

```
npm install
npm test          # 186 tests, all offline
npm run typecheck
npm run build
npm start         # needs a display; macOS for the overlay behaviour
```

CI runs the first four on every push and pull request (`.github/workflows/ci.yml`, NAV-82). It
skips the Electron binary download, because nothing but `npm start` needs it — keep it that way:
a suite that needs a display, a network or a running Ollama is a suite that goes red for reasons
that are not about the code.

## Layout

```
src/prompt/     the system prompt. All prompt text lives here and nowhere else (NAV-85).
src/agent/      provider seam, tool registry, agent loop, turn assembly.
src/main/       Electron main process: the three windows, the cursor poll that drives
                click-through and following, settings, hotkey, and conversation.ts — the thing
                that finally calls takeTurn.
src/renderer/   the fairy canvas and its frame pacing, the chat surface, and settings.
src/shared/     pure code used by both sides. No Electron imports — that is what keeps it testable.
                emotion.ts is the whole Triforce engine (emotions.md); settings, redaction and the
                motion maths live here too.
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

**There is one cursor poll, not two.** Click-through and cursor following both act on the
pointer, and separate timers would sample it at separate rates — she would ease towards a
position a tenth of a second away from the one deciding whether she takes clicks. `main/cursor.ts`
is the single timer, and because it runs for the life of the app it is measured against ADR 0001's
idle CPU bar and follows the same idle frame rate the render loop does.

**Following moves the window from the main process, and skips the call when nothing changed.**
The renderer cannot move its own window, and a per-frame window move sits on top of the port's
weakest measurement — so a still cursor and a settled fairy cost no window call at all.
`main/follow.ts` keeps a sub-pixel position of its own rather than easing from the window's
rounded bounds, which is what the Godot build did and why it jittered.

**Following pauses while the chat window is open, and a flight outranks the pause.** The panel
is placed against her once, on open; a fairy who kept walking would drag it around while you
type into it. Pointing is the exception, because pointing at something is most useful exactly
when you are mid-conversation about it.

**The fairy canvas carries two sizes, and they are not the same number.** The backing store is
device pixels (`size * dpr`); the CSS size is `size`. Set only the first and the element lays out
at its attribute size — 400px inside a 200px window on a Retina display, showing her top-left
quarter. It is invisible at dpr 1, which is every test and every headless run, so it survived to
the first launch on a real display. `test/fairy.test.ts` holds the line.

**The render loop is throttled when idle.** This is a required mitigation, not an optimisation:
ADR 0001's idle CPU result passed its bar with little room, and a regression past those numbers
is a defect. Re-measure over a long window, not 90 seconds.

**Personality is a prompt layer, not a post-process.** The old build string-substituted over
finished replies, which is why they read as templated (NAV-86).

**The chat surface is its own window.** Not a panel inside the overlay: the overlay is
click-through by default and a click-through window cannot receive a keystroke, so a text input
inside it could never be typed into. The overlay stays something you see through; the chat
window is the thing you talk to. Both show the same emotional state, because she is the one
having the conversation.

**`main/conversation.ts` imports nothing from Electron.** Settings, the provider, the emotion
store and where events go all arrive as dependencies, which is what lets a whole exchange run
under test — including `test/integration.test.ts`, which runs one over real HTTP against a
server it starts itself. `main/index.ts` is wiring and holds no decisions; keep it that way.

**An exchange is scored twice, and that is emotions.md, not a mistake.** The pre-reply pass
classifies how the message was written and applies it to the dimensions, so the reply is
generated in the mood the message put her in rather than the one after it. The post-turn pass
scores what the turn actually did and moves the Love Meter. Sentiment reaches the second pass
as its Love adjustment only — `sentimentDimensionsApplied` is what stops one message being felt
twice, and emotions.md §4.4 states each magnitude once.

**Sentiment classification fails towards `neutral` and never throws.** It is a second model
call in front of every message, so a provider that is down, slow or babbling must cost a mood
reading and not the user's turn. `neutral` is the label that moves nothing, which is why it is
the one to fail towards.

**A message is not context for itself.** `session.ts` excludes the message being answered from
what it counts as recalled. Leave it in and every prompt overlaps its own context perfectly,
which scores full Wisdom on every turn — including the first, when she knew nothing.

**The settings window is never sent the API key.** It is told whether one is set and nothing
more (NAV-81 — route nothing derived from settings to a renderer unredacted), so it sends a key
only when the user types a new one. `applyUpdate` touches only the keys a patch carries, which
is what makes a save from a window that cannot see the key safe: it cannot erase it. Clearing a
key is a button, so that it takes an action rather than an absence.

**`shared/settings.ts` validates, the settings window does not.** A save is an IPC boundary
carrying something a person typed, so `coerce` checks the provider name against the real list
and bounds the frame rates — `typeof` alone would let `'banana'` through as a provider and
`9000` through as an idle frame rate, and the second is a way to fail ADR 0001's CPU bar from
the settings window.

**An emotion dimension only moves when the turn exercised it.** Ordinary conversation does not
touch a tool, so it must not score Power as "no tool available" — otherwise Navi decays into
Oblivion just by being talked to. `TurnOutcome`'s three relevance flags default to false and
`session.ts` sets them from what actually happened. Deleting them looks like a simplification and
is a behaviour change.

**A relevant dimension is scored from zero, not adjusted from its last value.** The score is a
reading of this turn. Accumulation happens in the Love Meter and nowhere else.

**Emotion state is its own file, not part of settings.** Resetting your preferences should not
wipe the relationship. `coerceState` also re-derives the emotion and relationship labels from
the scores, so hand-editing `emotion.json` to say `best_friend` does nothing.

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

## Talking to her

`Shift+Cmd+N` toggles the chat window, and so does clicking her — the main process only lets a
click reach the overlay while the cursor is over her body, so the transparent aura is not a
button. Enter sends, Shift+Enter is a newline, and Escape stops a reply in progress or closes
the window when there is nothing to stop.

The header carries her current emotion and relationship, tinted with the same colour she is,
and says whether what you type stays on this machine. No tools are registered yet, so she can
talk and nothing else; the registry is there and the model picks from it when there is
something in it.

`sentimentModel` in settings takes a small fast model for the §4.4 classification call. Left
empty it uses whatever model the turn is using, so nothing has to be configured for her to work.

The gear in the chat header opens settings, and so does `⌘,`. Fields commit as you leave them;
there is no Save button. The Prompt tab shows the exact system prompt of the last request,
broken down by layer, which is what NAV-85 built the inspector for — most settings here end up
as text in that prompt, and this is where you check that they did.

## Not done yet

The surfaces are built. The capabilities are not — that is the honest summary, and the section
below is the detail.

**She has no tools.** `main/index.ts` creates an empty `ToolRegistry` and registers nothing, so
she can hold a conversation and do nothing else. The Godot build's five skills — screenshot,
cursor-anchored crop screenshot, point-to, session summary, heavy-thinking model swap — are all
unported. The first two are the ones the product is actually about: "hey Navi, what's this near
my cursor?" does not work yet (NAV-103).

**She does not follow the cursor.** `FollowController.gd` lerps her towards it every frame and
flies her to a coordinate for pointing. Neither is ported: `createOverlay` places her once at
launch and she stays there. `FOLLOW_OFFSET` is a launch offset despite its name (NAV-102).

**She has no voice.** `STTService.gd` and `TTSService.gd` drive `bin/whisper-cli` and
`bin/piper`, which are still tracked in the repository. Nothing in `app/` touches them
(NAV-104).

**A launch on a real display, properly.** She now runs on macOS, and the first launch found a
bug the whole automated suite could not: the canvas laid out at its backing-store size, so on a
Retina display only her top-left quarter was visible. Every test and every headless run is
dpr 1, where that is invisible. What still has not been done is the rest of ADR 0001's Risk A
list — background genuinely transparent, click-through toggling both ways, the global shortcut
firing while unfocused — and the idle CPU and memory re-measurement over a long window. Treat
that HiDPI bug as the argument for doing them by hand rather than assuming.
