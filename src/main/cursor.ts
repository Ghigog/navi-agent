/**
 * One cursor poll, shared.
 *
 * Click-through and cursor following both need to know where the pointer is, and before this
 * they would have been two intervals sampling at two rates: she would ease towards a position
 * a tenth of a second older or newer than the one deciding whether she takes clicks. One
 * timer, one sample, one answer per tick.
 *
 * Rate matters here rather than being a detail. This is a timer that runs for the whole life
 * of the app, so it is measured against ADR 0001's idle CPU result like everything else, which
 * is why it runs at the configured idle frame rate rather than at whatever looks smooth.
 *
 * No Electron import: `read` is injected, so this runs under test.
 */

import type { Point } from '../shared/geometry.js';

export interface CursorSource {
  /** Called once per tick with the sample and the time it was taken. Returns an unsubscribe. */
  subscribe(fn: (cursor: Point, t: number) => void): () => void;
  /** The most recent sample, for anything that needs the cursor between ticks. */
  current(): Point;
  /** Follows the idle frame rate, so a settings edit moves this too. */
  setRate(fps: number): void;
  stop(): void;
}

export interface CursorOptions {
  read: () => Point;
  fps: number;
  now?: () => number;
}

export function createCursorSource(opts: CursorOptions): CursorSource {
  const now = opts.now ?? (() => Date.now());
  const subscribers = new Set<(cursor: Point, t: number) => void>();

  let latest = opts.read();
  let timer: ReturnType<typeof setInterval> | null = null;
  let fps = opts.fps;

  const tick = (): void => {
    latest = opts.read();
    const t = now();
    // A copy per subscriber would be tidier; one shared frozen-by-convention sample is what
    // makes "they cannot disagree" true rather than merely likely.
    for (const fn of subscribers) fn(latest, t);
  };

  const arm = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(tick, Math.round(1000 / fps));
    // Node keeps the process alive for a pending interval; Electron's main process is kept
    // alive by its windows, and a poll should not be the thing that outlives them.
    timer.unref?.();
  };

  arm();

  return {
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    current: () => latest,
    setRate(next) {
      if (next === fps) return;
      fps = next;
      arm();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      subscribers.clear();
    },
  };
}
