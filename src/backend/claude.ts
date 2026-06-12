import Anthropic from '@anthropic-ai/sdk'
import type { BackendEvent } from './types'
import { stripResponseTags, visibleStreamingText } from './responseTags'
import { getTools, handleTool } from './tools/index'
import { getSettings } from './memory/settings'
import { PROFILE_AND_MEMORY_NOTE } from './prompt'

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

// Three-tier model routing:
//   Fast  (Haiku)  — single quick tool calls + short conversational
//   Smart (Sonnet) — email, GitHub, multi-step tools, medium complexity
//   Deep  (Fable)  — agentic research, plan/analyze/summarize with substantive
//                    content, or chains that have already consumed ≥4 tool calls
const MODEL_FAST = 'claude-haiku-4-5-20251001'
const MODEL_SMART = 'claude-sonnet-4-6'
const MODEL_DEEP = 'claude-fable-5'

const DEEP_KEYWORDS = ['plan', 'analyze', 'analyse', 'compare', 'summarize', 'summarise', 'research', 'write']
// A deep keyword alone isn't enough — the request must carry substantive
// content. 9+ words separates "what should I plan for today" (Fast) from
// "plan out the architecture for a new auth system with oauth and jwt" (Deep).
const DEEP_MIN_WORDS = 12

// Anything touching these surfaces needs at least Sonnet.
const SMART_SIGNALS = [
  'email', 'gmail', 'github', 'pull request', 'issue', 'commit', 'repo',
  'calendar_create', 'execute', 'fs_write', 'schedule',
]

// How many tool-use steps a chain may consume before escalating to Deep.
export const ESCALATION_STEP = 4

export function selectModel(text: string, forceModel?: string, stepCount?: number): string {
  // 1. Explicit caller override always wins
  if (forceModel) return forceModel

  // 2. Settings preference — tiered routing only applies in 'auto' mode
  let pref: 'auto' | 'fable' | 'haiku' = 'auto'
  try { pref = getSettings().modelPreference } catch { /* db not ready in unit context */ }
  if (pref === 'fable') return MODEL_DEEP
  if (pref === 'haiku') return MODEL_FAST

  const lower = text.toLowerCase()
  const words = lower.trim().split(/\s+/)

  // 3. Deep tier — a multi-step chain has already consumed ≥4 tool calls
  if (stepCount !== undefined && stepCount >= ESCALATION_STEP) return MODEL_DEEP

  // 4. Deep tier — complex reasoning keywords WITH substantive content
  if (words.length >= DEEP_MIN_WORDS && DEEP_KEYWORDS.some(kw => lower.includes(kw))) {
    return MODEL_DEEP
  }

  // 5. Deep tier — explicit agent / PR-describe requests + research-shaped asks
  if (lower.includes('spawn_agent') || lower.includes('pr_describe')) return MODEL_DEEP
  if (words.length > 12 && (lower.includes('investigate') || lower.includes('comprehensive'))) {
    return MODEL_DEEP
  }

  // 6. Smart tier — email, GitHub, multi-step tool surfaces ("PRs" via word boundary)
  if (SMART_SIGNALS.some(s => lower.includes(s)) || /\bprs?\b/.test(lower)) {
    return MODEL_SMART
  }

  // 7. Fast tier — short conversational, no tool keywords
  const hasToolKeyword = TOOL_KEYWORDS.some(kw => lower.includes(kw))
  if (words.length <= 15 && !hasToolKeyword) return MODEL_FAST

  // 8. Fast tier — single quick tool actions (launch / spotify / simple search)
  if (words.length <= 12 && (
    lower.includes('spotify') || lower.includes('launch') || lower.includes('open') ||
    lower.includes('play') || lower.includes('pause') || lower.includes('skip') ||
    (lower.includes('weather') && words.length <= 8) ||
    (/\bsearch\b/.test(lower) && words.length <= 10) ||
    (lower.includes('read') && words.length <= 8) ||
    (lower.includes('calendar') && words.length <= 8 && !lower.includes('create') && !lower.includes('add') && !lower.includes('schedule'))
  )) {
    return MODEL_FAST
  }

  // 9. Default — Smart tier for everything else
  return MODEL_SMART
}

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant running as a desktop overlay. Speak in a polished, concise British manner — helpful and confident without being verbose. Keep responses under 3 sentences unless detail is genuinely needed.

