import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('jarvis', {
  onBackendPort: (cb: (port: number) => void) =>
    ipcRenderer.once('backend-port', (_e, port) => cb(port)),
})
