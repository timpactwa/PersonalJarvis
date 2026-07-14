import { config } from 'dotenv'
config({ path: `${process.cwd()}/.env.local` })

// Global guard rails — registered before anything else runs so even startup
// crashes produce a readable error instead of a silent exit. An uncaught
// exception leaves the process in an unknown state, so we tell the renderer,
// flush, and exit non-zero — the main process restarts us. Unhandled
// rejections are logged and surfaced but are not fatal.
process.on('uncaughtException', (err) => {
  console.error('[backend] FATAL uncaught exception:', err.stack ?? err.message)
  try {
    broadcast({ type: 'error', message: `Backend crashed: ${err.message} — restarting...` })
  } catch { /* ws may not be up yet */ }
  setTimeout(() => process.exit(1), 250)
})
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
  console.error('[backend] unhandled promise rejection:', msg)
  try {
    broadcast({ type: 'error', message: `Backend error: ${reason instanceof Error ? reason.message : String(reason)}` })
  } catch { /* ws may not be up yet */ }
})

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import type { BackendEvent, RendererEvent } from './types'
import { setEmitter } from './events'
import { beginTurn, endTurn, cancelCurrent, isCurrent, isTurnActive, isAwaitingApproval, setAwaitingApproval, onCancel, type Turn } from './turnManager'
import { transcribe as transcribeLocal } from './whisper'
import { transcribe as transcribeGroq } from './groqWhisper'

function transcribe(buf: Buffer, signal?: AbortSignal): Promise<string> {
  if (process.env.GROQ_API_KEY) {
    console.error('[pipeline] STT: Groq Whisper')
    return transcribeGroq(buf, signal)
  }
  // Local Whisper can't abort mid-inference — caller discards the result via
  // its own abort check right after this resolves.
  console.error('[pipeline] STT: local Whisper')
  return transcribeLocal(buf)
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw (signal.reason instanceof Error ? signal.reason : new DOMException('cancelled', 'AbortError'))
  }
}
import { chat as chatClaude, isChatAvailable, type Message, type PendingEntity } from './claude'
import { chat as chatGroq } from './groq'
import { chat as chatOllama } from './ollama'
import { buildProviderChain, type ConcreteProvider } from './routing'

// In `auto` mode Claude handles BOTH tool and conversational requests, with
// per-turn tiered model selection (Haiku/Sonnet/Fable via selectModel). Groq is
// the fallback: used only when no Claude credentials are configured, or when
// Claude rate-limits mid-request. This keyword list still matters — it picks the
// tool-capable path when no Claude key is present, and a few callers use it to
// gate tool-only work (e.g. skipping preference-summary injection on chat turns).
const TOOL_KEYWORDS_ROUTE = [
  'email', 'gmail', 'calendar', 'file', 'folder', 'search', 'send', 'find',
  'launch', 'read', 'write', 'spotify', 'chrome', 'discord', 'vscode', 'rivals',
  'code', 'terminal', 'powershell', 'download', 'upload', 'run', 'execute',
  // app / launch intents
  'open', 'start',
  // calendar / scheduling
  'event', 'meeting', 'schedule', 'appointment',
  // music playback control
  'play', 'pause', 'resume', 'skip', 'song', 'track', 'playlist', 'volume', 'queue', 'music',
  // reminders
  'remind', 'reminder',
  // github / source control
  'github', 'pull request', 'issue', 'commit', 'repo', 'branch',
  // screen / vision
  'screenshot',
  // web search triggers
  'web', 'internet', 'weather', 'news', 'research', 'google',
  // self-configuration / usage
  'settings', 'provider', 'voice', 'configure', 'spending', 'usage', 'cost', 'rate limit',
  'command', 'teach',
  // preference/memory triggers → keep on Claude for entity extraction
  // 'remember' intentionally excluded here so those queries use Claude
]

function needsTool(text: string): boolean {
  const lower = text.toLowerCase()
  return TOOL_KEYWORDS_ROUTE.some(kw => lower.includes(kw))
}

function getLlmProvider(): import('./types').LlmProvider {
  try {
    const p = getSettings().llmProvider
    if (p === 'auto' || p === 'claude' || p === 'groq' || p === 'ollama') return p
  } catch { /* db not ready */ }
  return 'auto'
}

function getActiveProviderLabel(): string {
  const pref = getLlmProvider()
  if (pref !== 'auto') return pref
  if (isChatAvailable()) return 'claude'
  if (process.env.GROQ_API_KEY) return 'groq'
  return 'ollama'
}

function runProvider(
  provider: ConcreteProvider,
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
  signal?: AbortSignal,
) {
  if (provider === 'claude') return chatClaude(userText, history, memories, broadcast, undefined, undefined, undefined, signal)
  if (provider === 'groq') return chatGroq(userText, history, memories, broadcast, signal)
  return chatOllama(userText, history, memories, broadcast, signal)
}

