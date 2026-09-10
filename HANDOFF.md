# Navi modernization — handoff

Written 2026-09-06. Updated 2026-09-10, after the port's surfaces landed, the app ran on macOS
for the first time, and cursor following arrived (NAV-102).

Navi is a desktop AI companion, written in Godot 4 and being rebuilt on Electron + TypeScript
(ADR 0001). **The port has started and lives in `app/`.** The Godot app in the repository root
is still the one that runs.

Read this, then `backlog.md`. Do not start coding before the section "Where to start".

---

## What Navi is

A fairy that floats on the user's desktop in a transparent always-on-top window, follows the
cursor, and answers questions about what is on screen. She has a persistent emotional state and
a relationship with the user.

**The owner's own description of what it is for**, which should override any inference you draw
from the code:

> Someone close at hand that I can talk to, make friends with, make notes and get reminders, ask
> her to point something out on the screen. Instead of screenshotting something weird and sending
> it to Claude, I should be able to say "hey Navi, what's this near my cursor?" Maybe she'll say
> "I don't know and you suck" because I've been treating her badly. She should be somewhat
> capricious, so I need to look after her, like a virtual pet.

This is a **companion first, agent second**. See "Decisions already made".

---

## Decisions already made — do not relitigate

| # | Decision | Recorded in |
|---|---|---|
| 1 | **Companion first.** Emotional state legitimately affects her competence. She is explicitly *not* for reliability-critical work. This is intended behaviour, not a bug. | NAV-97 |
| 2 | Mood may shape tone, hedging and willingness. It must **never** license fabricating facts or misreporting the screen. The honesty rule outranks mood. | NAV-97 |
| 3 | **Local Ollama is the daily driver.** The core path must work offline with no cloud account. Currently `llama3.2:3b` and `gemma4:e4b`. | NAV-94 |
| 4 | **Distribution is intended** eventually. Signing, notarisation, auto-update and onboarding are real requirements. | NAV-94 |
| 5 | **Windows and Linux are wanted eventually.** Not now, but the native helper's interface must be platform-neutral from day one. | NAV-90, NAV-94 |
| 6 | **Onboarding offers both paths:** bring-your-own cloud key as the fast on-ramp, plus real instructions for setting up Ollama locally. Both first-class. | NAV-92 |
| 7 | **Computer use via the accessibility tree, not pixel coordinates.** Coordinates from screenshots have been unreliable and this is the agreed fix. | NAV-90 |
| 8 | **The safety gate ships before the write capability**, not after. | NAV-91 |
| 9 | **Platform: Electron + TypeScript**, with a stateless Swift helper. **Decided 2026-09-07 — the spike passed.** | [ADR 0001](docs/adr/0001-platform-electron.md) |
| 10 | **Click-through must be driven from outside the window.** A click-through window cannot receive keystrokes, so an in-window toggle can enable it and never disable it. Use a global shortcut, or cursor position. | ADR 0001 |
| 11 | **The idle render loop must be throttled.** The spike passed its resource bar without much room (2.4-2.6% CPU, 356 MB). The fairy does not need 60fps when nothing is happening. | ADR 0001 |

---

## State of the repository

Planning is merged on `main`. The port is on the branch above, in `app/`.

- **`backlog.md`** — the plan. Opens with **Implementation Order**, then 21 tickets NAV-81..101.
  **Ticket IDs are identity, not sequence.** Order lives in that section. The old log reused
  sixteen IDs because numbering was doing both jobs; do not repeat that. New tickets continue
  from NAV-102.
- **`done.md`** — historical index of 114 completed tickets, plus an accuracy audit explaining
  why the full bodies were removed. Bodies remain in git history at `81a2e83`.
- **`app/`** — the Electron port. Has its own README covering layout, the decisions that will
  look wrong without context, and the Electron install failure mode that will bite you.
- `mission_statement.md`, `emotions.md`, `ai_agent.md` — design docs, still current and worth
  reading. `ai_agent.md`'s conventions are GDScript-specific and apply to the root project only.

Deleted: `tickets.md` (broken absolute `file://` links), the empty `in_progress.md`, and `spike/`
(its fairy renderer is now `app/src/renderer/fairy.ts`; ADR 0001 holds its measurements).

---

## Where to start

### Step 1 — read `app/README.md`, then the ADR.

