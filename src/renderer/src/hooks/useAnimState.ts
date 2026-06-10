import { useState, useCallback } from 'react'
import type { AnimState, BackendEvent } from '../../../backend/types'

export interface JarvisState {
  anim: AnimState
  tokensToday: number
  costToday: number
  model: string
  userText: string
  assistantText: string
  dashboardOpen: boolean
}

const initial: JarvisState = {
  anim: 'idle',
  tokensToday: 0,
  costToday: 0,
  model: 'fable',
  userText: '',
  assistantText: '',
  dashboardOpen: false,
}

export function useAnimState(): {
  state: JarvisState
  handleEvent: (event: BackendEvent) => void
  toggleDashboard: () => void
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
        default:
          return prev
      }
    })
  }, [])

  const toggleDashboard = useCallback(() => {
    setState(prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen }))
  }, [])

  return { state, handleEvent, toggleDashboard }
}
