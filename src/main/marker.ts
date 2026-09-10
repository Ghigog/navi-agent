/**
 * The cursor-sample marker (NAV-99, carried into NAV-103).
 *
 * A fading amber ring at the exact screen point a cursor-anchored crop was centred on.
 *
 * This is the *visible* half of NAV-99 and it is easy to mistake for decoration. It is not. The
 * whole failure NAV-99 existed to fix was Navi answering about the wrong thing, and the reason
 * it survived so long is that a user had no way to tell *where she had looked* — a confident
 * answer about the wrong window is indistinguishable from a confident answer about the right
 * one. The ring is how a person catches it and says "no, over here". The arithmetic being right
 * is not a substitute for the user being able to see that it was.
 *
 * Its own window, because the overlay is 200px wide and sits wherever the fairy is, which is by
 * definition not where the cursor was. It is click-through, borrowed for 600ms and destroyed.
 */

import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { Point } from '../shared/geometry.js';

declare const __dirname: string;
const here = __dirname;

/** Matches the fade in `marker.html`, plus a little slack so nothing is cut off mid-frame. */
export const MARKER_MS = 750;

/** Square, and big enough for the ring plus the few pixels it grows by as it fades. */
export const MARKER_SIZE = 80;

let current: BrowserWindow | null = null;

/**
 * Shows the ring at a screen point.
 *
 * A second call replaces the first rather than stacking: two rings on screen would say she
 * looked at two places, and she looked at one.
 */
export function showCursorMarker(point: Point): void {
  dismissCursorMarker();

  const win = new BrowserWindow({
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    x: Math.round(point.x - MARKER_SIZE / 2),
    y: Math.round(point.y - MARKER_SIZE / 2),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    fullscreenable: false,
    // Nothing to show until it has painted; a white flash at the cursor would be worse than no
    // marker at all.
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });

  // Click-through always, and never focusable. This appears while the user is mid-sentence with
  // another application; stealing a click from them would be its own bug.
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(join(here, '../renderer/marker.html'));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });

  current = win;
  setTimeout(() => {
    if (current === win) current = null;
    if (!win.isDestroyed()) win.destroy();
  }, MARKER_MS);
}

/** Takes it off screen early. Called by the kill switch, and before showing another. */
export function dismissCursorMarker(): void {
  const win = current;
  current = null;
  if (win !== null && !win.isDestroyed()) win.destroy();
}