[docs/adr/0001-platform-electron.md](docs/adr/0001-platform-electron.md) is the decision;
`app/README.md` is what was built from it. Follow `backlog.md` → Implementation Order → **3a**;
the 3b (stay in Godot) sequence is kept only as a record and must not be worked.

### Step 2 — NAV-81, and the one piece still open

- The leaked OpenAI key was **revoked by the owner and not replaced**. The mechanism that leaked
  it is closed — `SettingsManager.load_settings()` printed the whole settings dictionary on every
  start, which is how a live key ended up in `test_run.log` and got committed. There is now a
  `redact_secrets()` helper, the load-time print goes through it, and five tests cover the
  redaction. The `openai_api_key` **setting is deliberately kept** — NAV-92 needs it for the
  bring-your-own-cloud-key onboarding path.
- History is purged. The owner confirmed a backup clone, `setup_models.sh` was extended to fetch
  `en_US-hfc_female-medium.onnx` (it previously only fetched `amy`) and the download was verified
  before anything was rewritten. `git filter-repo` then removed `test_run.log`, the eight
  `reconstructed_aiservice_step*.txt` scratch files, and both 61MB `.onnx` voice models from every
  ref (`main`, `claude/navi-purge-large-files-x1de5f`, and `claude/navi-modernization-review-rpw3mq`
  all had to be rewritten and force-pushed — the third still held the old blobs and would have kept
  the repo heavy otherwise). `bin/piper`, `bin/hotkey_daemon`, `bin/whisper-cli`, and the
  `.onnx.json` sidecars stay tracked; only the two `.onnx` models were purged. `.git` went from
  **116 MB to 3.4 MB**; a fresh clone is 11 MB.

A footnote, so nobody re-raises it as a finding: `filter-repo` rewrites `refs/heads/*` and does
not touch `refs/pull/*`, which GitHub creates per pull request and never lets anyone delete. So
`refs/pull/1/head` and `refs/pull/2/head` still hold `test_run.log` and the two voice models.
**This needs no action.** GitHub reports the repository at 3.2 MB and a normal clone is 3.5 MB;
the old blobs only appear if you ask for them by name (`git clone --mirror`, or an explicit
`git fetch origin refs/pull/2/head`). The key in them is revoked and unreplaced, and the voice
models are public downloads. Removing them would mean deleting and recreating the repository.

Note that the repository is **public**. Earlier NAV-81 reasoning assumed private and used that to
bound blast radius; re-check visibility before leaning on it in a future security call.

The port carries the same rule independently, in `app/src/shared/redact.ts`, with its own tests.
Two differences from the Godot helper, both deliberate: it recurses into nested structures, and it
masks a value that *looks* like a credential whatever its setting is named. The Godot version is
name-based only, which is sufficient for a flat settings dictionary and keeps `hotkey_keycode`
readable in debug output.

### Step 3 — the port, in `app/`

**Done** (186 tests, typecheck clean, builds):

- NAV-85 — the layered prompt assembler and inspector. All prompt text is in `src/prompt/`.
- The Electron shell: overlay window, click-through driven from the main process, throttled
  render loop, settings.
- The agent loop: one provider seam, native tool calling, no substring router (NAV-83), no
  in-band control tags (NAV-84), personality in the identity layer (NAV-86).
- The emotion engine, in `src/shared/emotion.ts`: the three dimensions, the eight composite
  emotions, the Love Meter and its relationship bands, retrieval relevance, and the fairy tint.
  Pure and synchronous, so it costs nothing on the latency path. `takeTurn` returns the
  `TurnOutcome` for a turn; `src/main/emotion-store.ts` scores and persists it to its own file,
  separate from settings. The prompt's Context layer carries the state with its tone guidance.
- The chat surface, and with it the wiring that gives `takeTurn` a caller. A second window,
  because the overlay is click-through and could never be typed into; `src/main/conversation.ts`
  owns the exchange and imports nothing from Electron, so a whole turn runs under test.
- Sentiment classification (emotions.md §4.4), in `src/agent/sentiment.ts`, with its prompt in
  `src/prompt/sentiment.ts`. A second cheap non-streaming call on the pre-reply pass. It never
  throws and is bounded in time: a mood reading must not cost the user their turn.
