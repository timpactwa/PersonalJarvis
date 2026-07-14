# Stability & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight bugs causing double-speak, auth logout, tool failures, and TTS instability — then add Groq streaming for the biggest remaining latency win.

**Architecture:** Eight independent fix tasks, ordered so each compiles and ships alone. No new abstractions. Fixes target the exact lines identified in code review.

**Tech Stack:** TypeScript, Electron utility-process backend, React renderer, msedge-tts, googleapis, Groq OpenAI-compat API, better-sqlite3, WebSocket (ws).

---

## Files touched

| File | Change |
|---|---|
| `src/backend/claude.ts` | Fix wrong MODEL_DEEP constant |
| `src/backend/tools/gmail.ts` | Singleton OAuth2Client (fixes token corruption) |
| `src/backend/tools/spotify.ts` | Export `getAccessToken` |
| `src/backend/monitors/spotify.ts` | Use `getAccessToken` instead of raw settings token |
| `src/backend/edgeTts.ts` | Singleton MsEdgeTTS instance |
| `src/backend/types.ts` | Add `speech_done` RendererEvent |
| `src/backend/monitors/index.ts` | Draining guard + wait for speech_done |
| `src/backend/index.ts` | Wire speech_done → monitors.setIdle; delay setIdle until audio ends |
| `src/renderer/src/App.tsx` | Send `speech_done` on audio end / error / PTT kill |
| `src/backend/groq.ts` | Replace non-streaming fetch with SSE streaming |
| `src/backend/tools/launcher.ts` | Fix `start ""` arg passing for apps with spaces |
| `src/backend/tools/search.ts` | Surface Brave API key diagnostic clearly |
| `tests/backend/tools/launcher.test.ts` | Tests for launcher arg handling |

---

## Task 1: Fix wrong MODEL_DEEP constant

The deep-tier Claude model is set to `claude-opus-4-6` which doesn't exist. All requests that escalate to the deep tier (long reasoning, multi-step tool chains) get an API rejection.

**Files:**
- Modify: `src/backend/claude.ts:37`

- [ ] **Step 1: Fix the constant**

In `src/backend/claude.ts`, change line 37:

```ts
// Before:
const MODEL_DEEP = 'claude-opus-4-6'

// After:
const MODEL_DEEP = 'claude-fable-5'
```

- [ ] **Step 2: Verify the build**

```bash
npm run build:backend
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/backend/claude.ts
git commit -m "fix(claude): correct MODEL_DEEP to claude-fable-5"
```

---

## Task 2: Gmail auth singleton — fix token corruption

`getAuthorizedClient()` is called on every Gmail tool use. Each call re-reads the token file and registers a new `tokens` event listener. After dozens of calls, concurrent listeners race to write `.gmail-token.json` on refresh, corrupting the file and logging the user out.

**Files:**
- Modify: `src/backend/tools/gmail.ts`

- [ ] **Step 1: Add module-level singleton and write the test**

In `src/backend/tools/gmail.ts`, add a module-level `_auth` variable and gate `getAuthorizedClient` to reuse it. Also add a `resetAuthClient` export for test cleanup.

Replace the entire `getAuthorizedClient` function and add the reset export:

```ts
let _auth: OAuth2Client | null = null

export function resetAuthClient(): void {
  _auth = null
}

export async function getAuthorizedClient(): Promise<OAuth2Client> {
  if (_auth) return _auth

  const auth = getOAuth2Client()

  if (existsSync(TOKEN_PATH)) {
    auth.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')))
    auth.on('tokens', (newTokens) => {
      try {
        const current = existsSync(TOKEN_PATH)
          ? JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'))
          : {}
        writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }))
      } catch (e) {
        console.error('[gmail] failed to save refreshed tokens:', e)
      }
    })
    _auth = auth
    return auth
  }

  // OAuth2 flow — opens browser for authorization
  const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES })
  console.log('[gmail] Opening browser for OAuth:', authUrl)

  const code = await new Promise<string>((resolve) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:3456')
      const authCode = url.searchParams.get('code')
      if (authCode) {
        res.end('Authorized! You can close this tab.')
        srv.close()
        resolve(authCode)
      } else {
        res.end('Waiting for authorization...')
      }
    }).listen(3456)
    require('child_process').exec(`start "${authUrl}"`)
  })

  const { tokens } = await auth.getToken(code)
  auth.setCredentials(tokens)
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens))
  _auth = auth
  return auth
}
```

