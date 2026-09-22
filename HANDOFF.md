# Navi — handoff

Written 2026-09-06. Rewritten 2026-09-10, after the port gained every capability the Godot app
had, the Godot app was deleted (NAV-105), companion depth landed, and the safety gate shipped
ahead of the capability it gates.

Navi is a desktop AI companion, Electron + TypeScript ([ADR 0001](docs/adr/0001-platform-electron.md)).
**There is one app now, and it is the repository root.** `npm start`.

Read this, then [`README.md`](README.md), then [`backlog.md`](backlog.md). Do not start coding
before the section "Where to start".

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
| 1 | **Companion first.** Emotional state legitimately affects her competence. She is explicitly *not* for reliability-critical work. This is intended behaviour, not a bug. | NAV-97, `mission_statement.md` § "The position" |
| 2 | Mood may shape tone, hedging and willingness. It must **never** license fabricating facts or misreporting the screen. The honesty rule outranks mood. | NAV-97 |
| 3 | **Local Ollama is the daily driver** for the core product — chat, screen questions, memory, notes — which must keep working offline with no cloud account. Backlog section 5's judgement loop is a declared exception and is cloud-first; see its own decisions block for why, and NAV-107 for the number to revisit it against. | NAV-94 |
| 4 | **Distribution is intended** eventually. Signing, notarisation, auto-update and onboarding are real requirements. | NAV-94 |
| 5 | **Windows and Linux are wanted eventually.** Not now, but the native helper's interface must be platform-neutral from day one. | NAV-90, NAV-94 |
| 6 | **Onboarding offers both paths:** bring-your-own cloud key as the fast on-ramp, plus real instructions for setting up Ollama locally. Both first-class. | NAV-92 |
| 7 | **Computer use via the accessibility tree, not pixel coordinates.** Coordinates from screenshots have been unreliable and this is the agreed fix. | NAV-90 |
| 8 | **The safety gate ships before the write capability**, not after. | NAV-91 |
| 9 | **Platform: Electron + TypeScript**, with a stateless Swift helper. **Decided 2026-09-07 — the spike passed.** | [ADR 0001](docs/adr/0001-platform-electron.md) |
| 10 | **Click-through must be driven from outside the window.** A click-through window cannot receive keystrokes, so an in-window toggle can enable it and never disable it. Use a global shortcut, or cursor position. | ADR 0001 |
| 11 | **The idle render loop must be throttled.** The spike passed its resource bar without much room (2.4-2.6% CPU, 356 MB). The fairy does not need 60fps when nothing is happening. | ADR 0001 |
| 12 | **The Godot app is deleted.** Not deprecated, not kept as a reference. It is in git history and does not need rescuing or comparing against. | NAV-105 |
| 13 | **She never steals focus.** Anything Navi says unprompted must not take the keyboard, raise a window over what you are doing, or interrupt typing. The reminder path used to violate this (`chat-window.ts:94` calls `app.focus({ steal: true })`); NAV-112 repointed it at `main/bubble-window.ts`, a third window that never calls `focus()` at all. | Owner, 2026-09-19 |

---

## State of the repository

One app, at the root. `src/`, `test/`, `package.json`. `bin/` holds the two voice binaries;
their models are fetched by `setup_models.sh` and are not tracked.

Four files in `userData` hold what she knows, kept apart on purpose: `settings.json` is the
user's preferences, `emotion.json` is the relationship, `memory.json` is what she has inferred
about you and is consolidated and decayed, and `notes.json` is what you asked her to write down
and is never pruned. Resetting any one of them must not touch the others.

- **[`README.md`](README.md)** — what she is, how to run her, the layout, and the long list of
  decisions that will look wrong if you do not know why they were made. It absorbed the port's
  own README when NAV-105 moved the app to the root.
- **[`backlog.md`](backlog.md)** — the plan. Opens with **Implementation Order**; sections 1, 2
  and 3 are done, section 4 is down to NAV-90 and the two tickets behind it, and section 5 is
  unprompted presence, which is where the next work is. **Ticket IDs are identity, not sequence.**
  New tickets continue from NAV-118.