// Walk the preference-ordered provider chain (claude → groq → ollama), falling
// back to the next provider on ANY failure — not just 429. A provider that is
// down throws before streaming any tokens (ECONNREFUSED / 401 / 404 / 429 / a
// stream error), so the fallback is clean. Tool errors inside a provider are
// caught internally and returned as tool results, so they never trigger a
// spurious fallback. This is what stops a single dead provider (e.g. an Ollama
// that isn't running) from hard-failing the turn.
async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
  signal?: AbortSignal,
) {
  const pref = getLlmProvider()
  const chain = buildProviderChain(pref, {
    claude: isChatAvailable(),
    groq: !!process.env.GROQ_API_KEY,
  })

  let lastErr: unknown
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]
    try {
      if (i === 0) console.error(`[pipeline] provider: ${provider} (pref: ${pref})`)
      else console.error(`[pipeline] ${chain[i - 1]} failed — falling back to ${provider}`)
      return await runProvider(provider, userText, history, memories, broadcast, signal)
    } catch (err) {
      // A user barge-in aborts the turn — that is NOT a provider failure, so
      // never fall through to the next provider on it.
      if (isAbortError(err) || signal?.aborted) throw err
      lastErr = err
      console.error(`[pipeline] provider ${provider} failed:`, err instanceof Error ? err.message : String(err))
    }
  }
  throw lastErr ?? new Error('All LLM providers failed')
}
import { synthesizeEdge } from './edgeTts'
import { handleSpotifyTool } from './tools/spotify'
import { initDb, closeDb, isDbAvailable, getDbError, getUsageDaily, getUsageByModel, getAllMemories, insertMemory, deleteMemory, getMemoryCount, getEntityCount } from './memory/db'
import { logApiCall, getStatsToday } from './memory/logger'
import { embed, findTopK } from './memory/embeddings'
import { resolveApproval, hasPending, getLatestPending, classifyApprovalUtterance } from './confirm'
import { sendEmailNow, createDraft, createCalendarEvent } from './tools/gmail'
import { upsertEntity, findMentionedEntities, getPreferenceSummary } from './memory/db'
import {
  applyContactEmailHints,
  extractContactEmailHints,
  extractEmailFromText,
  formatEntityContext,
  parseContactsFromUserMessage,
} from './memory/contacts'
import { stripResponseTags } from './responseTags'
import { markComposeCompleted, markComposeDismissed, clearComposeSuppression } from './toolSession'
import { closeAgent } from './agents'
import { runImprovementAgent } from './improvement'
import { resolvePlanPreview } from './planPreview'
import { getSettings, setSettings } from './memory/settings'
import { upsertCustomCommand, deleteCustomCommand } from './memory/customCommands'
import { monitors } from './monitors/index'
import { startCalendarMonitor } from './monitors/calendar'
import { startEmailMonitor } from './monitors/email'
import { startSpotifyMonitor } from './monitors/spotify'
import { startSystemMonitor } from './monitors/system'
import { startCustomMonitor } from './monitors/custom'
import {
  initCapture,
  startCapture,
  stopCapture,
  cancelCapture,
  shutdownCapture,
  isCaptureAvailable,
  getCaptureError,
  getSelectedDevice,
} from './audioCapture'

// Initialize database
initDb()

// Register background monitors (started on first WebSocket connection).
// speakFn is wrapped in an arrow so it's a lazy reference to speakOrIdle,
// which is declared later in this file.
monitors.addMonitor(startCalendarMonitor)
monitors.addMonitor(startEmailMonitor)
monitors.addMonitor(startSpotifyMonitor)
monitors.addMonitor(startSystemMonitor)
monitors.addMonitor(startCustomMonitor)
monitors.setSpeakFn((text) => speakOrIdle(text))

// Warm the mic stream now so the first push-to-talk is instant (device scan +
// dshow open used to cost 1-2s on the first M press).
void initCapture()

// Warm the embedding model at startup, in parallel with the mic. It lazily
// downloads/loads ~80MB on first use; doing it here (rather than on the first
// WebSocket connection) means it's usually ready before the user can speak,
// so the first turn doesn't stall on model load. Cached, so the connection-time
// warmup below becomes a no-op hit.
void embed('warmup').catch(() => {})

const server = createServer()
const wss = new WebSocketServer({ server })

const PORT = parseInt(process.env.JARVIS_PORT ?? '0', 10)

let _activeWs: WebSocket | null = null
let rendererBuild = 'UNKNOWN (no __hello)'

// Image attached by the user (drag-drop or screenshot hotkey) — consumed by
// the next conversation turn, which is forced onto Claude for vision.
let pendingImage: { imageBase64: string; mimeType: string } | null = null

// Resolves the next PTT input to the improvement agent instead of the LLM pipeline
let pendingImprovementResolve: ((answer: string) => void) | null = null

