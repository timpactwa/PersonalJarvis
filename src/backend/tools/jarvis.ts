import type { LlmProvider, Settings } from '../types'
import { getSettings, setSettings } from '../memory/settings'
import { getStatsToday, getUsageDaily, getUsageByModel } from '../memory/db'
import { isChatAvailable } from '../claude'
import { emitEvent } from '../events'

export interface JarvisToolDef {
  name: string
  description: string
  input_schema: { type: string; properties: Record<string, unknown>; required: string[] }
}

export const jarvisToolDefs: JarvisToolDef[] = [
  {
    name: 'jarvis_get_settings',
    description:
      'Read all Jarvis configuration: LLM provider, voice, hotkey, memory depth, Ollama model, and user profile. Use when the user asks about current settings, what mode Jarvis is in, or how Jarvis is configured. Never use web_search for this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'jarvis_set_settings',
    description:
      'Change Jarvis settings. Use when the user asks to switch LLM provider, change voice, update their profile, adjust memory depth, or change the push-to-talk hotkey. Only pass fields the user wants to change.',
    input_schema: {
      type: 'object',
      properties: {
        llmProvider: {
          type: 'string',
          enum: ['auto', 'claude', 'groq', 'ollama'],
          description: 'Which LLM to use. auto=smart routing, claude=Anthropic only, groq=Groq only, ollama=local only.',
        },
        modelPreference: {
          type: 'string',
          enum: ['auto', 'fable', 'haiku'],
          description: 'Claude model preference when using Claude.',
        },
        voiceId: { type: 'string', description: 'ElevenLabs voice ID for TTS.' },
        hotkey: { type: 'string', description: 'Push-to-talk hotkey, e.g. Alt+Space.' },
        screenshotHotkey: { type: 'string', description: 'Global hotkey for triggering a screenshot, e.g. Alt+Shift+S.' },
        shortTurns: { type: 'number', description: 'Short-term memory depth (2–50 conversation turns).' },
        ollamaModel: { type: 'string', description: 'Local Ollama model name.' },
        ollamaBaseUrl: { type: 'string', description: 'Ollama server URL.' },
        userProfile: { type: 'string', description: 'Free-text profile injected into every conversation.' },
        quietMode: {
          type: 'boolean',
          description: 'Enable quiet mode to silence TTS and disable push-to-talk. Useful in quiet spaces.',
        },
      },
      required: [],
    },
  },
  {
    name: 'jarvis_open_panel',
    description:
      'Open the Spotify or GitHub dashboard panel in the Jarvis UI. Use when the user says "show me Spotify", "pull up GitHub", "open my GitHub dashboard", "show my repos", "show my music", or any request to visually see these services — not just get text info.',
    input_schema: {
      type: 'object',
      properties: {
        panel: { type: 'string', enum: ['spotify', 'github'], description: 'Which panel to open: "spotify" or "github"' },
      },
      required: ['panel'],
    },
  },
  {
    name: 'jarvis_get_usage',
    description:
      'Get API usage stats, token counts, tracked costs, and provider info. Use when the user asks how much they are spending, token usage, rate limits, or cost to talk for a period. Never use web_search for Jarvis usage questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Days of history to include (default 7, max 30).' },
      },
      required: [],
    },
  },
]

function activeProviderLabel(settings: Settings): string {
  if (settings.llmProvider !== 'auto') return settings.llmProvider
  if (isChatAvailable()) return 'claude'
  if (process.env.GROQ_API_KEY) return 'groq'
  return 'ollama'
}

function configuredApis(): string {
  const apis: string[] = []
  if (isChatAvailable()) apis.push('Claude')
  if (process.env.GROQ_API_KEY) apis.push('Groq')
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY !== 'your_key_from_elevenlabs') apis.push('ElevenLabs TTS')
  if (process.env.BRAVE_SEARCH_API_KEY) apis.push('Brave Search')
  apis.push('Ollama (local)')
  return apis.join(', ')
}

function formatSettings(s: Settings): string {
  const active = activeProviderLabel(s)
  return [
    `Active provider: ${active} (setting: ${s.llmProvider})`,
    `Claude model preference: ${s.modelPreference}`,
    `Voice ID: ${s.voiceId}`,
    `Push-to-talk hotkey: ${s.hotkey}`,
    `Short-term memory: ${s.shortTurns} turns`,
    `Ollama model: ${s.ollamaModel} @ ${s.ollamaBaseUrl}`,
    s.userProfile ? `User profile: ${s.userProfile.slice(0, 200)}${s.userProfile.length > 200 ? '…' : ''}` : 'User profile: (empty)',
    `Configured APIs: ${configuredApis()}`,
  ].join('\n')
}

function validatePartial(input: Record<string, unknown>): Partial<Settings> {
  const partial: Partial<Settings> = {}

  const provider = input.llmProvider
  if (provider !== undefined) {
    if (provider !== 'auto' && provider !== 'claude' && provider !== 'groq' && provider !== 'ollama') {
      throw new Error(`Invalid llmProvider "${String(provider)}". Use auto, claude, groq, or ollama.`)
    }
    partial.llmProvider = provider as LlmProvider
  }

  const pref = input.modelPreference
  if (pref !== undefined) {
    if (pref !== 'auto' && pref !== 'fable' && pref !== 'haiku') {
      throw new Error(`Invalid modelPreference "${String(pref)}". Use auto, fable, or haiku.`)
    }
    partial.modelPreference = pref as Settings['modelPreference']
  }

  if (input.voiceId !== undefined) partial.voiceId = String(input.voiceId).trim()
  if (input.hotkey !== undefined) partial.hotkey = String(input.hotkey).trim()
  if (input.screenshotHotkey !== undefined) partial.screenshotHotkey = String(input.screenshotHotkey).trim()
  if (input.ollamaModel !== undefined) partial.ollamaModel = String(input.ollamaModel).trim()
  if (input.ollamaBaseUrl !== undefined) partial.ollamaBaseUrl = String(input.ollamaBaseUrl).trim()
  if (input.userProfile !== undefined) partial.userProfile = String(input.userProfile)
  if (input.quietMode !== undefined) partial.quietMode = Boolean(input.quietMode)

  if (input.shortTurns !== undefined) {
    const n = Number(input.shortTurns)
    if (!Number.isFinite(n) || n < 2 || n > 50) throw new Error('shortTurns must be between 2 and 50.')
    partial.shortTurns = Math.round(n)
  }

  if (Object.keys(partial).length === 0) {
    throw new Error('No settings provided. Pass at least one field to change.')
  }

  return partial
}

