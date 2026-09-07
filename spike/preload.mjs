import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spike', {
  onStats: (fn) => ipcRenderer.on('stats', (_e, d) => fn(d)),
  onClickThrough: (fn) => ipcRenderer.on('click-through', (_e, on) => fn(on)),
  onSummoned: (fn) => ipcRenderer.on('summoned', () => fn()),
  quit: () => ipcRenderer.send('quit'),
});
