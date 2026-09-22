/**
 * Leave-by note persistence (NAV-114).
 *
 * Its own file, not `notes.json`: these are calendar-derived, not the user's own words, and
 * NAV-113's "delete this section's data" needs to clear them without touching a note the user
 * actually wrote. Reuses the `Notes`/`Note` shape purely because `main/reminders.ts` already
 * knows how to arm, sweep and fire it — nothing stored here is shown in the notes viewer.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { coerceNotes, EMPTY_NOTES, type Notes } from '../shared/notes.js';

let cached: Notes | null = null;

function file(): string {
  return join(app.getPath('userData'), 'leave-by.json');
}

export function load(): Notes {
  if (cached) return cached;
  try {
    cached = coerceNotes(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    cached = { notes: [] };
  }
  return cached;
}

export function save(next: Notes): Notes {
  cached = next;
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** Disconnecting the calendar (NAV-108) leaves nothing derived from it behind, this store included. */
export function clear(): Notes {
  cached = EMPTY_NOTES;
  try {
    unlinkSync(file());
  } catch {
    // Already gone: never armed, or already cleared.
  }
  return cached;
}
