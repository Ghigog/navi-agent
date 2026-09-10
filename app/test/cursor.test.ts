import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCursorSource } from '../src/main/cursor.js';
import type { Point } from '../src/shared/geometry.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function source(fps = 30) {
  let point: Point = { x: 0, y: 0 };
  let reads = 0;
  const cursor = createCursorSource({
    read: () => {
      reads++;
      return point;
    },
    fps,
  });
  return {
    cursor,
    moveTo: (p: Point) => {
      point = p;
    },
    reads: () => reads,
  };
}

describe('createCursorSource', () => {
  it('hands every subscriber the same sample', () => {
    // The whole point of one poll: click-through and following cannot disagree about where the
    // cursor is, because there is only one answer per tick.
    const s = source();
    const seen: Point[] = [];
    s.cursor.subscribe((p) => seen.push(p));
    s.cursor.subscribe((p) => seen.push(p));

    s.moveTo({ x: 12, y: 34 });
    vi.advanceTimersByTime(1000 / 30);

    expect(seen).toEqual([
      { x: 12, y: 34 },
      { x: 12, y: 34 },
    ]);
    // One read for two readers, plus the one at construction.
    expect(s.reads()).toBe(2);
    s.cursor.stop();
  });

  it('ticks at the configured rate', () => {
    const s = source(30);
    let ticks = 0;
    s.cursor.subscribe(() => ticks++);

    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(30);
    s.cursor.stop();
  });

  it('changes rate in place, for a settings edit', () => {
    // The idle frame rate is an ADR 0001 mitigation rather than a preference, and this timer
    // runs for the life of the app, so it moves with it.
    const s = source(30);
    let ticks = 0;
    s.cursor.subscribe(() => ticks++);

    s.cursor.setRate(10);
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(10);
    s.cursor.stop();
  });

  it('reports the latest sample between ticks', () => {
    const s = source();
    s.moveTo({ x: 5, y: 5 });
    vi.advanceTimersByTime(1000 / 30);
    expect(s.cursor.current()).toEqual({ x: 5, y: 5 });
    s.cursor.stop();
  });

  it('stops polling when stopped', () => {
    const s = source();
    let ticks = 0;
    s.cursor.subscribe(() => ticks++);

    s.cursor.stop();
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(0);
  });

  it('unsubscribing leaves the others running', () => {
    const s = source();
    let a = 0;
    let b = 0;
    const off = s.cursor.subscribe(() => a++);
    s.cursor.subscribe(() => b++);

    off();
    vi.advanceTimersByTime(1000 / 30);
    expect(a).toBe(0);
    expect(b).toBe(1);
    s.cursor.stop();
  });
});
