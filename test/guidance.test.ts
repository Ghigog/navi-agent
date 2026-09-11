import { describe, expect, it, vi } from 'vitest';
import { ADVANCE_TIMEOUT_MS, createGuidance, GUIDANCE_PAUSE, type GuidanceFollow } from '../src/main/guidance.js';
import type { Point } from '../src/shared/geometry.js';

/** A `Follow` reduced to what guidance needs, driven by hand so a run plays out with no clock. */
function fakeFollow() {
  const flights: Point[] = [];
  const paused = new Set<string>();
  let landNext: (() => void) | null = null;

  const follow: GuidanceFollow = {
    flyTo: (point) => {
      flights.push(point);
      return new Promise((resolve) => {
        landNext = resolve;
      });
    },
    setPaused: (reason, on) => {
      if (on) paused.add(reason);
      else paused.delete(reason);
    },
    abort: () => {
      landNext?.();
      landNext = null;
    },
  };

  return {
    follow,
    flights,
    paused,
    /** Lands whichever flight is currently in progress. */
    land: () => {
      landNext?.();
      landNext = null;
    },
  };
}

/** A controllable timer, so the backstop can be fired by hand rather than waited out. */
function fakeTimers() {
  let id = 0;
  const pending = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => {
      const handle = ++id;
      pending.set(handle, fn);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle: unknown) => {
      pending.delete(handle as number);
    },
    fire: (handle: unknown) => {
      const fn = pending.get(handle as number);
      pending.delete(handle as number);
      fn?.();
    },
    pendingCount: () => pending.size,
  };
}

const STEPS = [
  { text: 'Open Settings', point: { x: 100, y: 100 } },
  { text: 'Click Advanced', point: { x: 200, y: 200 } },
];

/**
 * Drains the microtask queue. `land()` and `advance()` resolve a promise the guidance loop is
 * awaiting; the loop's next move — the next `onStep`, or calling `flyTo` again — only happens a
 * tick later, so every land/advance in these tests is followed by this before asserting on it or
 * driving the next step.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createGuidance', () => {
  it('flies to each step in order, waiting for the user between them', async () => {
    const f = fakeFollow();
    const timers = fakeTimers();
    const steps: Array<{ index: number; total: number; text: string }> = [];
    const guide = createGuidance({ follow: f.follow, onStep: (s) => steps.push(s), setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const run = guide.run(STEPS);

    f.land();
    await flush();
    expect(f.flights).toEqual([{ x: 100, y: 100 }]);
    expect(steps).toEqual([{ index: 0, total: 2, text: 'Open Settings' }]);

    guide.advance();
    await flush();
    f.land();
    await flush();
    expect(f.flights).toEqual([{ x: 100, y: 100 }, { x: 200, y: 200 }]);
    expect(steps[1]).toEqual({ index: 1, total: 2, text: 'Click Advanced' });

    guide.advance();
    expect(await run).toEqual({ shown: 2 });
  });

  it('pauses following for the run and restores it once done, under the guidance reason', async () => {
    const f = fakeFollow();
    const timers = fakeTimers();
    const guide = createGuidance({ follow: f.follow, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const run = guide.run(STEPS.slice(0, 1));
    expect(f.paused.has(GUIDANCE_PAUSE)).toBe(true);

    f.land();
    await flush();
    guide.advance();
    await run;

    expect(f.paused.has(GUIDANCE_PAUSE)).toBe(false);
  });

  it('advances on the backstop timeout when nobody responds', async () => {
    const f = fakeFollow();
    const timers = fakeTimers();
    const guide = createGuidance({ follow: f.follow, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const run = guide.run(STEPS.slice(0, 1));
    f.land();
    await flush();

    expect(timers.pendingCount()).toBe(1);
    timers.fire(1);

    expect(await run).toEqual({ shown: 1 });
  });

  it('uses a generous default backstop rather than a pace-setting one', () => {
    // The Godot behaviour this replaces auto-advanced on a short timer, which was the bug
    // NAV-106 exists to not repeat. A default under several seconds would be that bug again.
    expect(ADVANCE_TIMEOUT_MS).toBeGreaterThan(5000);
  });

  it('ends early on abort, mid-flight, and restores following', async () => {
    const f = fakeFollow();
    const timers = fakeTimers();
    const stopped = vi.fn();
    const ended = vi.fn();
    const guide = createGuidance({
      follow: f.follow,
      stopSpeaking: stopped,
      onEnd: ended,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    const run = guide.run(STEPS);
    guide.abort();

    expect(await run).toEqual({ shown: 0 });
    expect(f.paused.has(GUIDANCE_PAUSE)).toBe(false);
    expect(stopped).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
    expect(guide.active()).toBe(false);
  });

  it('ends early on abort while waiting between steps, without flying to the next one', async () => {
    const f = fakeFollow();
    const timers = fakeTimers();
    const guide = createGuidance({ follow: f.follow, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    const run = guide.run(STEPS);
    f.land();
    await flush();
    expect(f.flights).toHaveLength(1);

    guide.abort();
    expect(await run).toEqual({ shown: 1 });
    expect(f.flights).toHaveLength(1);
  });

  it('speaks each step once it is reached, and stops speaking on abort', async () => {
    const f = fakeFollow();
    const timers = fakeTimers();
    const spoken: string[] = [];
    const stopped = vi.fn();
    const guide = createGuidance({
      follow: f.follow,
      speak: (text) => spoken.push(text),
      stopSpeaking: stopped,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    const run = guide.run(STEPS);
    f.land();
    await flush();
    expect(spoken).toEqual(['Open Settings']);

    guide.abort();
    await run;
    expect(stopped).toHaveBeenCalledOnce();
  });

  it('reports nothing shown and ends cleanly for an empty sequence', async () => {
    const f = fakeFollow();
    const ended = vi.fn();
    const guide = createGuidance({ follow: f.follow, onEnd: ended });

    expect(await guide.run([])).toEqual({ shown: 0 });
    expect(f.flights).toHaveLength(0);
    expect(ended).toHaveBeenCalledOnce();
  });

  it('is not active before a run and not active once it ends', async () => {
    const f = fakeFollow();
    const timers = fakeTimers();
    const guide = createGuidance({ follow: f.follow, setTimer: timers.setTimer, clearTimer: timers.clearTimer });

    expect(guide.active()).toBe(false);
    const run = guide.run(STEPS.slice(0, 1));
    expect(guide.active()).toBe(true);

    f.land();
    await flush();
    guide.advance();
    await run;
    expect(guide.active()).toBe(false);
  });

  it('does nothing when advanced or aborted with no run in progress', () => {
    const f = fakeFollow();
    const guide = createGuidance({ follow: f.follow });
    expect(() => guide.advance()).not.toThrow();
    expect(() => guide.abort()).not.toThrow();
  });
});
