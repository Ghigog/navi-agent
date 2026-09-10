/**
 * Notes and reminders (NAV-100).
 *
 * The properties the ticket names, in order: notes survive a memory-consolidation pass
 * untouched (they are a different store, which is the whole reason), a reminder set before a
 * restart still fires after it, and an ambiguous time produces a question rather than a guess.
 */

import { describe, expect, it } from 'vitest';
import {
  addNote,
  addReminder,
  coerceNotes,
  deleteNote,
  dueNow,
  markFired,
  nextDue,
  searchNotes,
  upcoming,
  type Notes,
} from '../src/shared/notes.js';
import { createNoteTools, MAX_NOTE_CHARS, type NoteWriter } from '../src/agent/notes.js';
import { createReminders, MAX_TIMER_MS } from '../src/main/reminders.js';

const NOW = new Date(2026, 8, 9, 10, 30).getTime();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const empty = (): Notes => ({ notes: [] });

describe('saving and finding', () => {
  it('saves a note and finds it later by what it was about', () => {
    const { store } = addNote(empty(), 'The SSE parser is the flaky one.', [], NOW);
    const found = searchNotes(store, 'which parser was flaky');

    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe('The SSE parser is the flaky one.');
  });

  it('finds by a tag the user gave as well as by the words', () => {
    const { store } = addNote(empty(), 'Check the retry backoff.', ['navi', 'ci'], NOW);
    expect(searchNotes(store, 'ci')).toHaveLength(1);
  });

  it('lists the most recent for an empty query, rather than nothing', () => {
    // "What notes do I have" is the most obvious way to ask.
    let store = empty();
    for (let i = 0; i < 5; i++) store = addNote(store, `Note ${i}.`, [], NOW + i * MINUTE).store;

    const found = searchNotes(store, '');
    expect(found).toHaveLength(5);
    expect(found[0]?.text).toBe('Note 4.');
  });

  it('returns nothing for a search about something never written down', () => {
    const { store } = addNote(empty(), 'The SSE parser is flaky.', [], NOW);
    expect(searchNotes(store, 'dentist appointment')).toEqual([]);
  });

  it('deletes what the user deleted', () => {
    const { store, note } = addNote(empty(), 'Something.', [], NOW);
    expect(searchNotes(deleteNote(store, note.id), '')).toEqual([]);
  });

  it('keeps the user\'s own words rather than a paraphrase', () => {
    const { note } = addNote(empty(), '  the   SSE parser  is  flaky ', [], NOW);
    expect(note.text).toBe('the SSE parser is flaky');
  });
});

describe('reminders', () => {
  it('knows what is due and what is still ahead', () => {
    let store = addReminder(empty(), 'check the build', NOW + 20 * MINUTE, NOW).store;
    store = addReminder(store, 'stand up', NOW - MINUTE, NOW).store;

    expect(dueNow(store, NOW).map((n) => n.text)).toEqual(['stand up']);
    expect(upcoming(store, NOW).map((n) => n.text)).toEqual(['check the build']);
  });

  it('does not fire the same reminder twice', () => {
    const { store, note } = addReminder(empty(), 'stand up', NOW - MINUTE, NOW);
    const after = markFired(store, [note.id], NOW);
    expect(dueNow(after, NOW)).toEqual([]);
  });

  it('keeps a fired reminder, because it is still a note the user wrote', () => {
    const { store, note } = addReminder(empty(), 'stand up', NOW - MINUTE, NOW);
    const after = markFired(store, [note.id], NOW);
    expect(searchNotes(after, 'stand up')).toHaveLength(1);
  });

  it('reports the soonest one, which is what the timer needs', () => {
    let store = addReminder(empty(), 'later', NOW + DAY, NOW).store;
    store = addReminder(store, 'sooner', NOW + MINUTE, NOW).store;
    expect(nextDue(store, NOW)).toBe(NOW + MINUTE);
  });

  it('has nothing to arm for when nothing is pending', () => {
    const { store } = addNote(empty(), 'just a note', [], NOW);
    expect(nextDue(store, NOW)).toBeNull();
  });
});

