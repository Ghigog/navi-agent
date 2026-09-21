/**
 * Syncing the calendar cache (NAV-117).
 *
 * NAV-108's connection only produces an access token; this is what does something with it. A slow
 * timer keeps the next 24 hours current, and a forced refresh runs right before NAV-110 or NAV-111
 * is about to make a decision — that forced call is what actually guarantees freshness, which is
 * why the timer's own cadence can stay slow (15-30 minutes) without costing accuracy.
 *
 * No Electron import, the way `reminders.ts` and `calendar-connection.ts` have none: the store, the
 * clock, the timer and the network call all arrive as dependencies, so a sync — full, incremental,
 * expired-token, offline, paused — runs under test with no real network and no real clock.
 */

import { applySync, EMPTY_CACHE, type CommitmentCache, type GoogleEvent } from '../shared/calendar.js';

const EVENTS_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Within the ticket's 15-30 minute band. */
export const SYNC_INTERVAL_MS = 20 * 60 * 1000;

export type FetchPage =
  | { status: 'ok'; events: GoogleEvent[]; nextSyncToken: string }
  | { status: 'expired' }
  | { status: 'failed' };

export interface CalendarSyncDeps {
  read(): CommitmentCache;
  write(next: CommitmentCache): void;
  /** NAV-108's `ensureAccessToken`. Null means not connected, or a reconnect is needed — either way, nothing to sync. */
  ensureAccessToken(): Promise<string | null>;
  /** False means paused (NAV-113) or no calendar connected. Checked before anything else, every time. */
  enabled(): boolean;
  /** Per-event buffer overrides from Settings (NAV-113). Empty until that ships. */
  overrides?(): Readonly<Record<string, number>>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  fetchPage?: (accessToken: string, syncToken: string | null, now: number) => Promise<FetchPage>;
}

async function defaultFetchPage(accessToken: string, syncToken: string | null, now: number): Promise<FetchPage> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const url = new URL(EVENTS_ENDPOINT);
    url.searchParams.set('singleEvents', 'true');
    if (syncToken !== null) {
      // Google disallows timeMin/timeMax/q alongside a sync token — an incremental sync returns
      // every change since it was issued, not a window, and the horizon is applied locally.
      url.searchParams.set('syncToken', syncToken);
    } else {
      url.searchParams.set('timeMin', new Date(now).toISOString());
      url.searchParams.set('timeMax', new Date(now + 24 * 60 * 60 * 1000).toISOString());
    }
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null);
    if (res === null) return { status: 'failed' };
    if (res.status === 410) return { status: 'expired' };
    if (!res.ok) return { status: 'failed' };

    const body = (await res.json().catch(() => null)) as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string } | null;
    if (body === null) return { status: 'failed' };

    events.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    if (body.nextSyncToken !== undefined) nextSyncToken = body.nextSyncToken;
  } while (pageToken !== undefined);

  // A final page with no nextSyncToken would mean throwing away the ability to sync incrementally
  // next time; that should not happen against a real API, but failing the sync is safer than
  // silently forcing every future sync to go full.
  if (nextSyncToken === undefined) return { status: 'failed' };
  return { status: 'ok', events, nextSyncToken };
}

export interface CalendarSync {
  /** Arms the timer. Call once at launch. */
  start(): void;
  /** Runs a sync now, waiting for one already in flight rather than racing it, then re-arms. */
  refreshNow(): Promise<void>;
  stop(): void;
}

export function createCalendarSync(deps: CalendarSyncDeps): CalendarSync {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));
  const fetchPage = deps.fetchPage ?? defaultFetchPage;
  const overrides = deps.overrides ?? (() => ({}));

  let handle: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const disarm = (): void => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  const arm = (): void => {
    disarm();
    // Paused or disconnected: no timer at all, not a timer that no-ops. A stopped feature makes
    // no network calls, and that has to be true of the schedule itself, not just of what it does.
    if (!deps.enabled()) return;
    handle = setTimer(tick, SYNC_INTERVAL_MS);
  };

  const sync = async (): Promise<void> => {
    if (!deps.enabled()) return;
    const accessToken = await deps.ensureAccessToken();
    if (accessToken === null) return;

    const cache = deps.read();
    const page = await fetchPage(accessToken, cache.syncToken, now());

    if (page.status === 'failed') return; // try again next cadence, cache untouched
    if (page.status === 'expired') {
      // The sync token is dead; the only recovery is a full resync from empty.
      const fresh = await fetchPage(accessToken, null, now());
      if (fresh.status !== 'ok') return;
      deps.write(applySync(EMPTY_CACHE, fresh, now(), overrides()));
      return;
    }

    deps.write(applySync(cache, page, now(), overrides()));
  };

  /** Runs a sync, or waits for one already running rather than racing it. Shared by the timer and a forced refresh. */
  const runSync = (): Promise<void> => {
    if (inFlight === null) {
      inFlight = sync().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };

  const tick = (): void => {
    void runSync().finally(arm);
  };

  return {
    start(): void {
      arm();
    },
    async refreshNow(): Promise<void> {
      await runSync();
      arm();
    },
    stop(): void {
      disarm();
    },
  };
}
