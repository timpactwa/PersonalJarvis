import { useCallback, useEffect, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
import { rmsFromBytes } from './lib/rms'
import { HudOverlay } from './components/HudOverlay'
import { Transcript } from './components/Transcript'
import { TextInput } from './components/TextInput'
import { TitleBar } from './components/TitleBar'
import { ErrorToast } from './components/ErrorToast'
import { CompletionToast } from './components/CompletionToast'
import { Dashboard } from './components/Dashboard'
import { ConfirmCard } from './components/ConfirmCard'
import { AgentCards } from './components/AgentCards'
import { SettingsPanel } from './components/SettingsPanel'
import { MemoryBrowser } from './components/MemoryBrowser'
import { ListeningIndicator } from './components/ListeningIndicator'
import { EmailComposer } from './components/EmailComposer'
import { EmailViewer } from './components/EmailViewer'
import { EventEditor } from './components/EventEditor'
import { CommandEditor } from './components/CommandEditor'
import { ReportPanel } from './components/ReportPanel'
import type { BackendEvent, EmailDraft } from '../../backend/types'
import './styles/global.css'

export default function App(): JSX.Element {
  const { state, handleEvent, toggleDashboard, toggleSettings, clearError, closeCompose, closeViewer, openCompose, closeEvent, toggleTextVisible, toggleMemories, dismissToast, closeCommand, clearReport } = useAnimState()

  const onEvent = useCallback((event: BackendEvent) => {
    handleEvent(event)

    if (event.type === 'hotkey_changed') {
      ;(window as any).jarvis?.setHotkey?.(event.hotkey)
    }

    if (event.type === 'audio') {
      const audioData = event.data as unknown as ArrayBuffer
      const blob = new Blob([audioData], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      // Playback drives speaking→idle; the backend no longer sends timed
      // state events around TTS, so the UI unlocks the moment audio ends.
      handleEvent({ type: 'state', state: 'speaking' })

      let ctx: AudioContext | null = null
      let raf = 0
      try {
        ctx = new AudioContext()
        const src = ctx.createMediaElementSource(audio)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser)
        analyser.connect(ctx.destination)
        const buf = new Uint8Array(analyser.fftSize)
        const tick = (): void => {
          analyser.getByteTimeDomainData(buf)
          setAmplitude(rmsFromBytes(buf))
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (err) {
        console.error('[meter] tts meter error:', err)
      }

      const cleanup = (): void => {
        cancelAnimationFrame(raf)
        void ctx?.close()
        setAmplitude(0)
      }
      audio.onended = () => {
        URL.revokeObjectURL(url)
        cleanup()
        handleEvent({ type: 'state', state: 'idle' })
      }
      audio.play().catch(err => {
        console.error('[audio] playback error:', err)
        cleanup()
        handleEvent({ type: 'state', state: 'idle' })
      })
    }
  }, [handleEvent])

  const { send, connected } = useWebSocket(onEvent)

  // Backend lifecycle status from the main process — lets the UI distinguish
  // "still starting" from "crashed/failed" instead of spinning forever.
  const [backendStatus, setBackendStatus] = useState<{ status: string; message?: string } | null>(null)
  const [amplitude, setAmplitude] = useState(0)
  useEffect(() => {
    ;(window as any).jarvis.onBackendStatus?.((s: { status: string; message?: string }) => setBackendStatus(s))
  }, [])

  useEffect(() => {
    let ctx: AudioContext | null = null
    let raf = 0
    let stream: MediaStream | null = null

    const startMeter = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser)
        const buf = new Uint8Array(analyser.fftSize)
        const tick = (): void => {
          analyser.getByteTimeDomainData(buf)
          setAmplitude(rmsFromBytes(buf))
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (err) {
        console.error('[meter] mic meter error:', err)
      }
    }

    const stopMeter = (): void => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
      void ctx?.close()
      ctx = null; stream = null
      setAmplitude(0)
    }

    ;(window as any).jarvis.onPttStart(() => { void startMeter() })
    ;(window as any).jarvis.onPttStop(() => { stopMeter() })

    return () => { stopMeter() }
  }, [])

  useEffect(() => {
    if (state.dashboardOpen) send({ type: 'get_usage' })
  }, [state.dashboardOpen, send])

  useEffect(() => {
    if (connected) send({ type: 'get_settings' })
  }, [connected, send])

  useEffect(() => {
    if (state.settingsOpen) send({ type: 'get_settings' })
  }, [state.settingsOpen, send])

  useEffect(() => {
    if (state.memoriesOpen) send({ type: 'get_memories' })
  }, [state.memoriesOpen, send])

  // Screenshot hotkey (main process) → forward capture to the backend
  useEffect(() => {
    ;(window as any).jarvis?.onScreenshotCaptured?.((data: { imageBase64: string; mimeType: string }) => {
      send({ type: 'image_attach', imageBase64: data.imageBase64, mimeType: data.mimeType })
    })
  }, [send])

  // Drag-and-drop image attach
  const handleDragOver = (e: React.DragEvent): void => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (!base64) return
      send({ type: 'image_attach', imageBase64: base64, mimeType: file.type })
    }
    reader.readAsDataURL(file)
  }, [send])

  // Only block input while a request is in flight; typing while Jarvis is
  // speaking (or listening) is fine.
  const busy = state.anim === 'thinking'

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#ddefff', position: 'relative' }} onDragOver={handleDragOver} onDrop={handleDrop}>
      <ParticleRing state={state.anim} amplitude={amplitude} />
      <div className="grid-bg" />
      <TitleBar />
      <ListeningIndicator state={state.anim} />
      <HudOverlay
        animState={state.anim}
        tokensToday={state.tokensToday}
        costToday={state.costToday}
        model={state.model}
        llmProvider={state.settings?.llmProvider ?? 'auto'}
        onProviderChange={(provider) => send({ type: 'set_settings', settings: { llmProvider: provider } })}
        onStatsClick={toggleDashboard}
        textVisible={state.textVisible}
        onToggleText={toggleTextVisible}
      />
      <ErrorToast message={state.errorText} onDismiss={clearError} />
      <CompletionToast toasts={state.toasts} onDismiss={dismissToast} />
      {!connected && (() => {
        const bad = backendStatus?.status === 'crashed' || backendStatus?.status === 'failed'
        return (
          <div style={{
            position: 'absolute',
            top: 48,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '80vw',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: bad ? '#991b1b' : '#92400e',
            background: bad ? 'rgba(255, 241, 241, 0.95)' : 'rgba(255, 250, 240, 0.92)',
            padding: '4px 12px',
            borderRadius: 6,
            border: bad ? '1px solid rgba(180,30,30,0.35)' : '1px solid rgba(180,120,20,0.25)',
            pointerEvents: 'none',
            zIndex: 201,
          }}>
            {bad ? `✕ ${backendStatus?.message ?? 'backend stopped'}` : '⟳ connecting to backend...'}
          </div>
        )
      })()}
      <Transcript history={state.history} streamingText={state.streamingText} visible={state.textVisible} />
      <TextInput
        disabled={busy || !connected}
        onSubmit={(text) => send({ type: 'command', text })}
      />
      {state.confirm && (
        <ConfirmCard
          action={state.confirm.action}
          detail={state.confirm.detail}
          onConfirm={() => send({ type: 'confirm_response', id: state.confirm!.id, approved: true })}
          onCancel={() => send({ type: 'confirm_response', id: state.confirm!.id, approved: false })}
        />
      )}
      {state.compose && (
        <EmailComposer
          draft={state.compose}
          onSend={d => { send({ type: 'email_send', draft: d }); closeCompose() }}
          onSaveDraft={d => { send({ type: 'email_draft_save', draft: d }); closeCompose() }}
          onClose={() => {
            send({ type: 'email_compose_dismissed', draft: state.compose! })
            closeCompose()
          }}
        />
      )}
      {state.viewer && (
        <EmailViewer
          emails={state.viewer}
          onReply={e => {
            closeViewer()
            const to = e.from.match(/<([^>]+)>/)?.[1] ?? e.from
            const subject = e.subject.startsWith('Re:') ? e.subject : `Re: ${e.subject}`
            const body = `\n\n----- On ${e.date}, ${e.from} wrote -----\n${e.body}`
            const draft: EmailDraft = { id: crypto.randomUUID(), to, cc: '', bcc: '', subject, body }
            openCompose(draft)
          }}
          onClose={closeViewer}
        />
      )}
      {state.eventDraft && (
        <EventEditor
          event={state.eventDraft}
          onCreate={ev => { send({ type: 'event_create', event: ev }); closeEvent() }}
          onClose={closeEvent}
        />
      )}
      {state.commandDraft && (
        <CommandEditor
          draft={state.commandDraft}
          onSave={d => { send({ type: 'command_save', draft: d }); closeCommand() }}
          onClose={() => {
            send({ type: 'command_compose_dismissed', draft: state.commandDraft! })
            closeCommand()
          }}
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
      <SettingsPanel
        open={state.settingsOpen}
        settings={state.settings}
        onClose={toggleSettings}
        onSave={(partial) => send({ type: 'set_settings', settings: partial })}
        onHotkeyChange={(accel) => (window as any).jarvis.setHotkey(accel)}
        onOpenMemories={() => { toggleSettings(); toggleMemories() }}
      />
      <MemoryBrowser
        open={state.memoriesOpen}
        memories={state.memories}
        onClose={toggleMemories}
        onDelete={(id) => send({ type: 'delete_memory', id })}
      />
      <ReportPanel content={state.reportContent} onClose={clearReport} />
    </div>
  )
}
