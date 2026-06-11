import { useState, useCallback } from 'react'
import type { AnimState, BackendEvent, AgentInfo, Settings, UsagePoint, ModelUsage, EmailDraft, EmailMessage, CalendarEventDraft } from '../../../backend/types'

export interface PendingConfirm {
  id: string
  action: string
  detail: string
}

export interface ConversationTurn {
  id: number
  role: 'user' | 'assistant'
  text: string
}

export interface JarvisState {
  anim: AnimState
  tokensToday: number
  costToday: number
  model: string
  userText: string
  assistantText: string
  history: ConversationTurn[]
  streamingText: string | null
  dashboardOpen: boolean
  settingsOpen: boolean
  confirm: PendingConfirm | null
  agents: AgentInfo[]
  usageDaily: UsagePoint[]
  usageByModel: ModelUsage[]
  settings: Settings | null
  errorText: string | null
  compose: EmailDraft | null
  viewer: EmailMessage[] | null
  eventDraft: CalendarEventDraft | null
  textVisible: boolean
}

const initial: JarvisState = {
  anim: 'idle',
  tokensToday: 0,
  costToday: 0,
  model: 'claude',
  userText: '',
  assistantText: '',
  history: [],
  streamingText: null,
  dashboardOpen: false,
  settingsOpen: false,
  confirm: null,
  agents: [],
  usageDaily: [],
  usageByModel: [],
  settings: null,
  errorText: null,
  compose: null,
  viewer: null,
  eventDraft: null,
  textVisible: true,
}

export function useAnimState(): {
  state: JarvisState
  handleEvent: (event: BackendEvent) => void
  toggleDashboard: () => void
  toggleSettings: () => void
  clearError: () => void
} {
  const [state, setState] = useState<JarvisState>(initial)

  const handleEvent = useCallback((event: BackendEvent) => {
    setState(prev => {
      switch (event.type) {
        case 'state':
          return { ...prev, anim: event.state }
        case 'stats':
          return { ...prev, tokensToday: event.tokensToday, costToday: event.costToday, model: event.model }
        case 'transcript': {
          if (event.partial) {
            // Only assistant messages stream — update in-flight display slot
            if (event.role === 'assistant') return { ...prev, streamingText: event.text }
            return prev
          }
          const turn: ConversationTurn = { id: Date.now() + Math.random(), role: event.role, text: event.text }
          const history = [...prev.history, turn].slice(-10)
          if (event.role === 'user') return { ...prev, userText: event.text, assistantText: '', history, streamingText: null }
          return { ...prev, assistantText: event.text, history, streamingText: null }
        }
        case 'error':
          return { ...prev, errorText: event.message, anim: 'idle' }
        case 'dashboard_open':
          return { ...prev, dashboardOpen: !prev.dashboardOpen }
        case 'confirm_request':
          return { ...prev, confirm: { id: event.id, action: event.action, detail: event.detail } }
        case 'confirm_resolved':
          return prev.confirm && prev.confirm.id === event.id ? { ...prev, confirm: null } : prev
        case 'agent_spawn':
          return { ...prev, agents: [...prev.agents, { id: event.id, name: event.name, task: event.task, status: 'running', actions: [], startedAt: Date.now() }] }
        case 'agent_update':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, actions: [...a.actions, event.action] } : a) }
        case 'agent_done':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, status: 'done', result: event.result } : a) }
        case 'agent_error':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, status: 'error', result: event.message } : a) }
        case 'usage':
          return { ...prev, usageDaily: event.daily, usageByModel: event.byModel }
        case 'settings':
          return { ...prev, settings: event.settings }
        case 'email_compose':
          return { ...prev, compose: event.draft }
        case 'email_view':
          return { ...prev, viewer: event.emails }
        case 'event_compose':
          return { ...prev, eventDraft: event.event }
        case 'toggle_text':
          return { ...prev, textVisible: !prev.textVisible }
        default:
          return prev
      }
    })
  }, [])

  const toggleDashboard = useCallback(() => setState(prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen })), [])
  const toggleSettings = useCallback(() => setState(prev => ({ ...prev, settingsOpen: !prev.settingsOpen })), [])
  const clearError = useCallback(() => setState(prev => ({ ...prev, errorText: null })), [])
  const closeCompose = useCallback(() => setState(prev => ({ ...prev, compose: null })), [])
  const closeViewer = useCallback(() => setState(prev => ({ ...prev, viewer: null })), [])
  const openCompose = useCallback((draft: EmailDraft) => setState(prev => ({ ...prev, compose: draft })), [])
  const closeEvent = useCallback(() => setState(prev => ({ ...prev, eventDraft: null })), [])
  const toggleTextVisible = useCallback(() => setState(prev => ({ ...prev, textVisible: !prev.textVisible })), [])

  return { state, handleEvent, toggleDashboard, toggleSettings, clearError, closeCompose, closeViewer, openCompose, closeEvent, toggleTextVisible }
}
