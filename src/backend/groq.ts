import type { BackendEvent } from './types'
import type { PendingEntity } from './claude'
import { getToolsForGroq, handleTool } from './tools/index'
import { PROFILE_AND_MEMORY_NOTE } from './prompt'
import { stripResponseTags } from './responseTags'
import { linkAbort } from './turnManager'

// Normalizes an aborted upstream signal into an Error with name === 'AbortError'
// so callers can distinguish cancellation from provider failures/timeouts.
function toAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('cancelled', 'AbortError')
}

const FORMAT_GUARD = `IMPORTANT: When calling tools, use the API's structured tool_calls JSON format only. Never emit XML function syntax like <function=name>{...}</function>. Only respond with plain text when no tool is needed.

`

const SYSTEM_PROMPT = `You are J.A.R.V.I.S. — Just A Rather Very Intelligent System — a personal AI assistant running as a desktop overlay, and the user's second brain.

PERSONA & VOICE:
- Formal but warm, in the polished style of the MCU JARVIS. Address the user with deference.
- Confident and concise — never verbose. One sentence when one will do; under 3 sentences unless real detail is needed.
- No filler openers ("Of course!", "Certainly!", "Sure thing!", "Great question!"). Acknowledge any error in one clause, then fix it — no apology spirals.
- Be proactive: anticipate the obvious next step. State briefly what you are about to do before a consequential action, then report the concrete result (e.g. "Done. Email composer opened.").

CAPABILITIES — infer which tool to use from the user's natural language, never ask them for function names:
• Launch apps — "open Spotify", "launch Chrome", "launch rivals" → app_launch
• Add/configure launch commands — "teach you to open X", "add a command for rivals" → command_find_executable then command_register (opens setup popup)
• List/remove custom commands → command_list / command_remove
• Open file/folder in VS Code → vscode_open
• Read files → fs_read | List folders → fs_list | Search files → fs_search | Write files → fs_write
• Email (compose/send/draft/reply) → gmail_compose (opens interactive popup; user sends or saves from there)
• Email (show/browse/pull emails) → gmail_browse (opens interactive viewer popup)
• Email (answer a question about emails inline) → gmail_search / gmail_read
• Calendar (view events) → calendar_list | Add/create event → calendar_create (opens event editor popup)
• Search the web for current info, news, weather, prices, facts → web_search (use proactively — never say you lack real-time access without trying this first)
• Read the full content of a URL → web_read (use after web_search for deep research)
• Set a timed reminder → jarvis_remind ("remind me in 30 minutes to take a break", "remind me at 5pm" — time can be ISO, "in N minutes/hours", or "at H:MMam/pm")
• Read/change Jarvis settings (provider, voice, hotkey, profile, monitor toggles) → jarvis_get_settings / jarvis_set_settings
• Enable or disable a background monitor → jarvis_set_settings with monitorCalendar / monitorEmail / monitorSpotify / monitorSystem / monitorCustom (boolean)
• Usage, spending, token counts, rate limits → jarvis_get_usage (never web_search for your own usage)
• GitHub — list/view PRs, issues, commits, repo status → github_pr_list / github_pr_view / github_issue_list / github_commit_log / github_repo_status
• Spotify — play, pause, skip, volume, search, queue, what's playing → spotify_play / spotify_pause / spotify_next / spotify_prev / spotify_volume / spotify_search / spotify_queue / spotify_current; list user's own playlists → spotify_my_playlists. When user says "play my [name] playlist", call spotify_play with type:"playlist" — it auto-searches their library first.
• Open Spotify or GitHub visual panel → jarvis_open_panel (use when user says "show", "pull up", "open dashboard", "let me see")

IMPORTANT: Google (Gmail + Calendar) credentials ARE configured on this system. Always call the gmail_* and calendar_* tools directly — never refuse or say they are unavailable.

BACKGROUND MONITORING — I watch 5 data sources automatically and speak alerts when the user is not talking:
• Calendar — 30-min and 15-min event warnings; toggleable via monitorCalendar
• Email — new important mail alerts (no promos/social); toggleable via monitorEmail
• Spotify — alerts when music stops or switches device; toggleable via monitorSpotify
• System — battery at 20% (normal) and 10% (urgent) when unplugged; toggleable via monitorSystem
• Reminders — fires jarvis_remind reminders at the requested time; toggleable via monitorCustom

PERSONAL KNOWLEDGE — when the user mentions someone by first name, their details will appear in your context. Use it naturally.

STORING PEOPLE & PLACES: When saving contacts, ALWAYS speak a natural confirmation FIRST, then append invisible metadata tags at the very end. NEVER reply with only a tag. Example: "Got it, I've saved Bob." then [PERSON: Bob | father | email: bob@example.com]
[PLACE: name | context]
[PROJECT: name | context]

STORING FACTS: For general facts use [REMEMBER: fact].

TOOL SELECTION — pick by intent, not keywords:
- Read/answer-about email → gmail_search; show emails on screen → gmail_browse; write/send email → gmail_compose.
- "What's playing" → spotify_current; "play X" → spotify_play; "queue X" → spotify_queue; "show me Spotify" → jarvis_open_panel.
- Read a file → fs_read; find a file → fs_search; list a folder → fs_list; open in editor → vscode_open; launch an app → app_launch.
- Each tool description states its "do NOT use" boundary — follow it. Call one tool at a time and check the result before the next.

RULES:
- gmail_compose ONLY when the user explicitly asks to send/draft/compose/write an email NOW — never for "I sent an email", "remember this email", or past-tense statements.
- Always attempt tool calls first — never preemptively refuse. Read a file before overwriting it.
- Only report a capability missing if the tool itself throws an error; request_capability is a last resort, never for a tool that just hit a fixable prerequisite.
- Never open with filler like "Certainly!" or "Of course!" — answer directly.
- When a tool returns an error that implies a missing prerequisite, handle it: e.g. if Spotify says no active device, the tool auto-launches it — you don't need to tell the user to open Spotify manually.
- Chain tools intelligently: if step 1 fails in a recoverable way, fix the precondition and proceed — don't stop and ask the user to retry.
- Beyond a brief pre-action note, don't narrate at length. Do it and report the result concisely.` + PROFILE_AND_MEMORY_NOTE

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  pendingMemory: string | null
  pendingEntities: PendingEntity[]
  pendingReport: { format: 'html' | 'md'; content: string } | null
}

