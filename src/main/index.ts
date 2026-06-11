import { app, BrowserWindow, globalShortcut, utilityProcess, ipcMain } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null
let backendProcess: Electron.UtilityProcess | null = null
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

  // Spawn backend as child process
  backendProcess = utilityProcess.fork(
    join(__dirname, '../backend/index.js'),
    [],
    { env: { ...process.env, JARVIS_PORT: '0' }, stdio: 'pipe' }
  )

  backendProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write('[backend] ' + data.toString())
  })

  let stdoutBuf = ''
  backendProcess.stdout?.on('data', (data: Buffer) => {
    stdoutBuf += data.toString()
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'ready') {
          console.log('[main] backend ready on port', msg.port)
          process.env.JARVIS_BACKEND_PORT = String(msg.port)
          sendToRenderer('backend-port', msg.port)
        }
      } catch { console.log('[backend]', line) }
    }
  })

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
})

app.on('window-all-closed', () => {
  backendProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})
