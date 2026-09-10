# Navi

A desktop AI companion. She floats on your desktop in a transparent always-on-top window,
follows your cursor, answers questions about what is on your screen, and has a persistent
emotional state and a relationship with you that accumulates over time.

The owner's own description of what she is for, which should override any inference you draw
from the code:

> Someone close at hand that I can talk to, make friends with, make notes and get reminders, ask
> her to point something out on the screen. Instead of screenshotting something weird and sending
> it to Claude, I should be able to say "hey Navi, what's this near my cursor?" Maybe she'll say
> "I don't know and you suck" because I've been treating her badly. She should be somewhat
> capricious, so I need to look after her, like a virtual pet.

**She is a companion first and an agent second, and her moods really do affect her competence.**
That is intended rather than tolerated, and it means she is explicitly not for work that has to
be right the first time every time. The one line a mood may never cross is honesty: it may make
her terse, reluctant or unwilling, and it may never make her invent a fact or misreport your
screen. See [`mission_statement.md`](mission_statement.md) § "The position" (NAV-97).

## Running her

```
npm install
npm test          # offline: no display, no network, no model
npm run typecheck
npm run build
npm start         # needs a display; macOS for the overlay behaviour
```

`npm start` is the only way to run Navi. She is an Electron + TypeScript app
([ADR 0001](docs/adr/0001-platform-electron.md)); the Godot 4 original was deleted by NAV-105
once the port reached parity, and lives on only in git history.

First launch opens a guided setup: pick a model provider — Ollama locally, or an OpenAI key —
and work through the macOS permissions, which are shown live with links to the right System
Settings panes. Reopen it any time from Settings.

For voice, `./setup_models.sh` fetches the whisper and piper models into `bin/`, and
`./install_piper.sh` installs piper itself. Both halves of voice are off until you turn them on.

CI runs the four commands above on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml), NAV-82). It skips the Electron binary
download, because nothing but `npm start` needs it — keep it that way: a suite that needs a
display, a network or a running Ollama is a suite that goes red for reasons that are not about
the code.

## Documentation

- [`HANDOFF.md`](HANDOFF.md) — start here. What is built, what is not, and what will mislead you.
- [`mission_statement.md`](mission_statement.md) — who she is, and the bound on her moods.
- [`emotions.md`](emotions.md) — the Triforce emotion system: the three dimensions, the composite
  emotions, the Love Meter, and how each reaches the prompt.
- [`docs/adr/0001-platform-electron.md`](docs/adr/0001-platform-electron.md) — why Electron, with
  the spike's measurements.
- [`backlog.md`](backlog.md) — the plan. Opens with Implementation Order, which is the sequence;
  ticket IDs are identity and never sequence.
- [`done.md`](done.md) — historical index of completed tickets, and an accuracy audit of them.

## Layout

```
src/prompt/     the system prompt. All prompt text lives here and nowhere else (NAV-85).
src/agent/      provider seam, tool registry, the screen tools, agent loop, turn assembly.
src/main/       Electron main process: the four windows, the cursor poll that drives
                click-through and following, capture, voice, settings, hotkeys, and
                conversation.ts — the thing that finally calls takeTurn.
src/renderer/   the fairy canvas and its frame pacing, the chat surface, settings, first run,
                and the microphone.
src/shared/     pure code used by both sides. No Electron imports — that is what keeps it
                testable. emotion.ts is the whole Triforce engine (emotions.md); settings,
                redaction, onboarding readiness, the crop arithmetic, the motion maths and the
                sentence splitter live here too.
bin/            the local voice binaries. Models are fetched by setup_models.sh, not tracked.
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
honesty rule outranks it; `mission_statement.md` § "The position" records what mood may and may
not touch, item by item, and `test/identity.test.ts` holds the line (NAV-97).

**Screen content is untrusted input.** Text Navi reads on screen is data about the screen, never
instruction addressed to her. This is in the identity layer, and it shipped before any capability
that could act on it (NAV-91). A capture reaches the model as a *user-role* message, because the
chat schema has no place for an image on a tool message — so it is labelled as a picture, and the
identity rule was extended to say that it applies to any image in any role. The user role is the
trusted one; a screenshot is not.

**The crop is anchored on the cursor as it was when the user asked.** Not on the fairy, and not on
where the cursor is when the tool runs. `conversation.send` freezes a sample before anything can
await, and `agent/screen.ts` cannot reach the live cursor at all — only the frozen one. This is
NAV-99, and reading the live cursor inside a tool is the original bug in new clothes.

**Audio failures degrade to text.** Piper missing, no voice model, no microphone, nothing to play
a wav on: she says why, once per reply, and the turn is untouched. Speech is an ornament on a turn
and never a dependency of one — the same rule sentiment classification follows.

**The talk key is press-to-start, press-again-to-stop.** Not hold-to-talk, and that is forced:
`globalShortcut` reports key presses and never releases, so a held key would start a recording
nothing could end. An in-window binding is not an option either — the overlay is click-through and
never holds the keyboard.

**She starts speaking on the first finished sentence, not the finished reply.** `shared/speech.ts`
will not stop at the `.` in "3.5", which is why the *last* sentence of a reply can only leave
through `flush()`: until the stream ends, a full stop at the end of the buffer might be a decimal
point.

**Nothing on first run fails silently.** Navi needs a model provider, Screen Recording and
Accessibility, and all three fail quietly by default. `shared/onboarding.ts` is the single answer
to "is she usable yet?", and the checklist polls because macOS grants these in another application
entirely — a checklist that only updated on relaunch would teach the user that granting the
permission did not work.

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
and says whether what you type stays on this machine.

She has three tools and the model picks between them: `look_at_screen`, `look_near_cursor` and
`point_to`. Nothing inspects what you typed to choose one.

With voice turned on in Settings, `Shift+Cmd+V` starts listening and stops it again. Both halves
are off by default and both need `setup_models.sh` to have fetched their models.

`sentimentModel` in settings takes a small fast model for the §4.4 classification call. Left
empty it uses whatever model the turn is using, so nothing has to be configured for her to work.

The gear in the chat header opens settings, and so does `⌘,`. Fields commit as you leave them;
there is no Save button. The Prompt tab shows the exact system prompt of the last request,
broken down by layer, which is what NAV-85 built the inspector for — most settings here end up
as text in that prompt, and this is where you check that they did.

## Not done yet

**A launch on a real display, properly.** She runs on macOS, and the first launch found a bug the
whole automated suite could not: the canvas laid out at its backing-store size, so on a Retina
display only her top-left quarter was visible. Every test and every headless run is dpr 1, where
that is invisible. What still has not been done is the rest of ADR 0001's Risk A list —
background genuinely transparent, click-through toggling both ways, the global shortcut firing
while unfocused — and the idle CPU and memory re-measurement over a long window, now including
the cursor poll and window moves that following added. Treat that HiDPI bug as the argument for
doing them by hand rather than assuming.

**Everything the capabilities need a real machine for.** Screen Recording has to be granted before
a capture can be taken at all; the System Settings deep links have to open the right panes; piper
and whisper have to actually be installed for voice to make a sound. The suite pins the
arithmetic, the ordering and the failure copy, which is everything that was previously wrong —
but none of it has been seen working on a Mac.

**Companion depth and computer use.** `backlog.md` → Implementation Order, sections 3 and 4:
memory, notes, a richer emotional appraisal and the approval loop, then the safety gate and the
native accessibility helper.
