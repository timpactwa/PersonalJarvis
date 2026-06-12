import { app, BrowserWindow, globalShortcut, utilityProcess, ipcMain } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null
let backendProcess: Electron.UtilityProcess | null = null
let savedBackendPort: number | null = null
let lastBackendStatus: { status: string; message?: string } | null = null
let backendRestarts = 0
let quitting = false
let uiohookLoaded = false
let mKeyDown = false
let lastMKeydownAt = 0
let pttStartedAt = 0

function sendToBackend(msg: { type: string }): void {
  if (!backendProcess) return
  try {
    backendProcess.postMessage(msg)
  } catch (err) {
    console.error('[main] backend postMessage failed:', err)
  }
}

function startPtt(): void {
  if (mKeyDown) return
  mKeyDown = true
  pttStartedAt = Date.now()
  lastMKeydownAt = Date.now()
  console.log('[main] ptt-start')
  sendToBackend({ type: 'ptt-start' })
  sendToRenderer('ptt-start')
}

function stopPtt(reason: string): void {
  if (!mKeyDown) return
  mKeyDown = false
  const heldMs = Date.now() - pttStartedAt
  console.log(`[main] ptt-stop (${reason}) held=${heldMs}ms`)
  // Sub-150ms is an accidental tap, not speech — cancel. (The capture stream
  // is persistent with pre-roll, so anything longer carries real audio.)
  if (heldMs < 150) {
    console.log('[main] hold too short — cancelling')
    sendToBackend({ type: 'ptt-cancel' })
  } else {
    sendToBackend({ type: 'ptt-stop' })
  }
  sendToRenderer('ptt-stop')
}

// Safely send an IPC message to the renderer. After a reload/crash the frame may
// be disposed; calling webContents.send then throws "Render frame was disposed"
// and would otherwise break all subsequent hotkey handling.
function sendToRenderer(channel: string, ...args: unknown[]): void {
  const wc = mainWindow?.webContents
  if (!mainWindow || mainWindow.isDestroyed() || !wc || wc.isDestroyed() || wc.isCrashed()) {
    return
  }
  try {
    wc.send(channel, ...args)
  } catch (err) {
    console.log('[main] send failed (frame disposed?):', err)
  }
}

// Try to load uiohook-napi for hold-to-talk (keyup detection)
let uIOhook: any = null
let UiohookKey: any = null
try {
  const mod = require('uiohook-napi')
  uIOhook = mod.uIOhook
  UiohookKey = mod.UiohookKey
  uiohookLoaded = true
  console.log('[main] uiohook-napi loaded — hold-to-talk available')
} catch (err) {
  console.log('[main] uiohook-napi not available — falling back to Alt+Space toggle:', err)
}

const BACKEND_READY_TIMEOUT_MS = 20_000
const BACKEND_MAX_RESTARTS = 3
let readyWatchdog: NodeJS.Timeout | null = null

function sendBackendStatus(status: 'starting' | 'ready' | 'crashed' | 'failed', message?: string): void {
  lastBackendStatus = { status, message }
  sendToRenderer('backend-status', lastBackendStatus)
}

// Single funnel for the ready signal — it arrives via both parentPort IPC and
// the stdout pipe (belt and suspenders; stdio pipes have been flaky in
// utilityProcess on Windows), so dedupe here.
function onBackendReady(port: number, via: string): void {
  if (savedBackendPort === port) return
  console.log(`[main] backend ready on port ${port} (via ${via})`)
  if (readyWatchdog) {
    clearTimeout(readyWatchdog)
    readyWatchdog = null
  }
  backendRestarts = 0
  savedBackendPort = port
  process.env.JARVIS_BACKEND_PORT = String(port)
  sendToRenderer('backend-port', port)
  sendBackendStatus('ready')
}

function startBackend(): void {
  if (backendProcess || quitting) return
  savedBackendPort = null
  const entry = join(__dirname, '../backend/index.js')
  console.log('[main] starting backend:', entry)
  sendBackendStatus('starting')

  const proc = utilityProcess.fork(entry, [], {
    env: { ...process.env, JARVIS_PORT: '0' },
    stdio: 'pipe',
    serviceName: 'jarvis-backend',
  })
  backendProcess = proc

  // If nothing reports ready, say so loudly instead of leaving the renderer
  // on an eternal "connecting..." spinner with zero clues.
  readyWatchdog = setTimeout(() => {
    readyWatchdog = null
    console.error(`[main] backend did not report ready within ${BACKEND_READY_TIMEOUT_MS / 1000}s.`)
    console.error('[main] Look for [backend] lines above — if there are none at all, the process failed to spawn (bad path or missing dist-electron/backend/index.js; run: npm run build:backend).')
    sendBackendStatus('failed', 'Backend did not start in time. Check the terminal for [backend] errors.')
  }, BACKEND_READY_TIMEOUT_MS)

  proc.on('spawn', () => {
    console.log('[main] backend process spawned (pid', proc.pid, ')')
  })

  proc.stderr?.on('data', (data: Buffer) => {
    process.stderr.write('[backend] ' + data.toString())
  })

  // Primary ready signal: parentPort IPC
  proc.on('message', (msg: { type?: string; port?: number }) => {
    if (msg.type === 'ready' && msg.port) onBackendReady(msg.port, 'ipc')
  })

  // Fallback ready signal: JSON line on stdout
  let stdoutBuf = ''
  proc.stdout?.on('data', (data: Buffer) => {
    stdoutBuf += data.toString()
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'ready' && msg.port) onBackendReady(msg.port, 'stdout')
      } catch { console.log('[backend]', line) }
    }
  })

  proc.on('exit', (code: number) => {
    if (backendProcess !== proc) return // stale handler from a replaced process
    backendProcess = null
    savedBackendPort = null
    if (readyWatchdog) {
      clearTimeout(readyWatchdog)
      readyWatchdog = null
    }
    if (quitting) return
    console.error(`[main] backend exited unexpectedly with code ${code}`)
    if (backendRestarts < BACKEND_MAX_RESTARTS) {
      backendRestarts++
      const delay = 500 * 2 ** (backendRestarts - 1) // 500ms, 1s, 2s
      console.error(`[main] restarting backend in ${delay}ms (attempt ${backendRestarts}/${BACKEND_MAX_RESTARTS})`)
      sendBackendStatus('crashed', `Backend crashed (exit code ${code}) — restarting...`)
      setTimeout(startBackend, delay)
    } else {
      console.error('[main] backend keeps crashing — giving up. Fix the [backend] error above, then restart the app.')
      sendBackendStatus('failed', `Backend crashed ${BACKEND_MAX_RESTARTS + 1} times (exit code ${code}). Check the terminal, then restart the app.`)
    }
  })
}