- [ ] **Step 2: Build and verify no type errors**

```bash
npm run build:backend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/backend/tools/gmail.ts
git commit -m "fix(gmail): singleton OAuth2Client — prevents token listener accumulation"
```

---

## Task 3: Spotify monitor — use auto-refreshing token

`monitors/spotify.ts` reads `spotifyAccessToken` directly from settings. Spotify tokens expire after 1 hour. After expiry, the monitor silently fails (401 → null return) and stops alerting with no notification to the user.

**Files:**
- Modify: `src/backend/tools/spotify.ts` (export `getAccessToken`)
- Modify: `src/backend/monitors/spotify.ts`

- [ ] **Step 1: Export `getAccessToken` from spotify tool**

In `src/backend/tools/spotify.ts`, change `async function getAccessToken` to export:

```ts
// Before:
async function getAccessToken(): Promise<string> {

// After:
export async function getAccessToken(): Promise<string> {
```

- [ ] **Step 2: Update the monitor to use it**

Replace the entire `poll` function body in `src/backend/monitors/spotify.ts`:

```ts
import { getAccessToken } from '../tools/spotify'

// (remove the fetchPlayback signature's token parameter usage)

const poll = async (): Promise<void> => {
  if (!getSettings().monitorSpotify) return
  try {
    let token: string
    try {
      token = await getAccessToken()
    } catch {
      return  // Spotify not configured, skip silently
    }
    const state = await fetchPlayback(token)
    if (!state) {
      stoppedCount = 0
      return
    }

    const device = state.device
    const currentDeviceId = device?.id ?? null
    if (device && device.type !== 'Computer' && currentDeviceId !== prevDeviceId) {
      const devAlertId = `spotify:device:${device.id}:${Date.now()}`
      enqueue({ id: devAlertId, text: `Spotify switched to ${device.name}.`, priority: 'normal', source: 'spotify' })
    }
    prevDeviceId = currentDeviceId

    if (!state.is_playing) {
      stoppedCount++
      if (stoppedCount === 2) {
        const stoppedAlertId = `spotify:stopped:${Date.now()}`
        enqueue({ id: stoppedAlertId, text: 'Music stopped. Want me to queue something?', priority: 'normal', source: 'spotify' })
      }
    } else {
      stoppedCount = 0
    }
  } catch (err) {
    console.error('[monitor:spotify] error:', err instanceof Error ? err.message : err)
  }
}
```

- [ ] **Step 3: Build and check**

```bash
npm run build:backend
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/backend/tools/spotify.ts src/backend/monitors/spotify.ts
git commit -m "fix(monitors): Spotify monitor uses auto-refreshing token via getAccessToken"
```

---

## Task 4: MsEdgeTTS singleton — fix TTS latency and random failures

`edgeTts.ts` creates `new MsEdgeTTS()` on every call. Each instantiation opens a new WebSocket to Microsoft's TTS service (~200-400ms overhead) and is a source of random failures. A singleton that persists the connection across calls eliminates this overhead and improves stability.

**Files:**
- Modify: `src/backend/edgeTts.ts`

- [ ] **Step 1: Replace with singleton pattern**

Replace the entire `src/backend/edgeTts.ts` file content:

