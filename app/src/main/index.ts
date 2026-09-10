/**
 * Main process entry.
 *
 * The agent lives here rather than behind a socket: ADR 0001 rejected splitting Navi into two
 * stateful halves precisely so conversation state and UI state cannot drift apart.
 *
 * This file is wiring and nothing else. What a turn does is `conversation.ts`, which takes all
 * of this as dependencies and therefore runs under test without Electron; what a setting may
 * be is `shared/settings.ts`; what the windows are is `overlay.ts`, `chat-window.ts` and
 * `settings-window.ts`. Keep decisions out of here.
 */

import { app, clipboard, globalShortcut, ipcMain, screen, type BrowserWindow } from 'electron';
import { createOverlay } from './overlay.js';
import { createChatWindow, type ChatWindow } from './chat-window.js';
import { createSettingsWindow, type SettingsWindow } from './settings-window.js';
import { attachClickThrough, type ClickThrough } from './click-through.js';
import { createCursorSource, type CursorSource } from './cursor.js';
import { createFollow, type Follow } from './follow.js';
import { createConversation } from './conversation.js';
import { load, save } from './settings-store.js';
import { load as loadEmotion, record as recordEmotion, reset as resetEmotion } from './emotion-store.js';
import { createProvider } from '../agent/client.js';
import { ToolRegistry } from '../agent/tools.js';
import { lastPrompt } from '../prompt/inspector.js';
import { describe, tintFor } from '../shared/emotion.js';
import { view, type Settings } from '../shared/settings.js';

let win: BrowserWindow | null = null;
let chat: ChatWindow | null = null;
let settings: SettingsWindow | null = null;
let clickThrough: ClickThrough | null = null;
let cursor: CursorSource | null = null;
let follow: Follow | null = null;

app.whenReady().then(() => {
  const current = load();

  win = createOverlay();
  // One poll, two readers. Click-through and following both act on the cursor, and two timers
  // would sample it at two rates and disagree about where it is (NAV-102).
  cursor = createCursorSource({ read: () => screen.getCursorScreenPoint(), fps: current.idleFps });
  clickThrough = attachClickThrough(win, cursor);
  follow = createFollow({ window: win, cursor });
  chat = createChatWindow({ onVisibility: (open) => follow?.setPaused('chat', open) });
  settings = createSettingsWindow();

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

  /**
   * Shift+Cmd+N by default. The Swift daemon's old default, Shift+Ctrl+Alt+Space, collides
   * with macOS input-source switching and does not reliably register (ADR 0001).
   *
   * Returns whether it took, because the settings window says so: an accelerator another app
   * already owns fails silently otherwise, and the user is left pressing a key that does
   * nothing with no idea why.
   */
  const registerHotkey = (accelerator: string): boolean => {
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(accelerator, () => {
      win?.webContents.send('summoned');
      if (win) chat?.toggle(win);
    });
    if (!ok) console.warn(`could not register hotkey ${accelerator} — another app owns it`);
    return ok;
  };

  const sendRates = (s: Settings): void => {
    win?.webContents.send('rates', { idle: s.idleFps, active: s.activeFps });
    // The cursor poll is a permanent timer, so it is measured against ADR 0001's idle CPU bar
    // like the render loop is, and it moves with the same setting.
    cursor?.setRate(s.idleFps);
  };

  registerHotkey(current.hotkey);

  // She wakes up in the state she was left in, at the frame rates that were configured. Sent
  // once the renderer is listening — before that the fairy draws in its neutral colour at the
  // default rates and would keep both.
  const emotion = loadEmotion();
  win.webContents.once('did-finish-load', () => {
    win?.webContents.send('tint', tintFor(emotion));
    sendRates(current);
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

  ipcMain.on('settings:open', () => settings?.show());
  ipcMain.on('settings:close', () => settings?.hide());

  ipcMain.handle('settings:get', () => view(load()));
  ipcMain.handle('settings:save', (_e, patch: unknown) => {
    const next = save(patch);
    // Everything that reads a setting once rather than per turn has to be told it changed.
    const hotkeyRegistered = registerHotkey(next.hotkey);
    sendRates(next);
    conversation.describeState();
    return { view: view(next), hotkeyRegistered };
  });

  ipcMain.handle('prompt:last', () => lastPrompt());
  ipcMain.handle('emotion:get', () => describe(loadEmotion()));
  ipcMain.handle('emotion:reset', () => {
    const state = resetEmotion();
    // Repaints the fairy and the chat header from the state she has just been given.
    conversation.describeState();
    return describe(state);
  });
  ipcMain.handle('clipboard:write', (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  // The overlay is the app. It has no frame and cannot be closed by hand, but if it ever goes
  // away the hidden windows must not keep the process alive with nothing on screen.
  win.on('closed', () => app.quit());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clickThrough?.stop();
  follow?.stop();
  cursor?.stop();
});

// The overlay is the app. Closing it means quitting, including on macOS.
app.on('window-all-closed', () => app.quit());