- **[`done.md`](done.md)** — historical index of 114 completed tickets, plus an accuracy audit
  explaining why the full bodies were removed. Bodies remain in git history at `81a2e83`.
- `mission_statement.md`, `emotions.md` — design docs, current, and worth reading. The mission
  statement now carries NAV-97's position and the bound on her moods.

Deleted: the Godot project (`project.godot`, `scenes/`, `scripts/`, `addons/`, the GDScript
suite), `ai_agent.md` — its conventions were GDScript-specific and died with the app — and,
earlier, `tickets.md`, `in_progress.md` and `spike/`.

**If you suspect something was lost in the migration, diff against the deleted tree rather than
trusting this file.** `git show 394808f~1:scripts/<name>.gd` reads any of it. That is how
NAV-106, the cursor marker and the emoji notifications were found; all three were features that
had shipped and that nothing in the port's plan mentioned.

---

## Where to start

### Step 1 — read `README.md`, then the ADR.

`README.md`'s "Things that are decided" section is the one that saves time: every entry there is
something that looks like a mistake and is not.

### Step 2 — the state of it, stated plainly

**She is finished, and nobody has watched her work.**

Everything in the backlog is done except computer use. She follows the cursor; she can see the
screen and the area around the cursor and point at what she saw, or walk you through a sequence
of points one step at a time; she speaks a sentence at a time and listens on a key; a stranger can
get from install to a working Navi through a guided first run; she remembers you between sessions
inside a fixed budget; she takes notes and fires reminders that survive a restart; she can tell
when she did not understand you; and you can tell her she did well, which raises a stat and
teaches her what you liked. 476 tests, all offline, typecheck clean, builds.

**None of it has been seen working on a real Mac.** The suite runs at dpr 1 with no compositor,
no transparency, no Spaces, no Screen Recording permission, no microphone and no audio device —
which is exactly what these capabilities are made of. That is not pessimism about the code; it is
the same automation gap that let the HiDPI bug reach the first real launch. **Do the checks in
`backlog.md` → "What a human still owes" before building anything on top of this.** The list is
longer than it was, and every item on it is a thing no headless environment can perform.

### Step 3 — what to build next

**Backlog section 5 — unprompted presence.** Written 2026-09-19 from the *Context-Aware Nudges*
PRD and the owner's correction to it. Twelve tickets, ordered, each sized for one session. Read
section 5's header before any individual ticket: the decisions block and the three-layer split are
what the tickets assume rather than repeat.