// Ask the backend to clean up (ffmpeg stream, sqlite) and exit; hard-kill if
// it doesn't comply quickly.
function stopBackend(): void {
  quitting = true
  const proc = backendProcess
  backendProcess = null
  if (!proc) return
  try {
    proc.postMessage({ type: 'shutdown' })
  } catch {
    try { proc.kill() } catch { /* already gone */ }
    return
  }
  const hardKill = setTimeout(() => {
    try { proc.kill() } catch { /* already gone */ }
  }, 1500)
  proc.once('exit', () => clearTimeout(hardKill))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer process gone:', details)
  })
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[main] renderer became unresponsive')
  })

  // Backup keyup path when the Jarvis window has focus — uiohook occasionally
  // misses modifier keyup on Windows, which leaves mKeyDown stuck true forever.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key !== 'Alt') return
    if (input.type === 'keyUp') stopPtt('window keyup')
  })
  mainWindow.on('blur', () => stopPtt('window blur'))

  // Re-send the backend port + status after the renderer finishes loading.
  // The preload registers ipcRenderer.on('backend-port') only once the page
  // loads — if the backend sends ready before loadURL is called (which it
  // often does, because cache-clearing delays loadURL by ~200–500ms), the
  // initial sendToRenderer call is silently dropped. did-finish-load fires
  // after the preload has run and the IPC channel is open, so sending here
  // guarantees delivery regardless of startup timing.
  mainWindow.webContents.on('did-finish-load', () => {
    if (savedBackendPort !== null) {
      sendToRenderer('backend-port', savedBackendPort)
    }
    if (lastBackendStatus !== null) {
      sendToRenderer('backend-status', lastBackendStatus)
    }
  })

  startBackend()

  // Always load fresh in dev. Clear HTTP cache + storage (service workers,
  // cachestorage, etc.) so the renderer can never serve a stale bundle — that
  // previously caused old audio code to keep running after source changes.
  const ses = mainWindow.webContents.session
  void Promise.all([
    ses.clearCache(),
    ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage', 'shadercache'] }),
  ])
    .catch(() => { /* best effort */ })
    .finally(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (process.env.ELECTRON_RENDERER_URL) {
        console.log('[main] loading renderer from DEV SERVER:', process.env.ELECTRON_RENDERER_URL)
        void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
      } else {
        const file = join(__dirname, '../../dist/index.html')
        console.log('[main] loading renderer from FILE (no dev server URL set!):', file)
        void mainWindow.loadFile(file)
      }
    })
}

app.whenReady().then(() => {
  createWindow()

  // Escape always cancels an in-progress recording.
  globalShortcut.register('Escape', () => {
    sendToBackend({ type: 'ptt-cancel' })
    stopPtt('Escape')
  })

  if (uiohookLoaded) {
    // Hold-to-talk via global hook. If keyup is missed, a later M press (after a
    // gap longer than auto-repeat) acts as a rescue stop instead of being ignored.
    uIOhook.on('keydown', (e: any) => {
      if (e.keycode !== UiohookKey.AltRight) return
      const now = Date.now()
      if (!mKeyDown) {
        startPtt()
        return
      }
      // Auto-repeat keydowns arrive ~30-50ms apart while held — ignore those.
      // 2000ms threshold: games/OS can emit spurious M keydowns ~300ms after the real one.
      if (now - lastMKeydownAt > 2000) {
        console.log('[main] M keydown while already recording — treating as rescue stop')
        stopPtt('M toggle rescue')
      }
      lastMKeydownAt = now
    })
    uIOhook.on('keyup', (e: any) => {
      if (e.keycode === UiohookKey.AltRight) stopPtt('M keyup')
    })
    uIOhook.start()
    console.log('[main] uiohook started — hold Right Alt to talk, release to stop (Escape cancels)')
  } else {
    // Fallback: Alt+Space toggle via globalShortcut
    globalShortcut.register('Alt+Space', () => {
      console.log('[main] Alt+Space → ptt-start (toggle)')
      sendToRenderer('ptt-start')
    })
    console.log('[main] globalShortcut registered — Alt+Space to toggle recording')
  }

  ipcMain.on('set-hotkey', (_e, _accelerator: string) => { /* reserved */ })
  ipcMain.on('window-minimize', () => mainWindow?.minimize())
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window-close', () => mainWindow?.close())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (uiohookLoaded) uIOhook.stop()
  stopBackend()
})

app.on('window-all-closed', () => {
  stopBackend()
  if (process.platform !== 'darwin') app.quit()
})
