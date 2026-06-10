import { app, BrowserWindow, utilityProcess } from 'electron'
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

  backendProcess.stdout?.on('data', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString().trim())
      if (msg.type === 'ready') {
        process.env.JARVIS_BACKEND_PORT = String(msg.port)
        mainWindow?.webContents.send('backend-port', msg.port)
      }
    } catch { /* partial line */ }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  backendProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})