- Settings, and the prompt inspector panel that NAV-85 built `inspector.ts` for. The window is
  never sent the API key — it is told whether one is set and nothing else (NAV-81) — and
  `shared/settings.ts` validates every save, because an IPC boundary carrying typed values is
  where `'banana'` gets in as a provider name.

- CI, in `.github/workflows/ci.yml` (NAV-82): typecheck, tests and build on every push and pull
  request. Its Godot half closes as superseded — see the ticket for why fixing tests for
  `AIService.gd` is work the sequencing was designed to avoid.

- NAV-102 — cursor following, and the flight primitive pointing is built on. `shared/motion.ts`
  is the maths, `main/follow.ts` the controller, and neither imports Electron: the window
  arrives as a three-method port and the cursor as a source, so a whole follow-pause-fly-restore
  cycle runs under test. Two things worth knowing before you change it. Click-through and
  following now share **one** cursor poll (`main/cursor.ts`) rather than running two timers that
  sample at two rates and disagree; and the easing is `1 - exp(-speed * dt)` rather than Godot's
  `lerp(target, speed * delta)`, which is the same curve made frame-rate independent — the
  original moved differently at 30fps and 60fps and overshot when a slow frame pushed the factor
  past 1. `flyTo` suspends following, eases her *body* onto a coordinate, holds, then restores;
  it outranks the chat-window pause, because pointing at something is most useful exactly when
  you are talking about it.

### The state of it, stated plainly

**The port has surfaces, one capability, and no senses.** She runs on macOS, she looks right,
she holds a conversation, she has moods that persist, and she now follows your cursor and can be
flown to a coordinate. She still cannot see your screen, cannot point at anything *of her own
accord*, and cannot speak. `main/index.ts` creates a `ToolRegistry` and registers nothing in it,
so the flight primitive has no caller yet — NAV-103's `point_to` is the one it was built for.

That is not a bug list, it is the honest shape of the work: everything hard about the *platform*
is done and everything the product actually does is still in GDScript. Do not read "the port is
nearly finished" into the fact that the windows all work.

### What to build next, in order

1. **NAV-103 — the screen-capture tools.** This is the product. The owner's description leads
   with "what's this near my cursor?", and it does not work. The prompt half of NAV-99's cursor
   anchoring is already in `prompt/builder.ts`, gated on a `cursorAnchored` flag that nothing
   sets; setting it is part of the ticket. Read NAV-99 before writing the crop code — anchoring
   on the fairy instead of the cursor is the bug it exists to have fixed. `follow.flyTo` is
   waiting for `point_to`, and `cursor.current()` is where the send-time cursor sample comes
   from — take it when the user sends, not when the tool runs, or it is NAV-99 all over again.
2. **NAV-104 — voice.** The binaries and voice models are still tracked and `setup_models.sh`
   still fetches them.
3. **NAV-92** onboarding — parallel, mostly product and copy. The settings window is most of its
   second half already.
4. **NAV-89** prebuilt native helper.

### Still owed on macOS, by a human

She launches, and the first launch immediately found something the entire automated suite could
not: the fairy canvas laid out at its backing-store size, so on a Retina display only her
top-left quarter drew. dpr 1 is every test and every headless run, and at dpr 1 the bug does not
exist. Fixed in `app/test/fairy.test.ts`'s commit — but treat it as the argument for doing the
rest of ADR 0001's Risk A list by hand rather than assuming:

- background genuinely transparent
- click-through toggling both ways as the cursor crosses her
- the global shortcut firing while another app has focus
- idle CPU and memory re-measured over a long window, not 90 seconds — **now including the
  cursor poll and the window moves NAV-102 added**, which is the one acceptance criterion on
  that ticket no test can close

The last one has moved since the ADR: the idle throttle it required is now in and should have
roughly halved the CPU figure, so the bar is no longer 5% — anything not clearly under the
spike's 2.4-2.6% is a regression. Check the settings window says 30fps before measuring, since
it can now raise that.

## Traps in this codebase

Things that will mislead you if you read the code straight.

1. **`AIService.gd` is 2320 lines** and is a hand-written agent framework: transport for two
   providers in two modes, SSE parsing, the agent loop, prompt assembly, tool routing, emotion
   scoring, history, personality rewriting, error copy. `_deliver_final_response()` is 330 lines
   of two near-identical branches. Do not refactor it before NAV-94 resolves; if the migration
   goes ahead, most of it is never ported rather than fixed.

