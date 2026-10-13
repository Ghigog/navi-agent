/**
 * The leave-by reminder (NAV-114).
 *
 * The ticket's own properties: exactly one reminder per commitment, ever; no model call anywhere
 * in the path (it is templates and arithmetic); it survives a restart and catches up rather than
 * being lost if the machine slept through the moment; and a commitment that disappears before its
 * reminder fires never gets one.
 */

import { describe, expect, it } from 'vitest';
import { applySync, EMPTY_CACHE, type CommitmentCache, type GoogleEvent } from '../src/shared/calendar.js';
import { dueNow, markFired, type Notes } from '../src/shared/notes.js';
import { LEAD_MINUTES, leaveByMessage, LEAVE_BY_TEMPLATES, reconcileLeaveByNotes } from '../src/shared/leave-by.js';
import { createReminders, MAX_TIMER_MS } from '../src/main/reminders.js';
import type { Emotion } from '../src/shared/emotion.js';

const NOW = new Date(2026, 8, 9, 10, 0).getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const empty = (): Notes => ({ notes: [] });

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

function cacheWith(...events: GoogleEvent[]): CommitmentCache {
  return applySync(EMPTY_CACHE, 'primary', { events, nextSyncToken: 'tok-1' }, NOW);
}

describe('templated wording', () => {
  it('is one line per emotion, with the title filled in and nothing else', () => {
    const text = leaveByMessage('happiness', 'Standup');
    expect(text).toContain('Standup');
    expect(text).not.toContain('{title}');
  });

  it('every emotion has its own line', () => {
    const emotions = Object.keys(LEAVE_BY_TEMPLATES) as Emotion[];
    expect(emotions).toHaveLength(8);
    for (const emotion of emotions) expect(leaveByMessage(emotion, 'X')).toContain('X');
  });

  it('changes with mood while the event never does', () => {
    const calm = leaveByMessage('serenity', 'Standup');
    const angry = leaveByMessage('anger', 'Standup');
    expect(calm).not.toBe(angry);
  });
});

describe('reconciling against the commitment cache', () => {
  it('arms exactly one note for a new commitment, due at start minus buffer minus lead', () => {
    const cache = cacheWith(timed());
    const store = reconcileLeaveByNotes(cache, empty(), NOW);

    expect(store.notes).toHaveLength(1);
    const note = store.notes[0]!;
    expect(note.text).toBe('Standup');
    // Default 10-minute buffer (no location) plus the 10-minute lead.
    expect(note.due).toBe(NOW + HOUR - 10 * MINUTE - LEAD_MINUTES * MINUTE);
  });

  it('never arms a second note for the same commitment', () => {
    const cache = cacheWith(timed());
    const once = reconcileLeaveByNotes(cache, empty(), NOW);
    const twice = reconcileLeaveByNotes(cache, once, NOW + MINUTE);

    expect(twice.notes).toHaveLength(1);
    expect(twice).toBe(once); // nothing changed, so the same store is handed back
  });

  it('does not re-arm one that has already fired, even though the commitment is still cached', () => {
    const cache = cacheWith(timed());
    const armed = reconcileLeaveByNotes(cache, empty(), NOW);
    const fired = markFired(armed, [armed.notes[0]!.id], NOW);

    const after = reconcileLeaveByNotes(cache, fired, NOW + MINUTE);
    expect(after.notes).toHaveLength(1);
    expect(after.notes[0]?.firedAt).toBe(NOW);
  });

  it('arms one note per commitment when several are cached', () => {
    const second = timed({
      id: 'evt-2',
      summary: 'Dentist',
      start: { dateTime: new Date(NOW + 2 * HOUR).toISOString() },
      end: { dateTime: new Date(NOW + 3 * HOUR).toISOString() },
    });
    const cache = cacheWith(timed(), second);
    const store = reconcileLeaveByNotes(cache, empty(), NOW);

    expect(store.notes.map((n) => n.text).sort()).toEqual(['Dentist', 'Standup']);
  });

  it('drops a pending note for a commitment that disappears before it fires', () => {
    const cache = cacheWith(timed());
    const armed = reconcileLeaveByNotes(cache, empty(), NOW);

    // The next sync cancels the event, which removes it from the cache (NAV-117).
    const afterCancel = applySync(cache, 'primary', { events: [timed({ status: 'cancelled' })], nextSyncToken: 'tok-2' }, NOW);
    const reconciled = reconcileLeaveByNotes(afterCancel, armed, NOW + MINUTE);

    expect(reconciled.notes).toEqual([]);
  });

  it('keeps a note that already fired even after the commitment leaves the cache', () => {
    const cache = cacheWith(timed());
    const armed = reconcileLeaveByNotes(cache, empty(), NOW);
    const fired = markFired(armed, [armed.notes[0]!.id], NOW);

    const afterCancel = applySync(cache, 'primary', { events: [timed({ status: 'cancelled' })], nextSyncToken: 'tok-2' }, NOW);
    const reconciled = reconcileLeaveByNotes(afterCancel, fired, NOW + MINUTE);

    expect(reconciled.notes).toHaveLength(1);
    expect(reconciled.notes[0]?.firedAt).toBe(NOW);
  });

  it('leaves a note it does not own alone', () => {
    const store: Notes = { notes: [{ id: 'n1', text: 'a user note', tags: [], at: NOW }] };
    const reconciled = reconcileLeaveByNotes(EMPTY_CACHE, store, NOW);
    expect(reconciled).toEqual(store);
  });
});

