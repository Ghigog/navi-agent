import { describe, expect, it } from 'vitest';
import {
  centreOn,
  ease,
  followTarget,
  FOLLOW_OFFSET,
  LERP_SPEED,
  settled,
} from '../src/shared/motion.js';

describe('followTarget', () => {
  it('places her down-right of the cursor, as the Godot build did', () => {
    expect(followTarget({ x: 400, y: 300 })).toEqual({ x: 420, y: 320 });
    expect(FOLLOW_OFFSET).toEqual({ x: 20, y: 20 });
  });
});

describe('centreOn', () => {
  it('puts her body on the point, not her window corner', () => {
    // The window is 200px of mostly transparent aura. Flying its top-left to the target would
    // leave her body 100px down and right of the thing she is pointing at.
    expect(centreOn({ x: 600, y: 400 }, { width: 200, height: 200 })).toEqual({ x: 500, y: 300 });
  });
});

describe('ease', () => {
  it('moves towards the target without reaching it in one step', () => {
    const next = ease({ x: 0, y: 0 }, { x: 100, y: 100 }, 1000 / 60);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(100);
    expect(next.y).toBe(next.x);
  });

  it('agrees with Godot’s lerp at 60fps', () => {
    // FollowController.gd: pos.lerp(target, lerp_speed * delta) — 6 * 1/60 = 0.1 of the way.
    const godot = 0.1 * 100;
    const ours = ease({ x: 0, y: 0 }, { x: 100, y: 0 }, 1000 / 60).x;
    expect(Math.abs(ours - godot)).toBeLessThan(0.6);
  });

  it('covers the same ground per second whatever the frame rate', () => {
    // This is the change from Godot's form. `lerp_speed * delta` makes the motion depend on how
    // often it is called, so the same fairy moved differently at 30fps and 60fps and a dropped
    // frame changed the shape of the curve.
    const run = (fps: number): number => {
      let p = { x: 0, y: 0 };
      for (let i = 0; i < fps; i++) p = ease(p, { x: 100, y: 0 }, 1000 / fps);
      return p.x;
    };
    expect(Math.abs(run(30) - run(120))).toBeLessThan(0.01);
  });

  it('never overshoots, however slow the frame', () => {
    // Godot's form does: at delta > 1/lerp_speed the factor passes 1 and she flies past the
    // cursor and comes back. A stalled main process is exactly when that happens.
    const next = ease({ x: 0, y: 0 }, { x: 100, y: 0 }, 10_000, LERP_SPEED);
    expect(next.x).toBeLessThanOrEqual(100);
    expect(next.x).toBeGreaterThan(99.9);
  });

  it('stands still for a zero or negative frame', () => {
    expect(ease({ x: 5, y: 5 }, { x: 100, y: 100 }, 0)).toEqual({ x: 5, y: 5 });
    expect(ease({ x: 5, y: 5 }, { x: 100, y: 100 }, -16)).toEqual({ x: 5, y: 5 });
  });
});

describe('settled', () => {
  it('is true within a rounding error and false outside it', () => {
    expect(settled({ x: 10.2, y: 10.2 }, { x: 10, y: 10 })).toBe(true);
    expect(settled({ x: 10.6, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });
});