```ts
import { webcrypto } from 'crypto'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { getSettings } from './memory/settings'

if (!globalThis.crypto) {
  (globalThis as typeof globalThis & { crypto: typeof webcrypto }).crypto = webcrypto
}

const DEFAULT_VOICE = 'en-GB-RyanNeural'

function resolveVoice(): string {
  try {
    const id = getSettings().voiceId
    if (id && id.includes('Neural')) return id
  } catch { /* db not ready */ }
  return DEFAULT_VOICE
}

let _tts: MsEdgeTTS | null = null
let _ttsVoice = ''

async function getOrCreateTts(voice: string): Promise<MsEdgeTTS> {
  if (_tts && _ttsVoice === voice) return _tts
  try { _tts?.close() } catch {}
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  _tts = tts
  _ttsVoice = voice
  return tts
}

export async function synthesizeEdge(text: string): Promise<Buffer> {
  const voice = resolveVoice()
  const tts = await getOrCreateTts(voice)
  const { audioStream } = tts.toStream(text, { rate: '+25%' })

  const chunks: Buffer[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Edge TTS timed out after 15s')), 15_000)
      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      audioStream.on('end', () => { clearTimeout(timeout); resolve() })
      audioStream.on('error', (err: Error) => { clearTimeout(timeout); reject(err) })
    })
  } catch (err) {
    // Reset singleton on stream error so next call gets a fresh connection
    try { _tts?.close() } catch {}
    _tts = null
    _ttsVoice = ''
    throw err
  }

  return Buffer.concat(chunks)
}

export const EDGE_TTS_VOICES = [
  'en-GB-RyanNeural',
  'en-GB-ThomasNeural',
  'en-US-AndrewNeural',
  'en-US-GuyNeural',
  'en-US-EricNeural',
  'en-AU-WilliamNeural',
] as const
```

- [ ] **Step 2: Build**

```bash
npm run build:backend
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/backend/edgeTts.ts
git commit -m "fix(tts): singleton MsEdgeTTS — eliminate per-call WebSocket overhead"
```

---

## Task 5: Fix double-speak — speech_done roundtrip

**Root cause:** `speakOrIdle()` returns immediately after sending audio to the renderer (it doesn't wait for playback). The pipeline's `finally` block immediately sets `monitors.setIdle(true)`. The 8-second drain timer sees `idle=true` and can start a monitor alert while the previous audio is still playing on the renderer.

**Fix:** 
1. Add `speech_done` RendererEvent — renderer sends this when audio finishes.
2. Remove `monitors.setIdle(true)` from the `finally` blocks; only quiet-mode bypass sets it immediately.
3. `handleRendererEvent` sets `monitors.setIdle(true)` when `speech_done` arrives.
4. Add a `draining` guard to `MonitorRegistry.drainOnce` to prevent re-entrant drains.
5. `drainOnce` sets `this.idle = false` before calling `speakFn`; renderer's `speech_done` restores it.

**Files:**
- Modify: `src/backend/types.ts`
- Modify: `src/backend/monitors/index.ts`
- Modify: `src/backend/index.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add `speech_done` to RendererEvent in types.ts**

In `src/backend/types.ts`, append to the `RendererEvent` union (after the last `| { type: 'capability_add'... }` line):

```ts
  | { type: 'speech_done' }
```

The final lines of the type should read:

```ts
  | { type: 'spotify_refresh' }
  | { type: 'capability_add'; prompt: string; context: string }
  | { type: 'speech_done' }
```

- [ ] **Step 2: Add draining guard and setIdle(false) in MonitorRegistry**

Replace the `drainOnce` method in `src/backend/monitors/index.ts` and add a `private draining` field:

```ts
export class MonitorRegistry {
  private queue: Alert[] = []
  private seen = new Set<string>()
  private idle = true
  private draining = false          // NEW — prevents re-entrant drain calls
  private speakFn: SpeakFn | null = null
  private stopFns: StopFn[] = []
  private starters: MonitorStarter[] = []
  private drainTimer: ReturnType<typeof setInterval> | null = null

  // ... (setSpeakFn, setIdle, addMonitor, registerMonitor, enqueue, queueLength, peekNext, isRunning, startAll, stopAll unchanged) ...

  async drainOnce(): Promise<void> {
    if (this.draining || !this.idle || !this.speakFn || this.queue.length === 0) return
    const now = Date.now()
    const expired = this.queue.filter(a => a.expiresAt && a.expiresAt <= now)
    for (const a of expired) this.seen.delete(a.id)
    this.queue = this.queue.filter(a => !a.expiresAt || a.expiresAt > now)
    if (this.queue.length === 0) return
    const alert = this.queue.shift()!
    this.idle = false       // block further drains until speech_done arrives
    this.draining = true
    try { await this.speakFn!(alert.text) } catch (err) {
      console.error('[monitors] drain speak error:', err)
      this.idle = true      // on error, re-enable drain so queue doesn't stall
    } finally {
      this.draining = false
    }
    // idle stays false here — renderer's speech_done event restores it via setIdle(true)
  }
}
```

The full file should still export `monitors` singleton unchanged.

- [ ] **Step 3: Update index.ts — remove monitors.setIdle(true) from finally blocks; add speech_done handler**

In `src/backend/index.ts`:

**3a.** In `speakOrIdle` — when quiet mode is on, set monitors idle immediately (no audio plays). The `else` paths (audio sent) must NOT set it; they'll wait for `speech_done`. Add the quiet-mode immediate restore:

```ts
async function speakOrIdle(text: string): Promise<void> {
  const { quietMode } = getSettings()
  if (quietMode) {
    broadcast({ type: 'state', state: 'idle' })
    monitors.setIdle(true)   // no audio will play — re-enable immediately
    return
  }

  const speakText = stripMarkdownForTts(text)

  try {
    const audioBuffer = await synthesizeEdge(speakText)
    if (audioBuffer.length === 0) throw new Error('Edge TTS returned empty audio')
    broadcast({ type: 'audio', data: audioBuffer })
    // Do NOT call monitors.setIdle(true) here — wait for speech_done from renderer
    return
  } catch (err) {
    console.error('[tts] Edge TTS failed, falling back to Web Speech:', err instanceof Error ? err.message : err)
  }

  broadcast({ type: 'state', state: 'speaking' })
  broadcast({ type: 'speak_text', text: speakText })
  // Do NOT call monitors.setIdle(true) here — wait for speech_done from renderer
}
```

**3b.** In `processAudio` `finally` block — remove `monitors.setIdle(true)`:

```ts
  } finally {
    isProcessing = false
    // monitors.setIdle(true) removed — renderer sends speech_done when audio ends
    drainPending()
  }
