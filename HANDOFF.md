# Navi modernization — handoff

Written 2026-09-06. Updated 2026-09-07 on branch `claude/navi-modernization-review-xsaqgo`.

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

**The purge did not reach GitHub's pull-request refs, and cannot.** `filter-repo` rewrites
`refs/heads/*`; `refs/pull/*` are server-side snapshots GitHub keeps of what each PR pointed at,
and no force-push touches them. `refs/pull/1/head` and `refs/pull/2/head` still contain
`test_run.log` with the key and both 61MB voice models. The original verification missed it
because a normal clone does not fetch those refs — a normal clone is 3.5MB and clean, a mirror
clone is 115MB and is not. One `git fetch origin refs/pull/2/head` is all it takes.

The key is revoked and unreplaced, so this is a dead credential rather than a live exposure, but
the repository still carries 115MB and the old blobs are retrievable by anyone with read access.
**Only the owner can close this: GitHub Support has to drop the stale refs.** Do not record
NAV-81 as fully done until they have.

The port carries the same rule independently, in `app/src/shared/redact.ts`, with its own tests.
Two differences from the Godot helper, both deliberate: it recurses into nested structures, and it
masks a value that *looks* like a credential whatever its setting is named. The Godot version is
name-based only, which is sufficient for a flat settings dictionary and keeps `hotkey_keycode`
readable in debug output.

### Step 3 — the port has started, in `app/`

**Done** (62 tests, typecheck clean, builds):

- NAV-85 — the layered prompt assembler and inspector. All prompt text is in `src/prompt/`.
- The Electron shell: overlay window, click-through driven from the main process, throttled
  render loop, settings.
- The agent loop: one provider seam, native tool calling, no substring router (NAV-83), no
  in-band control tags (NAV-84), personality in the identity layer (NAV-86).

**Next, in order:**

1. **Launch it on macOS.** Nothing in `app/` has run against a real display. Re-run ADR 0001's
   Risk A checks and re-measure idle CPU and memory over a long window — the ADR requires this
   anyway, and the Electron version moved from 33 to 44 for security patches.
2. **Port the emotion engine and the chat surface.** The loop has no UI yet beyond the fairy.
3. **NAV-92** onboarding — parallel, mostly product and copy.
4. **NAV-89** prebuilt native helper, then **NAV-82** tests and CI on the new stack.

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

- Branch: `claude/navi-modernization-review-xsaqgo`. Do not push elsewhere without asking.
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

Flag these rather than attempting them: rotating a leaked API key (NAV-81's key rotation and
branch history rewrite are both done; asking GitHub Support to drop the stale `refs/pull/*` is
the one piece still open, and only the owner can raise it); running anything that needs a macOS display, including the port's
first launch; granting Accessibility and Screen Recording permissions. Any further
`git push --force` or history rewrite still needs an explicit go-ahead and a confirmed backup
first, same as NAV-81 did.
