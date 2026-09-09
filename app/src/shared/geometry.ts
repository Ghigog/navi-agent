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

/** How far the chat panel sits from the fairy's body. Close enough to read as hers. */
export const CHAT_GAP = 10;

export interface Size {
  width: number;
  height: number;
}

/**
 * Where the chat panel goes for a given fairy position.
 *
 * Anchored to the fairy's *body* rather than her window: the window is 200px of mostly
 * transparent aura, so measuring from its edge would leave the panel floating ~75px off her
 * with nothing in between.
 *
 * Below her by preference, above her when there is no room below, and always inside the work
 * area — a panel half off the bottom of the screen is a panel whose input box you cannot see.
 * Pure, so the placement is testable without a display (the rest of the window lives in
 * `main/chat-window.ts`, which needs Electron and therefore cannot be).
 */
export function chatBounds(fairy: Bounds, size: Size, workArea: Bounds, radius = INTERACTIVE_RADIUS): Bounds {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  const cx = fairy.x + fairy.width / 2;
  const cy = fairy.y + fairy.height / 2;

  const x = clamp(
    Math.round(cx - size.width / 2),
    workArea.x,
    Math.max(workArea.x, workArea.x + workArea.width - size.width),
  );

  const below = Math.round(cy + radius + CHAT_GAP);
  const above = Math.round(cy - radius - CHAT_GAP - size.height);
  const floor = workArea.y;
  const ceiling = Math.max(workArea.y, workArea.y + workArea.height - size.height);

  const y = below <= ceiling ? below : above >= floor ? above : clamp(below, floor, ceiling);

  return { x, y, width: size.width, height: size.height };
}
