/**
 * Syncing the commitment cache (NAV-117).
 *
 * The properties the ticket names: a forced refresh reflects a change made seconds earlier, and
 * pausing (or having no calendar connected) stops all network activity, not just what happens
 * with it — verified here by a request log the sync must never touch.
 */

import { describe, expect, it } from 'vitest';
import { createCalendarSync, SYNC_INTERVAL_MS, type FetchPage } from '../src/main/calendar-sync.js';
import { EMPTY_CACHE, type CommitmentCache, type GoogleEvent } from '../src/shared/calendar.js';

const NOW = new Date(2026, 8, 9, 10, 0).getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function timed(id: string, startOffsetMs: number): GoogleEvent {
  return {
    id,
    summary: id,
    status: 'confirmed',
    start: { dateTime: new Date(NOW + startOffsetMs).toISOString() },
    end: { dateTime: new Date(NOW + startOffsetMs + HOUR).toISOString() },
  };
}

/** A hand-driven clock and timer, same shape as the one `test/notes.test.ts` uses for reminders. */
function clock(start = NOW) {
  let t = start;
  let pending: { fn: () => void; at: number } | null = null;
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      pending = { fn, at: t + ms };
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      pending = null;
    },
    armed: () => pending,
  };
}

interface Harness {
  sync: ReturnType<typeof createCalendarSync>;
  requests: string[];
  cache: () => CommitmentCache;
  clock: ReturnType<typeof clock>;
  setEnabled: (value: boolean) => void;
}

function harness(
  opts: {
    fetchPage?: (calendarId: string, accessToken: string, syncToken: string | null, now: number) => Promise<FetchPage>;
    calendarIds?: () => readonly string[];
    token?: string | null;
  } = {},
): Harness {
  const c = clock();
  let current: CommitmentCache = EMPTY_CACHE;
  let enabled = true;
  const requests: string[] = [];

  const fetchPage =
    opts.fetchPage ??
    (async (): Promise<FetchPage> => ({ events: [], nextSyncToken: 'tok-default', status: 'ok' as const }));
  const calendarIds = opts.calendarIds ?? ((): readonly string[] => ['primary']);

  const sync = createCalendarSync({
    read: () => current,
    write: (next) => {
      current = next;
    },
    ensureAccessToken: async () => (opts.token === undefined ? 'access-1' : opts.token),
    enabled: () => enabled,
    calendarIds,
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    fetchPage: async (calendarId, accessToken, syncToken, now) => {
      requests.push(`${accessToken}:${syncToken ?? 'full'}`);
      return fetchPage(calendarId, accessToken, syncToken, now);
    },
  });

  return { sync, requests, cache: () => current, clock: c, setEnabled: (v) => (enabled = v) };
}

describe('forced refresh', () => {
  it('reflects a change made seconds earlier', async () => {
    let call = 0;
    const h = harness({
      fetchPage: async () => {
        call++;
        return call === 1
          ? { status: 'ok', events: [timed('evt-1', HOUR)], nextSyncToken: 'tok-1' }
          : { status: 'ok', events: [timed('evt-2', 2 * HOUR)], nextSyncToken: 'tok-2' };
      },
    });

    await h.sync.refreshNow();
    expect(h.cache().events.map((e) => e.id)).toEqual(['evt-1']);

    await h.sync.refreshNow();
    expect(h.cache().events.map((e) => e.id).sort()).toEqual(['evt-1', 'evt-2']);
  });

  it('uses the stored sync token on the next call, not a full resync', async () => {
    const h = harness();
    await h.sync.refreshNow();
    await h.sync.refreshNow();
    expect(h.requests).toEqual(['access-1:full', 'access-1:tok-default']);
  });

  it('does nothing when no calendar is connected', async () => {
    const h = harness({ token: null });
    await h.sync.refreshNow();
    expect(h.requests).toEqual([]);
    expect(h.cache()).toEqual(EMPTY_CACHE);
  });

  it('does not race a refresh already in flight', async () => {
    // Created before either refreshNow() call, so resolving it is safe regardless of exactly
    // when fetchPage's own await reaches it — the promise is already settled by then.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const h = harness({
      fetchPage: async () => {
        calls++;
        await gate;
        return { status: 'ok', events: [], nextSyncToken: `tok-${calls}` };
      },
    });

    const first = h.sync.refreshNow();
    const second = h.sync.refreshNow();
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });
});

