/**
 * The settings window's boundary.
 *
 * Everything here is request/response, so it is `invoke` rather than `send`: the window asks
 * for the current settings, the last prompt or the emotional state and gets an answer, instead
 * of listening for one to arrive.
 *
 * Note what is not exposed: nothing that reads the API key. `settings:get` answers with the
 * `SettingsView` shape, which says whether a key is set and never what it is (NAV-81).
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('naviSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  /** A patch, not a whole Settings. Keys left out keep whatever is stored. */
  save: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:save', patch),
  lastPrompt: () => ipcRenderer.invoke('prompt:last'),
  /** The memory viewer (NAV-93). Anything she remembers, the user can see and remove. */
  memory: () => ipcRenderer.invoke('memory:get'),
  memoryForget: (id: string) => ipcRenderer.invoke('memory:forget', id),
  memoryRemember: (text: string) => ipcRenderer.invoke('memory:remember', text),
  memoryReset: () => ipcRenderer.invoke('memory:reset'),
  emotion: () => ipcRenderer.invoke('emotion:get'),
  resetEmotion: () => ipcRenderer.invoke('emotion:reset'),
  /** The renderer has no reliable clipboard on a file:// page; the main process does. */
  copy: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  /** Reopens the first-run guide. The local-path instructions have to stay findable (NAV-92). */
  openOnboarding: () => ipcRenderer.send('onboarding:open'),
  close: () => ipcRenderer.send('settings:close'),
});
