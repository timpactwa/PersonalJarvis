import type { BackendEvent } from './types'
import { getToolsForGroq, handleTool } from './tools/index'
import type { PendingEntity } from './claude'

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant running as a desktop overlay. Speak in a polished, concise British manner — helpful and confident without being verbose. Keep responses under 3 sentences unless detail is genuinely needed.

CAPABILITIES — infer which tool to use from the user's natural language, never ask them for function names:
• Launch apps — "open Spotify", "launch Chrome", "start Discord" → app_launch
• Open file/folder in VS Code → vscode_open
• Read files → fs_read | List folders → fs_list | Search files → fs_search | Write files → fs_write
• Email (compose/send/draft/reply) → gmail_compose (opens interactive popup; user sends or saves from there)
• Email (show/browse/pull emails) → gmail_browse (opens interactive viewer popup)
• Email (answer a question about emails inline) → gmail_search / gmail_read
• Calendar (view events) → calendar_list | Add/create event → calendar_create (opens event editor popup)
• Search the web for current info, news, weather, prices, facts → web_search (use proactively — never say you lack real-time access without trying this first)
• Read the full content of a URL → web_read (use after web_search for deep research)
• Multi-step research or complex tasks → spawn_agent

IMPORTANT: Google (Gmail + Calendar) credentials ARE configured on this system. Always call the gmail_* and calendar_* tools directly — never refuse or say they are unavailable.

PERSONAL KNOWLEDGE — when the user mentions someone by first name, their details will appear in your context. Use it naturally.

STORING PEOPLE & PLACES: When the user introduces someone, include at the END of your reply:
[PERSON: name | relationship | context]
[PLACE: name | context]
[PROJECT: name | context]

STORING FACTS: For general facts use [REMEMBER: fact].

RULES:
- Always attempt tool calls first — never preemptively refuse.
- Only report a capability missing if the tool itself throws an error.
- Never say "Certainly!" or "Of course!" — just answer directly.`

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

interface GroqResponse {
  choices: Array<{
    message: GroqMessage
    finish_reason: string
  }>
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number }
}

const MAX_STEPS = 5

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
): Promise<ChatResult> {
  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (!apiKey) throw new Error('GROQ_API_KEY not set in .env.local')

  const model = process.env.GROQ_MODEL ?? DEFAULT_MODEL

  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  const messages: GroqMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + memoryContext },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  const tools = toGroqTools()
  let inputTokens = 0
  let outputTokens = 0
  let fullText = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    let res: Response
    try {
      res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', stream: false }),
        signal: controller.signal,
      })
    } catch (err: unknown) {
      clearTimeout(timeoutId)
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
      throw new Error(`Groq HTTP ${res.status}: ${body || '(no body)'}`)
    }

    const data = await res.json() as GroqResponse
    inputTokens += data.usage?.prompt_tokens ?? 0
    outputTokens += data.usage?.completion_tokens ?? 0

    const choice = data.choices?.[0]
    if (!choice) {
      fullText = 'I ran into a problem completing that — please try again.'
      break
    }
    const msg = choice.message

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Show which tools are running (visible via streamingText in the renderer)
      const toolLabel = msg.tool_calls.map(tc => tc.function.name.replace(/_/g, ' ')).join(', ')
      broadcast({ type: 'transcript', role: 'assistant', text: `→ ${toolLabel}…`, partial: true })

      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
      for (const tc of msg.tool_calls) {
        let result: string
        try {
          const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
          result = await handleTool(tc.function.name, args)
        } catch (err) {
          result = `Error: ${String(err)}`
        }
        messages.push({ role: 'tool', content: result, tool_call_id: tc.id })
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
  }

  // Extract entity tags for consistent behaviour with Claude
  const pendingEntities: PendingEntity[] = []
  const entityRe = /\[(PERSON|PLACE|PROJECT|ORG):\s*([^\]]+)\]/gi
  let entityMatch: RegExpExecArray | null
  while ((entityMatch = entityRe.exec(fullText)) !== null) {
    const type = entityMatch[1].toLowerCase() as PendingEntity['type']
    const parts = entityMatch[2].split('|').map(s => s.trim())
    const [name = '', second = '', third = ''] = parts
    if (name) {
      pendingEntities.push({
        name,
        type,
        relationship: type === 'person' ? second : '',
        context: type === 'person' ? third : second,
        aliases: [],
      })
    }
    fullText = fullText.replace(entityMatch[0], '').trim()
  }

  if (pendingMemory || pendingEntities.length > 0) {
    broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  }

  return { text: fullText, model: `groq:${model}`, inputTokens, outputTokens, pendingMemory, pendingEntities }
}