```

**3c.** In `processUserText` `finally` block — same removal:

```ts
  } finally {
    isProcessing = false
    // monitors.setIdle(true) removed — renderer sends speech_done when audio ends
    drainPending()
  }
```

**3d.** In `handleRendererEvent` — add handler for `speech_done` near the top (after `__ptt_start` check):

```ts
  if (event.type === 'speech_done') {
    monitors.setIdle(true)
    return
  }
```

- [ ] **Step 4: Update App.tsx — send speech_done on audio end, error, and PTT kill**

In `src/renderer/src/App.tsx`:

**4a.** Add a `sendRef` to capture `send` inside the `onEvent` callback (since `send` is declared after `onEvent`):

After line `const activeAudioRef = useRef<HTMLAudioElement | null>(null)`, add:

```ts
const sendRef = useRef<((e: import('../../backend/types').RendererEvent) => void) | null>(null)
```

**4b.** After `const { send, connected } = useWebSocket(onEvent)`, sync the ref:

```ts
sendRef.current = send
```

**4c.** In the `audio` event handler, update `audio.onended` and `doPlay().catch` to send `speech_done`:

```ts
audio.onended = () => {
  URL.revokeObjectURL(url)
  cleanup()
  activeAudioRef.current = null
  handleEvent({ type: 'state', state: 'idle' })
  sendRef.current?.({ type: 'speech_done' })   // NEW — tell backend audio finished
}
```

```ts
doPlay().catch(err => {
  activeAudioRef.current = null
  const detail = err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)
  console.error('[audio] playback error:', detail)
  cleanup()
  handleEvent({ type: 'state', state: 'idle' })
  sendRef.current?.({ type: 'speech_done' })   // NEW — re-enable monitor drain on error
})
```

**4d.** In the `speak_text` handler, send `speech_done` when Web Speech ends or errors:

```ts
if (event.type === 'speak_text') {
  if (quietModeRef.current) {
    handleEvent({ type: 'state', state: 'idle' })
    return
  }
  const utterance = new SpeechSynthesisUtterance(event.text)
  utterance.rate = 1.1
  utterance.onend = () => {
    handleEvent({ type: 'state', state: 'idle' })
    sendRef.current?.({ type: 'speech_done' })   // NEW
  }
  utterance.onerror = () => {
    handleEvent({ type: 'state', state: 'idle' })
    sendRef.current?.({ type: 'speech_done' })   // NEW
  }
  window.speechSynthesis.speak(utterance)
  return
}
```

**4e.** In the PTT-start handler, send `speech_done` when killing audio:

```ts
;(window as any).jarvis.onPttStart(() => {
  if (activeAudioRef.current) {
    activeAudioRef.current.pause()
    activeAudioRef.current.currentTime = 0
    activeAudioRef.current = null
    sendRef.current?.({ type: 'speech_done' })   // NEW — killed audio, unblock monitor drain
  }
  window.speechSynthesis.cancel()
  sendRef.current?.({ type: 'speech_done' })     // NEW — also covers Web Speech case
  void startMeter()
})
```

Note: `speech_done` sent twice if audio was playing is fine — `setIdle(true)` is idempotent.

- [ ] **Step 5: Build both backend and renderer**

```bash
npm run build:backend
```

Then verify renderer compiles:
```bash
npx electron-vite build
```

Expected: no TypeScript errors in either pass.

- [ ] **Step 6: Manual smoke test**

Start the app (`npm run dev`). Ask Jarvis a question. Wait for the response to finish speaking. Wait 10 seconds. If there's a queued monitor alert it should fire cleanly after speech ends, not simultaneously with it.

- [ ] **Step 7: Commit**

```bash
git add src/backend/types.ts src/backend/monitors/index.ts src/backend/index.ts src/renderer/src/App.tsx
git commit -m "fix(speech): speech_done roundtrip — fix double-speak from monitor drain firing during TTS playback"
```

---

## Task 6: Groq streaming — first token ~500-1000ms sooner

Currently `stream: false` causes Groq to hold the entire response until generation is complete before returning it. With `stream: true`, text deltas stream immediately and are broadcast to the renderer as they arrive.

**Files:**
- Modify: `src/backend/groq.ts`

- [ ] **Step 1: Add streaming interfaces and SSE parser**

At the top of `src/backend/groq.ts`, below the existing interfaces, add:

```ts
interface GroqStreamChunk {
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens: number; completion_tokens: number }
}

