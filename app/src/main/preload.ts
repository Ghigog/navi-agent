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
  /** Clicking her opens the chat window. The hotkey should not be the only way in. */
  requestChat: () => ipcRenderer.send('chat:open'),
});
