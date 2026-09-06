import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spike', {
  onStats: (fn) => ipcRenderer.on('stats', (_e, d) => fn(d)),
  clickThrough: (on) => ipcRenderer.send('click-through', on),
  confirm: (key, ok) => ipcRenderer.send('confirm', { key, ok }),
});
