import { useState, useCallback } from 'react'
import type { AnimState, BackendEvent, AgentInfo, Settings, UsagePoint, ModelUsage } from '../../../backend/types'

export interface PendingConfirm {
  id: string
  action: string
  detail: string
}

export interface JarvisState {
  anim: AnimState
  tokensToday: number
  costToday: number
  model: string
  userText: string
  assistantText: string
  dashboardOpen: boolean
  settingsOpen: boolean
  confirm: PendingConfirm | null
  agents: AgentInfo[]
  usageDaily: UsagePoint[]
  usageByModel: ModelUsage[]
  settings: Settings | null
}

const initial: JarvisState = {
  anim: 'idle',
  tokensToday: 0,
  costToday: 0,
  model: 'fable',
  userText: '',
  assistantText: '',
  dashboardOpen: false,
  settingsOpen: false,
  confirm: null,
  agents: [],
  usageDaily: [],
  usageByModel: [],
  settings: null,
}

export function useAnimState(): {
  state: JarvisState
  handleEvent: (event: BackendEvent) => void
  toggleDashboard: () => void
  toggleSettings: () => void
} {
  const [state, setState] = useState<JarvisState>(initial)

  const handleEvent = useCallback((event: BackendEvent) => {
    setState(prev => {
      switch (event.type) {
        case 'state':
          return { ...prev, anim: event.state }
        case 'stats':
          return { ...prev, tokensToday: event.tokensToday, costToday: event.costToday, model: event.model }
        case 'transcript':
          if (event.role === 'user') return { ...prev, userText: event.text, assistantText: '' }
          return { ...prev, assistantText: event.text }
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
        default:
          return prev
      }
    })
  }, [])

  const toggleDashboard = useCallback(() => setState(prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen })), [])
  const toggleSettings = useCallback(() => setState(prev => ({ ...prev, settingsOpen: !prev.settingsOpen })), [])

  return { state, handleEvent, toggleDashboard, toggleSettings }
}