export function broadcast(event: BackendEvent): void {
  if (!_activeWs || _activeWs.readyState !== WebSocket.OPEN) return
  if (event.type === 'audio') {
    // Frame: 4-byte LE uint32 turn id + MP3 payload. The renderer drops frames
    // from turns that are no longer current (barge-in); id 0 always plays.
    const header = Buffer.alloc(4)
    header.writeUInt32LE(event.turnId ?? 0, 0)
    _activeWs.send(Buffer.concat([header, event.data]))
    return
  }
  _activeWs.send(JSON.stringify(event))
}
setEmitter(broadcast)

// A broadcast bound to one turn: emits only while that turn is still current,
// so a cancelled (barged-in) turn can never paint stale state/transcript/audio.
function forTurn(turnId: number): (e: BackendEvent) => void {
  return (e) => { if (isCurrent(turnId)) broadcast(e) }
}

// Speaking watchdog — backstop for the renderer/WS dying or dropping mid-speech.
// speakOrIdle arms this right after broadcasting `audio` or `speak_text`; the
// normal path clears it when `speech_done` comes back from the renderer. If
// the renderer reloads/crashes or the socket drops, speech_done never
// arrives and background monitors (paused via monitors.setIdle(false) for
// the duration of the turn) would stay paused forever without this.
const SPEECH_WATCHDOG_CAP_MS = 90_000
let speechWatchdogTimer: ReturnType<typeof setTimeout> | null = null

function clearSpeechWatchdog(): void {
  if (speechWatchdogTimer !== null) {
    clearTimeout(speechWatchdogTimer)
    speechWatchdogTimer = null
  }
}

// Pure math, exported for unit testing. 96kbps mono estimate + grace period,
// capped so a huge reply can't wedge the watchdog open for minutes.
export function estimateAudioWatchdogMs(audioByteLength: number): number {
  const estimatedPlaybackMs = (audioByteLength * 8 / 96_000) * 1000
  return Math.min(estimatedPlaybackMs + 5000, SPEECH_WATCHDOG_CAP_MS)
}

export function estimateSpeakTextWatchdogMs(wordCount: number): number {
  return Math.min(wordCount * 400 + 8000, SPEECH_WATCHDOG_CAP_MS)
}

function armSpeechWatchdog(ms: number, turnId: number): void {
  clearSpeechWatchdog()
  speechWatchdogTimer = setTimeout(() => {
    speechWatchdogTimer = null
    monitors.setIdle(true)
    // turnId 0 is turnless (monitor alerts etc.) and always broadcasts;
    // otherwise only restore idle if this is still the current turn — a
    // superseding turn already owns the UI state.
    if (turnId === 0 || isCurrent(turnId)) {
      broadcast({ type: 'state', state: 'idle' })
    }
  }, ms)
}

// A barge-in cancels whatever turn owns any in-flight speech watchdog — the
// tts_stop broadcast and the new turn's own lifecycle take over from here.
onCancel(() => clearSpeechWatchdog())

