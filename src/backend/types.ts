// Events sent from backend → renderer
export type AnimState = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface Settings {
  hotkey: string
  voiceId: string
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
