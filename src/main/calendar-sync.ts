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

import { applySync, stripCalendar, type CommitmentCache, type GoogleEvent } from '../shared/calendar.js';

function eventsEndpoint(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

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
  /** Which calendars to read, from Settings' `selectedCalendars` (T-1). Empty means nothing is read. Defaults to `['primary']`, this file's only calendar before that setting existed. */
  calendarIds?(): readonly string[];
  /** Per-event buffer overrides from Settings (T-1). */
  overrides?(): Readonly<Record<string, number>>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  /** The HTTP seam: one page of one calendar's events, keyed by calendar id so a test can pin exactly which calendars were read. */
  fetchPage?: (calendarId: string, accessToken: string, syncToken: string | null, now: number) => Promise<FetchPage>;
}

async function defaultFetchPage(calendarId: string, accessToken: string, syncToken: string | null, now: number): Promise<FetchPage> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const url = new URL(eventsEndpoint(calendarId));
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
  const calendarIds = deps.calendarIds ?? (() => ['primary']);

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
    const ids = calendarIds();
    if (ids.length === 0) return; // nothing selected: reads only what Settings names, and that is nothing

    const accessToken = await deps.ensureAccessToken();
    if (accessToken === null) return;

    let cache = deps.read();
    let changed = false;

    for (const calendarId of ids) {
      const token = cache.syncTokens[calendarId] ?? null;
      const page = await fetchPage(calendarId, accessToken, token, now());

      if (page.status === 'failed') continue; // try again next cadence, this calendar's slice untouched

      if (page.status === 'expired') {
        // The sync token is dead; the only recovery is a full resync of this calendar from empty.
        const fresh = await fetchPage(calendarId, accessToken, null, now());
        if (fresh.status !== 'ok') continue;
        cache = applySync(stripCalendar(cache, calendarId), calendarId, fresh, now(), overrides());
        changed = true;
        continue;
      }

      // No prior token means this was a full request too (`defaultFetchPage` windows by
      // timeMin/timeMax rather than a syncToken), so it is as authoritative as an expired one:
      // this calendar's whole prior slice is replaced, not merged with.
      const base = token === null ? stripCalendar(cache, calendarId) : cache;
      cache = applySync(base, calendarId, page, now(), overrides());
      changed = true;
    }

    if (changed) deps.write(cache);
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
