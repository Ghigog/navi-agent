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
  /** "That was good" / "that wasn't" on the last reply (NAV-101). */
  approve: (liked: boolean) => ipcRenderer.send('chat:approve', liked),
  /** The answer to a confirmation card (NAV-91). Answered by id: two can be up at once. */
  confirm: (id: number, said: boolean) => ipcRenderer.send('chat:confirm', { id, said }),
  hide: () => ipcRenderer.send('chat:hide'),
  openSettings: () => ipcRenderer.send('settings:open'),
  onEvent: (fn: (event: unknown) => void) =>
    ipcRenderer.on('chat:event', (_e, event: unknown) => fn(event)),
  onFocus: (fn: () => void) => ipcRenderer.on('chat:focus', () => fn()),

  /**
   * Voice (NAV-104). The microphone lives in this window because `getUserMedia` does; the main
   * process owns the talk key, because a global shortcut is the only key a click-through
   * overlay can be reached by.
   */
  onListen: (fn: (on: boolean) => void) =>
    ipcRenderer.on('voice:listen', (_e, on: boolean) => fn(on)),
  /** A finished take, as WAV bytes. Null when there was not enough of one to bother with. */
  audio: (wav: Uint8Array | null) => ipcRenderer.send('voice:audio', wav),
  /** Something went wrong with the microphone. Shown in the transcript, never thrown. */
  voiceError: (message: string) => ipcRenderer.send('voice:error', message),
  /** What she heard. Rendered as the user's own message, because that is what it is. */
  onTranscript: (fn: (text: string) => void) =>
    ipcRenderer.on('voice:transcript', (_e, text: string) => fn(text)),

  /** The user is done looking at this step (NAV-106): a click on the step bar, or Enter/Space. */
  advanceGuide: () => ipcRenderer.send('guidance:advance'),
});
