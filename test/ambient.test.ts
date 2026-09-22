/**
 * The presence controls (NAV-113): the one-click pause reaching the modules it is meant to stop,
 * and the statement that has to be in the panel rather than a footnote.
 *
 * `shared/settings.ts#ambientEnabled` and `shared/interruption.ts#quietHoursFrom` are pure
 * derivations of Settings; this file is where they meet the modules NAV-117 and NAV-109 already
 * built with an injectable `enabled()` for exactly this purpose, so pausing is proven here against
 * the real production modules rather than a stand-in.
 */

import { describe, expect, it } from 'vitest';
import { createCalendarSync, type FetchPage } from '../src/main/calendar-sync.js';
import { createActivitySignal } from '../src/main/activity-signal.js';
import { EMPTY_CACHE, type CommitmentCache } from '../src/shared/calendar.js';
import { ambientEnabled, DEFAULTS, type Settings } from '../src/shared/settings.js';
import { AMBIENT_CAPTURE_STATEMENT } from '../src/shared/ambient.js';
import type { AppInfo } from '../src/shared/ui-protocol.js';

const NOW = new Date(2026, 8, 22, 10, 0).getTime();

/** A hand-driven clock and timer, the same shape `calendar-sync.test.ts` and `activity-signal.test.ts` already use. */
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
    armed: () => pending,
    async fire(): Promise<void> {
      if (pending === null) return;
      t = pending.at;
      const fn = pending.fn;
      pending = null;
      fn();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('AMBIENT_CAPTURE_STATEMENT', () => {
  it('says plainly that this is unprompted and that it can leave the machine', () => {
    expect(AMBIENT_CAPTURE_STATEMENT).toMatch(/without you asking/i);
    expect(AMBIENT_CAPTURE_STATEMENT).toMatch(/cloud/i);
    expect(AMBIENT_CAPTURE_STATEMENT).toMatch(/leave this machine/i);
  });
});

describe('the one-click pause (NAV-113), verified by request log', () => {
  it('stops calendar reads when ambientPaused is on, connected or not', async () => {
    const settings: Settings = { ...DEFAULTS, ambientPaused: true };
    let connected = true;
    const requests: string[] = [];
    let current: CommitmentCache = EMPTY_CACHE;
    const c = clock();

    const sync = createCalendarSync({
      read: () => current,
      write: (next) => {
        current = next;
      },
      ensureAccessToken: async () => 'access-1',
      enabled: () => connected && ambientEnabled(settings),
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      fetchPage: async (accessToken, syncToken): Promise<FetchPage> => {
        requests.push(`${accessToken}:${syncToken ?? 'full'}`);
        return { status: 'ok', events: [], nextSyncToken: 'tok-1' };
      },
    });

    await sync.refreshNow();
    expect(requests).toEqual([]);

    // Unpausing, still connected, lets the very same call through — proving the empty log above
    // was the pause and not something else about the fixture.
    settings.ambientPaused = false;
    await sync.refreshNow();
    expect(requests).toEqual(['access-1:full']);
  });

  it('stops the activity signal from reading the foreground app at all, not merely from acting on it', async () => {
    const settings: Settings = { ...DEFAULTS, ambientPaused: true, noticeActivity: true };
    const app: AppInfo = { bundleId: 'com.apple.Terminal', name: 'Terminal' };
    let reads = 0;
    const c = clock();

    const signal = createActivitySignal({
      frontmostApp: async () => {
        reads++;
        return app;
      },
      onChange: () => undefined,
      enabled: () => ambientEnabled(settings) && settings.noticeActivity,
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });

    signal.start();
    await c.fire();
    expect(reads).toBe(0);
    signal.stop();
  });

  it('with nothing connected, a calendar sync that is not paused still makes no request', async () => {
    const settings: Settings = { ...DEFAULTS, ambientPaused: false };
    const requests: string[] = [];
    let current: CommitmentCache = EMPTY_CACHE;
    const c = clock();

    const sync = createCalendarSync({
      read: () => current,
      write: (next) => {
        current = next;
      },
      ensureAccessToken: async () => 'access-1',
      // No calendar connected — the other half of "connected AND not paused" `main/index.ts` wires.
      enabled: () => false && ambientEnabled(settings),
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      fetchPage: async (accessToken, syncToken): Promise<FetchPage> => {
        requests.push(`${accessToken}:${syncToken ?? 'full'}`);
        return { status: 'ok', events: [], nextSyncToken: 'tok-1' };
      },
    });

    await sync.refreshNow();
    expect(requests).toEqual([]);
  });

  it("the watch list — noticeActivity off — stops the signal even when nothing else is paused", async () => {
    const settings: Settings = { ...DEFAULTS, ambientPaused: false, noticeActivity: false };
    let reads = 0;
    const c = clock();

    const signal = createActivitySignal({
      frontmostApp: async () => {
        reads++;
        return null;
      },
      onChange: () => undefined,
      enabled: () => ambientEnabled(settings) && settings.noticeActivity,
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    });

    signal.start();
    await c.fire();
    expect(reads).toBe(0);
    signal.stop();
  });
});
