import { config } from 'dotenv'
config({ path: `${process.cwd()}/.env.local` })

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import type { BackendEvent, RendererEvent } from './types'
import { setEmitter } from './events'
import { transcribe } from './whisper'
import { chat, type Message } from './claude'
import { synthesize } from './elevenlabs'
import { initDb } from './memory/db'
import { logApiCall, getStatsToday } from './memory/logger'
import { embed, findTopK } from './memory/embeddings'
import { getAllMemories, insertMemory } from './memory/db'

// Initialize database
initDb()

const server = createServer()
const wss = new WebSocketServer({ server })

const PORT = parseInt(process.env.JARVIS_PORT ?? '0', 10)

let _activeWs: WebSocket | null = null

export function broadcast(event: BackendEvent): void {
  if (!_activeWs || _activeWs.readyState !== WebSocket.OPEN) return
  const msg = event.type === 'audio' ? event.data : JSON.stringify(event)
  _activeWs.send(msg)
}
setEmitter(broadcast)

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

  // Send current stats
  try {
    const stats = getStatsToday()
    broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: 'fable' })
  } catch { /* db may not have data yet */ }
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

// Conversation history (kept in memory, last 40 messages = 20 turns)
const conversationHistory: Message[] = []

// ── Full voice pipeline: STT → Claude → TTS ──
eventHandlers.push(async (event) => {
  if (event.type !== 'audio') return

  broadcast({ type: 'state', state: 'thinking' })

  try {
    // 1. Transcribe speech to text
    const userText = await transcribe(event.data)
    if (!userText) {
      broadcast({ type: 'state', state: 'idle' })
      return
    }

    console.log(`[pipeline] user: "${userText}"`)
    broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })

    // Check for dashboard voice command
    const lower = userText.toLowerCase()
    if (lower.includes('show dashboard') || lower.includes('open dashboard')) {
      const stats = getStatsToday()
      broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: 'fable' })
      broadcast({ type: 'dashboard_open' })
      broadcast({ type: 'state', state: 'idle' })
      return
    }

    // 2. Retrieve relevant memories
    let topMems: string[] = []
    try {
      const queryVec = await embed(userText)
      const allMems = getAllMemories()
      if (allMems.length > 0) {
        topMems = findTopK(queryVec, allMems, 3).map(m => m.text)
      }
    } catch (err) {
      console.error('[memory] retrieval error (continuing without memories):', err)
    }

    // 3. Chat with Claude
    const { text, model, inputTokens, outputTokens, pendingMemory } = await chat(
      userText,
      conversationHistory,
      topMems,
      broadcast,
    )

    console.log(`[pipeline] jarvis (${model}): "${text.slice(0, 80)}..."`)

    // 4. Update conversation history
    conversationHistory.push({ role: 'user', content: userText })
    conversationHistory.push({ role: 'assistant', content: text })
    // Keep last 20 turns (40 messages)
    while (conversationHistory.length > 40) {
      conversationHistory.splice(0, 2)
    }

    // 5. Save memory if Claude flagged one
    if (pendingMemory) {
      try {
        const vec = await embed(pendingMemory)
        insertMemory(pendingMemory, vec)
        console.log(`[memory] saved: "${pendingMemory}"`)
      } catch (err) {
        console.error('[memory] save error:', err)
      }
    }

    // 6. Log API call to SQLite
    try {
      await logApiCall({ model, inputTokens, outputTokens })
    } catch (err) {
      console.error('[logger] error:', err)
    }

    // 7. Synthesize speech via ElevenLabs
    try {
      broadcast({ type: 'state', state: 'speaking' })
      const audioBuffer = await synthesize(text)
      broadcast({ type: 'audio', data: audioBuffer })
    } catch (err) {
      console.error('[tts] error:', err)
      // Still show the text even if TTS fails
    }

    // 8. Emit updated stats
    try {
      const stats = getStatsToday()
      broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model })
    } catch { /* ignore */ }

  } catch (err) {
    console.error('[pipeline] error:', err)
    broadcast({ type: 'error', message: String(err) })
  } finally {
    // Return to idle after a delay (to let TTS finish playing)
    setTimeout(() => broadcast({ type: 'state', state: 'idle' }), 4000)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address() as { port: number }
  // Print port to stdout so Electron main process can discover it
  process.stdout.write(JSON.stringify({ type: 'ready', port: addr.port }) + '\n')
})
