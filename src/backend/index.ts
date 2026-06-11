import { config } from 'dotenv'
config({ path: `${process.cwd()}/.env.local` })

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import type { BackendEvent, RendererEvent } from './types'
import { setEmitter } from './events'
import { transcribe as transcribeLocal } from './whisper'
import { transcribe as transcribeGroq } from './groqWhisper'

function transcribe(buf: Buffer): Promise<string> {
  if (process.env.GROQ_API_KEY) {
    console.error('[pipeline] STT: Groq Whisper')
    return transcribeGroq(buf)
  }
  console.error('[pipeline] STT: local Whisper')
  return transcribeLocal(buf)
}
import { chat as chatClaude, isChatAvailable, type Message } from './claude'
import { chat as chatGroq } from './groq'
import { chat as chatOllama } from './ollama'

// Tool-keyword requests go to Groq (generous rate limits, reliable tool use).
// Pure conversational requests go to Claude Haiku (better personality/reasoning).
// If Claude rate-limits, Groq catches it.
const TOOL_KEYWORDS_ROUTE = [
  'email', 'gmail', 'calendar', 'file', 'folder', 'search', 'send', 'find',
  'launch', 'open', 'read', 'write', 'spotify', 'chrome', 'discord', 'vscode',
  'code', 'terminal', 'powershell', 'download', 'upload', 'run', 'execute',
  // web search triggers
  'web', 'internet', 'weather', 'news', 'research', 'google',
  // preference/memory triggers → keep on Claude for entity extraction
  // 'remember' intentionally excluded here so those queries use Claude
]

function needsTool(text: string): boolean {
  const lower = text.toLowerCase()
  return TOOL_KEYWORDS_ROUTE.some(kw => lower.includes(kw))
}

function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
) {
  if (process.env.GROQ_API_KEY && needsTool(userText)) {
    console.error('[pipeline] tool request — using Groq')
    return chatGroq(userText, history, memories, broadcast)
  }
  if (isChatAvailable()) {
    console.error('[pipeline] conversational — using Claude')
    return chatClaude(userText, history, memories, broadcast).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if ((msg.includes('429') || msg.includes('rate_limit')) && process.env.GROQ_API_KEY) {
        console.error('[pipeline] Claude rate limited — falling back to Groq')
        return chatGroq(userText, history, memories, broadcast)
      }
      throw err
    })
  }
  if (process.env.GROQ_API_KEY) {
    console.error('[pipeline] using Groq LLM')
    return chatGroq(userText, history, memories, broadcast)
  }
  console.error('[pipeline] using Ollama LLM (last resort)')
  return chatOllama(userText, history, memories, broadcast)
}
import { synthesize } from './elevenlabs'
import { initDb, getUsageDaily, getUsageByModel, getAllMemories, insertMemory } from './memory/db'
import { logApiCall, getStatsToday } from './memory/logger'
import { embed, findTopK } from './memory/embeddings'
import { resolveConfirmation, hasPending, getLatestPending } from './confirm'
import { sendEmailNow, createDraft, createCalendarEvent } from './tools/gmail'
import { upsertEntity, findMentionedEntities, getPreferenceSummary } from './memory/db'
import { closeAgent } from './agents'
import { getSettings, setSettings } from './memory/settings'
import {
  initCapture,
  startCapture,
  stopCapture,
  cancelCapture,
  isCaptureAvailable,
  getCaptureError,
  getSelectedDevice,
} from './audioCapture'

// Initialize database
initDb()

// Warm the mic stream now so the first push-to-talk is instant (device scan +
// dshow open used to cost 1-2s on the first M press).
void initCapture()

const server = createServer()
const wss = new WebSocketServer({ server })

const PORT = parseInt(process.env.JARVIS_PORT ?? '0', 10)

let _activeWs: WebSocket | null = null
let rendererBuild = 'UNKNOWN (no __hello)'
let isProcessing = false

export function broadcast(event: BackendEvent): void {
  if (!_activeWs || _activeWs.readyState !== WebSocket.OPEN) return
  const msg = event.type === 'audio' ? event.data : JSON.stringify(event)
  _activeWs.send(msg)
}
setEmitter(broadcast)

