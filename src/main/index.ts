import { app, BrowserWindow, globalShortcut, utilityProcess, ipcMain } from 'electron'
import { join } from 'path'

let mainWindow: BrowserWindow | null = null
let backendProcess: Electron.UtilityProcess | null = null

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

  // Spawn backend as child process
  backendProcess = utilityProcess.fork(
    join(__dirname, '../backend/index.js'),
    [],
    { env: { ...process.env, JARVIS_PORT: '0' }, stdio: 'pipe' }
  )

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
          process.env.JARVIS_BACKEND_PORT = String(msg.port)
          mainWindow?.webContents.send('backend-port', msg.port)
        }
      } catch { console.error('[main] bad backend stdout line:', line) }
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  registerHotkey('Alt+Space')

  ipcMain.on('set-hotkey', (_e, accelerator: string) => {
    registerHotkey(accelerator)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  backendProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})

function registerHotkey(accelerator: string): void {
  globalShortcut.unregisterAll()
  try {
    globalShortcut.register(accelerator, () => {
      mainWindow?.webContents.send('ptt-start')
    })
  } catch {
    // Invalid accelerator — fall back to default so PTT keeps working
    globalShortcut.register('Alt+Space', () => {
      mainWindow?.webContents.send('ptt-start')
    })
  }
}