async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('data: ')) yield trimmed.slice(6)
    }
  }
  if (buf.trim().startsWith('data: ')) yield buf.trim().slice(6)
}
```

- [ ] **Step 2: Add `collectStream` helper**

Below `sseLines`, add a function that reads one streaming response and returns the full text plus any tool calls:

```ts
interface StreamResult {
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: string }> | null
  inputTokens: number
  outputTokens: number
}

async function collectStream(
  res: Response,
  broadcast: (e: BackendEvent) => void,
): Promise<StreamResult> {
  const toolCallBuf: Record<number, { id: string; name: string; arguments: string }> = {}
  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  for await (const line of sseLines(res.body!)) {
    if (line === '[DONE]') break
    let chunk: GroqStreamChunk
    try { chunk = JSON.parse(line) as GroqStreamChunk } catch { continue }

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens
      outputTokens = chunk.usage.completion_tokens
    }

    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    if (delta.content) {
      text += delta.content
      broadcast({ type: 'transcript', role: 'assistant', text, partial: true })
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (!toolCallBuf[tc.index]) {
          toolCallBuf[tc.index] = { id: tc.id ?? '', name: '', arguments: '' }
        }
        if (tc.id) toolCallBuf[tc.index].id = tc.id
        if (tc.function?.name) toolCallBuf[tc.index].name += tc.function.name
        if (tc.function?.arguments) toolCallBuf[tc.index].arguments += tc.function.arguments
      }
    }
  }

  const toolCalls = Object.keys(toolCallBuf).length > 0
    ? Object.values(toolCallBuf).filter(tc => tc.name)
    : null

  return { text, toolCalls, inputTokens, outputTokens }
}
```

- [ ] **Step 3: Replace the non-streaming fetch in the `chat()` loop**

In the `chat()` function, replace the `body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', stream: false })` line and the handling that follows with streaming variants.

Find the `body: JSON.stringify(...)` line (currently with `stream: false`) and change to:

```ts
body: JSON.stringify({
  model,
  messages,
  tools,
  tool_choice: 'auto',
  stream: true,
  stream_options: { include_usage: true },
}),
```