2. **`PROMPT_SKILL_RULES` (`:66`) is dead weight that still runs.** ~150 hardcoded substrings
   that force a skill before the model is consulted. `"here"` forces a screenshot; so do `"find"`,
   `"move"`, `"chat"`, `"app"`. Native tool calling was implemented later, so two routers compete
   and the substring one always wins. NAV-83 deletes it.

3. **Genuinely dead code that reads as live.** `_VISUAL_REFUSAL_PATTERNS` (`:153`) and
   `_get_retraction_message()` (`:1908`) have **zero callers** — NAV-59 removed the pipeline and
   left the parts. `[ESCALATE]` survives only in a strip list. `_deliver_final_response()` takes a
   `fast_model` parameter it never reads. NAV-98.

4. **`done.md` was partly false before the audit.** Most notably NAV-68 claims
   `_apply_personality_voice()` was bypassed; it was not, and still wraps every thought line in
   hardcoded templates. Trust the code over any historical ticket. Seven tests named in acceptance
   criteria do not exist.

5. **Control tags are parsed out of the live token stream** — `<scratchpad>`, `[CONTINUE]`,
   `[PAUSE]`, `[SKILL: point_to: X,Y]` — while that same stream is being rendered. `point_to` has
   two calling conventions and the prompt asks the model to pick. NAV-84.

6. **The system prompt is a `+=` chain** across eight fragments in several files, with no way to
   see the final string. This is how the contradictory pointing instructions survived. NAV-85
   adds an assembler and an inspector; build the inspector first, it makes everything else
   verifiable.

7. **Godot cannot do computer use.** No API for synthesizing input outside its own window,
   enumerating other apps' windows, or reading an accessibility tree. `Input.parse_input_event`
   only feeds Godot's own queue. A native helper is required on any platform. This is settled;
   do not go looking for a Godot-native solution.

8. **The Godot test suite has one failing test** in `test/test_ai_service.gd` and emits a lot of
   `Stack underflow! (Engine Bug)` noise. It still does; NAV-82 closed that half as superseded
   rather than fixed, because `AIService.gd` is replaced rather than repaired. CI covers `app/`.

Two in `app/`, which otherwise reads cleanly:

9. **`main/follow.ts` moves the window; the renderer does not know it moved.** Following is a
   main-process decision on top of one shared cursor poll (`main/cursor.ts`), and the fairy
   canvas is never told her window's screen position. Anything that needs to draw towards a
   screen coordinate — NAV-103's pointer arrow — has to be sent one, the way `tint` and `busy`
   are; do not reach for the position inside the renderer, it is not there.

10. **The `ToolRegistry` is empty and looks deliberate.** It is — for now — but it means every
    capability the product is about is absent while the code around it looks finished. NAV-103.

---

## Working agreements

- Branch: `claude/handoff-docs-review-0nr7ij`. Do not push elsewhere without asking.
- Root project (Godot): conventions live in `ai_agent.md` — static typing mandatory in GDScript,
  PascalCase scenes, composition over inheritance. Tests use GUT, run headless with
  `godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test/ -gexit`.
- Port (`app/`): `npm test`, `npm run typecheck`. Both run offline and take under a second, so
  there is no excuse for pushing without them.
- Do not open a PR unless asked.
- Ticket IDs are stable. Update the Implementation Order section when sequence changes; never
  renumber a ticket.
- **Never commit a credential.** The leak in `test_run.log` came from `print()`-ing the whole
  settings dictionary on load. NAV-81 adds redaction.

## Things only the owner can do

Flag these rather than attempting them: rotating a leaked API key (NAV-81 is closed — key rotated,
history rewritten); anything that needs a real macOS display; granting Accessibility and Screen
Recording permissions. Any further `git push --force` or history rewrite still needs an explicit
go-ahead and a confirmed backup first, same as NAV-81 did.

The port's first launch is done — see "Still owed on macOS" above for what a human still has to
check by eye, and why the HiDPI bug found on that launch is the reason to check rather than
assume. NAV-103 will need Screen Recording granted before it can be tested at all.

Worth knowing about the automation gap, since it will keep mattering: Xvfb on Linux verifies
plumbing — windows, IPC, a full exchange, settings reaching disk — and it runs at dpr 1 with no
compositor, no transparency and no Spaces. Everything ADR 0001's Risk A list covers is precisely
what it cannot see.
