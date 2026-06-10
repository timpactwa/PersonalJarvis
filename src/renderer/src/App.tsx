import { useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
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
      <div style={{ color: '#7dd3fc', fontFamily: 'Orbitron, monospace', position: 'absolute', top: 20, left: 20, fontSize: 12, letterSpacing: '0.1em', pointerEvents: 'none' }}>
        JARVIS — {state.anim.toUpperCase()}
      </div>
    </div>
  )
}
