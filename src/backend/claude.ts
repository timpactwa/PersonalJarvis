import Anthropic from '@anthropic-ai/sdk'
import type { BackendEvent } from './types'
import { getTools, handleTool } from './tools/index'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Note: 'open' is intentionally excluded — it matches too broadly (e.g. "open
// vs code" is conversational), while concrete launch intents are captured by
// app names like 'spotify', 'chrome', 'vscode'.
const TOOL_KEYWORDS = [
  'email', 'gmail', 'file', 'folder', 'search', 'send', 'find',
  'launch', 'remember', 'read', 'write', 'calendar', 'spotify', 'chrome',
  'vscode', 'notepad', 'terminal', 'powershell', 'download', 'upload',
]

export function selectModel(text: string): string {
  const lower = text.toLowerCase()
  const words = lower.trim().split(/\s+/)
  const hasToolKeyword = TOOL_KEYWORDS.some(kw => lower.includes(kw))
  if (words.length <= 15 && !hasToolKeyword) return 'claude-haiku-4-5-20251001'
  return 'claude-fable-5'
}

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant. Speak in a polished, concise British manner — helpful and confident without being verbose. Keep responses under 3 sentences unless detail is genuinely needed. When using tools, act without asking for permission unless the action is destructive (e.g. sending an email or running a file). Never say "Certainly!" or "Of course!" — just answer directly.`

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

export async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
): Promise<ChatResult> {
  const model = selectModel(userText)
  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0
  let pendingMemory: string | null = null

  broadcast({ type: 'state', state: 'thinking' })

  // Use streaming for the initial response
  const stream = client.messages.stream({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT + memoryContext,
    messages,
    tools: getTools(),
  })

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullText += chunk.delta.text
      broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: true })
    }
    if (chunk.type === 'message_start') {
      inputTokens = chunk.message.usage.input_tokens
    }
    if (chunk.type === 'message_delta') {
      outputTokens = chunk.usage.output_tokens
    }
  }

  // Handle tool use if Claude decided to use a tool
  const finalMsg = await stream.finalMessage()

  if (finalMsg.stop_reason === 'tool_use') {
    const toolUseBlocks = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (b) => {
        try {
          const result = await handleTool(b.name, b.input as Record<string, unknown>)
          return { type: 'tool_result' as const, tool_use_id: b.id, content: result }
        } catch (err) {
          return { type: 'tool_result' as const, tool_use_id: b.id, content: `Error: ${String(err)}`, is_error: true }
        }
      }),
    )

    // Follow-up after tool results (non-streaming for simplicity)
    const followUp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT + memoryContext,
      messages: [
        ...messages,
        { role: 'assistant', content: finalMsg.content },
        { role: 'user', content: toolResults },
      ],
    })

    fullText = followUp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')

    outputTokens += followUp.usage.output_tokens
    inputTokens += followUp.usage.input_tokens

    broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  } else {
    broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  }

  // Extract memory instruction if Claude included one
  const memMatch = fullText.match(/\[REMEMBER:\s*([^\]]+)\]/i)
  if (memMatch) {
    pendingMemory = memMatch[1].trim()
    fullText = fullText.replace(memMatch[0], '').trim()
    // Rebroadcast cleaned text
    broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  }

  return { text: fullText, model, inputTokens, outputTokens, pendingMemory }
}
