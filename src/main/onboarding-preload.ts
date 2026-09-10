/**
 * The first-run window's boundary (NAV-92).
 *
 * Same rule as the other preloads: contextIsolation is on, and nothing here can read the API
 * key. The window sets one by sending a new value and is told only whether one exists (NAV-81).
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('naviOnboarding', {
  /** Everything the checklist shows: provider readiness and the three permissions. */
  status: () => ipcRenderer.invoke('onboarding:status'),
  /** A settings patch, same validator as the settings window uses. */
  save: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:save', patch),
  /** Asks for a permission where that is possible, and opens System Settings where it is not. */
  request: (kind: string) => ipcRenderer.invoke('onboarding:request', kind),
  /** Opens a URL in the user's browser. Used for the Ollama download page. */
  open: (url: string) => ipcRenderer.invoke('onboarding:open', url),
  /** Marks first run done and closes the window. */
  finish: () => ipcRenderer.send('onboarding:finish'),
});
