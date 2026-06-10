import { config } from 'dotenv'
config({ path: `${process.cwd()}/.env.local` })

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import type { BackendEvent, RendererEvent } from './types'
import { setEmitter } from './events'
import { transcribe } from './whisper'
import { chat, type Message } from './ollama'
import { synthesize } from './elevenlabs'
import { initDb, getUsageDaily, getUsageByModel } from './memory/db'
import { logApiCall, getStatsToday } from './memory/logger'
import { embed, findTopK } from './memory/embeddings'
import { getAllMemories, insertMemory } from './memory/db'
import { resolveConfirmation, hasPending, getLatestPending } from './confirm'
import { closeAgent } from './agents'
import { getSettings, setSettings } from './memory/settings'

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
  if (event.type === 'confirm_response') {
    void (async () => {
      try {
        const result = await resolveConfirmation(event.id, event.approved)
        broadcast({ type: 'confirm_resolved', id: event.id, approved: event.approved })
        const msg = event.approved ? (result ?? 'Done.') : 'Cancelled.'
        broadcast({ type: 'transcript', role: 'assistant', text: msg, partial: false })
        broadcast({ type: 'state', state: 'speaking' })
        try { broadcast({ type: 'audio', data: await synthesize(msg) }) } catch { /* tts optional */ }
      } catch (err) {
        broadcast({ type: 'error', message: String(err) })
      } finally {
        setTimeout(() => broadcast({ type: 'state', state: 'idle' }), 3000)
      }
    })()
    return
  }
  if (event.type === 'agent_close') {
    closeAgent(event.id)
    return
  }
  if (event.type === 'get_usage') {
    broadcast({ type: 'usage', daily: getUsageDaily(30), byModel: getUsageByModel(30) })
    return
  }
  if (event.type === 'get_settings') {
    broadcast({ type: 'settings', settings: getSettings() })
    return
  }
  if (event.type === 'set_settings') {
    const updated = setSettings(event.settings)
    broadcast({ type: 'settings', settings: updated })
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

    // If a destructive action is awaiting confirmation, interpret this utterance as the answer.
    if (hasPending()) {
      const yes = /\b(yes|yeah|yep|confirm|confirmed|send it|do it|go ahead|affirmative|proceed)\b/i.test(userText)
      const no = /\b(no|nope|cancel|stop|don'?t|negative|abort)\b/i.test(userText)
      if (yes || no) {
        const conf = getLatestPending()!
        const result = await resolveConfirmation(conf.id, yes)
        broadcast({ type: 'confirm_resolved', id: conf.id, approved: yes })
        const reply = yes ? (result ?? 'Done.') : 'Cancelled.'
        broadcast({ type: 'transcript', role: 'assistant', text: reply, partial: false })
        broadcast({ type: 'state', state: 'speaking' })
        try { broadcast({ type: 'audio', data: await synthesize(reply) }) } catch { /* tts optional */ }
        setTimeout(() => broadcast({ type: 'state', state: 'idle' }), 3000)
        return
      }
    }

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
