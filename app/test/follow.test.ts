import { describe, expect, it } from 'vitest';
import type { Point } from '../src/shared/geometry.js';
import { createFollow, DEFAULT_HOLD_MS, type FollowWindow } from '../src/main/follow.js';
import type { CursorSource } from '../src/main/cursor.js';
import { FOLLOW_OFFSET } from '../src/shared/motion.js';

const FRAME = 1000 / 60;

/** A cursor source driven by hand, so a whole gesture runs in a few milliseconds of test. */
function fakeCursor(start: Point = { x: 0, y: 0 }) {
  const subscribers = new Set<(p: Point, t: number) => void>();
  let point = start;
  let t = 0;

  const source: CursorSource = {
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    current: () => point,
    setRate: () => {},
    stop: () => subscribers.clear(),
  };

  return {
    source,
    moveTo(p: Point) {
      point = p;
    },
    /** Advances the clock and delivers `frames` ticks. */
    tick(frames = 1) {
      for (let i = 0; i < frames; i++) {
        t += FRAME;
        for (const fn of subscribers) fn(point, t);
      }
    },
  };
}

function fakeWindow(at: Point = { x: 0, y: 0 }) {
  let bounds = { ...at, width: 200, height: 200 };
  let moves = 0;
  return {
    win: {
      getBounds: () => bounds,
      setPosition: (x: number, y: number) => {
        bounds = { ...bounds, x, y };
        moves++;
      },
      isDestroyed: () => false,
    } satisfies FollowWindow,
    at: () => ({ x: bounds.x, y: bounds.y }),
    /** Her body, which is what the user actually sees. */
    body: () => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }),
    moves: () => moves,
    /** Something other than following moved the window. */
    place: (p: Point) => {
      bounds = { ...bounds, ...p };
    },
  };
}

