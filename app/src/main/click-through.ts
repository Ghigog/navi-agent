/**
 * Click-through, driven from outside the window.
 *
 * A window in click-through mode cannot receive keystrokes — that is what click-through means —
 * so a binding inside the window can turn it on and never turn it off. The spike hit this and
 * ADR 0001 records it as a constraint on the design.
 *
 * So the default is click-through ON, and it is disabled only while the OS cursor is actually
 * over the fairy. Nothing about that decision runs inside the renderer.
 *
 * The cursor sample arrives from `cursor.ts` rather than being polled here, so this and
 * `follow.ts` always act on the same one (NAV-102).
 */

import type { BrowserWindow } from 'electron';
import { isOverFairy } from '../shared/geometry.js';
import type { CursorSource } from './cursor.js';

export interface ClickThrough {
  stop(): void;
  /** Exposed for the settings UI to show current state. */
  isClickThrough(): boolean;
}

export function attachClickThrough(win: BrowserWindow, cursor: CursorSource): ClickThrough {
  let clickThrough: boolean | null = null;

  const apply = (next: boolean) => {
    if (next === clickThrough || win.isDestroyed()) return;
    clickThrough = next;
    // `forward: true` keeps move events flowing to the renderer while clicks pass through, so
    // the fairy can still react to a cursor passing over her.
    win.setIgnoreMouseEvents(next, { forward: true });
    win.webContents.send('click-through', next);
  };

  const unsubscribe = cursor.subscribe((point) => {
    if (win.isDestroyed()) return;
    apply(!isOverFairy(point, win.getBounds()));
  });

  apply(true);

  return {
    stop: unsubscribe,
    isClickThrough: () => clickThrough === true,
  };
}
