/**
 * Click-through, driven from outside the window.
 *
 * A window in click-through mode cannot receive keystrokes — that is what click-through means —
 * so a binding inside the window can turn it on and never turn it off. The spike hit this and
 * ADR 0001 records it as a constraint on the design.
 *
 * So the default is click-through ON, and it is disabled only while the OS cursor is actually
 * over the fairy. Nothing about that decision runs inside the renderer.
 */

import type { BrowserWindow } from 'electron';
import { screen } from 'electron';

/** How often to check whether the cursor is over the fairy. */
const POLL_MS = 100;

/**
 * The fairy's visible body is a small core in the middle of a 200px window that is mostly
 * transparent aura. Taking clicks across the whole window would make a 200px dead zone follow
 * the cursor around the desktop.
 */
const INTERACTIVE_RADIUS = 46;

export interface ClickThrough {
  stop(): void;
  /** Exposed for tests and for the settings UI to show current state. */
  isClickThrough(): boolean;
}

export function isOverFairy(
  cursor: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  radius = INTERACTIVE_RADIUS,
): boolean {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return Math.hypot(cursor.x - cx, cursor.y - cy) <= radius;
}

export function attachClickThrough(win: BrowserWindow): ClickThrough {
  let clickThrough: boolean | null = null;

  const apply = (next: boolean) => {
    if (next === clickThrough || win.isDestroyed()) return;
    clickThrough = next;
    // `forward: true` keeps move events flowing to the renderer while clicks pass through, so
    // the fairy can still react to a cursor passing over her.
    win.setIgnoreMouseEvents(next, { forward: true });
    win.webContents.send('click-through', next);
  };

  const timer = setInterval(() => {
    if (win.isDestroyed()) return;
    apply(!isOverFairy(screen.getCursorScreenPoint(), win.getBounds()));
  }, POLL_MS);

  apply(true);

  return {
    stop: () => clearInterval(timer),
    isClickThrough: () => clickThrough === true,
  };
}
