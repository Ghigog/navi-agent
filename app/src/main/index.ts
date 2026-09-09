/**
 * Main process entry.
 *
 * The agent lives here rather than behind a socket: ADR 0001 rejected splitting Navi into two
 * stateful halves precisely so conversation state and UI state cannot drift apart.
 *
 * This file is wiring and nothing else. What a turn does is `conversation.ts`, which takes all
 * of this as dependencies and therefore runs under test without Electron; what the windows are
 * is `overlay.ts` and `chat-window.ts`. Keep decisions out of here.
 */

import { app, globalShortcut, ipcMain, type BrowserWindow } from 'electron';
import { createOverlay } from './overlay.js';
import { createChatWindow, type ChatWindow } from './chat-window.js';
import { attachClickThrough, type ClickThrough } from './click-through.js';
import { createConversation } from './conversation.js';
import { load } from './settings-store.js';
import { load as loadEmotion, record as recordEmotion } from './emotion-store.js';
import { createProvider } from '../agent/client.js';
import { ToolRegistry } from '../agent/tools.js';
import { tintFor } from '../shared/emotion.js';

let win: BrowserWindow | null = null;
let chat: ChatWindow | null = null;
let clickThrough: ClickThrough | null = null;

app.whenReady().then(() => {
  const settings = load();

  win = createOverlay();
  clickThrough = attachClickThrough(win);
  chat = createChatWindow();

  // Empty for now. Tools reach the model as native schemas and the model picks; nothing here
  // or anywhere else inspects the user's text to choose one (NAV-83).
  const registry = new ToolRegistry();

  const conversation = createConversation({
    settings: load,
    createProvider,
    registry,
    emotion: { load: loadEmotion, record: recordEmotion },
    emit: (event) => {
      chat?.send('chat:event', event);
      // The fairy shows the same state the chat window does — she is the one having the
      // conversation, and the chat window is only where the words are.
      if (event.type === 'emotion') win?.webContents.send('tint', event.tint);
      if (event.type === 'start') win?.webContents.send('busy', true);
      if (event.type === 'done' || event.type === 'error') win?.webContents.send('busy', false);
    },
  });

  ipcMain.on('chat:ready', () => conversation.describeState());
  ipcMain.on('chat:send', (_e, text: unknown) => {
    // The renderer is ours, but the boundary is still a boundary.
    if (typeof text === 'string') void conversation.send(text);
  });
  ipcMain.on('chat:cancel', () => conversation.cancel());
  ipcMain.on('chat:hide', () => chat?.hide());
  ipcMain.on('chat:open', () => {
    if (win) chat?.show(win);
  });

  // She wakes up in the state she was left in. Sent once the renderer is listening — before
  // that the fairy draws in its neutral colour and would keep it.
  const emotion = loadEmotion();
  win.webContents.once('did-finish-load', () => {
    win?.webContents.send('tint', tintFor(emotion));
  });

  // Shift+Cmd+N. The Swift daemon's old default, Shift+Ctrl+Alt+Space, collides with macOS
  // input-source switching and does not reliably register (ADR 0001).
  const registered = globalShortcut.register(settings.hotkey, () => {
    win?.webContents.send('summoned');
    if (win) chat?.toggle(win);
  });
  if (!registered) {
    console.warn(`could not register hotkey ${settings.hotkey} — another app owns it`);
  }

  // The overlay is the app. It has no frame and cannot be closed by hand, but if it ever goes
  // away the hidden chat window must not keep the process alive with nothing on screen.
  win.on('closed', () => app.quit());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clickThrough?.stop();
});

// The overlay is the app. Closing it means quitting, including on macOS.
app.on('window-all-closed', () => app.quit());
