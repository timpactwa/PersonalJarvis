import { useCallback, useEffect, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
import { HudOverlay } from './components/HudOverlay'
import { Transcript } from './components/Transcript'
import { TextInput } from './components/TextInput'
import { TitleBar } from './components/TitleBar'
import { ErrorToast } from './components/ErrorToast'
import { Dashboard } from './components/Dashboard'
import { ConfirmCard } from './components/ConfirmCard'
import { AgentCards } from './components/AgentCards'
import { SettingsPanel } from './components/SettingsPanel'
import { ListeningIndicator } from './components/ListeningIndicator'
import { EmailComposer } from './components/EmailComposer'
import { EmailViewer } from './components/EmailViewer'
import { EventEditor } from './components/EventEditor'
import type { BackendEvent, EmailDraft } from '../../backend/types'
import './styles/global.css'

export default function App(): JSX.Element {
  const { state, handleEvent, toggleDashboard, toggleSettings, clearError, closeCompose, closeViewer, openCompose, closeEvent, toggleTextVisible } = useAnimState()

  const onEvent = useCallback((event: BackendEvent) => {
    handleEvent(event)

    if (event.type === 'audio') {
      const audioData = event.data as unknown as ArrayBuffer
      const blob = new Blob([audioData], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      // Playback drives speaking→idle; the backend no longer sends timed
      // state events around TTS, so the UI unlocks the moment audio ends.
      handleEvent({ type: 'state', state: 'speaking' })
      audio.onended = () => {
        URL.revokeObjectURL(url)
        handleEvent({ type: 'state', state: 'idle' })
      }
      audio.play().catch(err => {
        console.error('[audio] playback error:', err)
        handleEvent({ type: 'state', state: 'idle' })
      })
    }
  }, [handleEvent])

  const { send, connected } = useWebSocket(onEvent)

  // Backend lifecycle status from the main process — lets the UI distinguish
  // "still starting" from "crashed/failed" instead of spinning forever.
  const [backendStatus, setBackendStatus] = useState<{ status: string; message?: string } | null>(null)
  useEffect(() => {
    ;(window as any).jarvis.onBackendStatus?.((s: { status: string; message?: string }) => setBackendStatus(s))
  }, [])

  useEffect(() => {
    ;(window as any).jarvis.onPttStart(() => {
      console.log('[ptt] ptt-start (backend captures audio)')
    })
    ;(window as any).jarvis.onPttStop(() => {
      console.log('[ptt] ptt-stop (backend processes audio)')
    })
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

  // Only block input while a request is in flight; typing while Jarvis is
  // speaking (or listening) is fine.
  const busy = state.anim === 'thinking'

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#ddefff', position: 'relative' }}>
      <ParticleRing state={state.anim} />
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
      {!connected && (() => {
        const bad = backendStatus?.status === 'crashed' || backendStatus?.status === 'failed'
        return (
          <div style={{
            position: 'absolute',
            top: 48,
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '80vw',
            fontFamily: '"Share Tech Mono", monospace',
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
          onClose={closeCompose}
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
      />
    </div>
  )
}