async function sendDiagnostics(): Promise<void> {
  const issues: string[] = []

  if (isChatAvailable()) {
    console.error('[diag] LLM: Claude (Fable 5 / Haiku 4.5 — model routing active)')
  } else if (process.env.GROQ_API_KEY) {
    const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
    console.error(`[diag] LLM: Groq fallback (${model})`)
  } else {
    // Check Ollama as last resort
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags', {
        signal: AbortSignal.timeout(3000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json() as { models?: { name: string }[] }
      const models = data.models?.map(m => m.name) ?? []
      console.error('[diag] LLM: Ollama OK — models:', models.join(', ') || '(none)')
      if (models.length === 0) {
        issues.push('Ollama has no models. Run: ollama pull llama3.1:8b')
      }
    } catch (err) {
      console.error('[diag] Ollama unreachable:', err)
      issues.push('No LLM available. Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in .env.local, or run: ollama serve')
    }
  }

  if (!process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY === 'your_key_from_elevenlabs') {
    console.error('[diag] TTS disabled — ELEVENLABS_API_KEY not set in .env.local')
  } else {
    console.error('[diag] TTS: ElevenLabs key configured')
  }

  if (!isCaptureAvailable()) {
    const err = getCaptureError() ?? 'unknown reason'
    console.error('[diag] mic capture unavailable:', err)
    issues.push(`Mic capture unavailable (${err}). Text input still works.`)
  } else {
    // Warm up device detection on startup so we know which mic will be used
    const selectedDevice = getSelectedDevice()
    if (selectedDevice) {
      console.error('[diag] mic: selected device:', selectedDevice)
    } else {
      console.error('[diag] mic: available, device will be selected on first recording')
    }
  }

  if (issues.length > 0) {
    broadcast({ type: 'error', message: issues.join('\n') })
  }
}

wss.on('connection', (ws: WebSocket) => {
  _activeWs = ws
  console.log('[backend] renderer connected')

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      void processAudio(raw as Buffer, 'renderer-ws')
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
    rendererBuild = 'UNKNOWN (no __hello)'
    console.log('[backend] renderer disconnected')
  })

  broadcast({ type: 'state', state: 'idle' })

  try {
    const stats = getStatsToday()
    const activeModel = isChatAvailable() ? 'claude' : process.env.GROQ_API_KEY ? 'groq' : 'ollama'
    broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: activeModel })
  } catch { /* db may not have data yet */ }

  void sendDiagnostics()
  // Pre-warm embedding model in background — avoids 3-5s freeze on first query
  void embed('warmup').catch(() => {})
})

function handleRendererEvent(event: RendererEvent): void {
  if (event.type === 'command' && event.text?.startsWith('__hello')) {
    rendererBuild = event.text.replace('__hello', '').trim()
    console.error('[backend] renderer build:', rendererBuild)
    return
  }
  if (event.type === 'command' && event.text === '__ptt_start') {
    return
  }
  if (event.type === 'command' && event.text && !event.text.startsWith('__')) {
    void processUserText(event.text, 'text-input')
    return
  }
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
        await speakOrIdle(msg)
      } catch (err) {
        broadcast({ type: 'error', message: String(err) })
        broadcast({ type: 'state', state: 'idle' })
      }
    })()
    return
  }
  if (event.type === 'email_send') {
    void (async () => {
      try {
        const { to, subject, body, cc, bcc } = event.draft
        const result = await sendEmailNow(to, subject, body, cc, bcc)
        broadcast({ type: 'transcript', role: 'assistant', text: result, partial: false })
        await speakOrIdle(result)
      } catch (err) {
        broadcast({ type: 'error', message: String(err) })
        broadcast({ type: 'state', state: 'idle' })
      }
    })()
    return
  }
  if (event.type === 'email_draft_save') {
    void (async () => {
      try {
        const { to, subject, body, cc, bcc } = event.draft
        const result = await createDraft(to, subject, body, cc, bcc)
        broadcast({ type: 'transcript', role: 'assistant', text: result, partial: false })
        await speakOrIdle(result)
      } catch (err) {
        broadcast({ type: 'error', message: String(err) })
        broadcast({ type: 'state', state: 'idle' })
      }
    })()
    return
  }
  if (event.type === 'event_create') {
    void (async () => {
      try {
        const { title, start, end, description } = event.event
        const result = await createCalendarEvent(title, start, end, description)
        broadcast({ type: 'transcript', role: 'assistant', text: result, partial: false })
        await speakOrIdle(result)
      } catch (err) {
        broadcast({ type: 'error', message: String(err) })
        broadcast({ type: 'state', state: 'idle' })
      }
    })()
    return
  }
  if (event.type === 'agent_close') {
    closeAgent(event.id)
    return
  }
  if (event.type === 'get_usage') {
    try {
      broadcast({ type: 'usage', daily: getUsageDaily(30), byModel: getUsageByModel(30) })
    } catch (err) {
      broadcast({ type: 'error', message: String(err) })
    }
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
  eventHandlers.forEach(h => h(event))
}

