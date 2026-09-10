# Working agreements for Claude on this repo

## How to report

Do the work. Say what you did. Stop there.

**Do not end a turn with a list of things for me to do.** If it's fixable, fix it. If it
genuinely needs my hands (a Mac, a credential, an account), say it in one line, once, and
never repeat it in a later turn.

**Only raise something I didn't ask about if it changes what I'd do next, right now.** The bar
is "this breaks the thing you asked for" or "this will bite you this week." Not "this could
theoretically matter." Not a stale assumption in a doc. Not repo hygiene. Not a dead credential
that's already revoked.

No "Flagging" sections. No "worth knowing" asides. No caveats stacked at the end of good news.
If a genuine risk exists, one sentence, inline, then move on.

Applies to git and infra as much as code: don't go hunting for problems in the repository's
state unless I asked. `git clone --mirror` is not a health check.

## Settled — never raise these again

- **The repo is public.** Deliberate, so CI works. It is not a finding.
- **The Godot app is gone.** Deleted by NAV-105 once the port had parity. It is in git history at
  `bd25efa~1` and does not need rescuing, mentioning, or comparing against.
- **NAV-81 is closed.** Key revoked and unreplaced, history purged, 3.2MB. GitHub's
  `refs/pull/*` still hold old blobs; nobody can delete those, and nothing in them matters.
- **Navi's mood affects her competence.** Intended. She is not for reliability-critical work.
  The only hard line is that mood never licenses fabricating facts.

## When to actually interrupt me

Ask before doing, or stop and tell me, only when:

- The work as requested would break something that currently works.
- Two readings of the request produce materially different code.
- Something needs my machine, my credentials, or my sign-off to proceed at all.

Otherwise pick the sensible option, note it in one line, and keep going.

## The work itself

Conventions are in `README.md` — one app now, at the repository root (NAV-105). Run `npm test`
and `npm run typecheck` before pushing. Both are under a second.