CAPABILITIES — infer which tool to use from the user's natural language, never ask them for function names:
• Launch apps — "open Spotify", "launch Chrome", "launch rivals" → app_launch
• Add/configure launch commands — "teach you to open X", "add a command for rivals" → command_find_executable then command_register (opens setup popup)
• List/remove custom commands → command_list / command_remove
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
• Read/change Jarvis settings (provider, voice, hotkey, profile) → jarvis_get_settings / jarvis_set_settings
• Usage, spending, token counts, rate limits → jarvis_get_usage (never web_search for your own usage)
• GitHub — PRs, issues, commits, repo status, write PR descriptions → github_pr_list / github_pr_view / github_issue_list / github_commit_log / github_repo_status / github_pr_describe
• Spotify — control playback, search, queue; connect account → spotify_auth / spotify_play / spotify_pause / spotify_next / spotify_prev / spotify_volume / spotify_search / spotify_queue / spotify_current; list user's own playlists → spotify_my_playlists. For "play my [X] playlist" use spotify_play with type:"playlist" — it matches against the user's library automatically. Use spotify_my_playlists when user asks what playlists they have.
• Open Spotify or GitHub visual panel → jarvis_open_panel (use when user says "show", "pull up", "open dashboard", "let me see")

PERSONAL KNOWLEDGE — the user's context is injected automatically. When the user mentions someone by first name only, that person's details will appear in your context. Use it naturally without announcing it.

STORING PEOPLE & PLACES: When saving contacts, ALWAYS speak a natural confirmation FIRST, then append invisible metadata tags at the very end. NEVER reply with only a tag. For people, include email in context when known (e.g. email: mom@example.com):
[PERSON: name | relationship | context]
[PLACE: name | context]
[PROJECT: name | context]
Examples:
  [PERSON: Amanda | girlfriend | studies biology at Virginia Tech, met freshman orientation]
  [PLACE: The Lyric | favourite coffee shop in Blacksburg]
  [PROJECT: Jarvis | personal AI assistant built in Electron + TypeScript]

STORING FACTS: For general facts use [REMEMBER: fact].

RULES:
- gmail_compose ONLY when the user explicitly asks to send/draft/compose/write an email NOW — never for past-tense or remember-only messages.
- Use tools proactively — always attempt the tool call first, never preemptively refuse.
- Google (Gmail + Calendar) credentials are configured on this system — always call the tool.
- Only report a capability missing if the tool itself throws an error.
- Never say "Certainly!" or "Of course!" — just answer directly.
- When a tool returns an error implying a missing prerequisite, handle it automatically — the user expects results, not instructions. E.g. Spotify "no active device" is handled by the tool itself (auto-launches Spotify and retries) — report the final outcome only.
- Chain tools intelligently across multiple steps. If step 1 fails in a recoverable way, resolve the dependency and continue — don't stop and explain the failure to the user.
- Never narrate your plan. Execute and report the result concisely.` + PROFILE_AND_MEMORY_NOTE

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
  email?: string
}

export interface ChatResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  pendingMemory: string | null
  pendingEntities: PendingEntity[]
}

const MAX_STEPS = 12

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
  imageBase64?: string,
  imageMimeType?: string,
  forceModel?: string,
): Promise<ChatResult> {
  const client = getClient()
  // selectModel handles the forceModel override internally (it always wins)
  let model = selectModel(userText, forceModel)

  if (imageBase64) console.error('[claude] vision turn — image attached')

  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  const mediaType = (imageMimeType ?? 'image/png') as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  const userContent: Anthropic.Messages.ContentBlockParam[] = imageBase64
    ? [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: userText },
      ]
    : [{ type: 'text', text: userText }]

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userContent },
  ]

  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0

  for (let step = 0; step < MAX_STEPS; step++) {
    // Tier escalation: once a chain has consumed ≥4 tool-use steps the task is
    // clearly complex — re-select with the step count so Deep tier takes over.
    // No-op when forceModel or a settings preference is in effect.
    if (step >= ESCALATION_STEP) {
      const escalated = selectModel(userText, forceModel, step)
      if (escalated !== model) {
        console.error(`[claude] step ${step} — escalating ${model} → ${escalated}`)
        model = escalated
      }
    }

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
        broadcast({ type: 'transcript', role: 'assistant', text: visibleStreamingText(stepText), partial: true })
      }
      if (chunk.type === 'message_start') inputTokens += chunk.message.usage.input_tokens
      if (chunk.type === 'message_delta') outputTokens += chunk.usage.output_tokens
    }

    const finalMsg = await stream.finalMessage()

    if (finalMsg.stop_reason !== 'tool_use') {
      fullText = stepText
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
          const result = await handleTool(b.name, b.input as Record<string, unknown>, { userText })
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

  const { text, pendingMemory, pendingEntities } = stripResponseTags(fullText)
  fullText = text
  broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })

  return { text: fullText, model, inputTokens, outputTokens, pendingMemory, pendingEntities }
}