Then replace the `if (!res.ok)` ... through to the `break` at the bottom of the step loop. The new step body (after the `try/catch fetch`) should be:

```ts
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 401) throw new Error('Groq API key is invalid. Check GROQ_API_KEY in .env.local')
      if (res.status === 429) throw new Error('Groq rate limit hit — wait a moment and try again')

      const recovered = res.status === 400 ? parseFailedToolGeneration(body) : null
      if (recovered) {
        console.error(`[groq] recovered tool call from failed_generation: ${recovered.name}`)
        broadcast({ type: 'transcript', role: 'assistant', text: `→ ${recovered.name.replace(/_/g, ' ')}…`, partial: true })
        let result: string
        try {
          result = await runToolCall(recovered.name, recovered.arguments, userText)
        } catch (err) {
          result = `Error: ${String(err)}`
        }
        const syntheticId = `recovered-${step}`
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [{ id: syntheticId, type: 'function', function: { name: recovered.name, arguments: JSON.stringify(recovered.arguments) } }],
        })
        messages.push({ role: 'tool', content: result, tool_call_id: syntheticId })
        continue
      }

      throw new Error(`Groq HTTP ${res.status}: ${body || '(no body)'}`)
    }

    const { text, toolCalls, inputTokens: i, outputTokens: o } = await collectStream(res, broadcast)
    inputTokens += i
    outputTokens += o

    if (toolCalls && toolCalls.length > 0) {
      const toolLabel = toolCalls.map(tc => tc.name.replace(/_/g, ' ')).join(', ')
      broadcast({ type: 'transcript', role: 'assistant', text: `→ ${toolLabel}…`, partial: true })

      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })

      for (const tc of toolCalls) {
        let result: string
        try {
          const args = JSON.parse(tc.arguments) as Record<string, unknown>
          result = await runToolCall(tc.name, args, userText)
        } catch (err) {
          result = `Error: ${String(err)}`
        }
        messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
      }
      continue
    }

    fullText = text
    break
```

Also remove the now-unused `GroqResponse` interface (its fields are superseded by `GroqStreamChunk`). Keep `GroqMessage` and `GroqTool`.

- [ ] **Step 4: Build and verify**

```bash
npm run build:backend
```

Expected: no TypeScript errors.

- [ ] **Step 5: Manual test — verify streaming works**