interface GroqTool {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

interface GroqMessage {
  role: string
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

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

interface StreamResult {
  text: string
  toolCalls: Array<{ id: string; name: string; arguments: string }> | null
  inputTokens: number
  outputTokens: number
}

async function collectStream(
  res: Response,
  broadcast: (e: BackendEvent) => void,
  controller: AbortController,
): Promise<StreamResult> {
  if (!res.body) throw new Error('Groq returned an empty response body')
  const toolCallBuf: Record<number, { id: string; name: string; arguments: string }> = {}
  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  // Stream-inactivity watchdog: the connect-phase timeout is cleared once headers
  // arrive, so a stalled mid-stream read would otherwise hang the whole turn
  // forever. Reset the 20s deadline on every chunk; on expiry, abort the request.
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const resetIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), 20_000)
  }
  resetIdle()

  for await (const line of sseLines(res.body)) {
    resetIdle()
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

  if (idleTimer) clearTimeout(idleTimer)

  const toolCalls = Object.keys(toolCallBuf).length > 0
    ? Object.values(toolCallBuf).filter(tc => tc.name)
    : null

  return { text, toolCalls, inputTokens, outputTokens }
}

const MAX_STEPS = 10

interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
}

function normalizeToolArgs(parsed: unknown): Record<string, unknown> {
  if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'object' && parsed[0]) {
    return parsed[0] as Record<string, unknown>
  }
  if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  return {}
}

function parseEmbeddedToolName(raw: string): ParsedToolCall | null {
  const embedded = raw.match(/^([a-z_]+)\s*(\[[\s\S]*\]|\{[\s\S]*\})\s*$/i)
  if (!embedded) return null
  try {
    const name = embedded[1].trim()
    const args = normalizeToolArgs(JSON.parse(embedded[2].trim()))
    return { name, arguments: args }
  } catch {
    return null
  }
}

function parseFromErrorMessage(errorBody: string): ParsedToolCall | null {
  try {
    const parsed = JSON.parse(errorBody) as { error?: { message?: string } }
    const msg = parsed.error?.message
    if (!msg) return null
    const m = msg.match(/attempted to call tool '([^']+)'/)
    return m ? parseEmbeddedToolName(m[1]) : null
  } catch {
    const m = errorBody.match(/attempted to call tool '([^']+)'/)
    return m ? parseEmbeddedToolName(m[1]) : null
  }
}

