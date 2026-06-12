// Events sent from backend → renderer
export type AnimState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type LlmProvider = 'auto' | 'claude' | 'groq' | 'ollama'

export interface Settings {
  hotkey: string
  screenshotHotkey: string
  voiceId: string
  llmProvider: LlmProvider
  modelPreference: 'auto' | 'fable' | 'haiku'
  shortTurns: number
  ollamaModel: string
  ollamaBaseUrl: string
  /** Free-text "about me" the user authors; injected into Jarvis's context each turn. */
  userProfile: string
  spotifyAccessToken: string
  spotifyExpiresAt: number
  spotifyRefreshToken: string
  /** Silence TTS and disable push-to-talk for quiet spaces. */
  quietMode: boolean
}

export interface AgentInfo {
  id: string
  name: string
  task: string
  status: 'running' | 'done' | 'error'
  actions: string[]
  result?: string
  startedAt: number
}

export interface UsagePoint { date: string; tokens: number; cost: number }
export interface ModelUsage { model: string; tokens: number; cost: number }
export interface MemoryEntry { id: number; text: string; createdAt: number }

export type CustomCommandKind = 'exe' | 'uri' | 'shell'

export interface CustomCommand {
  id: string
  label: string
  aliases: string[]
  target: string
  kind: CustomCommandKind
  updatedAt: number
}

export interface CustomCommandDraft {
  id: string
  label: string
  aliases: string[]
  target: string
  kind: CustomCommandKind
}

export interface EmailDraft {
  id: string
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
}

export interface EmailMessage {
  id: string
  from: string
  subject: string
  date: string
  body: string
}

export interface CalendarEventDraft {
  id: string
  title: string
  start: string
  end: string
  description: string
}

export type BackendEvent =
  | { type: 'state'; state: AnimState }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; partial: boolean }
  | { type: 'stats'; tokensToday: number; costToday: number; model: string }
  | { type: 'audio'; data: Buffer }
  | { type: 'error'; message: string }
  | { type: 'dashboard_open' }
  | { type: 'confirm_request'; id: string; action: string; detail: string }
  | { type: 'confirm_resolved'; id: string; approved: boolean }
  | { type: 'agent_spawn'; id: string; name: string; task: string }
  | { type: 'agent_update'; id: string; action: string }
  | { type: 'agent_done'; id: string; result: string }
  | { type: 'agent_error'; id: string; message: string }
  | { type: 'usage'; daily: UsagePoint[]; byModel: ModelUsage[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'hotkey_changed'; hotkey: string }
  | { type: 'screenshot_hotkey_changed'; hotkey: string }
  | { type: 'command_compose'; draft: CustomCommandDraft }
  | { type: 'email_compose'; draft: EmailDraft }
  | { type: 'email_view'; emails: EmailMessage[] }
  | { type: 'event_compose'; event: CalendarEventDraft }
  | { type: 'toggle_text' }
  | { type: 'memories'; memories: MemoryEntry[] }
  | { type: 'report'; format: 'html' | 'md'; content: string }
  | { type: 'screenshot_request'; prompt: string }
  | { type: 'panel_open'; panel: 'spotify' | 'github' }
  | { type: 'quiet_mode_changed'; enabled: boolean }

// Events sent from renderer → backend
export type RendererEvent =
  | { type: 'audio'; data: Buffer }
  | { type: 'command'; text: string }
  | { type: 'dashboard_open' }
  | { type: 'confirm_response'; id: string; approved: boolean }
  | { type: 'agent_close'; id: string }
  | { type: 'get_usage' }
  | { type: 'get_settings' }
  | { type: 'set_settings'; settings: Partial<Settings> }
  | { type: 'email_send'; draft: EmailDraft }
  | { type: 'email_draft_save'; draft: EmailDraft }
  | { type: 'email_compose_dismissed'; draft: EmailDraft }
  | { type: 'command_save'; draft: CustomCommandDraft }
  | { type: 'command_compose_dismissed'; draft: CustomCommandDraft }
  | { type: 'command_delete'; id: string }
  | { type: 'event_create'; event: CalendarEventDraft }
  | { type: 'get_memories' }
  | { type: 'delete_memory'; id: number }
  | { type: 'image_attach'; imageBase64: string; mimeType: string }
