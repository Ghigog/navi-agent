# Navi modernization — handoff

Written 2026-09-06. Branch `claude/navi-modernization-review-rpw3mq`.

You are picking up a planned-but-not-started modernization of Navi, a desktop AI companion
currently written in Godot 4. **No production code has changed.** All work so far is planning:
a review, a ticket backlog, an audit of the old ticket log, and one runnable spike.

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

Planning is committed on the branch. Four commits, all `docs:` or the spike.

- **`backlog.md`** — the plan. Opens with **Implementation Order**, then 21 tickets NAV-81..101.
  **Ticket IDs are identity, not sequence.** Order lives in that section. The old log reused
  sixteen IDs because numbering was doing both jobs; do not repeat that. New tickets continue
  from NAV-102.
- **`done.md`** — historical index of 111 completed tickets, plus an accuracy audit explaining
  why the full bodies were removed. Bodies remain in git history at `81a2e83`.
- **`spike/`** — the NAV-94 spike. Throwaway; delete once NAV-94 is recorded.
- `mission_statement.md`, `emotions.md`, `ai_agent.md` — design docs, still current and worth reading.

Deleted this session: `tickets.md` (broken absolute `file://` links) and the empty `in_progress.md`.

---

## Where to start

### Step 1 — NAV-94 is decided. Read the ADR.

[docs/adr/0001-platform-electron.md](docs/adr/0001-platform-electron.md). Both spike halves passed on
macOS. **The migration to Electron + TypeScript is approved.** Follow `backlog.md` →
Implementation Order → **3a**; the 3b (stay in Godot) sequence is kept only as a record and must not
be worked.

`spike/` has done its job. Carry `spike/fairy.js` into the port as the starting point for the fairy
renderer — it is ~100 lines against `FairyVisuals.gd`'s 520 and already does the Triforce emotion
tint — then delete the rest of the directory.

### Step 2 — current state of NAV-81

- **Done** (`8decbf8`): the leaked OpenAI key was **revoked by the owner and not replaced**. The
  mechanism that leaked it is closed — `SettingsManager.load_settings()` printed the whole settings
  dictionary on every start, which is how a live key ended up in `test_run.log` and got committed.
  There is now a `redact_secrets()` helper, the load-time print goes through it, `test_run.log` is
  deleted and `*.log` is gitignored, and five tests cover the redaction.
  The `openai_api_key` **setting is deliberately kept** — NAV-92 needs it for the
  bring-your-own-cloud-key onboarding path.
- **Not done:** purging `test_run.log` and the two 61 MB voice models from git history. `.git` is
  **116 MB**; the two `bin/voices/*.onnx` files are ~122 MB of it. This is a `git filter-repo`
  rewrite that force-pushes over a merged `main`, so it needs the owner's explicit go-ahead and a
  backup clone first. **Since the key is revoked, this is now weight, not exposure — there is no
  urgency and it must not be done casually.**

### Step 3 — then follow Implementation Order in `backlog.md`.

The next real decision is **when to start the Electron port**. The alternative is to keep taking
value out of the Godot app first — NAV-100 (notes and reminders) is small, has no dependencies
beyond NAV-93's store, and carries over to the port unchanged. Put that choice to the owner rather
than drifting into the port by default.

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

8. **The test suite has one failing test** in `test/test_ai_service.gd` and emits a lot of
   `Stack underflow! (Engine Bug)` noise. There is no CI. NAV-82 is deliberately sequenced
   *after* NAV-94 so CI is not built around a stack that may be retired.

---

## Working agreements

- Branch: `claude/navi-modernization-review-rpw3mq`. Do not push elsewhere without asking.
- Conventions live in `ai_agent.md`: static typing is mandatory in GDScript, PascalCase scenes,
  composition over inheritance. Follow it while the project is still Godot.
- Tests use GUT. Run headless:
  `godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test/ -gexit`
- Do not open a PR unless asked.
- Ticket IDs are stable. Update the Implementation Order section when sequence changes; never
  renumber a ticket.
- **Never commit a credential.** The leak in `test_run.log` came from `print()`-ing the whole
  settings dictionary on load. NAV-81 adds redaction.

## Things only the owner can do

Flag these rather than attempting them: rotating the leaked API key; running the macOS spike;
granting Accessibility and Screen Recording permissions; deciding NAV-94; any `git push --force`
or history rewrite (NAV-81 needs `filter-repo`, which is destructive and should be run by a human
who has a backup).
