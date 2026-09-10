/**
 * The renderer gets a narrow, explicit surface and nothing else: contextIsolation is on and
 * nodeIntegration is off, so this file is the entire boundary.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('navi', {
  onClickThrough: (fn: (on: boolean) => void) =>
    ipcRenderer.on('click-through', (_e, on: boolean) => fn(on)),
  onSummoned: (fn: () => void) => ipcRenderer.on('summoned', () => fn()),
  onTint: (fn: (c: { r: number; g: number; b: number }) => void) =>
    ipcRenderer.on('tint', (_e, c) => fn(c)),
  /** True while a turn is running, so the fairy can show she is working. */
  onBusy: (fn: (busy: boolean) => void) => ipcRenderer.on('busy', (_e, busy: boolean) => fn(busy)),
  /** Frame rates from settings, sent on load and whenever they are edited. */
  onRates: (fn: (r: { idle: number; active: number }) => void) =>
    ipcRenderer.on('rates', (_e, r) => fn(r)),
  /**
   * Where she is pointing, relative to the centre of this window, or null when she is not
   * (NAV-103). Sent from the main process because the renderer cannot find out where its own
   * window is on screen.
   */
  onPoint: (fn: (relative: { x: number; y: number } | null) => void) =>
    ipcRenderer.on('point', (_e, relative) => fn(relative)),
  /** A floating emoji, when her emotion changed (emotions.md §9.2). */
  onEmoji: (fn: (char: string) => void) => ipcRenderer.on('emoji', (_e, char: string) => fn(char)),
  /** True while she is reaching outside her own window (NAV-91). The user must always know. */
  onActing: (fn: (acting: boolean) => void) => ipcRenderer.on('acting', (_e, acting: boolean) => fn(acting)),
  /** Clicking her opens the chat window. The hotkey should not be the only way in. */
  requestChat: () => ipcRenderer.send('chat:open'),
});
