/**
 * Notes and reminders (NAV-100).
 *
 * Small, and disproportionately useful: the owner's description names it second, and it is a
 * thing wanted several times a day by someone who already has Navi on screen.
 *
 * **Separate from `memory.ts`, and that separation is a requirement rather than tidiness.**
 * Memory is inferred — she wrote it down because she thought it mattered — and it is
 * consolidated and decayed to keep the prompt small. Notes are *the user's own words*, saved
 * because they asked. Nothing here is ever consolidated, promoted or forgotten by a schedule,
 * and no budget applies: notes are searched on demand, not injected into every prompt, so they
 * cost nothing until they are asked for.
 *
 * Pure. `main/notes-store.ts` persists it and `main/reminders.ts` fires it.
 */

import { keywords, words } from './text.js';

export interface Note {
  id: string;
  /** What the user said, saved as they said it. */
  text: string;
  tags: string[];
  at: number;
  /** Set on a reminder: when it should fire. Resolved at write time (`shared/when.ts`). */
  due?: number;
  /** Set once it has fired, so a restart does not fire it again. */
  firedAt?: number;
}

export interface Notes {
  notes: Note[];
}

export const EMPTY_NOTES: Notes = { notes: [] };

/** How many a search hands back. Enough to find the one you meant, few enough to read. */
export const MAX_RESULTS = 8;

/**
 * A fired reminder is kept, not deleted.
 *
 * It is still a note the user wrote, and "what did I ask you to remind me about last week" is a
 * reasonable question. They are dropped only when the user deletes them.
 */
let counter = 0;
export function newNoteId(at = Date.now()): string {
  counter = (counter + 1) % 100000;
  return `n${at.toString(36)}-${counter.toString(36)}`;
}

const normalise = (text: string): string => text.trim().replace(/\s+/g, ' ');

function build(text: string, tags: readonly string[], at: number): Note {
  const clean = normalise(text);
  return {
    id: newNoteId(at),
    text: clean,
    // Tags the user gave, plus the words worth finding it by. Derived on write, so a search does
    // no work per note beyond a set lookup.
    tags: [...new Set([...tags.map((t) => t.toLowerCase().trim()).filter((t) => t !== ''), ...keywords(clean)])],
    at,
  };
}

export function addNote(store: Notes, text: string, tags: readonly string[] = [], at = Date.now()): { store: Notes; note: Note } {
  const note = build(text, tags, at);
  return { store: { notes: [...store.notes, note] }, note };
}

export function addReminder(store: Notes, text: string, due: number, at = Date.now()): { store: Notes; note: Note } {
  const note: Note = { ...build(text, [], at), due };
  return { store: { notes: [...store.notes, note] }, note };
}

export function deleteNote(store: Notes, id: string): Notes {
  return { notes: store.notes.filter((n) => n.id !== id) };
}

/**
 * Finds notes by keyword, newest first.
 *
 * An empty query lists everything rather than nothing: "what notes do I have" is the most
 * obvious way to ask, and answering it with nothing would be perverse.
 */
export function searchNotes(store: Notes, query: string, limit = MAX_RESULTS): Note[] {
  const terms = keywords(query);
  const newestFirst = (a: Note, b: Note): number => b.at - a.at;

  if (terms.size === 0) return [...store.notes].sort(newestFirst).slice(0, limit);

  const scored = store.notes
    .map((note) => {
      const haystack = new Set([...note.tags, ...words(note.text)]);
      let hits = 0;
      for (const term of terms) if (haystack.has(term)) hits++;
      return { note, hits };
    })
    .filter((r) => r.hits > 0);

  return scored
    .sort((a, b) => b.hits - a.hits || newestFirst(a.note, b.note))
    .slice(0, limit)
    .map((r) => r.note);
}

/** Reminders that are due and have not fired. The only thing the timer needs to ask. */
export function dueNow(store: Notes, now = Date.now()): Note[] {
  return store.notes
    .filter((n) => n.due !== undefined && n.firedAt === undefined && n.due <= now)
    .sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
}

/** Reminders still ahead, soonest first. What she should say when asked what is coming up. */
export function upcoming(store: Notes, now = Date.now()): Note[] {
  return store.notes
    .filter((n) => n.due !== undefined && n.firedAt === undefined && n.due > now)
    .sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
}

export function markFired(store: Notes, ids: readonly string[], at = Date.now()): Notes {
  const set = new Set(ids);
  return { notes: store.notes.map((n) => (set.has(n.id) ? { ...n, firedAt: at } : n)) };
}

/**
 * When the next reminder is due, or null.
 *
 * Used to schedule a single timer rather than polling: a permanent one-second interval is
 * exactly the kind of idle work ADR 0001's CPU bar exists to keep out.
 */
export function nextDue(store: Notes, now = Date.now()): number | null {
  const next = upcoming(store, now)[0];
  return next?.due ?? null;
}

/** Same rule as everything else that reads a file: degrade, never propagate a shape. */
export function coerceNotes(stored: unknown): Notes {
  if (stored === null || typeof stored !== 'object') return { notes: [] };
  const raw = (stored as { notes?: unknown }).notes;
  if (!Array.isArray(raw)) return { notes: [] };

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

  return {
    notes: raw
      .map((n) => n as Partial<Note>)
      .filter((n) => typeof n.text === 'string' && n.text.trim() !== '')
      .map((n) => ({
        id: str(n.id) || newNoteId(),
        text: str(n.text),
        tags: Array.isArray(n.tags) ? n.tags.map(str).filter((t) => t !== '') : [],
        at: num(n.at) ?? 0,
        ...(num(n.due) === undefined ? {} : { due: num(n.due)! }),
        ...(num(n.firedAt) === undefined ? {} : { firedAt: num(n.firedAt)! }),
      })),
  };
}
