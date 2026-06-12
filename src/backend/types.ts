// Events sent from backend → renderer
export type AnimState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type LlmProvider = 'auto' | 'claude' | 'groq' | 'ollama'

export interface Settings {
  hotkey: string
  voiceId: string
  llmProvider: LlmProvider
  modelPreference: 'auto' | 'fable' | 'haiku'
  shortTurns: number
  ollamaModel: string
  ollamaBaseUrl: string
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
  | { type: 'email_compose'; draft: EmailDraft }
  | { type: 'email_view'; emails: EmailMessage[] }
  | { type: 'event_compose'; event: CalendarEventDraft }
  | { type: 'toggle_text' }

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
  | { type: 'event_create'; event: CalendarEventDraft }
