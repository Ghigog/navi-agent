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
| 9 | **Recommended platform: Electron + TypeScript**, with a stateless Swift helper. Conditional on the spike below. | NAV-94 |

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

### Step 1 — the owner runs the spike. You cannot.

`spike/` decides whether the migration happens. It splits the risk:

- **Risk B (rendering cost) is already answered: PASS.** Measured at 0.208 ms mean frame,
  27.8x headroom, ~1.2% of one core on CPU raster with no GPU. Reproduce with
  `cd spike && npm run bench`. The fairy is not a reason to stay in Godot.
- **Risk A (macOS window behaviour) is unanswered** and can only be answered on a Mac:
  `cd spike && npm install && npm run spike`. It prints a GO/NO-GO verdict.

**If you are not running on macOS with a display, you cannot resolve NAV-94.** Say so plainly
and work the tickets that do not depend on it. Do not guess the verdict, and do not begin a port
on the assumption it passes.

### Step 2 — two tickets are safe to start immediately

Neither depends on the platform decision.

- **NAV-81** — a real OpenAI key is committed in `test_run.log` (introduced `ec72554`, still at
  HEAD). The repo is private, so this is not a fire, but the key must be rotated **by the owner**
  — you cannot rotate it — and the file purged from history. Also `bin/` is ~124 MB of tracked
  binaries.
- **NAV-99** — the highest-value fix in the backlog. `WindowController.capture_crop_screenshot()`
  (`:430`) centres its crop on **the fairy**, which sits at `follow_offset = (20, 20)` from the
  cursor and stops following the moment the hotkey is pressed. So "what's this near my cursor?",
  the single most-used interaction, has never looked at the cursor. Sample the cursor in
  `_on_hotkey_pressed()` (`:175`) and anchor on that. Small, and it ports unchanged.

### Step 3 — then follow Implementation Order in `backlog.md`.

---

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
