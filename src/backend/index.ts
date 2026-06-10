import { WebSocketServer, WebSocket } from 'ws'
import express from 'express'
import { createServer } from 'http'
import type { BackendEvent, RendererEvent } from './types'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

const PORT = parseInt(process.env.JARVIS_PORT ?? '0', 10)

export let broadcast: (event: BackendEvent) => void = () => {}

wss.on('connection', (ws: WebSocket) => {
  console.log('[backend] renderer connected')

  broadcast = (event: BackendEvent) => {
    const msg = event.type === 'audio'
      ? event.data
      : JSON.stringify(event)
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  }

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

  ws.on('close', () => console.log('[backend] renderer disconnected'))

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
