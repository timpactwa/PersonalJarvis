import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import type { BackendEvent, RendererEvent } from './types'
import { transcribe } from './whisper'

const server = createServer()
const wss = new WebSocketServer({ server })

const PORT = parseInt(process.env.JARVIS_PORT ?? '0', 10)

let _activeWs: WebSocket | null = null

export function broadcast(event: BackendEvent): void {
  if (!_activeWs || _activeWs.readyState !== WebSocket.OPEN) return
  const msg = event.type === 'audio' ? event.data : JSON.stringify(event)
  _activeWs.send(msg)
}

wss.on('connection', (ws: WebSocket) => {
  _activeWs = ws
  console.log('[backend] renderer connected')

  ws.on('message', (raw) => {
    if (Buffer.isBuffer(raw)) {
      handleRendererEvent({ type: 'audio', data: raw })
    } else {
      try {
        handleRendererEvent(JSON.parse(raw.toString()) as RendererEvent)
      } catch {
        console.error('[backend] invalid message', raw)
      }
    }
  })

  ws.on('close', () => {
    _activeWs = null
    console.log('[backend] renderer disconnected')
  })

  // Send initial state on connect
  broadcast({ type: 'state', state: 'idle' })
})

function handleRendererEvent(event: RendererEvent): void {
  // Handle __ptt_start command to set listening state
  if (event.type === 'command' && event.text === '__ptt_start') {
    broadcast({ type: 'state', state: 'listening' })
    return
  }
  // Handle dashboard_open toggle
  if (event.type === 'dashboard_open') {
    broadcast({ type: 'dashboard_open' })
    return
  }
  // Dispatch to registered handlers
  eventHandlers.forEach(h => h(event))
}

export const eventHandlers: Array<(e: RendererEvent) => void> = []

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address() as { port: number }
  // Print port to stdout so Electron main process can discover it
  process.stdout.write(JSON.stringify({ type: 'ready', port: addr.port }) + '\n')
})

// Handle incoming audio from PTT
eventHandlers.push(async (event) => {
  if (event.type !== 'audio') return

  broadcast({ type: 'state', state: 'thinking' })

  try {
    const text = await transcribe(event.data)
    if (!text) {
      broadcast({ type: 'state', state: 'idle' })
      return
    }
    broadcast({ type: 'transcript', role: 'user', text, partial: false })
    // Claude handler will be added in Task 9 / Task 10
    // For now, just return to idle after showing transcript
    broadcast({ type: 'state', state: 'idle' })
  } catch (err) {
    console.error('[whisper] error:', err)
    broadcast({ type: 'error', message: String(err) })
    broadcast({ type: 'state', state: 'idle' })
  }
})