export const eventHandlers: Array<(e: RendererEvent) => void> = []

const conversationHistory: Message[] = []

// One pending utterance (latest wins). Input that arrives while the pipeline
// is busy is processed as soon as the current turn finishes instead of being
// silently dropped — dropping it made follow-up requests feel dead.
let pending: { kind: 'audio'; pcm: Buffer } | { kind: 'text'; text: string } | null = null

function drainPending(): void {
  if (!pending) return
  const next = pending
  pending = null
  if (next.kind === 'audio') void processAudio(next.pcm, 'queued-ptt')
  else void processUserText(next.text, 'queued-text')
}

async function processAudio(pcmBuffer: Buffer, source: string): Promise<void> {
  if (isProcessing) {
    console.warn('[pipeline] busy — queueing audio from', source)
    pending = { kind: 'audio', pcm: pcmBuffer }
    return
  }
  isProcessing = true

  console.error(
    '[pipeline] received audio:', pcmBuffer.length, 'bytes',
    '| source:', source,
    '| renderer build:', rendererBuild,
  )
  broadcast({ type: 'state', state: 'thinking' })

  try {
    console.error('[pipeline] transcribing...')
    const userText = await transcribe(pcmBuffer)
    if (!userText) {
      console.error('[pipeline] empty transcription — returning to idle')
      broadcast({ type: 'transcript', role: 'assistant', text: "I didn't catch that. Try again or type your question.", partial: false })
      broadcast({ type: 'state', state: 'idle' })
      return
    }
    await runConversation(userText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] error processing audio:', msg)
    broadcast({ type: 'error', message: msg })
    broadcast({ type: 'state', state: 'idle' })
  } finally {
    isProcessing = false
    drainPending()
  }
}

const TEXT_TOGGLE_RE = /\b(toggle|turn on|turn off|enable|disable|show|hide)\b.{0,20}\btext\b|\btext\b.{0,20}\b(toggle|on|off|show|hide)\b/i

async function processUserText(userText: string, source: string): Promise<void> {
  if (isProcessing) {
    console.warn('[pipeline] busy — queueing text from', source)
    pending = { kind: 'text', text: userText }
    return
  }

  // UI command intercept — handle before the LLM to keep latency near zero
  if (TEXT_TOGGLE_RE.test(userText)) {
    broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })
    broadcast({ type: 'toggle_text' })
    const reply = 'Text display toggled.'
    broadcast({ type: 'transcript', role: 'assistant', text: reply, partial: false })
    void speakOrIdle(reply)
    return
  }

  isProcessing = true

  console.log(`[pipeline] user (${source}): "${userText}"`)
  broadcast({ type: 'state', state: 'thinking' })

  try {
    await runConversation(userText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] error processing text:', msg)
    broadcast({ type: 'error', message: msg })
    broadcast({ type: 'state', state: 'idle' })
  } finally {
    isProcessing = false
    drainPending()
  }
}

// Speak `text` if TTS is configured, otherwise go idle immediately. The
// renderer drives the speaking→idle transition around actual audio playback,
// so no fixed timers — those kept the UI locked for seconds after every reply.
async function speakOrIdle(text: string): Promise<void> {
  if (!process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY === 'your_key_from_elevenlabs') {
    broadcast({ type: 'state', state: 'idle' })
    return
  }
  try {
    const audioBuffer = await synthesize(text)
    broadcast({ type: 'audio', data: audioBuffer })
  } catch (err) {
    const ttsMsg = err instanceof Error ? err.message : String(err)
    console.error('[tts] error:', ttsMsg)
    broadcast({ type: 'error', message: `TTS failed: ${ttsMsg}` })
    broadcast({ type: 'state', state: 'idle' })
  }
}

