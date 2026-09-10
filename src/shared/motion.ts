/**
 * How Navi moves: the maths of following the cursor and of flying to a coordinate.
 *
 * Pure and free of Electron imports, like the rest of `shared/`, so every decision about where
 * she should be is testable without a display. The window call that acts on it is
 * `main/follow.ts`.
 *
 * Ported from the Godot build's `FollowController.gd`, now deleted (NAV-105), with one deliberate
 * change — see `ease`.
 */

import type { Point, Size } from './geometry.js';

/**
 * Where she sits relative to the cursor: down-right of it, as in the Godot build.
 *
 * This is the window's top-left, not her body. Her body is the middle of a 200px window, so at
 * this offset she floats clear of the cursor rather than under it, which is what keeps her out
 * of the way of the thing you are pointing at.
 */
export const FOLLOW_OFFSET: Point = { x: 20, y: 20 };

/** Godot's `lerp_speed`. Higher is snappier; 6 is the value the app has always had. */
export const LERP_SPEED = 6;

/** Under half a pixel is under the rounding, so it is arrival. */
export const SETTLE_PX = 0.5;

/** The window's top-left for a given cursor position. */
export function followTarget(cursor: Point, offset: Point = FOLLOW_OFFSET): Point {
  return { x: cursor.x + offset.x, y: cursor.y + offset.y };
}

/** The window's top-left that puts its centre — her body — on `point`. */
export function centreOn(point: Point, size: Size): Point {
  return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
}

/**
 * One step of easing towards a target.
 *
 * Godot used `pos.lerp(target, lerp_speed * delta)`, which is frame-rate dependent: the same
 * `lerp_speed` gives different motion at 30fps and 60fps, and a dropped frame changes the
 * shape of the movement. `1 - exp(-speed * dt)` is the frame-rate independent form of the same
 * curve — at 60fps the two agree to within half a percent, and unlike the original it does not
 * overshoot when a slow frame pushes `speed * delta` past 1.
 *
 * Keep it eased. Snapping her to the cursor is a different and worse product: she is a fairy
 * following you, not a second cursor.
 */
export function ease(from: Point, to: Point, dtMs: number, speed = LERP_SPEED): Point {
  const t = 1 - Math.exp(-speed * (Math.max(0, dtMs) / 1000));
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Whether she has arrived, within a rounding error. */
export function settled(a: Point, b: Point, epsilon = SETTLE_PX): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}
