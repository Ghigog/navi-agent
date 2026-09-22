/**
 * Outcome log persistence (NAV-115). Its own file, `notes-store.ts`'s pattern exactly: every
 * write reaches disk immediately, because a mute set and then lost on restart — "I told her to
 * stop and she forgot" — is a promise broken silently.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { coerceOutcomeLog, EMPTY_OUTCOME_LOG, type OutcomeLog } from '../shared/outcome-log.js';

let cached: OutcomeLog | null = null;

function file(): string {
  return join(app.getPath('userData'), 'outcome-log.json');
}

export function load(): OutcomeLog {
  if (cached) return cached;
  try {
    cached = coerceOutcomeLog(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    cached = { ...EMPTY_OUTCOME_LOG };
  }
  return cached;
}

export function save(next: OutcomeLog): OutcomeLog {
  cached = next;
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
