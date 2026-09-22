/**
 * The bubble window's boundary. Same rule as `chat-preload.ts`: contextIsolation is on,
 * nodeIntegration is off, and this is the whole surface its renderer gets — smaller than the
 * chat window's, because there is nothing here to send back except which button was pressed.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('naviBubble', {
  onShow: (fn: (message: unknown) => void) => ipcRenderer.on('bubble:show', (_e, message: unknown) => fn(message)),
  /** Told to shrink to the marker, on the schedule `bubble-window.ts` alone decides. */
  onCollapse: (fn: () => void) => ipcRenderer.on('bubble:collapse', () => fn()),
  /** Which button was pressed, by id. `main/index.ts`'s one `bubble:action` handler is what gives each id a meaning. */
  action: (id: string) => ipcRenderer.send('bubble:action', id),
});