describe('firing, with the shared reminders timer', () => {
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
      advance(ms: number) {
        t += ms;
        while (pending !== null && pending.at <= t) {
          const due = pending;
          pending = null;
          due.fn();
        }
      },
      armed: () => pending,
    };
  }

  function stand(store: Notes, start = NOW) {
    const c = clock(start);
    const fired: string[] = [];
    let current = store;

    const reminders = createReminders({
      read: () => current,
      write: (next) => {
        current = next;
      },
      fire: (notes) => fired.push(...notes.map((n) => n.text)),
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });

    return { reminders, fired, clock: c, current: () => current };
  }

  it('fires exactly once when the leave-by moment arrives', () => {
    const cache = cacheWith(timed());
    const s = stand(reconcileLeaveByNotes(cache, empty(), NOW));
    s.reminders.start();

    expect(s.fired).toEqual([]);
    s.clock.advance(HOUR - 10 * MINUTE - LEAD_MINUTES * MINUTE);
    expect(s.fired).toEqual(['Standup']);

    s.clock.advance(HOUR);
    expect(s.fired).toEqual(['Standup']); // never a second time
  });

  it('survives a restart and does not fire twice', () => {
    const cache = cacheWith(timed());
    const armed = reconcileLeaveByNotes(cache, empty(), NOW);
    const first = stand(armed);
    first.reminders.start();
    first.clock.advance(HOUR);

    const second = stand(first.current());
    second.reminders.start();
    expect(second.fired).toEqual([]);
  });

  it('catches up late rather than never, if the machine slept through the moment', () => {
    // Armed for a moment already in the past by the time `start()` runs.
    const due = new Date(NOW - MINUTE).getTime();
    const store: Notes = { notes: [{ id: 'lb-evt-1', text: 'Standup', tags: ['leave-by'], at: NOW - HOUR, due }] };

    const s = stand(store);
    s.reminders.start();
    expect(s.fired).toEqual(['Standup']);
  });

  it('does not overflow the timer for a commitment a long way out', () => {
    // Built directly rather than via the cache: `applySync`'s 24-hour horizon would prune this
    // anyway (NAV-117), and what this pins is `reminders.ts`'s own chaining, which a leave-by
    // note is subject to like any other due time.
    const store: Notes = {
      notes: [{ id: 'lb-evt-1', text: 'Standup', tags: ['leave-by'], at: NOW, due: NOW + 60 * 24 * HOUR }],
    };
    const s = stand(store);
    s.reminders.start();
    expect(s.clock.armed()?.at).toBe(NOW + MAX_TIMER_MS);
    expect(s.reminders.armedFor()).toBe(NOW + 60 * 24 * HOUR);
  });
});

describe('dueNow agrees with what the timer will fire', () => {
  it('is empty right up until the leave-by moment', () => {
    const cache = cacheWith(timed());
    const store = reconcileLeaveByNotes(cache, empty(), NOW);
    const due = store.notes[0]!.due!;

    expect(dueNow(store, due - MINUTE)).toEqual([]);
    expect(dueNow(store, due)).toHaveLength(1);
  });
});
