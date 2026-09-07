/**
 * Pure geometry, deliberately free of Electron imports so it is testable without a display
 * server or a downloaded Electron binary.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The fairy's visible body is a small core in the middle of a 200px window that is otherwise
 * transparent aura. Treating the whole window as interactive would drag a 200px dead zone
 * around the desktop behind the cursor.
 */
export const INTERACTIVE_RADIUS = 46;

export function isOverFairy(cursor: Point, bounds: Bounds, radius = INTERACTIVE_RADIUS): boolean {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return Math.hypot(cursor.x - cx, cursor.y - cy) <= radius;
}
