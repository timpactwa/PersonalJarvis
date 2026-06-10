import { useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
import { HudOverlay } from './components/HudOverlay'
import { Transcript } from './components/Transcript'
import type { BackendEvent } from '../../backend/types'
import './styles/global.css'

export default function App(): JSX.Element {
  const { state, handleEvent } = useAnimState()

  const onEvent = useCallback((event: BackendEvent) => {
    handleEvent(event)
  }, [handleEvent])

  useWebSocket(onEvent)

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#060b14', position: 'relative' }}>
      <ParticleRing state={state.anim} />
      <HudOverlay
        animState={state.anim}
        tokensToday={state.tokensToday}
        costToday={state.costToday}
        model={state.model}
      />
      <Transcript userText={state.userText} assistantText={state.assistantText} />
    </div>
  )
}
