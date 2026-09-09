/**
 * The chat window's boundary. Same rule as preload.ts: contextIsolation is on, nodeIntegration
 * is off, and this file is the whole surface the chat renderer gets.
 *
 * It is separate from the fairy's preload rather than shared so that neither window carries the
 * other's abilities. The overlay has no reason to be able to send a message.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('naviChat', {
  /** The renderer is listening; send it the provider and the current mood. */
  ready: () => ipcRenderer.send('chat:ready'),
  send: (text: string) => ipcRenderer.send('chat:send', text),
  cancel: () => ipcRenderer.send('chat:cancel'),
  hide: () => ipcRenderer.send('chat:hide'),
  onEvent: (fn: (event: unknown) => void) =>
    ipcRenderer.on('chat:event', (_e, event: unknown) => fn(event)),
  onFocus: (fn: () => void) => ipcRenderer.on('chat:focus', () => fn()),
});
