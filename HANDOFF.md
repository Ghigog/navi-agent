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
| 3 | **Local Ollama is the daily driver.** The core path must work offline with no cloud account. Currently `llama3.2:3b` and `gemma4:e4b`. | NAV-94 |
| 4 | **Distribution is intended** eventually. Signing, notarisation, auto-update and onboarding are real requirements. | NAV-94 |
| 5 | **Windows and Linux are wanted eventually.** Not now, but the native helper's interface must be platform-neutral from day one. | NAV-90, NAV-94 |
| 6 | **Onboarding offers both paths:** bring-your-own cloud key as the fast on-ramp, plus real instructions for setting up Ollama locally. Both first-class. | NAV-92 |
| 7 | **Computer use via the accessibility tree, not pixel coordinates.** Coordinates from screenshots have been unreliable and this is the agreed fix. | NAV-90 |
| 8 | **The safety gate ships before the write capability**, not after. | NAV-91 |
| 9 | **Platform: Electron + TypeScript**, with a stateless Swift helper. **Decided 2026-09-07 — the spike passed.** | [ADR 0001](docs/adr/0001-platform-electron.md) |
| 10 | **Click-through must be driven from outside the window.** A click-through window cannot receive keystrokes, so an in-window toggle can enable it and never disable it. Use a global shortcut, or cursor position. | ADR 0001 |
| 11 | **The idle render loop must be throttled.** The spike passed its resource bar without much room (2.4-2.6% CPU, 356 MB). The fairy does not need 60fps when nothing is happening. | ADR 0001 |
| 12 | **The Godot app is deleted.** Not deprecated, not kept as a reference. It is in git history and does not need rescuing or comparing against. | NAV-105 |

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
  and 3 are done, and section 4 is down to NAV-90 and the two tickets behind it. **Ticket IDs
  are identity, not sequence.** New tickets continue from NAV-106.
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

One ticket, and it needs a machine this environment does not have.

**NAV-106 — step-by-step guidance — is done.** It was a feature that shipped in Godot across five
tickets (NAV-11, NAV-35, NAV-39, NAV-40, NAV-43) and never got a port ticket of its own: the only
tickets referring to it were NAV-87 and NAV-88, and closing those as superseded took the guidance
work with them silently. **Worth reading as a warning about this backlog** — "closed as
superseded" is not the same as "nothing in it mattered", and this was found by diffing deleted
GDScript against the port rather than by anything written down. `guide_through`
(`src/agent/guidance.ts`) takes one structured tool call and `main/guidance.ts` is `flyTo`'s
caller — see its ticket in `backlog.md` for what changed from the Godot version and why.

**NAV-90 — the native accessibility helper.** Swift, a Mac, and Accessibility granted. It is the
only thing standing between Navi and the "agent second" half of what she is, and two other
tickets are queued behind it: NAV-89 packages and signs it, NAV-96's ambient presence needs the
AX tree it provides.

Two things to know before starting it, both now written at the top of its ticket:

- **NAV-91 is done and is waiting on this ticket for two inputs.** The gate is only as honest as
  what it is told. `secureField` must come from a real `AXSecureTextField` read rather than a
  caller's say-so, and `app` must be a bundle id the OS reported rather than a string the model
  produced. Every write tool calls `gate.attempt` and does nothing else about safety.
- **Define the wire protocol platform-neutrally on day one.** Windows and Linux are wanted
  eventually (decision 5), and leaking `AXUIElement` specifics across the seam means rewriting
  every call site later.

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
