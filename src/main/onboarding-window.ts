/**
 * The first-run window (NAV-92).
 *
 * An ordinary window, like Settings and unlike the overlay: it is a thing you read, work
 * through and close. It is also the one window that may open on its own, on first launch,
 * because a new user has no way to know it exists.
 *
 * Built lazily and kept, so returning to it from Settings does not lose where the user was.
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

declare const __dirname: string;
const here = __dirname;

export const ONBOARDING_SIZE = { width: 620, height: 700 };

export interface OnboardingWindow {
  show(): void;
  hide(): void;
  isOpen(): boolean;
  send(channel: string, payload?: unknown): void;
}

export function createOnboardingWindow(): OnboardingWindow {
  let win: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  const build = (): BrowserWindow => {
    const next = new BrowserWindow({
      ...ONBOARDING_SIZE,
      show: false,
      title: 'Navi',
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#16171e',
      webPreferences: {
        preload: join(here, '../preload/onboarding.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Closing the guide closes the guide. The overlay is the app.
    next.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      next.hide();
    });

    next.loadFile(join(here, '../renderer/onboarding.html'));
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