**The one-sentence version of what it is.** Navi uses what she knows about you (NAV-93's memory),
sees what you are doing (NAV-103's capture), and occasionally judges that it is worth saying
something. The PRD's League-of-Legends-and-a-calendar-clash scenario is an *example* of that, not
the goal — building the narrow version is the main way to get this wrong.

**Three layers, and which of them may be a model.** This is the load-bearing design decision:

- **Whether she may speak is code** (NAV-110). Budget, cooldowns, quiet hours, never twice about
  the same thing. A model policing its own interruption frequency drifts, and nag fatigue is what
  gets a feature like this muted in a week.
- **Whether there is anything worth saying is the model's** (NAV-111). That is the product, and it
  is the part most likely to be bad — NAV-107 exists to find out before the rest is built on it.
- **Every fact is code's** (NAV-117). NAV-97's honesty bound does not soften because the judgement
  is a model's: she may be wrong about whether you should stop, never about when your meeting is.

**Start here, in this order:**

1. **NAV-107 — the spike.** Throwaway. Answers whether a model asked "is there anything worth
   saying?" stays quiet when it should. That number gates NAV-111's design, so do it first even
   though it ships nothing.
2. **NAV-112 — the surface that never steals focus. Done.** Fixed the defect that was live: the
   only unprompted path in the app (`reminders` → `chat.show` → `app.focus({ steal: true })`) no
   longer touches the chat window at all — `main/bubble-window.ts` shows a line via
   `showInactive()` and collapses on its own. Decision 13.
3. **NAV-108, then NAV-117** — connect a calendar, then sync and cache it.
4. **NAV-114 — the leave-by reminder.** The thin slice that ships real value: pure arithmetic, no
   model, no screen capture, no injection surface.

Then the judgement half: NAV-110 → NAV-109 → NAV-111 → NAV-113 → NAV-118 → NAV-115.

**NAV-113 — settings and the off switch — is done, the controls half.** `ambientPaused` and
`noticeActivity` (`shared/settings.ts`), quiet hours as minutes-since-midnight, a "Presence"
section in the settings panel with the calendar connect/disconnect NAV-108 built but never exposed
to a window, and "Delete all data" for the calendar cache. `main/calendar-sync.ts`'s `enabled` now
reads the pause switch as well as the connection. `test/ambient.test.ts` proves the pause against
the real `createCalendarSync`/`createActivitySignal` modules with a request log, and against
`quietHoursFrom`/`mayInterrupt` directly. Deferred, and said so in the ticket rather than silently:
choosing a calendar and a default/per-event buffer (only `primary` is read at all), sound, reduced
motion, and the "say so at most weekly" disconnected notice — none of the five ACs needed them, and
nothing yet calls the settings this ticket does not have a caller for.

**NAV-111 — the judgement turn — is built as a call, not wired in.** `agent/judgement.ts` and
`prompt/judgement.ts` are the SILENT/SPEAK: model call itself — timeout, defensive parsing, a
validator that rejects any number the model didn't get from the facts it was handed, tone folded
in from `emotionBody`. 29 offline tests, no live model reached. What it does not have: a caller.
Nothing yet runs NAV-110's `mayInterrupt`, feeds the result here, or shows a remark through
NAV-112's bubble — that needs NAV-113's settings flag to exist first. And the actual verdict
NAV-107 was supposed to produce before this got built — is the judgement good enough on a real
cloud model — is still open; see that ticket's own entry for why.

**NAV-110 — the interruption gate — is done.** `shared/interruption.ts`: the daily cap, the
minimum gap with backoff, the "never twice about the same thing" rule, quiet hours with no
override, the pre-filter, and the facts bundle NAV-111 will be handed, all pure and tested with a
fake clock — no store, no wiring, per this section's own seams.

**NAV-109 — the activity signal — is done, and its stated blocker was already stale.** This
section had NAV-109 waiting on NAV-90's window enumeration needing a Mac — but NAV-90 merged on
2026-09-11 (`c206d54`, PR #13), which is *before* this section was even written on 2026-09-19; the
backlog's status table and this file both simply never caught up. `frontmostApp()` was already on
`UiPort`. `shared/activity.ts` is the pure debounce (first sample is a silent baseline, a settled
switch is one event, alt-tabbing never reaches the window); `main/activity-signal.ts` is the poll
loop around it, same dependency-injected shape as `calendar-sync.ts`. Not wired into
`main/index.ts` and not persisted, same position NAV-110 stated for itself — that is NAV-111's
job, once there is a settings flag (NAV-113) and a judgement to feed. **NAV-111 is still blocked
on NAV-107's recommendation**, which needs a cloud API key that does not exist in this
environment — a reachable local Ollama does exist here, but NAV-111's decision to be cloud-only
for the spike stands regardless, so that does not unblock it.

**NAV-96 is section 5 now.** Its ID and body stay in section 4 and point there. Do not close it —
that is exactly how the guidance work went quiet before NAV-106 found it by diffing deleted
GDScript.

**NAV-90 — the native accessibility helper — is built and merged, not "still open."** Read the
correction at the top of its ticket in `backlog.md` before trusting anything else this file says
about it: the code (`helper/`, `main/helper.ts`, `agent/ui.ts`) is in place and wired through
NAV-91's gate, but the fixture-app tests need Accessibility granted to run past a skip, and the
two eye-test acceptance criteria have not been tried by hand — both still need a human. NAV-89 is
queued behind it for the same reason (a signed build, an Apple developer account). Two things its
ticket says at the top, unaffected by this correction: NAV-91 is done and waiting on it for two
honest inputs (`secureField` from a real `AXSecureTextField` read, `app` from an OS-reported
bundle id), and the wire protocol must be platform-neutral from day one.

### Step 4 — things that will save you an hour

Found by reading the code during section 5's planning. All still true as of 2026-09-19.

- **`npm install` first.** A fresh container has no `node_modules`, and `npm test` fails with
  `vitest: not found` in a way that looks like a broken suite and is not. Then `npm test` and
  `npm run typecheck`, both under a second, both before pushing.
- **`main/reminders.ts` is the module to copy.** Deps injected as plain functions, clock included,
  no Electron import — which is why a reminder set for next Tuesday can be fired in a millisecond
  under test. Every new module in section 5 should look like it.
- **`agent/sentiment.ts` is the model-call pattern.** Cheap, non-streaming, time-bounded, parsed
  defensively, and failing towards the answer that changes nothing. NAV-111 is that shape with
  silence as the safe direction.
- **`showInactive()` plus `acceptFirstMouse: true`** is how a window shows without taking focus and
  still gets its first click. `main/chat-window.ts` deliberately does the opposite — it needs the
  keyboard — and should keep doing so.
- **The overlay cannot hold the bubble.** It is 200px, click-through except within 46px of her body
  (`shared/geometry.ts:23`), and `renderer/fairy.ts` draws particles, a pointer arrow and a
  floating emoji — there is no speech bubble anywhere to reuse. NAV-112 is a third window.
- **Placement maths goes in `shared/geometry.ts`** next to `chatBounds`, pure, so it is testable
  with no display. That is why `chatBounds` is already there.
- **Only one runtime dependency exists** (`openai`). Electron's built-in `safeStorage` covers the
  Keychain; do not be the session that adds `keytar`.

---

## Traps in this codebase

Things that will mislead you if you read the code straight. The eight `AIService.gd` traps that
used to head this list went with the file.

1. **`main/follow.ts` moves the window; the renderer does not know it moved.** Following is a
   main-process decision on top of one shared cursor poll (`main/cursor.ts`), and the fairy canvas
   is never told her window's screen position. The pointing arrow works because `onFlight` does the
   subtraction in the main process, on the tick that moves her, and sends the *direction*. Anything
   else that needs to draw towards a screen coordinate has to be sent one the same way; do not
   reach for the position inside the renderer, it is not there.

2. **The screen tools cannot see the live cursor, and that is the design.** `agent/screen.ts` has
   a `cursor()` dependency that only `freeze()` calls. Reading it at tool-run time would compile,
   pass every test that does not move the cursor, and be NAV-99 all over again: the crop would be
   centred on where the hand wandered while she was thinking. The freeze happens in
   `conversation.send`, before the first `await`.

3. **The system prompt can be rendered more than once in a turn.** `run()` takes `systemPrompt` as
   a function of the turn's flags and re-renders the system message in place when a cursor-anchored
   crop arrives. A capture happens *during* a turn, so a fixed string would carry NAV-99's
   anchoring note on every turn or on none. The inspector shows the last render, which is the one
   she actually answered under.

4. **An image reaches the model as a `user` message, not a tool result.** The chat-completions
   schema has no place for an image on a `role: "tool"` message and both providers ignore one. It
   is labelled as a capture so that screen text does not read as the user speaking — the user role
   is the trusted one and a screenshot is not (NAV-91). Images are deliberately *not* added to the
   conversation history: a capture is true about the moment it was taken and misleading five turns
   later.

5. **The last sentence of a reply is never spoken by `push()`.** `shared/speech.ts` requires
   whitespace after a terminator, because during streaming the end of the buffer is not the end of
   anything — treat it as one and "It is 3." gets spoken the instant the model writes the 3 of
   3.5. It leaves through `flush()`. If you "fix" this you will reintroduce the bug.

6. **The talk key is not hold-to-talk and cannot be.** `globalShortcut` reports key presses and
   never releases. This is written on the setting, in the README and here, because it reads like
   an oversight three times before it reads like a constraint.

7. **`emotion.json` is separate from `settings.json` on purpose.** Resetting preferences must not
   wipe the relationship. `coerceState` re-derives the emotion and relationship labels from the
   scores, so hand-editing the file to say `best_friend` does nothing.

8. **The relevance flags on `TurnOutcome` default to false and look redundant.** They are not.
   Ordinary conversation touches no tool, and scoring that as "no tool available" decays Navi into
   Oblivion just by being talked to. Deleting them looks like a simplification and is a behaviour
   change (emotions.md §4.1).

9. **Memory and notes are two files, and merging them would be a regression.** Memory is inferred
   and is consolidated and decayed to hold a fixed prompt size. Notes are the user's own words
   and nothing prunes them. The separation is what makes "notes survive a memory-consolidation
   pass" true by construction rather than by a rule somebody has to remember.

10. **`agent/sentiment.ts` asks for two bare words, not JSON, and parses each independently.**
    That is not laziness about structured output — it is the acknowledgement that `llama3.2:3b`
    cannot be relied on to produce it. A model that answers only "kind" still gets its tone read.
    Each axis has a default that moves nothing, so a failed appraisal is indistinguishable
    downstream from a polite message that made sense.

11. **`confidence` is on `EmotionState` and is not a Triforce dimension.** emotions.md maps
    exactly three onto the eight composite emotions and onto her tint. Adding it to
    `deriveEmotion` or to `emotionColor` would change both, and would be a rewrite of the design
    document rather than a tidy-up.

12. **`main/marker.ts` looks like decoration and is not.** The fading ring at the cursor is the
    *visible* half of NAV-99. The bug it exists to fix — Navi answering about the wrong thing —
    survived as long as it did because a user could not tell where she had looked, and a
    confident answer about the wrong window reads exactly like a confident answer about the
    right one. The arithmetic being right is not a substitute for the user being able to see
    that it was. It was missed on the first pass and added by audit.

13. **The safety gate gates nothing, and that is the ordering rather than an oversight.**
    `shared/policy.ts` and `main/gate.ts` are complete and tested against a capability that does
    not exist. A gate written after the thing it gates is a gate written to let the existing
    behaviour through. Do not "simplify" it into the write tools when you build them.

---

## Working agreements

- Branch: whatever the current task names. Do not push elsewhere without asking.
- `npm test` and `npm run typecheck` before pushing. Both run offline and take about a second, so
  there is no excuse.
- Do not open a PR unless asked.
- Ticket IDs are stable. Update the Implementation Order section when sequence changes; never
  renumber a ticket.
- **Never commit a credential.** The leak in `test_run.log` came from `print()`-ing the whole
  settings dictionary on load. `shared/redact.ts` carries the rule forward, with its own tests; it
  recurses into nested structures and masks anything that *looks* like a credential whatever the
  setting is called.

## Things only the owner can do

Flag these rather than attempting them: rotating a leaked API key (NAV-81 is closed — key rotated,
history rewritten); anything that needs a real macOS display; granting Accessibility, Screen
Recording and Microphone permissions; installing piper and pulling an Ollama model; and the Apple
developer account NAV-89 needs to sign anything. Any further `git push --force` or history
rewrite still needs an explicit go-ahead and a confirmed backup first, same as NAV-81 did.

The automation gap will keep mattering, so it is worth stating once more: the suite verifies
plumbing — windows, IPC, a full exchange, settings reaching disk, the crop arithmetic, the
sentence splitting, the failure copy. It runs at dpr 1 with no compositor, no transparency, no
Spaces, no permissions and no audio. Everything ADR 0001's Risk A list covers, and everything the
new capabilities are actually made of, is precisely what it cannot see.
