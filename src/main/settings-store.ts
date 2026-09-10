/**
 * Settings persistence. The one place settings reach disk or a log.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyUpdate, coerce, DEFAULTS, type Settings } from '../shared/settings.js';
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

/**
 * Writes a patch from the settings window.
 *
 * It goes through `applyUpdate` rather than a spread: this is an IPC boundary, so the patch is
 * a value someone typed and not a `Settings` however it is declared. Keys the patch omits keep
 * what is stored, which is what lets a window that never sees the API key save without
 * destroying it.
 */
export function save(next: unknown): Settings {
  cached = applyUpdate(load(), next);
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(cached, null, 2), 'utf8');
  return cached;
}
