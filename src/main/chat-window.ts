/**
 * The chat window.
 *
 * A second window rather than a panel inside the overlay, and that is forced rather than
 * chosen: the overlay is click-through by default and a click-through window cannot receive a
 * keystroke (see click-through.ts and ADR 0001). A text input inside it could never be typed
 * into. So the overlay stays a fairy you can see through, and this is the surface you talk to.
 *
 * It is positioned against the fairy every time it opens, so it stays hers rather than
 * becoming a window that happens to be on screen. The placement maths is pure and lives in
 * shared/geometry.ts, where it can be tested without a display.
 */

import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { chatBounds, type Size } from '../shared/geometry.js';

declare const __dirname: string;
const here = __dirname;

/** Wide enough for a paragraph, short enough not to own the screen. */
export const CHAT_SIZE: Size = { width: 380, height: 440 };

export interface ChatWindowOptions {
  /**
   * Called whenever the panel opens or closes. Following pauses while it is open (NAV-102):
   * the panel is placed against her once, on open, so a fairy who kept following would walk
   * off and leave it behind — or drag it around while you are typing into it.
   */
  onVisibility?: (open: boolean) => void;
}

export interface ChatWindow {
  /** Opens it against the fairy's current position and puts the caret in the input. */
  show(anchor: BrowserWindow): void;
  hide(): void;
  toggle(anchor: BrowserWindow): void;
  isOpen(): boolean;
  /** Sends to the chat renderer, if it is still there. */
  send(channel: string, payload?: unknown): void;
}

export function createChatWindow(opts: ChatWindowOptions = {}): ChatWindow {
  const win = new BrowserWindow({
    ...CHAT_SIZE,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(here, '../preload/chat.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(join(here, '../renderer/chat.html'));

  // Closing the chat window is closing the chat, not quitting Navi. The overlay is the app.
  // The flag is what stops that from also making Navi unquittable: without it the same
  // handler cancels the close that quitting sends, and the process never exits.
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  win.on('close', (e) => {
    if (quitting || win.isDestroyed()) return;
    e.preventDefault();
    win.hide();
  });

  const place = (anchor: BrowserWindow): void => {
    const fairy = anchor.getBounds();
    const { workArea } = screen.getDisplayMatching(fairy);
    win.setBounds(chatBounds(fairy, CHAT_SIZE, workArea));
  };

  const isOpen = (): boolean => !win.isDestroyed() && win.isVisible();

  const show = (anchor: BrowserWindow): void => {
    if (win.isDestroyed()) return;
    place(anchor);
    win.show();
    // The hotkey is global, so Navi is usually in the background when this runs, and on macOS
    // showing a window in a background app does not give it the keyboard. Without this the
    // panel appears and what you type goes to whatever you were using before.
    app.focus({ steal: true });
    win.focus();
    win.webContents.send('chat:focus');
    opts.onVisibility?.(true);
  };

  const hide = (): void => {
    if (win.isDestroyed()) return;
    win.hide();
    opts.onVisibility?.(false);
  };

  return {
    isOpen,
    show,
    hide,
    toggle: (anchor) => (isOpen() ? hide() : show(anchor)),
    send: (channel, payload) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    },
  };
}
