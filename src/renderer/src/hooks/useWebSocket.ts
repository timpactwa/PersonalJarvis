import { useEffect, useRef, useCallback, useState } from 'react'
import type { BackendEvent, RendererEvent } from '../../../backend/types'

type Handler = (event: BackendEvent) => void

let ws: WebSocket | null = null
let backendPort: number | null = null
const handlers = new Set<Handler>()
const connectedListeners = new Set<(v: boolean) => void>()

function setConnected(v: boolean): void {
  connectedListeners.forEach(cb => cb(v))
}

function connect(port: number): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  backendPort = port
  console.log('[ws] connecting to backend on port', port)
  ws = new WebSocket(`ws://127.0.0.1:${port}`)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    console.log('[ws] connected to backend on port', port)
    setConnected(true)
    ws?.send(JSON.stringify({ type: 'command', text: '__hello backend-capture-v1' }))
  }

  ws.onerror = (err) => {
    console.error('[ws] connection error', err)
  }

  ws.onclose = (e) => {
    console.warn('[ws] disconnected (code', e.code, ') — reconnecting in 2s')
    ws = null
    setConnected(false)
    setTimeout(() => { if (backendPort) connect(backendPort) }, 2000)
  }

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      handlers.forEach(h => h({ type: 'audio', data: e.data as unknown as Buffer }))
    } else {
      try {
        const event = JSON.parse(e.data) as BackendEvent
        handlers.forEach(h => h(event))
      } catch { /* ignore malformed */ }
    }
  }
}

export function useWebSocket(onEvent: Handler): {
  send: (event: RendererEvent) => void
  sendBinary: (data: ArrayBuffer) => void
  connected: boolean
} {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent
  const [connected, setConnectedState] = useState(false)

  useEffect(() => {
    const handler: Handler = (e) => cbRef.current(e)
    handlers.add(handler)

    const onConnChange = (v: boolean): void => setConnectedState(v)
    connectedListeners.add(onConnChange)

    if (!backendPort) {
      ;(window as any).jarvis.onBackendPort((port: number) => connect(port))
    } else if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect(backendPort)
    } else {
      // Already connected from a previous React mount (StrictMode double-invoke etc.)
      setConnectedState(true)
    }

    return () => {
      handlers.delete(handler)
      connectedListeners.delete(onConnChange)
    }
  }, [])

  const send = useCallback((event: RendererEvent) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event))
    } else {
      console.warn('[ws] send dropped — not connected:', event.type)
    }
  }, [])

  const sendBinary = useCallback((data: ArrayBuffer) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(data)
  }, [])

  return { send, sendBinary, connected }
}
