import { useEffect, useRef, useCallback } from 'react'
import type { BackendEvent, RendererEvent } from '../../../backend/types'

type Handler = (event: BackendEvent) => void

let ws: WebSocket | null = null
const handlers = new Set<Handler>()

export function useWebSocket(onEvent: Handler): {
  send: (event: RendererEvent) => void
  sendBinary: (data: ArrayBuffer) => void
} {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    const handler: Handler = (e) => cbRef.current(e)
    handlers.add(handler)

    if (!ws) {
      ;(window as any).jarvis.onBackendPort((port: number) => {
        ws = new WebSocket(`ws://127.0.0.1:${port}`)
        ws.binaryType = 'arraybuffer'
        ws.onerror = (err) => console.error('[ws] connection error', err)

        ws.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer) {
            // e.data is ArrayBuffer in browser context (ws.binaryType = 'arraybuffer')
            handlers.forEach(h => h({ type: 'audio', data: e.data as unknown as Buffer }))
          } else {
            try {
              const event = JSON.parse(e.data) as BackendEvent
              handlers.forEach(h => h(event))
            } catch { /* ignore malformed */ }
          }
        }
      })
    }

    return () => { handlers.delete(handler) }
  }, [])

  const send = useCallback((event: RendererEvent) => {
    ws?.send(JSON.stringify(event))
  }, [])

  const sendBinary = useCallback((data: ArrayBuffer) => {
    ws?.send(data)
  }, [])

  return { send, sendBinary }
}