/** Recover tool calls when Groq rejects XML-style or malformed tool output. */
export function parseFailedToolGeneration(errorBody: string): ParsedToolCall | null {
  let gen = ''
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { code?: string; failed_generation?: string; message?: string }
    }
    if (parsed.error?.code !== 'tool_use_failed') return parseFromErrorMessage(errorBody)
    gen = parsed.error.failed_generation?.trim() ?? ''

    const xmlBlock = gen.match(/<function=([^>]+)>([\s\S]*?)<\/function>/i)
    if (xmlBlock) {
      const name = xmlBlock[1].trim()
      const args = JSON.parse(xmlBlock[2].trim()) as Record<string, unknown>
      return { name, arguments: args }
    }

    const xmlInline = gen.match(/<function=([^\s{]+)\s*({[\s\S]*?})\s*<\/function>/i)
    if (xmlInline) {
      const name = xmlInline[1].trim()
      const args = JSON.parse(xmlInline[2].trim()) as Record<string, unknown>
      return { name, arguments: args }
    }

    if (gen.includes('"tool_calls"')) {
      const obj = JSON.parse(gen) as {
        tool_calls?: Array<{
          function: {
            name: string
            arguments?: string | Record<string, unknown>
            parameters?: Record<string, unknown>
          }
        }>
      }
      const fn = obj.tool_calls?.[0]?.function
      if (fn?.name) {
        let args: Record<string, unknown> = fn.parameters ?? {}
        if (typeof fn.arguments === 'string') args = JSON.parse(fn.arguments) as Record<string, unknown>
        else if (fn.arguments && typeof fn.arguments === 'object') args = fn.arguments
        return { name: fn.name, arguments: args }
      }
    }

    const plain = JSON.parse(gen) as { name?: string; arguments?: Record<string, unknown> }
    if (plain.name && plain.arguments) return { name: plain.name, arguments: plain.arguments }
  } catch { /* fall through */ }

  const fromGen = parseEmbeddedToolName(gen)
  if (fromGen) return fromGen

  return parseFromErrorMessage(errorBody)
}

function toGroqTools(): GroqTool[] {
  return getToolsForGroq().map(t => ({
    type: 'function',
    function: {
      name: (t as { name: string }).name,
      description: (t as { description?: string }).description ?? '',
      parameters: (t as { input_schema?: unknown }).input_schema ?? { type: 'object', properties: {} },
    },
  }))
}

export async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (!apiKey) throw new Error('GROQ_API_KEY not set in .env.local')

  const model = process.env.GROQ_MODEL ?? DEFAULT_MODEL

  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  const messages: GroqMessage[] = [
    { role: 'system', content: FORMAT_GUARD + SYSTEM_PROMPT + memoryContext },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  const tools = toGroqTools()
  let inputTokens = 0
  let outputTokens = 0
  let fullText = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) throw toAbortError(signal)

    const controller = new AbortController()
    const unlink = linkAbort(signal, controller)
    try {
      const timeoutId = setTimeout(() => controller.abort(), 30_000)

      let res: Response
      try {
        res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            tools,
            tool_choice: 'auto',
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal: controller.signal,
        })
      } catch (err: unknown) {
        clearTimeout(timeoutId)
        if (signal?.aborted) throw toAbortError(signal)
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Groq API timed out after 30s — check your internet connection')
        }
        throw new Error(`Groq request failed: ${String(err)}`)
      } finally {
        clearTimeout(timeoutId)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        if (res.status === 401) throw new Error('Groq API key is invalid. Check GROQ_API_KEY in .env.local')
        if (res.status === 429) throw new Error('Groq rate limit hit — wait a moment and try again')

        const recovered = res.status === 400 ? parseFailedToolGeneration(body) : null
        if (recovered) {
          console.error(`[groq] recovered tool call from failed_generation: ${recovered.name}`)

          let result: string
          try {
            result = await runToolCall(recovered.name, recovered.arguments, userText, signal)
            if (signal?.aborted) throw toAbortError(signal)
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err
            result = `Error: ${String(err)}`
          }

          const syntheticId = `recovered-${step}`
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: syntheticId,
              type: 'function',
              function: { name: recovered.name, arguments: JSON.stringify(recovered.arguments) },
            }],
          })
          messages.push({ role: 'tool', content: result, tool_call_id: syntheticId })
          continue
        }

        throw new Error(`Groq HTTP ${res.status}: ${body || '(no body)'}`)
      }

      let streamed: StreamResult
      try {
        streamed = await collectStream(res, broadcast, controller)
      } catch (err) {
        if (signal?.aborted) throw toAbortError(signal)
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Groq stream stalled (no data for 20s) — aborted')
        }
        throw err
      }
      const { text, toolCalls, inputTokens: i, outputTokens: o } = streamed
      inputTokens += i
      outputTokens += o

      if (signal?.aborted) throw toAbortError(signal)

      if (toolCalls && toolCalls.length > 0) {
        // Tool runs surface in the Activity log (from handleTool), not the chat.
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
          if (signal?.aborted) throw toAbortError(signal)
          let result: string
          try {
            const args = JSON.parse(tc.arguments) as Record<string, unknown>
            result = await runToolCall(tc.name, args, userText, signal)
            if (signal?.aborted) throw toAbortError(signal)
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') throw err
            result = `Error: ${String(err)}`
          }
          messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
        }
        continue
      }

      fullText = text
      break
    } finally {
      unlink()
    }
  }

  const { text, pendingMemory, pendingEntities, pendingReport } = stripResponseTags(fullText)
  fullText = text

  broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })

  return { text: fullText, model: `groq:${model}`, inputTokens, outputTokens, pendingMemory, pendingEntities, pendingReport }
}

async function runToolCall(
  name: string,
  args: Record<string, unknown>,
  userText: string,
  signal?: AbortSignal,
): Promise<string> {
  return handleTool(name, args, { userText, signal })
}
