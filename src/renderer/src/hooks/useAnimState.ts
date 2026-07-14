import { useState, useCallback } from 'react'
import type { AnimState, BackendEvent, AgentInfo, Settings, UsagePoint, ModelUsage, EmailDraft, EmailMessage, CalendarEventDraft, MemoryEntry, CustomCommandDraft, GithubRow } from '../../../backend/types'
import type { DashboardData } from '../components/DashboardView'

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

export interface Toast { id: number; text: string }

export interface ActivityEntry {
  id: number
  kind: 'action' | 'console'
  text: string
  detail?: string
  ts: number
}

export type ViewTab = 'chat' | 'dashboard' | 'activity'

export interface JarvisState {
  anim: AnimState
  activeView: ViewTab
  activity: ActivityEntry[]
  dashboard: DashboardData | null
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
  memoriesOpen: boolean
  memories: MemoryEntry[]
  toasts: Toast[]
  commandDraft: CustomCommandDraft | null
  imageAttached: boolean
  reportContent: { format: 'html' | 'md'; content: string } | null
  spotifyOpen: boolean
  githubOpen: boolean
  quietMode: boolean
  spotifyNowPlaying: { track?: string; artist?: string; isPlaying: boolean; albumArt?: string } | null
  githubData: { tab: 'STATUS' | 'PRs' | 'ISSUES' | 'COMMITS'; rows: GithubRow[] } | null
  planPreview: { id: string; steps: string[] } | null
  capabilityMissing: { name: string; description: string } | null
  improvementActive: boolean
  improvementDone: boolean
}

const initial: JarvisState = {
  anim: 'idle',
  activeView: 'chat',
  activity: [],
  dashboard: null,
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
  memoriesOpen: false,
  memories: [],
  toasts: [],
  commandDraft: null,
  imageAttached: false,
  reportContent: null,
  spotifyOpen: false,
  githubOpen: false,
  quietMode: false,
  spotifyNowPlaying: null,
  githubData: null,
  planPreview: null,
  capabilityMissing: null,
  improvementActive: false,
  improvementDone: false,
}