function providerWarnings(partial: Partial<Settings>): string[] {
  const warnings: string[] = []
  if (partial.llmProvider === 'claude' && !isChatAvailable()) {
    warnings.push('Claude selected but no Claude credentials are configured in .env.local.')
  }
  if (partial.llmProvider === 'groq' && !process.env.GROQ_API_KEY) {
    warnings.push('Groq selected but GROQ_API_KEY is not set in .env.local.')
  }
  return warnings
}

export function getJarvisSettings(): string {
  return formatSettings(getSettings())
}

export function setJarvisSettings(input: Record<string, unknown>): string {
  const partial = validatePartial(input)
  const warnings = providerWarnings(partial)
  const updated = setSettings(partial)

  emitEvent({ type: 'settings', settings: updated })
  try {
    const stats = getStatsToday()
    emitEvent({
      type: 'stats',
      tokensToday: stats.tokens,
      costToday: stats.cost,
      model: activeProviderLabel(updated),
    })
  } catch { /* non-critical */ }

  if (partial.hotkey) {
    emitEvent({ type: 'hotkey_changed', hotkey: updated.hotkey })
  }
  if (partial.screenshotHotkey) emitEvent({ type: 'screenshot_hotkey_changed', hotkey: updated.screenshotHotkey })
  if (partial.quietMode !== undefined) {
    emitEvent({ type: 'quiet_mode_changed', enabled: updated.quietMode })
  }

  const changed = Object.keys(partial).join(', ')
  const warn = warnings.length > 0 ? `\nWarning: ${warnings.join(' ')}` : ''
  return `Updated: ${changed}.\n${formatSettings(updated)}${warn}`
}

export function getJarvisUsage(daysInput?: number): string {
  const days = Math.min(Math.max(1, Math.floor(Number(daysInput) || 7)), 30)
  const today = getStatsToday()
  const daily = getUsageDaily(days)
  const byModel = getUsageByModel(days)
  const settings = getSettings()
  const active = activeProviderLabel(settings)

  const periodTokens = daily.reduce((sum, d) => sum + d.tokens, 0)
  const periodCost = daily.reduce((sum, d) => sum + d.cost, 0)
  const avgTokensPerDay = daily.length > 0 ? Math.round(periodTokens / daily.length) : 0

  const modelLines = byModel.length > 0
    ? byModel.map(m => `  ${m.model}: ${m.tokens.toLocaleString()} tokens, $${m.cost.toFixed(4)} tracked`).join('\n')
    : '  (no usage recorded yet)'

  const dailyLines = daily.length > 0
    ? daily.slice(-5).map(d => `  ${d.date}: ${d.tokens.toLocaleString()} tokens, $${d.cost.toFixed(4)}`).join('\n')
    : '  (no daily data)'

  // Rough estimate: ~150 tokens per short voice exchange (user + assistant)
  const tokensPerMinute = 300
  const estCostPer5Min = active === 'claude'
    ? ((tokensPerMinute * 5) / 1_000_000) * 0.004
    : 0

  return [
    `Active provider: ${active}`,
    `Today: ${today.tokens.toLocaleString()} tokens, $${today.cost.toFixed(4)} tracked locally`,
    `Last ${days} days: ${periodTokens.toLocaleString()} tokens, $${periodCost.toFixed(4)} tracked`,
    `Average per day: ${avgTokensPerDay.toLocaleString()} tokens`,
    '',
    'By model:',
    modelLines,
    '',
    'Recent days:',
    dailyLines,
    '',
    'Note: Groq and Ollama show $0 in local tracking — check your Groq/ElevenLabs dashboards for actual billing.',
    `Rough estimate for 5 min of voice chat on ${active}: ~${(tokensPerMinute * 5).toLocaleString()} tokens${estCostPer5Min > 0 ? `, ~$${estCostPer5Min.toFixed(3)} on Claude API` : ', negligible cost on Groq/Ollama free tiers'}.`,
    active === 'groq' ? 'Groq free tier: ~30 requests/min, ~6K tokens/min, daily caps vary by model.' : '',
  ].filter(Boolean).join('\n')
}

export async function handleJarvisTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'jarvis_get_settings':
      return getJarvisSettings()
    case 'jarvis_set_settings':
      return setJarvisSettings(input)
    case 'jarvis_open_panel': {
      const panel = input.panel
      if (panel !== 'spotify' && panel !== 'github') {
        throw new Error(`Invalid panel "${String(panel)}". Use spotify or github.`)
      }
      emitEvent({ type: 'panel_open', panel })
      return `Opening ${panel} panel.`
    }
    case 'jarvis_get_usage':
      return getJarvisUsage(Number(input.days))
    default:
      throw new Error(`Unknown jarvis tool: ${name}`)
  }
}