async function sendDiagnostics(): Promise<void> {
  const issues: string[] = []

  const provider = getLlmProvider()
  console.error(`[diag] LLM provider setting: ${provider} (active: ${getActiveProviderLabel()})`)

  if (provider === 'groq' || (provider === 'auto' && !isChatAvailable() && process.env.GROQ_API_KEY)) {
    if (process.env.GROQ_API_KEY) {
      const model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
      console.error(`[diag] LLM: Groq (${model})`)
    } else {
      issues.push('LLM provider is Groq but GROQ_API_KEY is not set in .env.local')
    }
  } else if (provider === 'ollama') {
    console.error('[diag] LLM: Ollama (forced)')
  } else if (isChatAvailable()) {
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

  if (!isDbAvailable()) {
    console.error('[diag] persistence: DISABLED —', getDbError())
    issues.push('Memory persistence is off (SQLite failed to load — run `npm run rebuild:native`). Conversations work, but nothing is saved.')
  }

  if (issues.length > 0) {
    broadcast({ type: 'error', message: issues.join('\n') })
  }
}

wss.on('connection', (ws: WebSocket) => {
  clearComposeSuppression()
  _activeWs = ws
  console.log('[backend] renderer connected')

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      void processAudio(raw as Buffer, 'renderer-ws')
      return
    }
    let event: RendererEvent
    try {
      event = JSON.parse(raw.toString()) as RendererEvent
    } catch {
      console.error('[backend] malformed JSON from renderer:', raw.toString().slice(0, 200))
      return
    }
    try {
      handleRendererEvent(event)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[backend] error handling '${event.type}' event:`, err)
      broadcast({ type: 'error', message: `Failed to handle ${event.type}: ${msg}` })
    }
  })

  ws.on('close', () => {
    // Only clear the active socket if THIS is still it. On a reconnect the new
    // connection arrives before the old one's close fires; without this guard
    // the stale close would null out the live socket and silently kill every
    // broadcast, making the app look frozen.
    if (_activeWs !== ws) {
      console.log('[backend] stale renderer socket closed (newer one active)')
      return
    }
    _activeWs = null
    rendererBuild = 'UNKNOWN (no __hello)'
    console.log('[backend] renderer disconnected')
  })

  // A reconnect mid-turn must not lie about the state — the turn is still
  // running on this side even though the renderer just (re)appeared.
  broadcast({ type: 'state', state: isTurnActive() ? 'thinking' : 'idle' })

  if (!monitors.isRunning()) {
    monitors.startAll()
    console.error('[monitors] background monitors started')
  }

  try {
    const stats = getStatsToday()
    broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: getActiveProviderLabel() })
  } catch { /* db may not have data yet */ }

  broadcast({ type: 'settings', settings: getSettings() })
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
  if (event.type === 'speech_done') {
    clearSpeechWatchdog()
    monitors.setIdle(true)
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
    // The awaiting tool call inside handleTool's gate resumes on this and
    // returns the real outcome to the model as its tool result — the model
    // phrases the reply itself in the same turn. No canned transcript/speak
    // here anymore, and confirm.ts already emits confirm_resolved on settle,
    // so we don't double-emit it.
    resolveApproval(event.id, event.approved)
    return
  }
  if (event.type === 'email_compose_dismissed') {
    markComposeDismissed(event.draft.to, event.draft.subject, event.draft.id)
    return
  }
  if (event.type === 'command_compose_dismissed') {
    return
  }
  if (event.type === 'command_save') {
    void (async () => {
      try {
        const saved = upsertCustomCommand(event.draft)
        const triggers = saved.aliases.join(', ')
        const msg = `Saved launch command "${saved.label}". Say "${triggers.split(',')[0]}" to open it.`
        broadcast({ type: 'transcript', role: 'assistant', text: msg, partial: false })
        await speakOrIdle(msg)
      } catch (err) {
        broadcast({ type: 'error', message: String(err) })
        broadcast({ type: 'state', state: 'idle' })
      }
    })()
    return
  }
  if (event.type === 'command_delete') {
    try {
      deleteCustomCommand(event.id)
    } catch (err) {
      broadcast({ type: 'error', message: String(err) })
    }
    return
  }
  if (event.type === 'email_send') {
    void (async () => {
      try {
        const { to, subject, body, cc, bcc } = event.draft
        markComposeCompleted(to, subject, event.draft.id)
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
        markComposeCompleted(to, subject, event.draft.id)
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
  if (event.type === 'get_dashboard') {
    try {
      broadcast({
        type: 'dashboard_data',
        memoryCount: getMemoryCount(),
        entityCount: getEntityCount(),
        sttEngine: process.env.GROQ_API_KEY ? 'Groq Whisper' : 'Local Whisper',
        uptimeSec: Math.floor(process.uptime()),
      })
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
    try {
      const stats = getStatsToday()
      broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: getActiveProviderLabel() })
    } catch { /* ignore */ }
    if (updated.llmProvider) {
      console.error('[backend] LLM provider changed to:', updated.llmProvider)
    }
    if (event.settings.hotkey) broadcast({ type: 'hotkey_changed', hotkey: updated.hotkey })
    if (event.settings.screenshotHotkey) broadcast({ type: 'screenshot_hotkey_changed', hotkey: updated.screenshotHotkey })
    return
  }
  if (event.type === 'get_memories') {
    try {
      const mems = getAllMemories().map(m => ({ id: m.id, text: m.text, createdAt: m.timestamp }))
      broadcast({ type: 'memories', memories: mems })
    } catch (err) {
      broadcast({ type: 'error', message: String(err) })
    }
    return
  }
  if (event.type === 'delete_memory') {
    try {
      deleteMemory(event.id)
      const mems = getAllMemories().map(m => ({ id: m.id, text: m.text, createdAt: m.timestamp }))
      broadcast({ type: 'memories', memories: mems })
    } catch (err) {
      broadcast({ type: 'error', message: String(err) })
    }
    return
  }
  if (event.type === 'image_attach') {
    pendingImage = { imageBase64: event.imageBase64, mimeType: event.mimeType }
    broadcast({ type: 'transcript', role: 'assistant', text: 'Image attached — ask me anything about it.', partial: false })
    return
  }
  if (event.type === 'plan_confirmed') {
    resolvePlanPreview(event.id, true)
    return
  }
  if (event.type === 'plan_cancelled') {
    resolvePlanPreview(event.id, false)
    return
  }
  if (event.type === 'spotify_refresh') {
    // Direct Spotify state poll — bypasses the LLM entirely for low-latency panel updates
    void handleSpotifyTool('spotify_current', {}).catch(err => {
      console.error('[spotify] refresh error:', err instanceof Error ? err.message : String(err))
    })
    return
  }
  if (event.type === 'capability_add') {
    const portAddr = server.address() as { port: number } | null
    const port = portAddr?.port ?? 0
    void runImprovementAgent(event.prompt, port).catch(err => {
      console.error('[improvement] unhandled error:', err)
      broadcast({ type: 'improvement_error', message: String(err) })
    })
    return
  }
  eventHandlers.forEach(h => h(event))
}

export const eventHandlers: Array<(e: RendererEvent) => void> = []

const conversationHistory: Message[] = []

// Latest wins IMMEDIATELY: a new utterance/text begins a fresh turn, which
// cancels whatever was in flight (beginTurn aborts the previous turn's
// signal). No queue — queued input made barge-in impossible and follow-up
// requests feel dead while the old turn droned on.

// Approval intercept + ordering note: when a destructive-tool confirmation
// (or plan preview / improvement question) is pending, isAwaitingApproval()
// is true. If THIS audio is the spoken yes/no answer, it must resolve the
// pending approval WITHOUT starting a new turn — beginTurn() cancels
// whatever turn is current, which for an awaiting turn is exactly the one
// waiting on this answer (it aborts ctx.signal, which resolves awaitApproval
// to false and races the real answer). But we can't know whether this audio
// IS the answer until it's transcribed, and normal transcription is tied to
// a turn's abort signal/state broadcasts. So: when approval is pending,
// transcribe FIRST here with no turn (an ungated 'thinking' broadcast, since
// there's no turn-bound `tb` yet) and classify the result.
//   - yes/no  → resolve the pending approval, echo the user transcript, and
//     return. No new turn is ever started; the awaiting turn resumes inside
//     handleTool and finishes on its own turn/tb.
//   - neither → this is a new, unrelated utterance. Fall through to the
//     normal turn-based pipeline, reusing the transcript we already have so
//     the audio is never transcribed twice. beginTurn() then cancels the
//     awaiting turn as an ordinary barge-in.
async function processAudio(pcmBuffer: Buffer, source: string): Promise<void> {
  if (isAwaitingApproval() && hasPending()) {
    broadcast({ type: 'state', state: 'thinking' })
    let text = ''
    try {
      text = await transcribe(pcmBuffer)
    } catch (err) {
      console.error('[pipeline] approval-intercept transcription failed — falling back to normal pipeline:', err)
      return runTurnForAudio(pcmBuffer, source)
    }
    const cls = text ? classifyApprovalUtterance(text) : null
    if (cls) {
      const pendingApproval = getLatestPending()
      if (pendingApproval) {
        resolveApproval(pendingApproval.id, cls === 'yes')
        broadcast({ type: 'transcript', role: 'user', text, partial: false })
      }
      return
    }
    return runTurnForAudio(pcmBuffer, source, text)
  }

  return runTurnForAudio(pcmBuffer, source)
}

async function runTurnForAudio(pcmBuffer: Buffer, source: string, pretranscribed?: string): Promise<void> {
  const turn = beginTurn()
  const tb = forTurn(turn.id)
  tb({ type: 'turn', id: turn.id })
  monitors.setIdle(false)

  console.error(
    '[pipeline] received audio:', pcmBuffer.length, 'bytes',
    '| source:', source,
    '| turn:', turn.id,
    '| renderer build:', rendererBuild,
  )
  tb({ type: 'state', state: 'thinking' })

  try {
    let userText = pretranscribed
    if (userText === undefined) {
      console.error('[pipeline] transcribing...')
      userText = await transcribe(pcmBuffer, turn.signal)
      throwIfAborted(turn.signal)
    }
    if (!userText) {
      console.error('[pipeline] empty transcription — returning to idle')
      tb({ type: 'transcript', role: 'assistant', text: "I didn't catch that. Try again or type your question.", partial: false })
      tb({ type: 'state', state: 'idle' })
      monitors.setIdle(true)   // no speech follows — re-enable monitor drain
      return
    }
    await runConversation(userText, tb, turn)
  } catch (err) {
    if (isAbortError(err) || turn.signal.aborted) {
      console.error(`[pipeline] turn ${turn.id} cancelled (${source}) — superseding turn owns the UI`)
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] error processing audio:', msg)
    tb({ type: 'error', message: friendlyError(err) })
    tb({ type: 'state', state: 'idle' })
    monitors.setIdle(true)   // error path plays no audio; restore monitor drain
  } finally {
    endTurn(turn.id)
  }
}

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.includes('rate_limit') || raw.includes('429')) return 'Claude is rate limited right now. Try again in a moment.'
  try {
    const parsed = JSON.parse(raw.replace(/^\d+\s*/, ''))
    return parsed?.error?.message || parsed?.message || raw
  } catch { return raw }
}

const TEXT_TOGGLE_RE = /\b(toggle|turn on|turn off|enable|disable|show|hide)\b.{0,20}\btext\b|\btext\b.{0,20}\b(toggle|on|off|show|hide)\b/i

async function processUserText(userText: string, source: string): Promise<void> {
  // UI command intercept — handled before any turn begins so it neither
  // cancels an in-flight turn nor costs LLM latency.
  if (TEXT_TOGGLE_RE.test(userText)) {
    broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })
    broadcast({ type: 'toggle_text' })
    const reply = 'Text display toggled.'
    broadcast({ type: 'transcript', role: 'assistant', text: reply, partial: false })
    void speakOrIdle(reply)
    return
  }

  // Approval intercept — see processAudio's comment for the full rationale.
  // Typed input is already verbatim text (no transcription step), so this is
  // just: pending + yes/no → resolve it and return without starting a new
  // turn; pending + neither → fall through, and beginTurn() below cancels the
  // awaiting turn as an ordinary barge-in (its awaitApproval resolves false).
  if (isAwaitingApproval() && hasPending()) {
    const cls = classifyApprovalUtterance(userText)
    if (cls) {
      const pendingApproval = getLatestPending()
      if (pendingApproval) {
        resolveApproval(pendingApproval.id, cls === 'yes')
        broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })
      }
      return
    }
  }

  const turn = beginTurn()
  const tb = forTurn(turn.id)
  tb({ type: 'turn', id: turn.id })
  monitors.setIdle(false)

  console.log(`[pipeline] user (${source}): "${userText}" | turn: ${turn.id}`)
  tb({ type: 'state', state: 'thinking' })

  try {
    await runConversation(userText, tb, turn)
  } catch (err) {
    if (isAbortError(err) || turn.signal.aborted) {
      console.error(`[pipeline] turn ${turn.id} cancelled (${source}) — superseding turn owns the UI`)
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] error processing text:', msg)
    tb({ type: 'error', message: friendlyError(err) })
    tb({ type: 'state', state: 'idle' })
    // No audio plays on the error path, so the speech_done roundtrip that
    // normally re-enables monitor drain will never fire — re-idle here or
    // background monitors stay paused for the rest of the session.
    monitors.setIdle(true)
  } finally {
    endTurn(turn.id)
  }
}

function stripMarkdownForTts(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/gs, '$1')
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/\*(.*?)\*/gs, '$1')
    .replace(/_(.*?)_/gs, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
}

// TTS priority: Edge TTS → Web Speech API (last resort, no internet needed).
// Callers without a turn (monitor alerts, improvement-agent questions, renderer
// button flows) get the defaults: ungated broadcast + turn id 0 (always plays).
async function speakOrIdle(text: string, tb: (e: BackendEvent) => void = broadcast, turn?: Turn): Promise<void> {
  const { quietMode } = getSettings()
  if (quietMode) {
    clearSpeechWatchdog()   // no speech will play — nothing to guard
    tb({ type: 'state', state: 'idle' })
    monitors.setIdle(true)   // no audio will play — re-enable monitor drain immediately
    return
  }

  const speakText = stripMarkdownForTts(text)

  try {
    const audioBuffer = await synthesizeEdge(speakText, turn?.signal)
    if (audioBuffer.length === 0) throw new Error('Edge TTS returned empty audio')
    if (turn?.signal.aborted) return
    tb({ type: 'audio', data: audioBuffer, turnId: turn?.id ?? 0 })
    armSpeechWatchdog(estimateAudioWatchdogMs(audioBuffer.length), turn?.id ?? 0)
    // Do NOT call monitors.setIdle(true) here — wait for speech_done from renderer
    return
  } catch (err) {
    // Barge-in during synthesis: propagate so the pipeline's abort path runs.
    if (isAbortError(err) || turn?.signal.aborted) throw err
    console.error('[tts] Edge TTS failed, falling back to Web Speech:', err instanceof Error ? err.message : err)
  }

  // Web Speech API fallback — renderer plays via speechSynthesis (no network needed)
  tb({ type: 'state', state: 'speaking' })
  tb({ type: 'speak_text', text: speakText })
  const wordCount = speakText.trim().split(/\s+/).filter(Boolean).length
  armSpeechWatchdog(estimateSpeakTextWatchdogMs(wordCount), turn?.id ?? 0)
  // Do NOT call monitors.setIdle(true) here — wait for speech_done from renderer
}

async function runConversation(
  userText: string,
  tb: (e: BackendEvent) => void,
  turn: Turn,
): Promise<void> {
  // Shadow the module-level broadcast: every emit inside this turn is gated on
  // the turn still being current, so a barged-in turn paints nothing stale.
  const broadcast = tb
  broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })

  // If improvement agent is waiting for user input, route this turn to it
  if (pendingImprovementResolve) {
    const resolve = pendingImprovementResolve
    pendingImprovementResolve = null
    resolve(userText)
    return
  }

  // NOTE: the yes/no-to-a-pending-approval intercept used to live here, but
  // by the time runConversation is reached a NEW turn has already begun
  // (beginTurn() already cancelled whatever turn was awaiting approval). The
  // intercept now runs at the TOP of processAudio/processUserText, before a
  // new turn starts, so a yes/no answer never cancels the turn it's meant to
  // resume. See the comments there.

  const bulkContacts = parseContactsFromUserMessage(userText)
  if (bulkContacts.length > 0) {
    for (const c of bulkContacts) {
      upsertEntity(c.name, 'person', c.relationship, c.context, [], c.email)
      console.log(`[contacts] saved ${c.name} (${c.email})`)
      try {
        const mem = `${c.name}'s email is ${c.email}`
        const vec = await embed(mem)
        insertMemory(mem, vec)
      } catch { /* non-critical */ }
    }
    const reply = bulkContacts.length === 1
      ? `Got it — I've saved ${bulkContacts[0].name} (${bulkContacts[0].email}).`
      : `Got it — I've saved ${bulkContacts.map(c => c.name).join(' and ')}.`
    conversationHistory.push({ role: 'user', content: userText })
    conversationHistory.push({ role: 'assistant', content: reply })
    broadcast({ type: 'transcript', role: 'assistant', text: reply, partial: false })
    await speakOrIdle(reply, tb, turn)
    return
  }

  const lower = userText.toLowerCase()
  if (lower.includes('show dashboard') || lower.includes('open dashboard')) {
    const stats = getStatsToday()
    broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: getActiveProviderLabel() })
    broadcast({ type: 'dashboard_open' })
    broadcast({ type: 'state', state: 'idle' })
    return
  }

  // Start embedding early — runs while sync DB calls complete
  const embedPromise = embed(userText)
  let topMems: string[] = []
  try {
    // Time context — always-current so the LLM knows when it is
    topMems.push(`Current time: ${new Date().toLocaleString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })}`)

    // User profile — the self-authored "about me", always front-of-context.
    // Soft-cap so a runaway profile can't bloat every single turn's input.
    const profile = getSettings().userProfile?.trim()
    if (profile) {
      const capped = profile.length > 600 ? `${profile.slice(0, 600)}…` : profile
      topMems.push(`About the user: ${capped}`)
    }

    // Preference summary — what tools and searches this user uses most. Only
    // relevant to tool-shaped requests; skip it on purely conversational turns
    // to keep their input lean.
    if (needsTool(userText)) {
      const prefs = getPreferenceSummary()
      if (prefs) topMems.push(prefs)
    }

    // Link contact emails stated explicitly (e.g. "that's my mom's email")
    if (applyContactEmailHints(userText, conversationHistory)) {
      const hint = extractContactEmailHints(userText, conversationHistory)
      if (hint) {
        topMems.push(`${hint.contactRef}'s email: ${hint.email}`)
        try {
          const mem = `${hint.contactRef}'s email is ${hint.email}`
          const vec = await embed(mem)
          insertMemory(mem, vec)
          console.log(`[memory] saved contact email: "${mem}"`)
        } catch (err) {
          console.error('[memory] contact email save error:', err)
        }
      }
    }

    // Entity injection — find people/places/projects mentioned by name or relationship
    const mentioned = findMentionedEntities(userText)
    for (const entity of mentioned) {
      topMems.push(formatEntityContext(entity))
    }
    // Semantic memory retrieval
    const queryVec = await embedPromise
    const allMems = getAllMemories()
    if (allMems.length > 0) {
      const semanticMems = findTopK(queryVec, allMems, 3).map(m => m.text)
      topMems.push(...semanticMems)
    }
  } catch (err) {
    console.error('[memory] retrieval error (continuing without memories):', err)
  }

  const attachedImage = pendingImage
  pendingImage = null  // consume immediately

  const useVision = !!attachedImage?.imageBase64
  if (useVision) console.error('[pipeline] vision turn — forced Claude')

  const result = useVision
    ? await chatClaude(userText, conversationHistory, topMems, broadcast, attachedImage!.imageBase64, attachedImage!.mimeType, undefined, turn.signal)
    : await chat(userText, conversationHistory, topMems, broadcast, turn.signal)
  throwIfAborted(turn.signal)
  const { text, model, inputTokens, outputTokens, pendingMemory } = result
  // Ollama's ChatResult type omits pendingEntities; default defensively so this
  // never throws regardless of which provider answered.
  const pendingEntities = (result as { pendingEntities?: PendingEntity[] }).pendingEntities ?? []

  // Re-strip handles raw text from providers that don't pre-strip (e.g. Ollama); no-op for Groq/Claude.
  const cleaned = stripResponseTags(text)
  const finalText = cleaned.text

  const report = (result as { pendingReport?: { format: 'html' | 'md'; content: string } | null }).pendingReport ?? cleaned.pendingReport
  if (report) {
    broadcast({ type: 'report', format: report.format, content: report.content })
  }

  console.log(`[pipeline] jarvis (${model}): "${finalText.slice(0, 80)}..."`)

  // A barged-in turn must not pollute history with an answer the user never
  // heard — only the still-current turn records the exchange.
  if (isCurrent(turn.id)) {
    conversationHistory.push({ role: 'user', content: userText })
    conversationHistory.push({ role: 'assistant', content: finalText })
    while (conversationHistory.length > 60) {
      conversationHistory.splice(0, 2)
    }
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

  const entitiesToSave = pendingEntities.length > 0 ? pendingEntities : cleaned.pendingEntities
  for (const entity of entitiesToSave) {
    try {
      const email = entity.email?.trim()
        || extractEmailFromText(entity.context)
        || ''
      upsertEntity(entity.name, entity.type, entity.relationship, entity.context, entity.aliases, email)
      console.log(`[entities] saved ${entity.type}: "${entity.name}"${email ? ` (${email})` : ''}`)
    } catch (err) {
      console.error('[entities] save error:', err)
    }
  }

  if (cleaned.pendingMemory && !pendingMemory) {
    try {
      const vec = await embed(cleaned.pendingMemory)
      insertMemory(cleaned.pendingMemory, vec)
    } catch { /* non-critical */ }
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

  if (finalText !== text) {
    broadcast({ type: 'transcript', role: 'assistant', text: finalText, partial: false })
  }

  throwIfAborted(turn.signal)
  await speakOrIdle(finalText, tb, turn)
}

function handlePttStart(): void {
  // BARGE-IN: a new press while a turn is thinking/speaking cancels it — the
  // abort signal kills in-flight STT/LLM/TTS, the gated broadcast mutes its
  // stale output, and tts_stop makes the renderer stop playback immediately.
  // Exception: while a confirmation prompt is awaiting the user's answer, the
  // press IS the answer path — don't cancel the turn that's waiting on it.
  if (!isAwaitingApproval()) {
    const hadTurn = cancelCurrent('barge-in')
    if (hadTurn) broadcast({ type: 'tts_stop' })
  }
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
    broadcast({ type: 'state', state: isTurnActive() ? 'thinking' : 'idle' })
    return
  }
  await processAudio(pcm, 'backend-ptt')
}

