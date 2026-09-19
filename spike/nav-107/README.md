# NAV-107 spike

Throwaway. Not shipped code, not imported by `src/`, deleted once its verdict is recorded in
`backlog.md` — same treatment the NAV-94 platform spike got (`spike/` existed, produced its
numbers and one file worth keeping, then was retired in the commit that recorded the decision).

Two questions, matching the ticket:

1. **`run.mjs`** — is the judgement any good? Fifteen hand-made situations
   (`situations.mjs`), at least half of which warrant silence, run against whichever of the cloud
   and local paths are actually configured. Reports the false-positive rate (spoke when it
   should not have) for each, plus a one-off prompt-injection check.
2. **`oauth.mjs`** — does the Google Calendar OAuth shape work at all? PKCE, a loopback
   redirect, one event read. Proves the flow before NAV-108 builds it properly with a real token
   store, refresh, and revocation handling.

## Running it

```
# the judgement question — needs at least one of:
OPENAI_API_KEY=sk-...            node spike/nav-107/run.mjs      # cloud path
# Ollama running locally is picked up automatically if reachable # local baseline

# the calendar question — needs a Google Cloud project with the Calendar API enabled and an
# OAuth client (type: Desktop app)
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node spike/nav-107/oauth.mjs
```

## What this environment could not do

This was written and reviewed for shape and logic, but **not run against a real model or a real
Google account** — this container has no configured cloud API key, no reachable Ollama, and no
Google OAuth client, and getting any of those needs the owner's own credentials. That is the one
part of this ticket only the owner can finish: run `run.mjs` with a real key (and Ollama if you
want the local baseline), run `oauth.mjs` against a calendar you own, and write the actual
false-positive numbers into NAV-107's acceptance criteria in `backlog.md`, along with the
recommendation (buildable as described / buildable narrower / not worth building) that the rest
of section 5 is gated on.

The situations also stand in a written screen description for a real capture — there is no
display here to capture from. Worth re-running once with a real screenshot or `observe_ui` output
in place of `situation.screen` before trusting the number fully; a model may behave differently
reading a genuine capture than a tidy sentence describing one.

## Notes on the two scripts

- `judge.mjs` mirrors `src/agent/sentiment.ts`'s shape on purpose: cheap, non-streaming, time-
  bounded, parsed defensively, and it fails towards the safe answer (silence, not "neutral") on
  anything unparseable, timed out, or erroring. That is the shape NAV-111 is expected to reuse —
  not this file itself, which is throwaway, but the pattern.
- `oauth.mjs` fixes a local port and does the standard installed-app PKCE dance. It does not
  store the refresh token anywhere — NAV-108 owns doing that through `safeStorage`, not a file
  this script writes.