describe('createFollow', () => {
  it('eases towards the cursor rather than snapping to it', () => {
    const cursor = fakeCursor({ x: 0, y: 0 });
    const w = fakeWindow({ x: 0, y: 0 });
    createFollow({ window: w.win, cursor: cursor.source });

    cursor.moveTo({ x: 600, y: 400 });
    cursor.tick(2);

    // Moved, but nowhere near arrived. Snapping her to the cursor is a different and worse
    // product — she is a fairy following you, not a second cursor.
    expect(w.at().x).toBeGreaterThan(0);
    expect(w.at().x).toBeLessThan(200);
  });

  it('arrives at the follow offset and stops', () => {
    const cursor = fakeCursor({ x: 0, y: 0 });
    const w = fakeWindow({ x: 0, y: 0 });
    createFollow({ window: w.win, cursor: cursor.source });

    cursor.moveTo({ x: 600, y: 400 });
    cursor.tick(120);

    expect(w.at()).toEqual({ x: 600 + FOLLOW_OFFSET.x, y: 400 + FOLLOW_OFFSET.y });
  });

  it('costs no window call once the cursor is still and she has caught up', () => {
    // The reason this matters is ADR 0001: a per-frame window move sits on top of the weakest
    // measurement in the port, so an idle desktop must cost nothing at all.
    const cursor = fakeCursor({ x: 100, y: 100 });
    const w = fakeWindow({ x: 0, y: 0 });
    createFollow({ window: w.win, cursor: cursor.source });

    cursor.tick(200);
    const settled = w.moves();
    cursor.tick(200);

    expect(w.moves()).toBe(settled);
  });

  it('stands still while the chat window is open, and catches up after', () => {
    const cursor = fakeCursor({ x: 100, y: 100 });
    const w = fakeWindow({ x: 0, y: 0 });
    const follow = createFollow({ window: w.win, cursor: cursor.source });

    cursor.tick(200);
    const parked = w.at();

    follow.setPaused('chat', true);
    cursor.moveTo({ x: 900, y: 700 });
    cursor.tick(200);
    // The panel is placed against her once, on open. A fairy who kept walking would leave it
    // behind — or drag it around while you are typing into it.
    expect(w.at()).toEqual(parked);
    expect(follow.isFollowing()).toBe(false);

    follow.setPaused('chat', false);
    cursor.tick(200);
    expect(w.at()).toEqual({ x: 920, y: 720 });
  });

  it('flies her body onto the point, holds, then follows again', async () => {
    const cursor = fakeCursor({ x: 0, y: 0 });
    const w = fakeWindow({ x: 0, y: 0 });
    const follow = createFollow({ window: w.win, cursor: cursor.source });

    let landed = false;
    const flight = follow.flyTo({ x: 800, y: 600 }).then(() => {
      landed = true;
    });

    cursor.tick(120);
    // Her body, not her window corner: flying the corner there points 100px past the target.
    expect(w.body()).toEqual({ x: 800, y: 600 });
    expect(follow.isFlying()).toBe(true);

    // She holds the position she is pointing at. A pointer that leaves before you have looked
    // at it has not pointed at anything.
    await Promise.resolve();
    expect(landed).toBe(false);

    cursor.tick(Math.ceil(DEFAULT_HOLD_MS / FRAME) + 2);
    await flight;
    expect(follow.isFollowing()).toBe(true);

    cursor.moveTo({ x: 100, y: 100 });
    cursor.tick(200);
    expect(w.at()).toEqual({ x: 120, y: 120 });
  });

  it('flies even while the chat window is open', async () => {
    // Pointing at something is most useful exactly when you are mid-conversation about it,
    // which is the pause that would otherwise swallow the gesture.
    const cursor = fakeCursor({ x: 0, y: 0 });
    const w = fakeWindow({ x: 0, y: 0 });
    const follow = createFollow({ window: w.win, cursor: cursor.source });
    follow.setPaused('chat', true);

    const flight = follow.flyTo({ x: 800, y: 600 }, { hold: 0 });
    cursor.tick(120);
    await flight;

    expect(w.body()).toEqual({ x: 800, y: 600 });
  });

  it('lets a second flight replace the first', async () => {
    const cursor = fakeCursor({ x: 0, y: 0 });
    const w = fakeWindow({ x: 0, y: 0 });
    const follow = createFollow({ window: w.win, cursor: cursor.source });

    const first = follow.flyTo({ x: 800, y: 600 });
    cursor.tick(10);
    const second = follow.flyTo({ x: 200, y: 200 });

    // The first resolves rather than hanging: a caller awaiting a gesture the user has moved
    // on from should be released, not left holding a promise nobody will settle.
    await first;
    cursor.tick(120);
    expect(w.body()).toEqual({ x: 200, y: 200 });

    follow.abort();
    await second;
  });

  it('abort ends a flight early and restores following', async () => {
    const cursor = fakeCursor({ x: 100, y: 100 });
    const w = fakeWindow({ x: 0, y: 0 });
    const follow = createFollow({ window: w.win, cursor: cursor.source });

    const flight = follow.flyTo({ x: 900, y: 700 });
    cursor.tick(5);
    follow.abort();
    await flight;

    expect(follow.isFollowing()).toBe(true);
    cursor.tick(300);
    expect(w.at()).toEqual({ x: 120, y: 120 });
  });

  it('eases from where she actually is when something else moves the window', () => {
    const cursor = fakeCursor({ x: 100, y: 100 });
    const w = fakeWindow({ x: 0, y: 0 });
    createFollow({ window: w.win, cursor: cursor.source });

    cursor.tick(200);
    w.place({ x: 50, y: 50 });
    cursor.tick(1);

    // Easing from the position we last set rather than the one she is at would teleport her
    // back the moment the next frame ran.
    expect(w.at().x).toBeGreaterThan(50);
    expect(w.at().x).toBeLessThan(80);
  });

  it('stops moving her once stopped', () => {
    const cursor = fakeCursor({ x: 500, y: 500 });
    const w = fakeWindow({ x: 0, y: 0 });
    const follow = createFollow({ window: w.win, cursor: cursor.source });

    follow.stop();
    cursor.tick(200);
    expect(w.at()).toEqual({ x: 0, y: 0 });
  });
});
