import Anthropic from '@anthropic-ai/sdk'
import type { BackendEvent } from './types'
import { getTools, handleTool } from './tools/index'
import { getSettings } from './memory/settings'

// Note: 'open' is intentionally excluded — it matches too broadly (e.g. "open
// vs code" is conversational), while concrete launch intents are captured by
// app names like 'spotify', 'chrome', 'vscode'.
const TOOL_KEYWORDS = [
  'email', 'gmail', 'file', 'folder', 'search', 'send', 'find',
  'launch', 'remember', 'read', 'write', 'calendar', 'spotify', 'chrome',
  'vscode', 'notepad', 'terminal', 'powershell', 'download', 'upload',
  // web search
  'web', 'internet', 'weather', 'news', 'research', 'google',
  // additional tool triggers
  'discord', 'code', 'run', 'execute',
]

export function selectModel(text: string): string {
  let pref: 'auto' | 'fable' | 'haiku' = 'auto'
  try { pref = getSettings().modelPreference } catch { /* db not ready in unit context */ }
  if (pref === 'fable') return 'claude-fable-5'
  if (pref === 'haiku') return 'claude-haiku-4-5-20251001'

  const lower = text.toLowerCase()
  const words = lower.trim().split(/\s+/)
  const hasToolKeyword = TOOL_KEYWORDS.some(kw => lower.includes(kw))
  if (words.length <= 15 && !hasToolKeyword) return 'claude-haiku-4-5-20251001'
  return 'claude-sonnet-4-6'
}

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant running as a desktop overlay. Speak in a polished, concise British manner — helpful and confident without being verbose. Keep responses under 3 sentences unless detail is genuinely needed.

CAPABILITIES — infer which tool to use from the user's natural language, never ask them for function names:
• Launch apps — "open Spotify", "launch Chrome", "start Discord" → app_launch
• Open file/folder in VS Code — "open this project in VS Code", "edit config.ts" → vscode_open
• Read files → fs_read | List folders → fs_list | Search files → fs_search | Write files → fs_write
• Run scripts → execute_file (always asks confirmation first)
• Email (compose/send/draft/reply) → gmail_compose (opens interactive popup; user sends or saves from there)
• Email (show/browse/pull emails) → gmail_browse (opens interactive viewer popup)
• Email (answer a question about emails inline) → gmail_search / gmail_read
• Calendar (view events) → calendar_list | Add/create event → calendar_create (opens event editor popup)
• Search the web for current info, news, weather, prices, facts → web_search (use proactively — never say you lack real-time access without trying this first)
• Read the full content of a URL → web_read (use after web_search for deep research)
• Multi-step research or complex tasks → spawn_agent

PERSONAL KNOWLEDGE — the user's context is injected automatically. When the user mentions someone by first name only, that person's details will appear in your context. Use it naturally without announcing it.

STORING PEOPLE & PLACES: When the user introduces someone or asks you to remember a person/place/project, include a tag at the END of your reply (after your spoken response):
[PERSON: name | relationship | context]
[PLACE: name | context]
[PROJECT: name | context]
Examples:
  [PERSON: Amanda | girlfriend | studies biology at Virginia Tech, met freshman orientation]
  [PLACE: The Lyric | favourite coffee shop in Blacksburg]
  [PROJECT: Jarvis | personal AI assistant built in Electron + TypeScript]

STORING FACTS: For general facts use [REMEMBER: fact].

RULES:
- Use tools proactively — always attempt the tool call first, never preemptively refuse.
- Google (Gmail + Calendar) credentials are configured on this system — always call the tool.
- Only report a capability missing if the tool itself throws an error.
- Never say "Certainly!" or "Of course!" — just answer directly.`

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface PendingEntity {
  name: string
  type: 'person' | 'place' | 'project' | 'org'
  relationship: string
  context: string
  aliases: string[]
}

export interface ChatResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  pendingMemory: string | null
  pendingEntities: PendingEntity[]
}

const MAX_STEPS = 6

// Lazily initialised so dotenv has run before we read the env vars
let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (_client) return _client
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    _client = new Anthropic({ authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN })
  } else if (process.env.ANTHROPIC_API_KEY) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  } else {
    throw new Error('No Claude credentials — set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in .env.local')
  }
  return _client
}

export function isChatAvailable(): boolean {
  return !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY)
}

export async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
): Promise<ChatResult> {
  const client = getClient()
  const model = selectModel(userText)

  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userText },
  ]

  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT + memoryContext,
      messages,
      tools: getTools(),
    })

    let stepText = ''
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        stepText += chunk.delta.text
        broadcast({ type: 'transcript', role: 'assistant', text: stepText, partial: true })
      }
      if (chunk.type === 'message_start') inputTokens += chunk.message.usage.input_tokens
      if (chunk.type === 'message_delta') outputTokens += chunk.usage.output_tokens
    }

    const finalMsg = await stream.finalMessage()

    if (finalMsg.stop_reason !== 'tool_use') {
      fullText = stepText
      broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
      break
    }

    // Show which tools are running — visible via streamingText in the renderer
    const toolBlocks = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    const toolLabel = toolBlocks.map(b => b.name.replace(/_/g, ' ')).join(', ')
    broadcast({ type: 'transcript', role: 'assistant', text: `→ ${toolLabel}…`, partial: true })

    messages.push({ role: 'assistant', content: finalMsg.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolBlocks.map(async (b) => {
        try {
          const result = await handleTool(b.name, b.input as Record<string, unknown>)
          return { type: 'tool_result' as const, tool_use_id: b.id, content: result }
        } catch (err) {
          return { type: 'tool_result' as const, tool_use_id: b.id, content: `Error: ${String(err)}`, is_error: true }
        }
      }),
    )

    messages.push({ role: 'user', content: toolResults })
  }

  if (!fullText) {
    fullText = 'I ran into a problem completing that — please try again.'
    broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  }

  let pendingMemory: string | null = null
  const memMatch = fullText.match(/\[REMEMBER:\s*([^\]]+)\]/i)
  if (memMatch) {
    pendingMemory = memMatch[1].trim()
    fullText = fullText.replace(memMatch[0], '').trim()
  }

  // Extract entity tags: [PERSON: name | relationship | context], [PLACE: ...], [PROJECT: ...]
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

  return { text: fullText, model, inputTokens, outputTokens, pendingMemory, pendingEntities }
}
