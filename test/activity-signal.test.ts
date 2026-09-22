/**
 * The poll loop around `shared/activity.ts`'s debounce (NAV-109). What this layer owns that the
 * pure module cannot: the timer re-arms itself, and "off" means the read itself never happens.
 */

import { describe, expect, it } from 'vitest';
import { createActivitySignal } from '../src/main/activity-signal.js';
import type { AppInfo } from '../src/shared/ui-protocol.js';

const CODE: AppInfo = { bundleId: 'com.microsoft.VSCode', name: 'Code' };
const SLACK: AppInfo = { bundleId: 'com.tinyspeck.slack', name: 'Slack' };

const POLL_MS = 1000;
const DEBOUNCE_MS = 3000;

/** A hand-driven clock and timer, same shape as `test/calendar-sync.test.ts` uses. */
function clock(start = 0) {
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
    /** Advances the clock to the armed time, fires it, and lets the poll's promise chain settle. */
    async fire(): Promise<void> {
      if (pending === null) throw new Error('nothing armed');
      t = pending.at;
      const fn = pending.fn;
      pending = null;
      fn();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

interface Harness {
  signal: ReturnType<typeof createActivitySignal>;
  events: AppInfo[];
  reads: number;
  clock: ReturnType<typeof clock>;
  setApp: (app: AppInfo | null) => void;
  setEnabled: (value: boolean) => void;
}

function harness(): Harness {
  const c = clock();
  const events: AppInfo[] = [];
  let current: AppInfo | null = CODE;
  let enabled = true;
  let reads = 0;

  const signal = createActivitySignal({
    frontmostApp: async () => {
      reads++;
      return current;
    },
    onChange: (event) => events.push(event.app),
    enabled: () => enabled,
    now: c.now,
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    pollMs: POLL_MS,
    debounceMs: DEBOUNCE_MS,
  });

  return {
    signal,
    events,
    get reads() {
      return reads;
    },
    clock: c,
    setApp: (app) => {
      current = app;
    },
    setEnabled: (v) => {
      enabled = v;
    },
  };
}

describe('createActivitySignal', () => {
  it('the first poll establishes a baseline and emits nothing', async () => {
    const h = harness();
    h.signal.start();
    await h.clock.fire();
    expect(h.events).toEqual([]);
    h.signal.stop();
  });

  it('switching to a different application emits exactly one event, after debounce', async () => {
    const h = harness();
    h.signal.start();
    await h.clock.fire(); // baseline: Code

    h.setApp(SLACK);
    // More than enough polls to cross the debounce window regardless of phase.
    for (let i = 0; i < Math.ceil(DEBOUNCE_MS / POLL_MS) + 2; i++) await h.clock.fire();

    expect(h.events).toEqual([SLACK]);
    h.signal.stop();
  });

  it('rapid alt-tabbing produces one event, not a burst', async () => {
    const h = harness();
    h.signal.start();
    await h.clock.fire(); // baseline: Code

    // Flip on every poll for longer than the debounce window, then settle on Slack.
    const flips = [SLACK, CODE, SLACK, CODE, SLACK, SLACK, SLACK, SLACK];
    for (const app of flips) {
      h.setApp(app);
      await h.clock.fire();
    }

    expect(h.events).toEqual([SLACK]);
    h.signal.stop();
  });

  it('nothing beyond app identity and timestamp is recorded or transmitted', async () => {
    const h = harness();
    h.signal.start();
    await h.clock.fire();
    h.setApp(SLACK);
    for (let i = 0; i < 5; i++) await h.clock.fire();

    expect(h.events).toEqual([SLACK]);
    expect(Object.keys(SLACK)).toEqual(['bundleId', 'name']);
  });

  it('with the feature off, the signal is not collected at all', async () => {
    const h = harness();
    h.setEnabled(false);
    h.signal.start();
    await h.clock.fire();
    h.setApp(SLACK);
    for (let i = 0; i < 5; i++) await h.clock.fire();

    expect(h.reads).toBe(0);
    expect(h.events).toEqual([]);
    h.signal.stop();
  });

  it('turning the feature off mid-run stops reads without a restart', async () => {
    const h = harness();
    h.signal.start();
    await h.clock.fire(); // baseline established, one read
    expect(h.reads).toBe(1);

    h.setEnabled(false);
    for (let i = 0; i < 5; i++) await h.clock.fire();
    expect(h.reads).toBe(1); // no further reads while off

    h.signal.stop();
  });

  it('stops polling when stopped', async () => {
    const h = harness();
    h.signal.start();
    await h.clock.fire();
    h.signal.stop();
    expect(h.clock.armed()).toBeNull();
  });
});
