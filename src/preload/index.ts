import { contextBridge, ipcRenderer } from 'electron'

let pttCallback: (() => void) | null = null
let pttStopCallback: (() => void) | null = null

// Register at module load time (before any renderer code) so we never miss the IPC
let cachedPort: number | null = null
let pendingPortCb: ((port: number) => void) | null = null
ipcRenderer.on('backend-port', (_e, port: number) => {
  cachedPort = port
  pendingPortCb?.(port)
  pendingPortCb = null
})

ipcRenderer.on('ptt-start', () => { pttCallback?.() })
ipcRenderer.on('ptt-stop', () => { pttStopCallback?.() })

contextBridge.exposeInMainWorld('jarvis', {
  onBackendPort: (cb: (port: number) => void) => {
    if (cachedPort !== null) {
      cb(cachedPort)
    } else {
      pendingPortCb = cb
    }
  },
  onPttStart: (cb: () => void) => { pttCallback = cb },
  onPttStop: (cb: () => void) => { pttStopCallback = cb },
  setHotkey: (accelerator: string) => ipcRenderer.send('set-hotkey', accelerator),
  windowControls: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
  },
})
