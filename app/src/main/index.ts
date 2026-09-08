/**
 * Main process entry.
 *
 * The agent lives here rather than behind a socket: ADR 0001 rejected splitting Navi into two
 * stateful halves precisely so conversation state and UI state cannot drift apart.
 */

import { app, globalShortcut, type BrowserWindow } from 'electron';
import { createOverlay } from './overlay.js';
import { attachClickThrough, type ClickThrough } from './click-through.js';
import { load } from './settings-store.js';

let win: BrowserWindow | null = null;
let clickThrough: ClickThrough | null = null;

app.whenReady().then(() => {
  const settings = load();

  win = createOverlay();
  clickThrough = attachClickThrough(win);

  // Shift+Cmd+N. The Swift daemon's old default, Shift+Ctrl+Alt+Space, collides with macOS
  // input-source switching and does not reliably register (ADR 0001).
  const registered = globalShortcut.register(settings.hotkey, () => {
    win?.webContents.send('summoned');
  });
  if (!registered) {
    console.warn(`could not register hotkey ${settings.hotkey} — another app owns it`);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clickThrough?.stop();
});

// The overlay is the app. Closing it means quitting, including on macOS.
app.on('window-all-closed', () => app.quit());