describe('notes are not memory', () => {
  it('has no budget, no decay and no consolidation', () => {
    // The separation the ticket asks for, stated as a test: a thousand notes are a thousand
    // notes. Nothing here prunes, because these are the user's own words.
    let store = empty();
    for (let i = 0; i < 1000; i++) store = addNote(store, `Note number ${i}.`, [], NOW - i * DAY).store;

    expect(store.notes).toHaveLength(1000);
    // Including the one from nearly three years ago that nobody has ever searched for: still
    // there, and still the best answer to a search that names it.
    expect(searchNotes(store, 'Note number 999')[0]?.text).toBe('Note number 999.');
  });

  it('caps what a search hands back, since the model has to read it', () => {
    let store = empty();
    for (let i = 0; i < 50; i++) store = addNote(store, `Migration note ${i}.`, [], NOW - i * MINUTE).store;
    expect(searchNotes(store, 'migration').length).toBeLessThanOrEqual(8);
  });
});

describe('the tools', () => {
  function stand(now = NOW) {
    let store = empty();
    const writer: NoteWriter = {
      save: (text, tags) => {
        const result = addNote(store, text, tags, now);
        store = result.store;
        return result.note;
      },
      remind: (text, due) => {
        const result = addReminder(store, text, due, now);
        store = result.store;
        return result.note;
      },
      search: (query) => searchNotes(store, query),
      upcoming: () => upcoming(store, now),
    };
    const tools = createNoteTools(writer, () => now);
    const byName = (name: string) => tools.find((t) => t.schema.name === name)!;
    return { tools, byName, current: () => store };
  }

  it('offers saving, reminding and looking things up', () => {
    expect(stand().tools.map((t) => t.schema.name)).toEqual(['save_note', 'set_reminder', 'list_notes']);
  });

  it('saves what the user said', async () => {
    const s = stand();
    await s.byName('save_note').run({ text: 'The SSE parser is the flaky one.' });
    expect(s.current().notes[0]?.text).toBe('The SSE parser is the flaky one.');
  });

  it('refuses a document', async () => {
    const s = stand();
    const result = await s.byName('save_note').run({ text: 'x'.repeat(MAX_NOTE_CHARS + 1) });
    expect(result.isError).toBe(true);
    expect(s.current().notes).toEqual([]);
  });

  it('sets a reminder from the words the user used', async () => {
    const s = stand();
    const result = await s.byName('set_reminder').run({ text: 'check the build', when: 'in 20 minutes' });

    expect(result.isError).toBeUndefined();
    expect(s.current().notes[0]?.due).toBe(NOW + 20 * MINUTE);
    // Said back, because resolving at write time only helps if the user hears it in time to
    // correct it.
    expect(result.content).toContain('in 20 minutes');
  });

  it('asks rather than guessing when the time is vague', async () => {
    const s = stand();
    const result = await s.byName('set_reminder').run({ text: 'check the build', when: 'later' });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/ask them/);
    // And nothing was set, which is the part that matters: a reminder for a time they did not
    // mean is worse than a question.
    expect(s.current().notes).toEqual([]);
  });

  it('refuses a time that has gone', async () => {
    const s = stand();
    const result = await s.byName('set_reminder').run({ text: 'x', when: '2020-01-01 09:00' });
    expect(result.isError).toBe(true);
    expect(s.current().notes).toEqual([]);
  });

  it('lists notes and what is coming up', async () => {
    const s = stand();
    await s.byName('save_note').run({ text: 'The SSE parser is flaky.' });
    await s.byName('set_reminder').run({ text: 'check the build', when: 'in 2 hours' });

    const result = await s.byName('list_notes').run({ query: '' });
    expect(result.content).toContain('SSE parser');
    expect(result.content).toContain('Coming up:');
    expect(result.content).toContain('check the build');
  });

  it('says so plainly when there is nothing saved', async () => {
    const result = await stand().byName('list_notes').run({});
    expect(result.content).toMatch(/not saved any/);
  });
});

