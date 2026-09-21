/**
 * Where the calendar refresh token actually lives (NAV-108).
 *
 * Not `settings.json`, which the settings window round-trips freely and which NAV-81 already
 * proved can end up somewhere it shouldn't. `safeStorage` is Keychain-backed on macOS and ships
 * with Electron, so this is the only file that needed a new capability to satisfy "not in
 * settings.json, and not a new native module" at once.
 */

import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CalendarTokenStore, CalendarTokens } from './calendar-connection.js';

function file(): string {
  return join(app.getPath('userData'), 'calendar-token.bin');
}

function isTokens(value: unknown): value is CalendarTokens {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['refreshToken'] === 'string' && typeof v['accessToken'] === 'string' && typeof v['expiresAt'] === 'number';
}

export function createCalendarTokenStore(): CalendarTokenStore {
  return {
    load(): CalendarTokens | null {
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        const parsed: unknown = JSON.parse(safeStorage.decryptString(readFileSync(file())));
        return isTokens(parsed) ? parsed : null;
      } catch {
        // Missing file (never connected, or already disconnected) or a blob this OS account
        // can't decrypt (a settings folder copied to another machine) both mean: not connected.
        return null;
      }
    },

    save(tokens: CalendarTokens): void {
      if (!safeStorage.isEncryptionAvailable()) {
        // No OS keychain to hand it to — refusing to write it in the clear instead.
        console.warn('calendar: no OS keychain available; the token was not saved');
        return;
      }
      mkdirSync(dirname(file()), { recursive: true });
      writeFileSync(file(), safeStorage.encryptString(JSON.stringify(tokens)));
    },

    clear(): void {
      try {
        unlinkSync(file());
      } catch {
        // Already gone is the common case: disconnecting twice, or disconnecting having never connected.
      }
    },
  };
}