async function runConversation(userText: string): Promise<void> {
  broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })

  if (hasPending()) {
    const yes = /\b(yes|yeah|yep|confirm|confirmed|send it|do it|go ahead|affirmative|proceed)\b/i.test(userText)
    const no = /\b(no|nope|cancel|stop|don'?t|negative|abort)\b/i.test(userText)
    if (yes || no) {
      const conf = getLatestPending()!
      const result = await resolveConfirmation(conf.id, yes)
      broadcast({ type: 'confirm_resolved', id: conf.id, approved: yes })
      const reply = yes ? (result ?? 'Done.') : 'Cancelled.'
      broadcast({ type: 'transcript', role: 'assistant', text: reply, partial: false })
      await speakOrIdle(reply)
      return
    }
  }

  const lower = userText.toLowerCase()
  if (lower.includes('show dashboard') || lower.includes('open dashboard')) {
    const stats = getStatsToday()
    const activeModel = isChatAvailable() ? 'claude' : process.env.GROQ_API_KEY ? 'groq' : 'ollama'
    broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: activeModel })
    broadcast({ type: 'dashboard_open' })
    broadcast({ type: 'state', state: 'idle' })
    return
  }

  let topMems: string[] = []
  try {
    // Time context — always-current so the LLM knows when it is
    topMems.push(`Current time: ${new Date().toLocaleString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })}`)

    // Preference summary — what tools and searches this user uses most
    const prefs = getPreferenceSummary()
    if (prefs) topMems.push(prefs)

    // Entity injection — find people/places/projects mentioned by name
    const mentioned = findMentionedEntities(userText)
    for (const entity of mentioned) {
      const rel = entity.relationship ? ` (${entity.relationship})` : ''
      topMems.push(`${entity.name}${rel}: ${entity.context}`)
    }
    // Semantic memory retrieval
    const queryVec = await embed(userText)
    const allMems = getAllMemories()
    if (allMems.length > 0) {
      const semanticMems = findTopK(queryVec, allMems, 3).map(m => m.text)
      topMems.push(...semanticMems)
    }
  } catch (err) {
    console.error('[memory] retrieval error (continuing without memories):', err)
  }

  const { text, model, inputTokens, outputTokens, pendingMemory, pendingEntities } = await chat(
    userText,
    conversationHistory,
    topMems,
    broadcast,
  )

  console.log(`[pipeline] jarvis (${model}): "${text.slice(0, 80)}..."`)

  conversationHistory.push({ role: 'user', content: userText })
  conversationHistory.push({ role: 'assistant', content: text })
  while (conversationHistory.length > 40) {
    conversationHistory.splice(0, 2)
  }

  if (pendingMemory) {
    try {
      const vec = await embed(pendingMemory)
      insertMemory(pendingMemory, vec)
      console.log(`[memory] saved: "${pendingMemory}"`)
    } catch (err) {
      console.error('[memory] save error:', err)
    }
  }

  for (const entity of pendingEntities) {
    try {
      upsertEntity(entity.name, entity.type, entity.relationship, entity.context, entity.aliases)
      console.log(`[entities] saved ${entity.type}: "${entity.name}"`)
    } catch (err) {
      console.error('[entities] save error:', err)
    }
  }

  try {
    await logApiCall({ model, inputTokens, outputTokens })
  } catch (err) {
    console.error('[logger] error:', err)
  }

  try {
    const stats = getStatsToday()
    broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model })
  } catch { /* ignore */ }

  await speakOrIdle(text)
}

function handlePttStart(): void {
  // Recording is allowed even while a previous turn is processing — the
  // utterance is queued on release instead of being silently dropped.
  if (!isCaptureAvailable()) {
    const err = getCaptureError() ?? 'native audio capture unavailable'
    console.error('[ptt] cannot start capture:', err)
    broadcast({ type: 'error', message: `${err}. Use the text input (Ctrl+K) instead.` })
    return
  }
  if (!startCapture()) {
    broadcast({ type: 'error', message: 'Microphone is still warming up — try again in a second, or use the text input (Ctrl+K).' })
    return
  }
  broadcast({ type: 'state', state: 'listening' })
}

async function handlePttStop(): Promise<void> {
  const pcm = stopCapture()
  if (!pcm) {
    if (!isProcessing) broadcast({ type: 'state', state: 'idle' })
    return
  }
  await processAudio(pcm, 'backend-ptt')
}

if (process.parentPort) {
  process.parentPort.on('message', (e: { data: { type?: string } }) => {
    const msg = e.data
    if (msg?.type === 'ptt-start') handlePttStart()
    else if (msg?.type === 'ptt-stop') handlePttStop()
    else if (msg?.type === 'ptt-cancel') cancelCapture()
  })
  console.error('[backend] parentPort PTT listener ready')
} else {
  console.error('[backend] WARNING: no parentPort — PTT capture disabled (standalone mode)')
}

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address() as { port: number }
  console.error('[backend] listening on port', addr.port)

  if (isCaptureAvailable()) {
    console.error('[backend] native mic capture: available')
  } else {
    console.error('[backend] WARNING: native mic capture unavailable —', getCaptureError())
    console.error('[backend] Voice PTT disabled. Text input (Ctrl+K) still works.')
  }

  process.stdout.write(JSON.stringify({ type: 'ready', port: addr.port }) + '\n')
})
