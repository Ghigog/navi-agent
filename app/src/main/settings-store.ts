/**
 * Settings persistence. The one place settings reach disk or a log.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { coerce, DEFAULTS, type Settings } from '../shared/settings.js';
import { redact } from '../shared/redact.js';

let cached: Settings | null = null;

function file(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function load(): Settings {
  if (cached) return cached;
  try {
    cached = coerce(JSON.parse(readFileSync(file(), 'utf8')));
  } catch {
    // Missing or unreadable file is the normal first-run case, not an error worth surfacing.
    cached = { ...DEFAULTS };
  }
  // NAV-81: this dictionary contains API keys. It is only ever logged redacted.
  console.log('settings loaded:', redact(cached));
  return cached;
}

export function save(next: Partial<Settings>): Settings {
  cached = { ...load(), ...next };
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(cached, null, 2), 'utf8');
  return cached;
}
