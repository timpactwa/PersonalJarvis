import { contextBridge, ipcRenderer } from 'electron'

// Expose IPC methods to the renderer process
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel: string, args?: any) => ipcRenderer.invoke(channel, args),
    on: (channel: string, func: (event: any, ...args: any[]) => void) =>
      ipcRenderer.on(channel, (_event, ...args) => func(_event, ...args)),
    once: (channel: string, func: (event: any, ...args: any[]) => void) =>
      ipcRenderer.once(channel, (_event, ...args) => func(_event, ...args)),
    send: (channel: string, args?: any) => ipcRenderer.send(channel, args),
  },
})