// Graceful shutdown: stop the ffmpeg capture stream (it outlives a hard kill),
// close the db cleanly, and exit. Triggered by the main process on app quit.
function shutdown(): void {
  console.error('[backend] shutdown requested — cleaning up')
  monitors.stopAll()
  shutdownCapture()
  try { closeDb() } catch { /* best effort */ }
  server.close()
  process.exit(0)
}

if (process.parentPort) {
  process.parentPort.on('message', (e: { data: { type?: string } }) => {
    const msg = e.data
    if (msg?.type === 'ptt-start') handlePttStart()
    else if (msg?.type === 'ptt-stop') void handlePttStop()
    else if (msg?.type === 'ptt-cancel') cancelCapture()
    else if (msg?.type === 'shutdown') shutdown()
  })
  console.error('[backend] parentPort PTT listener ready')
} else {
  console.error('[backend] WARNING: no parentPort — PTT capture disabled (standalone mode)')
}

// HTTP route for improvement agent to ask user questions mid-execution
server.on('request', (req, res) => {
  if (req.method === 'POST' && req.url === '/api/improvement/ask') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { question } = JSON.parse(body) as { question: string }
        console.log('[improvement] agent question:', question)

        // Speak the question via TTS
        broadcast({ type: 'transcript', role: 'assistant', text: `[Agent asks] ${question}`, partial: false })
        try {
          const audio = await synthesizeEdge(question)
          broadcast({ type: 'audio', data: audio })
        } catch { /* TTS failure is non-critical */ }

        // Wait for next PTT response (5 min timeout). Arm the same
        // awaiting-approval flag the destructive-tool gate uses so a PTT
        // press meant to answer this question isn't treated as a barge-in
        // cancel of some other in-flight turn — cleared exactly once,
        // whichever branch below resolves the promise first.
        setAwaitingApproval(true)
        const answer = await new Promise<string>((resolve) => {
          pendingImprovementResolve = resolve
          setTimeout(() => {
            if (pendingImprovementResolve === resolve) {
              pendingImprovementResolve = null
              resolve('(no response)')
            }
          }, 5 * 60 * 1000)
        })
        setAwaitingApproval(false)

        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(answer)
      } catch (err) {
        res.writeHead(500)
        res.end('Error: ' + String(err))
      }
    })
  }
})

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
  // Also signal via parentPort — stdio pipes are unreliable in Electron utilityProcess on Windows
  if (process.parentPort) {
    process.parentPort.postMessage({ type: 'ready', port: addr.port })
  }
})
