/**
 * Commitment cache persistence (NAV-117).
 *
 * Its own file, per this section's storage decision: `memory.json` is consolidated and decayed,
 * `notes.json` is the user's own words and is never touched by a schedule, and this is neither —
 * it is a local mirror of the user's calendar, entirely rebuilt from Google on the next sync, so
 * losing it costs nothing but a sync token (a full resync recovers it). Unlike the refresh token in
 * `calendar-store.ts`, nothing here is a secret; plain JSON is the same choice `notes-store.ts` and
 * `memory-store.ts` already made.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { coerceCache, EMPTY_CACHE, type CommitmentCache } from '../shared/calendar.js';

let cached: CommitmentCache | null = null;

function file(): string {
  return join(app.getPath('userData'), 'calendar.json');
}

export function load(): CommitmentCache {
  if (cached) return cached;
  try {
    cached = coerceCache(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    cached = EMPTY_CACHE;
  }
  return cached;
}

export function save(next: CommitmentCache): CommitmentCache {
  cached = next;
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** Disconnecting the calendar (NAV-108) leaves nothing derived from it behind, this cache included. */
export function clear(): CommitmentCache {
  cached = EMPTY_CACHE;
  try {
    unlinkSync(file());
  } catch {
    // Already gone: never synced, or already cleared.
  }
  return cached;
}
