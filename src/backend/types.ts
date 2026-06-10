// Events sent from backend → renderer
export type AnimState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type BackendEvent =
  | { type: 'state'; state: AnimState }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; partial: boolean }
  | { type: 'stats'; tokensToday: number; costToday: number; model: string }
  | { type: 'audio'; data: Buffer }
  | { type: 'error'; message: string }
  | { type: 'dashboard_open' }

// Events sent from renderer → backend
export type RendererEvent =
  | { type: 'audio'; data: Buffer }         // WAV audio for STT
  | { type: 'command'; text: string }        // Typed command
  | { type: 'dashboard_open' }
