import { contextBridge, ipcRenderer } from 'electron'

let pttCallback: (() => void) | null = null
let pttStopCallback: (() => void) | null = null

// Register at module load time (before any renderer code) so we never miss the
// IPC. Callbacks stay subscribed: the backend can restart on a NEW port, and
// that update must reach the renderer too (a one-shot callback here once left
// the renderer reconnecting to a dead port forever).
let cachedPort: number | null = null
const portCbs: Array<(port: number) => void> = []
ipcRenderer.on('backend-port', (_e, port: number) => {
  cachedPort = port
  portCbs.forEach(cb => cb(port))
})

type BackendStatus = { status: string; message?: string }
let cachedStatus: BackendStatus | null = null
const statusCbs: Array<(s: BackendStatus) => void> = []
ipcRenderer.on('backend-status', (_e, s: BackendStatus) => {
  cachedStatus = s
  statusCbs.forEach(cb => cb(s))
})

ipcRenderer.on('ptt-start', () => { pttCallback?.() })
ipcRenderer.on('ptt-stop', () => { pttStopCallback?.() })

contextBridge.exposeInMainWorld('jarvis', {
  onBackendPort: (cb: (port: number) => void) => {
    portCbs.push(cb)
    if (cachedPort !== null) cb(cachedPort)
  },
  onBackendStatus: (cb: (s: BackendStatus) => void) => {
    statusCbs.push(cb)
    if (cachedStatus !== null) cb(cachedStatus)
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
