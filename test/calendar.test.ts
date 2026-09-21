/**
 * The commitment cache (NAV-117).
 *
 * What the ticket actually asks for: a confirmed, busy, timed event reaches the cache and an
 * all-day, declined, tentative or "free" one never does; the available-time arithmetic is pure and
 * runs against a fake clock with no network; buffers apply per event, with the location default,
 * and a per-event override wins.
 */

import { describe, expect, it } from 'vitest';
import {
  applySync,
  bufferMinutesFor,
  coerceCache,
  DEFAULT_BUFFER_MINUTES,
  EMPTY_CACHE,
  isCommitment,
  LOCATION_BUFFER_MINUTES,
  leaveByTime,
  minutesUntilLeaveBy,
  nextCommitment,
  toCommitmentEvent,
  type CommitmentCache,
  type GoogleEvent,
} from '../src/shared/calendar.js';

const NOW = new Date(2026, 8, 9, 10, 0).getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function timed(overrides: Partial<GoogleEvent> = {}): GoogleEvent {
  return {
    id: 'evt-1',
    summary: 'Standup',
    status: 'confirmed',
    start: { dateTime: new Date(NOW + HOUR).toISOString() },
    end: { dateTime: new Date(NOW + HOUR + 30 * MINUTE).toISOString() },
    ...overrides,
  };
}

describe('what counts as a commitment', () => {
  it('a confirmed, busy, timed event counts', () => {
    expect(isCommitment(timed())).toBe(true);
  });

  it('an all-day event never counts', () => {
    const event = timed({ start: { date: '2026-09-09' }, end: { date: '2026-09-10' } });
    expect(isCommitment(event)).toBe(false);
  });

  it('a declined event never counts', () => {
    const event = timed({ attendees: [{ self: true, responseStatus: 'declined' }] });
    expect(isCommitment(event)).toBe(false);
  });

  it('a tentative event never counts', () => {
    expect(isCommitment(timed({ status: 'tentative' }))).toBe(false);
  });

  it('a cancelled event never counts', () => {
    expect(isCommitment(timed({ status: 'cancelled' }))).toBe(false);
  });

  it('an event marked "free" never counts', () => {
    expect(isCommitment(timed({ transparency: 'transparent' }))).toBe(false);
  });

  it('an event the user has not responded to still counts — only a decline excludes it', () => {
    const event = timed({ attendees: [{ self: true, responseStatus: 'needsAction' }] });
    expect(isCommitment(event)).toBe(true);
  });
});

describe('applying a sync page to the cache', () => {
  it('a confirmed, busy, timed event within 24 hours reaches the cache', () => {
    const page = { events: [timed()], nextSyncToken: 'tok-1' };
    const cache = applySync(EMPTY_CACHE, page, NOW);

    expect(cache.events).toHaveLength(1);
    expect(cache.events[0]?.id).toBe('evt-1');
    expect(cache.syncToken).toBe('tok-1');
    expect(cache.syncedAt).toBe(NOW);
  });

  it('an all-day, declined, tentative or "free" event never reaches the cache', () => {
    const page = {
      events: [
        timed({ id: 'all-day', start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }),
        timed({ id: 'declined', attendees: [{ self: true, responseStatus: 'declined' }] }),
        timed({ id: 'tentative', status: 'tentative' }),
        timed({ id: 'free', transparency: 'transparent' }),
      ],
      nextSyncToken: 'tok-1',
    };

    expect(applySync(EMPTY_CACHE, page, NOW).events).toEqual([]);
  });

  it('a later page cancelling a previously cached event removes it', () => {
    const first = applySync(EMPTY_CACHE, { events: [timed()], nextSyncToken: 'tok-1' }, NOW);
    const second = applySync(first, { events: [timed({ status: 'cancelled' })], nextSyncToken: 'tok-2' }, NOW);

    expect(second.events).toEqual([]);
    expect(second.syncToken).toBe('tok-2');
  });

  it('an event more than 24 hours out is pruned', () => {
    const farOut = timed({
      start: { dateTime: new Date(NOW + 2 * DAY).toISOString() },
      end: { dateTime: new Date(NOW + 2 * DAY + HOUR).toISOString() },
    });
    const cache = applySync(EMPTY_CACHE, { events: [farOut], nextSyncToken: 'tok-1' }, NOW);
    expect(cache.events).toEqual([]);
  });

  it('an event already in the past is pruned even if it was cached before', () => {
    const cache: CommitmentCache = {
      events: [{ id: 'stale', title: 'Old', start: NOW - 2 * HOUR, end: NOW - HOUR, location: null }],
      syncToken: 'tok-1',
      syncedAt: NOW - DAY,
    };
    const next = applySync(cache, { events: [], nextSyncToken: 'tok-2' }, NOW);
    expect(next.events).toEqual([]);
  });
});

