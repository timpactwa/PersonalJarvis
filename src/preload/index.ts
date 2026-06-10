import { contextBridge, ipcRenderer } from 'electron'

let pttCallback: (() => void) | null = null
ipcRenderer.on('ptt-start', () => { pttCallback?.() })

contextBridge.exposeInMainWorld('jarvis', {
  onBackendPort: (cb: (port: number) => void) =>
    ipcRenderer.once('backend-port', (_e, port) => cb(port)),
  onPttStart: (cb: () => void) => { pttCallback = cb },
})
