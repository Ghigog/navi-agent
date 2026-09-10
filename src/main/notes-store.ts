/**
 * Note persistence (NAV-100).
 *
 * Its own file again, and for a sharper reason than the others: `memory.json` is consolidated
 * and decayed, and notes must never be. These are the user's own words, saved because they
 * asked, and a note that vanished because a schedule thought it was stale would be a bug
 * wearing the clothes of a feature.
 *
 * Every write reaches disk immediately. A reminder that only exists in memory is not a
 * reminder — she is asked to remember something and the process is killed, and the promise
 * should hold.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { coerceNotes, type Notes } from '../shared/notes.js';

let cached: Notes | null = null;

function file(): string {
  return join(app.getPath('userData'), 'notes.json');
}

export function load(): Notes {
  if (cached) return cached;
  try {
    cached = coerceNotes(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    cached = { notes: [] };
  }
  console.log(`notes loaded: ${cached.notes.length}`);
  return cached;
}

export function save(next: Notes): Notes {
  cached = next;
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