describe('buffers', () => {
  it('defaults to 10 minutes with no location', () => {
    const event = toCommitmentEvent(timed())!;
    expect(bufferMinutesFor(event)).toBe(DEFAULT_BUFFER_MINUTES);
  });

  it('defaults to 15 minutes when the event has a location', () => {
    const event = toCommitmentEvent(timed({ location: 'Conference Room B' }))!;
    expect(bufferMinutesFor(event)).toBe(LOCATION_BUFFER_MINUTES);
  });

  it('a per-event override wins over the location default', () => {
    const event = toCommitmentEvent(timed({ location: 'Conference Room B' }), 45)!;
    expect(bufferMinutesFor(event)).toBe(45);
  });

  it('a per-event override wins over the plain default', () => {
    const event = toCommitmentEvent(timed(), 2)!;
    expect(bufferMinutesFor(event)).toBe(2);
  });

  it('applySync carries the override through from the sync page', () => {
    const cache = applySync(EMPTY_CACHE, { events: [timed()], nextSyncToken: 'tok-1' }, NOW, { 'evt-1': 25 });
    expect(cache.events[0]?.bufferMinutes).toBe(25);
    expect(bufferMinutesFor(cache.events[0]!)).toBe(25);
  });

  it('leaveByTime subtracts the buffer from the start time', () => {
    const event = toCommitmentEvent(timed(), 20)!;
    expect(leaveByTime(event)).toBe(event.start - 20 * MINUTE);
  });
});

describe('the available-time arithmetic', () => {
  it('is null when nothing is coming', () => {
    expect(minutesUntilLeaveBy(EMPTY_CACHE, NOW)).toBeNull();
    expect(nextCommitment(EMPTY_CACHE, NOW)).toBeNull();
  });

  it('reports minutes until the buffer window starts, with a fake clock and no network', () => {
    const cache = applySync(EMPTY_CACHE, { events: [timed()], nextSyncToken: 'tok-1' }, NOW);
    // Event starts in 60 minutes, default 10-minute buffer: 50 minutes until leave-by.
    expect(minutesUntilLeaveBy(cache, NOW)).toBe(50);
  });

  it('goes negative once the buffer window has already started', () => {
    const cache = applySync(EMPTY_CACHE, { events: [timed()], nextSyncToken: 'tok-1' }, NOW);
    const later = NOW + 55 * MINUTE;
    expect(minutesUntilLeaveBy(cache, later)).toBe(-5);
  });

  it('picks the soonest of several commitments', () => {
    const sooner = timed({
      id: 'sooner',
      start: { dateTime: new Date(NOW + 20 * MINUTE).toISOString() },
      end: { dateTime: new Date(NOW + 40 * MINUTE).toISOString() },
    });
    const cache = applySync(EMPTY_CACHE, { events: [timed(), sooner], nextSyncToken: 'tok-1' }, NOW);
    expect(nextCommitment(cache, NOW)?.id).toBe('sooner');
  });

  it('ignores a commitment that has already ended', () => {
    // Built directly rather than via applySync, which would already prune it on the way in —
    // this pins nextCommitment's own "not yet ended" check as a property in its own right.
    const cache: CommitmentCache = {
      events: [{ id: 'past', title: 'Standup', start: NOW - HOUR, end: NOW - 10 * MINUTE, location: null }],
      syncToken: 'tok-1',
      syncedAt: NOW - DAY,
    };
    expect(nextCommitment(cache, NOW)).toBeNull();
  });
});

describe('coerceCache', () => {
  it('degrades a malformed shape to empty rather than propagating it', () => {
    expect(coerceCache(null)).toEqual(EMPTY_CACHE);
    expect(coerceCache({})).toEqual(EMPTY_CACHE);
    expect(coerceCache({ events: 'nope' })).toEqual(EMPTY_CACHE);
  });

  it('round-trips a well-formed cache, including a per-event buffer override', () => {
    const cache = applySync(EMPTY_CACHE, { events: [timed({ location: 'Room B' })], nextSyncToken: 'tok-1' }, NOW, {
      'evt-1': 25,
    });
    expect(coerceCache(JSON.parse(JSON.stringify(cache)))).toEqual(cache);
  });

  it('drops an entry missing required fields rather than keeping a partial one', () => {
    const coerced = coerceCache({ events: [{ id: 'x' }, { id: 'y', start: NOW, end: NOW + HOUR }], syncToken: 't', syncedAt: NOW });
    expect(coerced.events.map((e) => e.id)).toEqual(['y']);
  });
});
