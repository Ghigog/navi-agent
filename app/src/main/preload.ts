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
});
