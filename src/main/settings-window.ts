/**
 * The settings window.
 *
 * Unlike the overlay and the chat panel this is an ordinary window: opaque, resizable, and
 * carrying the platform's own close and zoom buttons through `titleBarStyle: 'hiddenInset'`.
 * It is a place you go to read and change things, sometimes for a while — the prompt inspector
 * is a wall of text — and the frameless always-on-top treatment that suits a fairy hovering
 * over your desktop would be wrong for it.
 *
 * One window, created lazily and then reused, so reopening it does not lose scroll position or
 * a half-typed field.
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

declare const __dirname: string;
const here = __dirname;

export const SETTINGS_SIZE = { width: 640, height: 720 };
export const SETTINGS_MIN = { width: 520, height: 420 };

export interface SettingsWindow {
  show(): void;
  hide(): void;
  isOpen(): boolean;
  send(channel: string, payload?: unknown): void;
}

export function createSettingsWindow(): SettingsWindow {
  let win: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  const build = (): BrowserWindow => {
    const next = new BrowserWindow({
      ...SETTINGS_SIZE,
      minWidth: SETTINGS_MIN.width,
      minHeight: SETTINGS_MIN.height,
      show: false,
      title: 'Navi',
      // macOS keeps its own close and zoom buttons; everywhere else this is simply frameless
      // and the window is closed from the panel's own button.
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#16171e',
      webPreferences: {
        preload: join(here, '../preload/settings.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Closing settings closes settings. The overlay is the app.
    next.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      next.hide();
    });

    next.loadFile(join(here, '../renderer/settings.html'));
    return next;
  };

  return {
    isOpen: () => win !== null && !win.isDestroyed() && win.isVisible(),

    show() {
      if (win === null || win.isDestroyed()) win = build();
      win.show();
      app.focus({ steal: true });
      win.focus();
    },

    hide() {
      if (win !== null && !win.isDestroyed()) win.hide();
    },

    send(channel, payload) {
      if (win !== null && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
  };
}
