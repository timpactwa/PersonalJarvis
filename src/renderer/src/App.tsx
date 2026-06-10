import { useCallback, useEffect, useRef } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
import { HudOverlay } from './components/HudOverlay'
import { Transcript } from './components/Transcript'
import { Dashboard } from './components/Dashboard'
import { ConfirmCard } from './components/ConfirmCard'
import { AgentCards } from './components/AgentCards'
import type { BackendEvent } from '../../backend/types'
import './styles/global.css'

export default function App(): JSX.Element {
  const { state, handleEvent, toggleDashboard, toggleSettings } = useAnimState()

  const onEvent = useCallback((event: BackendEvent) => {
    handleEvent(event)

    if (event.type === 'audio') {
      // Play TTS audio received from backend
      const audioData = event.data as unknown as ArrayBuffer
      const blob = new Blob([audioData], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      audio.play().catch(err => console.error('[audio] playback error:', err))
    }
  }, [handleEvent])

  const { send, sendBinary } = useWebSocket(onEvent)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingRef = useRef(false)

  useEffect(() => {
    const startRecording = async (): Promise<void> => {
      if (recordingRef.current) return
      recordingRef.current = true

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        console.error('[ptt] mic access denied', err)
        recordingRef.current = false
        return
      }

      chunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const buffer = await blob.arrayBuffer()
        sendBinary(buffer)
        stream.getTracks().forEach(t => t.stop())
        recordingRef.current = false
      }

      recorder.start()
      mediaRecorderRef.current = recorder
      send({ type: 'command', text: '__ptt_start' })
    }

    const stopRecording = (): void => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
    }

    // Listen for PTT start from main process (Alt+Space press)
    ;(window as any).jarvis.onPttStart(startRecording)

    // Alt+Space key-up stops recording
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ' && e.altKey) stopRecording()
    }
    window.addEventListener('keyup', onKeyUp)

    return () => {
      window.removeEventListener('keyup', onKeyUp)
      stopRecording()
    }
  }, [send, sendBinary])

  useEffect(() => {
    if (state.dashboardOpen) send({ type: 'get_usage' })
  }, [state.dashboardOpen, send])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#060b14', position: 'relative' }}>
      <ParticleRing state={state.anim} />
      <HudOverlay
        animState={state.anim}
        tokensToday={state.tokensToday}
        costToday={state.costToday}
        model={state.model}
        onStatsClick={toggleDashboard}
      />
      <Transcript userText={state.userText} assistantText={state.assistantText} />
      {state.confirm && (
        <ConfirmCard
          action={state.confirm.action}
          detail={state.confirm.detail}
          onConfirm={() => send({ type: 'confirm_response', id: state.confirm!.id, approved: true })}
          onCancel={() => send({ type: 'confirm_response', id: state.confirm!.id, approved: false })}
        />
      )}
      <AgentCards agents={state.agents} onClose={(id) => send({ type: 'agent_close', id })} />
      <Dashboard
        open={state.dashboardOpen}
        onClose={toggleDashboard}
        tokensToday={state.tokensToday}
        costToday={state.costToday}
        model={state.model}
        daily={state.usageDaily}
        byModel={state.usageByModel}
        onOpenSettings={() => { toggleDashboard(); toggleSettings() }}
      />
    </div>
  )
}