describe('an expired sync token', () => {
  it('falls back to a full resync from empty', async () => {
    let call = 0;
    const h = harness({
      fetchPage: async (_calendarId, _token, syncToken) => {
        call++;
        if (call === 1) return { status: 'ok', events: [timed('stale', HOUR)], nextSyncToken: 'tok-1' };
        if (syncToken === 'tok-1') return { status: 'expired' };
        return { status: 'ok', events: [timed('fresh', HOUR)], nextSyncToken: 'tok-2' };
      },
    });

    await h.sync.refreshNow();
    expect(h.cache().events.map((e) => e.id)).toEqual(['stale']);

    await h.sync.refreshNow();
    expect(h.cache().events.map((e) => e.id)).toEqual(['fresh']);
    expect(h.cache().syncTokens).toEqual({ primary: 'tok-2' });
  });
});

describe('a failed fetch', () => {
  it('leaves the cache untouched, to try again next cadence', async () => {
    const h = harness({ fetchPage: async () => ({ status: 'failed' }) });
    await h.sync.refreshNow();
    expect(h.cache()).toEqual(EMPTY_CACHE);
  });
});

describe('pausing or no calendar connected', () => {
  it('start() never arms a timer when disabled', () => {
    const h = harness();
    h.setEnabled(false);
    h.sync.start();
    expect(h.clock.armed()).toBeNull();
  });

  it('a sync on the timer makes no request at all when disabled', async () => {
    const h = harness();
    h.setEnabled(false);
    await h.sync.refreshNow();
    expect(h.requests).toEqual([]);
  });

  it('the timer re-arms itself on the ticket\'s cadence once enabled', () => {
    const h = harness();
    h.sync.start();
    expect(h.clock.armed()?.at).toBe(NOW + SYNC_INTERVAL_MS);
  });

  it('stop() disarms the timer', () => {
    const h = harness();
    h.sync.start();
    h.sync.stop();
    expect(h.clock.armed()).toBeNull();
  });
});

describe('calendar selection (T-1), tested through the injected HTTP port', () => {
  it('reads only the calendars Settings names, not any other', async () => {
    const seen: string[] = [];
    const h = harness({
      calendarIds: () => ['work', 'family'],
      fetchPage: async (calendarId) => {
        seen.push(calendarId);
        return { status: 'ok', events: [], nextSyncToken: `tok-${calendarId}` };
      },
    });

    await h.sync.refreshNow();
    expect(seen.sort()).toEqual(['family', 'work']);
    expect(h.cache().syncTokens).toEqual({ work: 'tok-work', family: 'tok-family' });
  });

  it('reads nothing when Settings names no calendar at all', async () => {
    const h = harness({ calendarIds: () => [] });
    await h.sync.refreshNow();
    expect(h.requests).toEqual([]);
    expect(h.cache()).toEqual(EMPTY_CACHE);
  });

  it("one calendar's events reach the cache without touching another's", async () => {
    const h = harness({
      calendarIds: () => ['work', 'family'],
      fetchPage: async (calendarId) =>
        calendarId === 'work'
          ? { status: 'ok', events: [timed('work-1', HOUR)], nextSyncToken: 'tok-work' }
          : { status: 'ok', events: [timed('family-1', 2 * HOUR)], nextSyncToken: 'tok-family' },
    });

    await h.sync.refreshNow();
    expect(h.cache().events.map((e) => e.id).sort()).toEqual(['family-1', 'work-1']);
  });

  it('dropping a calendar from Settings stops reading it on the very next sync, without a restart', async () => {
    let ids = ['work', 'family'];
    const seen: string[] = [];
    const h = harness({
      // Read fresh on every call, the same way `enabled` and `overrides` already are — a change
      // in Settings reaches the next sync rather than needing this seam rebuilt.
      calendarIds: () => ids,
      fetchPage: async (calendarId) => {
        seen.push(calendarId);
        return { status: 'ok', events: [], nextSyncToken: `tok-${calendarId}` };
      },
    });

    await h.sync.refreshNow();
    expect(seen.sort()).toEqual(['family', 'work']);

    seen.length = 0;
    ids = ['work'];
    await h.sync.refreshNow();
    expect(seen).toEqual(['work']);
  });
});