export function useAnimState() {
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
          const history = [...prev.history, turn].slice(-50)
          // A final transcript means the pending image has been consumed by a
          // conversation turn — clear the indicator. The backend's own
          // "Image attached" confirmation must NOT clear it, or the flag would
          // vanish the instant it was set.
          const isAttachConfirm = event.role === 'assistant' && event.text.startsWith('Image attached')
          const imageAttached = isAttachConfirm ? prev.imageAttached : false
          if (event.role === 'user') return { ...prev, userText: event.text, assistantText: '', history, streamingText: null, imageAttached }
          return { ...prev, assistantText: event.text, history, streamingText: null, imageAttached }
        }
        case 'error':
          return { ...prev, errorText: event.message, anim: 'idle' }
        case 'dashboard_open':
          // Voice "open dashboard" now switches to the Dashboard tab.
          return { ...prev, activeView: 'dashboard' }
        case 'dashboard_data':
          return { ...prev, dashboard: { memoryCount: event.memoryCount, entityCount: event.entityCount, sttEngine: event.sttEngine, uptimeSec: event.uptimeSec } }
        case 'activity': {
          const entry: ActivityEntry = { id: Date.now() + Math.random(), kind: event.kind, text: event.text, detail: event.detail, ts: event.ts }
          return { ...prev, activity: [...prev.activity, entry].slice(-200) }
        }
        case 'confirm_request':
          return { ...prev, confirm: { id: event.id, action: event.action, detail: event.detail } }
        case 'confirm_resolved':
          return prev.confirm && prev.confirm.id === event.id ? { ...prev, confirm: null } : prev
        case 'agent_spawn':
          return { ...prev, agents: [...prev.agents, { id: event.id, name: event.name, task: event.task, status: 'running', actions: [], startedAt: Date.now() }] }
        case 'agent_update':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, actions: [...a.actions, event.action] } : a) }
        case 'agent_done': {
          const agent = prev.agents.find(a => a.id === event.id)
          const toast: Toast = { id: Date.now() + Math.random(), text: `Agent complete: ${agent?.name ?? 'subagent'}` }
          return {
            ...prev,
            agents: prev.agents.map(a => a.id === event.id ? { ...a, status: 'done', result: event.result } : a),
            toasts: [...prev.toasts, toast],
          }
        }
        case 'agent_error':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, status: 'error', result: event.message } : a) }
        case 'usage':
          return { ...prev, usageDaily: event.daily, usageByModel: event.byModel }
        case 'settings':
          return { ...prev, settings: event.settings, quietMode: event.settings.quietMode ?? false }
        case 'email_compose':
          return { ...prev, compose: event.draft }
        case 'email_view':
          return { ...prev, viewer: event.emails }
        case 'event_compose':
          return { ...prev, eventDraft: event.event }
        case 'toggle_text':
          return { ...prev, textVisible: !prev.textVisible }
        case 'memories':
          return { ...prev, memories: event.memories }
        case 'command_compose':
          return { ...prev, commandDraft: event.draft }
        case 'report':
          return { ...prev, reportContent: { format: event.format, content: event.content } }
        case 'panel_open':
          if (event.panel === 'spotify') return { ...prev, spotifyOpen: true }
          if (event.panel === 'github') return { ...prev, githubOpen: true }
          return prev
        case 'quiet_mode_changed':
          return { ...prev, quietMode: event.enabled }
        case 'spotify_now_playing':
          return { ...prev, spotifyNowPlaying: { track: event.track, artist: event.artist, isPlaying: event.isPlaying, albumArt: event.albumArt } }
        case 'github_data':
          return { ...prev, githubData: { tab: event.tab, rows: event.rows } }
        case 'plan_preview':
          return { ...prev, planPreview: { id: event.id, steps: event.steps } }
        case 'capability_missing':
          return { ...prev, capabilityMissing: { name: event.name, description: event.description } }
        case 'improvement_started':
          return { ...prev, improvementActive: true }
        case 'improvement_done':
          return { ...prev, improvementActive: false, improvementDone: true }
        case 'improvement_error':
          return { ...prev, improvementActive: false }
        case 'speak_text':
          return prev // handled in App.tsx via speechSynthesis
        default:
          return prev
      }
    })
  }, [])

  const setView = useCallback((view: ViewTab) => setState(prev => ({ ...prev, activeView: view })), [])
  const toggleDashboard = useCallback(() => setState(prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen })), [])
  const toggleSettings = useCallback(() => setState(prev => ({ ...prev, settingsOpen: !prev.settingsOpen })), [])
  const clearError = useCallback(() => setState(prev => ({ ...prev, errorText: null })), [])
  const closeCompose = useCallback(() => setState(prev => ({ ...prev, compose: null })), [])
  const closeViewer = useCallback(() => setState(prev => ({ ...prev, viewer: null })), [])
  const openCompose = useCallback((draft: EmailDraft) => setState(prev => ({ ...prev, compose: draft })), [])
  const closeEvent = useCallback(() => setState(prev => ({ ...prev, eventDraft: null })), [])
  const toggleTextVisible = useCallback(() => setState(prev => ({ ...prev, textVisible: !prev.textVisible })), [])
  const toggleMemories = useCallback(() => setState(prev => ({ ...prev, memoriesOpen: !prev.memoriesOpen })), [])
  const dismissToast = useCallback((id: number) => setState(prev => ({ ...prev, toasts: prev.toasts.filter(t => t.id !== id) })), [])
  const closeCommand = useCallback(() => setState(prev => ({ ...prev, commandDraft: null })), [])
  const clearReport = useCallback(() => setState(prev => ({ ...prev, reportContent: null })), [])
  const setImageAttached = useCallback((v: boolean) => setState(prev => ({ ...prev, imageAttached: v })), [])
  const toggleSpotify = useCallback(() => setState(prev => ({ ...prev, spotifyOpen: !prev.spotifyOpen })), [])
  const toggleGithub = useCallback(() => setState(prev => ({ ...prev, githubOpen: !prev.githubOpen })), [])
  const closePlanPreview = useCallback(() => setState(prev => ({ ...prev, planPreview: null })), [])
  const closeCapabilityModal = useCallback(() => setState(prev => ({ ...prev, capabilityMissing: null })), [])
  const dismissImprovementDone = useCallback(() => setState(prev => ({ ...prev, improvementDone: false })), [])

  return { state, handleEvent, setView, toggleDashboard, toggleSettings, clearError, closeCompose, closeViewer, openCompose, closeEvent, toggleTextVisible, toggleMemories, dismissToast, closeCommand, clearReport, setImageAttached, toggleSpotify, toggleGithub, closePlanPreview, closeCapabilityModal, dismissImprovementDone }
}