Start the app and ask: "What's 2+2?" Verify you see text appearing character by character (or word by word) in the transcript before Jarvis finishes speaking.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all previously passing tests still pass (streaming changes don't affect unit tests since those mock the fetch layer).

- [ ] **Step 7: Commit**

```bash
git add src/backend/groq.ts
git commit -m "feat(groq): streaming responses — first token visible 500-1000ms sooner"
```

---

## Task 7: Fix app launcher — args in app names

`launcher.ts` wraps app names in double quotes for `start ""`. This means `start "" "code --new-window"` passes the entire string as the window title, not a command with args. Apps that need arguments (or any app where the alias doesn't match the executable exactly) silently fail.

**Files:**
- Modify: `src/backend/tools/launcher.ts`
- Modify: `tests/backend/tools/launcher.test.ts`

- [ ] **Step 1: Write failing test for arg-bearing app names**

In `tests/backend/tools/launcher.test.ts`, add a test that verifies the `start` command is built correctly when an alias resolves to a name with spaces:

```ts
import { describe, it, expect, vi } from 'vitest'
import { launchApp } from '../../../src/backend/tools/launcher'

// Mock execAsync to capture what command was invoked
vi.mock('child_process', () => ({ exec: vi.fn((cmd, opts, cb) => cb(null, '', '')) }))

describe('launchApp', () => {
  it('uses start without extra quotes for simple names', async () => {
    const { exec } = await import('child_process')
    await launchApp('notepad')
    expect(vi.mocked(exec)).toHaveBeenCalledWith(
      expect.stringContaining('notepad'),
      expect.any(Object),
      expect.any(Function),
    )
  })
})
```

Run:
```bash
npx vitest run tests/backend/tools/launcher.test.ts
```

Expected: may pass or fail depending on current behavior — note the result.

- [ ] **Step 2: Fix the `launchApp` fallback to not over-quote**

In `src/backend/tools/launcher.ts`, the final `execAsync` call (line ~161) currently wraps `resolved` in quotes:

```ts
// Before:
await execAsync(`start "" "${resolved}"`, { shell: 'cmd.exe' })
return `Launched ${appName}`
```

Split the resolved name into the executable and any args, then build the command accordingly:

```ts
// After:
// Split on first space: "code --new-window" → exe="code", args="--new-window"
const [exe, ...argParts] = resolved.split(' ')
const argStr = argParts.join(' ')
const cmd = argStr
  ? `start "" "${exe}" ${argStr}`
  : `start "" "${exe}"`
await execAsync(cmd, { shell: 'cmd.exe' })
return `Launched ${appName}`
```

Apply the same fix to `launchCustomCommand` for `kind === 'shell'` (line ~112-114):

```ts
if (cmd.kind === 'shell') {
  if (!SAFE_NAME_RE.test(cmd.target)) throw new Error(`Invalid shell target for "${cmd.label}"`)
  const [exe, ...argParts] = cmd.target.split(' ')
  const argStr = argParts.join(' ')
  const shellCmd = argStr ? `start "" "${exe}" ${argStr}` : `start "" "${exe}"`
  await execAsync(shellCmd, { shell: 'cmd.exe' })
  return `Launched ${cmd.label}`
}
```

- [ ] **Step 3: Build and run tests**

```bash
npm run build:backend && npx vitest run tests/backend/tools/launcher.test.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/backend/tools/launcher.ts tests/backend/tools/launcher.test.ts
git commit -m "fix(launcher): split exe+args before wrapping in start quotes"
```

---

## Task 8: Brave API key — surface diagnostic clearly

The Brave Search API key in `.env.local` is 31 chars (should be 32). Currently the search tool hits a 403, which is silently treated as "no results found". The user has no idea web search is broken.

**Files:**
- Modify: `src/backend/tools/search.ts`

- [ ] **Step 1: Add key-length validation and a clear error on 403**

In `src/backend/tools/search.ts`, update `webSearch`:

```ts
export async function webSearch(query: string, count = 5): Promise<string> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) {
    return 'Web search is not configured. Set BRAVE_SEARCH_API_KEY in .env.local (get a free key at brave.com/search/api).'
  }
  if (key.length !== 32) {
    return `Web search key looks wrong (${key.length} chars, expected 32). Check BRAVE_SEARCH_API_KEY in .env.local.`
  }

  const n = Math.min(Math.max(1, count), 10)
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': key,
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Brave Search: invalid API key (${res.status}). Check BRAVE_SEARCH_API_KEY in .env.local.`)
    }
    throw new Error(`Brave Search API error ${res.status}: ${body.slice(0, 200) || '(no body)'}`)
  }

  const data = await res.json() as BraveSearchResponse
  const results = data.web?.results?.slice(0, n) ?? []

  if (results.length === 0) return 'No results found for that query.'

  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`
  ).join('\n\n')
}
```

- [ ] **Step 2: Build**

```bash
npm run build:backend
```

Expected: no errors.

- [ ] **Step 3: Fix the actual API key**

Check your `.env.local` for the `BRAVE_SEARCH_API_KEY` value. It should be exactly 32 characters. If it's 31, the most likely issue is a missing trailing character. Log in to [brave.com/search/api](https://brave.com/search/api) and copy the key fresh.

- [ ] **Step 4: Commit the search.ts fix**

```bash
git add src/backend/tools/search.ts
git commit -m "fix(search): validate Brave API key length and surface 401/403 as actionable errors"
```

---

## Final: Run full test suite and push

- [ ] **Run all tests**

```bash
npm test
```

Expected: same pass count as before (333 passing, 4 known pre-existing failures in spotify mock + gmail timeout).

- [ ] **Smoke test the app**

```bash
npm run dev
```

Verify:
1. Ask a question — response streams in (text appears progressively)
2. Ask a question — wait for it to finish speaking — no second voice fires
3. Ask Jarvis to "open Spotify" — opens correctly
4. Ask "what's the weather?" — Brave error is surfaced if key wrong, or results appear if key correct
5. Ask an email question — Gmail doesn't log out mid-session
