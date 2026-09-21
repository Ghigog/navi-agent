/**
 * The speech bubble (NAV-112).
 *
 * Hers, always on top, and the one surface in the app that is allowed to appear while you are
 * doing something else — which is exactly why it must never take the keyboard, raise itself over
 * what you are doing, or eat a click meant for whatever is underneath. `chat-window.ts` takes the
 * focus on purpose, because a text input nobody can type into is worse than one that steals it;
 * this window exists to be the opposite of that, for the one case where speaking is not the same
 * as asking to be talked to.
 *
 * `showInactive()`, never `show()`, and nothing here ever calls `app.focus()` or `win.focus()`.
 * `acceptFirstMouse: true` is the other half: without it, a click on one of the buttons would be
 * swallowed activating the app instead of registering.
 *
 * Placement reuses `chatBounds` rather than duplicating it — the maths (centred on her body,
 * below by preference, clamped to the work area) is exactly the same problem at a different
 * size, and `chatBounds` is already pure and pinned by `test/chat-window.test.ts`.
 *
 * It collapses on its own, on a schedule nothing but the clock drives: full size until acted on
 * or `BUBBLE_VISIBLE_MS`, then a small marker on her for `MARKER_VISIBLE_MS`, then gone. Nothing
 * here is modal — ignoring it is always a valid choice.
 */

import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { chatBounds, type Size } from '../shared/geometry.js';

declare const __dirname: string;
const here = __dirname;

/** Wide enough for a line and up to three buttons, short enough to read as a bubble, not a card. */
export const BUBBLE_SIZE: Size = { width: 320, height: 116 };

/** A dot on her, not a window with anything to read. */
export const MARKER_SIZE: Size = { width: 24, height: 24 };

/** Visible in full until acted on or this long, whichever comes first. */
export const BUBBLE_VISIBLE_MS = 30_000;

/** Then a small marker on her for this long, before it disappears for good. */
export const MARKER_VISIBLE_MS = 2 * 60_000;

export interface BubbleButton {
  id: string;
  label: string;
}

export interface BubbleMessage {
  text: string;
  /** Up to three; a fourth is dropped rather than crowding the surface. */
  buttons?: readonly BubbleButton[];
}

export interface BubbleWindow {
  /** Shows it against the fairy, full size, and starts its own collapse clock. */
  show(anchor: BrowserWindow, message: BubbleMessage): void;
  /** Takes it off screen now, wherever it was in its schedule, and cancels the clock. */
  dismiss(): void;
}

export function createBubbleWindow(): BubbleWindow {
  const win = new BrowserWindow({
    ...BUBBLE_SIZE,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    // Belt and braces alongside never calling focus(): a window that cannot be focused cannot be
    // focus-stolen by a future edit that adds a `show()` call by mistake.
    focusable: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(here, '../preload/bubble.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(join(here, '../renderer/bubble.html'));

  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  win.on('close', (e) => {
    if (quitting || win.isDestroyed()) return;
    e.preventDefault();
    win.hide();
  });

  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let vanishTimer: ReturnType<typeof setTimeout> | null = null;
  let anchor: BrowserWindow | null = null;

  const clearTimers = (): void => {
    if (collapseTimer !== null) clearTimeout(collapseTimer);
    if (vanishTimer !== null) clearTimeout(vanishTimer);
    collapseTimer = null;
    vanishTimer = null;
  };

  const place = (size: Size): void => {
    if (anchor === null || win.isDestroyed()) return;
    const fairy = anchor.getBounds();
    const { workArea } = screen.getDisplayMatching(fairy);
    win.setBounds(chatBounds(fairy, size, workArea));
  };

  const vanish = (): void => {
    clearTimers();
    anchor = null;
    if (!win.isDestroyed()) win.hide();
  };

  const collapse = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send('bubble:collapse');
    place(MARKER_SIZE);
    // The marker is a dot to notice, not a thing to click; click-through so it never blocks
    // whatever is underneath, the same reason `marker.ts`'s cursor ring is click-through.
    win.setIgnoreMouseEvents(true);
    vanishTimer = setTimeout(vanish, MARKER_VISIBLE_MS);
  };

  const show = (nextAnchor: BrowserWindow, message: BubbleMessage): void => {
    if (win.isDestroyed()) return;
    clearTimers();
    anchor = nextAnchor;
    place(BUBBLE_SIZE);
    win.webContents.send('bubble:show', {
      text: message.text,
      buttons: (message.buttons ?? []).slice(0, 3),
    });
    win.setIgnoreMouseEvents(false);
    win.showInactive();
    collapseTimer = setTimeout(collapse, BUBBLE_VISIBLE_MS);
  };

  return { show, dismiss: vanish };
}