describe('firing them', () => {
  /** A hand-driven clock and timer, so a reminder set for next Tuesday fires in a millisecond. */
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
      /** Moves the clock and runs the timer if it would have fired. */
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

  it('fires a reminder when it comes due', () => {
    const s = stand(addReminder(empty(), 'check the build', NOW + 20 * MINUTE, NOW).store);
    s.reminders.start();

    expect(s.fired).toEqual([]);
    s.clock.advance(20 * MINUTE);
    expect(s.fired).toEqual(['check the build']);
  });

  it('fires one set before a restart, on the next launch', () => {
    // The reminder was due while the app was closed. `start()` sweeps, so it arrives late
    // rather than never — which is the whole difference between a reminder and a wish.
    const store = addReminder(empty(), 'check the build', NOW - DAY, NOW - 2 * DAY).store;
    const s = stand(store);

    s.reminders.start();
    expect(s.fired).toEqual(['check the build']);
  });

  it('does not fire the same one again after a second restart', () => {
    const store = addReminder(empty(), 'check the build', NOW - DAY, NOW - 2 * DAY).store;
    const s = stand(store);

    s.reminders.start();
    const afterFirst = s.current();
    const second = stand(afterFirst);
    second.reminders.start();

    expect(second.fired).toEqual([]);
  });

  it('marks it fired before saying it, so a failure cannot make it repeat forever', () => {
    const store = addReminder(empty(), 'boom', NOW - MINUTE, NOW - DAY).store;
    const c = clock();
    let current = store;
    const reminders = createReminders({
      read: () => current,
      write: (next) => {
        current = next;
      },
      fire: () => {
        throw new Error('the chat window went away');
      },
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });

    expect(() => reminders.start()).toThrow();
    expect(dueNow(current, NOW)).toEqual([]);
  });

  it('moves the timer when a sooner reminder is added', () => {
    let current = addReminder(empty(), 'later', NOW + DAY, NOW).store;
    const c = clock();
    const fired: string[] = [];
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

    reminders.start();
    expect(reminders.armedFor()).toBe(NOW + DAY);

    current = addReminder(current, 'sooner', NOW + MINUTE, NOW).store;
    reminders.refresh();
    expect(reminders.armedFor()).toBe(NOW + MINUTE);

    c.advance(MINUTE);
    expect(fired).toEqual(['sooner']);
  });

  it('does not fire a reminder for next month immediately', () => {
    // setTimeout overflows past ~24.8 days and fires at once, which for a distant reminder
    // means firing it now. The wait is clamped and chained instead.
    const s = stand(addReminder(empty(), 'renew the domain', NOW + 60 * DAY, NOW).store);
    s.reminders.start();

    expect(s.clock.armed()?.at).toBe(NOW + MAX_TIMER_MS);
    s.clock.advance(MAX_TIMER_MS);
    expect(s.fired).toEqual([]);
    expect(s.reminders.armedFor()).toBe(NOW + 60 * DAY);
  });

  it('arms nothing when there is nothing pending', () => {
    const s = stand(addNote(empty(), 'just a note', [], NOW).store);
    s.reminders.start();
    expect(s.reminders.armedFor()).toBeNull();
  });
});

describe('reading a stored file', () => {
  it('degrades junk rather than propagating it', () => {
    expect(coerceNotes(null)).toEqual({ notes: [] });
    expect(coerceNotes({ notes: 'not a list' })).toEqual({ notes: [] });
    expect(coerceNotes({ notes: [{ tags: [] }] })).toEqual({ notes: [] });
  });

  it('survives a round trip through JSON, reminders included', () => {
    let store = addNote(empty(), 'A note.', ['x'], NOW).store;
    store = addReminder(store, 'A reminder.', NOW + DAY, NOW).store;
    expect(coerceNotes(JSON.parse(JSON.stringify(store)))).toEqual(store);
  });
});
