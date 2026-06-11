import type { BackendEvent } from './types'
import { getTools, handleTool } from './tools/index'
import { getSettings } from './memory/settings'

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant. Speak in a polished, concise British manner — helpful and confident without being verbose. Keep responses under 3 sentences unless detail is genuinely needed. When using tools, act without asking for permission unless the action is destructive (e.g. sending an email or running a file). If the user asks you to remember something durable about them, include a tag of the form [REMEMBER: the fact] at the end of your reply. Never say "Certainly!" or "Of course!" — just answer directly.`

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
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string }
}
interface OllamaMsg {
  role: string
  content: string
  tool_calls?: OllamaToolCall[]
}
interface OllamaResponse {
  message: OllamaMsg
  prompt_eval_count?: number
  eval_count?: number
}

const MAX_STEPS = 5

function resolveConfig(): { model: string; baseUrl: string } {
  let model = process.env.OLLAMA_MODEL
  let baseUrl = process.env.OLLAMA_BASE_URL
  if (!model || !baseUrl) {
    try {
      const s = getSettings()
      model = model ?? s.ollamaModel
      baseUrl = baseUrl ?? s.ollamaBaseUrl
    } catch {
      /* db not ready (e.g. unit context) — fall through to hard defaults */
    }
  }
  return { model: model ?? 'llama3.1:8b', baseUrl: baseUrl ?? 'http://127.0.0.1:11434' }
}

function toOllamaTools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  return getTools().map(t => ({
    type: 'function',
    function: {
      name: (t as { name: string }).name,
      description: (t as { description?: string }).description ?? '',
      parameters: (t as { input_schema?: unknown }).input_schema ?? { type: 'object', properties: {} },
    },
  }))
}

function parseArgs(a: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (typeof a === 'string') {
    try {
      return JSON.parse(a) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return a ?? {}
}

export async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
): Promise<ChatResult> {
  const { model, baseUrl } = resolveConfig()
  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  const messages: OllamaMsg[] = [
    { role: 'system', content: SYSTEM_PROMPT + memoryContext },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  broadcast({ type: 'state', state: 'thinking' })

  const tools = toOllamaTools()
  let inputTokens = 0
  let outputTokens = 0
  let fullText = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const controller = new AbortController()
    // 120s — llama3.1:8b is 4.9GB and first cold-start can take 60-90s to page into RAM
    const timeoutId = setTimeout(() => controller.abort(), 120_000)

    let res: Response
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, stream: false }),
        signal: controller.signal,
      })
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Ollama timed out after 120s at ${baseUrl}. The model may still be loading into RAM — try again in a moment, or run: ollama serve`)
      }
      throw new Error(
        `Cannot reach Ollama at ${baseUrl} — start it with: ollama serve\nDetails: ${String(err)}`
      )
    } finally {
      clearTimeout(timeoutId)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Ollama HTTP ${res.status} for model "${model}": ${body || '(no body)'}`)
    }

    const data = await res.json() as OllamaResponse
    inputTokens += data.prompt_eval_count ?? 0
    outputTokens += data.eval_count ?? 0

    const msg = data.message
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
      for (const tc of msg.tool_calls) {
        let result: string
        try {
          result = await handleTool(tc.function.name, parseArgs(tc.function.arguments))
        } catch (err) {
          result = `Error: ${String(err)}`
        }
        messages.push({ role: 'tool', content: result })
      }
      continue
    }

    fullText = msg.content ?? ''
    break
  }

  broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })

  let pendingMemory: string | null = null
  const memMatch = fullText.match(/\[REMEMBER:\s*([^\]]+)\]/i)
  if (memMatch) {
    pendingMemory = memMatch[1].trim()
    fullText = fullText.replace(memMatch[0], '').trim()
    broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  }

  return { text: fullText, model: `ollama:${model}`, inputTokens, outputTokens, pendingMemory, pendingEntities: [] }
}
