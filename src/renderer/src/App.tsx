import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
import Backdrop from './components/Backdrop'
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
import { SpotifyPanel } from './components/SpotifyPanel'
import { GitHubPanel } from './components/GitHubPanel'
import { ImageAttachZone } from './components/ImageAttachZone'
import PlanPreviewCard from './components/PlanPreviewCard'
import { CapabilityModal } from './components/CapabilityModal'
import { RelaunchPrompt } from './components/RelaunchPrompt'
import type { BackendEvent, EmailDraft } from '../../backend/types'
import './styles/global.css'

export default function App(): JSX.Element {
  const { state, handleEvent, toggleDashboard, toggleSettings, clearError, closeCompose, closeViewer, openCompose, closeEvent, toggleTextVisible, toggleMemories, dismissToast, closeCommand, clearReport, setImageAttached, toggleSpotify, toggleGithub, closePlanPreview, closeCapabilityModal, dismissImprovementDone } = useAnimState()

  const quietModeRef = useRef(false)
  quietModeRef.current = state.quietMode

  const activeAudioRef = useRef<HTMLAudioElement | null>(null)
  const sendRef = useRef<((e: import('../../backend/types').RendererEvent) => void) | null>(null)

  const onEvent = useCallback((event: BackendEvent) => {
    if (event.type === 'screenshot_request') {
      // Voice-triggered screenshot (jarvis_screenshot tool): ask the main
      // process to capture; the result comes back via screenshot-captured IPC.
      ;(window as any).jarvis?.triggerScreenshot?.()
      return
    }

    handleEvent(event)

    if (event.type === 'hotkey_changed') {
      ;(window as any).jarvis?.setHotkey?.(event.hotkey)
    }

    if (event.type === 'screenshot_hotkey_changed') {
      ;(window as any).jarvis?.setScreenshotHotkey?.(event.hotkey)
      return
    }

    if (event.type === 'speak_text') {
      // Web Speech API fallback when ElevenLabs is unavailable
      if (quietModeRef.current) {
        handleEvent({ type: 'state', state: 'idle' })
        return
      }
      const utterance = new SpeechSynthesisUtterance(event.text)
      utterance.rate = 1.1
      utterance.onend = () => {
        handleEvent({ type: 'state', state: 'idle' })
        sendRef.current?.({ type: 'speech_done' })
      }
      utterance.onerror = () => {
        handleEvent({ type: 'state', state: 'idle' })
        sendRef.current?.({ type: 'speech_done' })
      }
      window.speechSynthesis.speak(utterance)
      return
    }

    if (event.type === 'audio') {
      if (quietModeRef.current) {
        handleEvent({ type: 'state', state: 'idle' })
        return
      }
      const audioData = event.data as unknown as ArrayBuffer
      const blob = new Blob([audioData], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      activeAudioRef.current = audio
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
        activeAudioRef.current = null
        handleEvent({ type: 'state', state: 'idle' })
        sendRef.current?.({ type: 'speech_done' })
      }
      const doPlay = async (): Promise<void> => {
        if (ctx?.state === 'suspended') await ctx.resume()
        await audio.play()
      }
      doPlay().catch(err => {
        activeAudioRef.current = null
        const detail = err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)
        console.error('[audio] playback error:', detail)
        cleanup()
        handleEvent({ type: 'state', state: 'idle' })
        sendRef.current?.({ type: 'speech_done' })
      })
    }
  }, [handleEvent])

  const { send, connected } = useWebSocket(onEvent)
  sendRef.current = send

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

    ;(window as any).jarvis.onPttStart(() => {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause()
        activeAudioRef.current.currentTime = 0
        activeAudioRef.current = null
        sendRef.current?.({ type: 'speech_done' })
      }
      window.speechSynthesis.cancel()
      sendRef.current?.({ type: 'speech_done' })
      void startMeter()
    })
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
    const jarvis = (window as any).jarvis
    jarvis?.onScreenshotCaptured?.((data: { imageBase64: string; mimeType: string }) => {
      send({ type: 'image_attach', imageBase64: data.imageBase64, mimeType: data.mimeType })
      setImageAttached(true)
    })
    return () => {
      jarvis?.offScreenshotCaptured?.()
    }
  }, [send, setImageAttached])

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
      setImageAttached(true)
    }
    reader.readAsDataURL(file)
  }, [send, setImageAttached])

  const sendCapabilityAdd = useCallback((prompt: string, context: string) => {
    send({ type: 'capability_add', prompt, context })
    closeCapabilityModal()
  }, [send, closeCapabilityModal])

  const handlePlanConfirm = (id: string): void => {
    send({ type: 'plan_confirmed', id })
    closePlanPreview()
  }
  const handlePlanCancel = (id: string): void => {
    send({ type: 'plan_cancelled', id })
    closePlanPreview()
  }

  // Only block input while a request is in flight; typing while Jarvis is
  // speaking (or listening) is fine.
  const busy = state.anim === 'thinking'

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#05070e', position: 'relative', overflow: 'hidden' }} onDragOver={handleDragOver} onDrop={handleDrop}>
      <Backdrop />
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
        spotifyOpen={state.spotifyOpen}
        githubOpen={state.githubOpen}
        quietMode={state.quietMode}
        onToggleSpotify={toggleSpotify}
        onToggleGithub={toggleGithub}
        onToggleQuietMode={() => send({ type: 'set_settings', settings: { quietMode: !state.quietMode } })}
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
      <ImageAttachZone
        imageAttached={state.imageAttached}
        onAttach={(base64, mimeType) => {
          send({ type: 'image_attach', imageBase64: base64, mimeType })
          setImageAttached(true)
        }}
        onClear={() => setImageAttached(false)}
      />
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
      {state.planPreview && (
        <PlanPreviewCard
          plan={state.planPreview}
          onConfirm={handlePlanConfirm}
          onCancel={handlePlanCancel}
        />
      )}
      {state.capabilityMissing && (
        <CapabilityModal
          name={state.capabilityMissing.name}
          description={state.capabilityMissing.description}
          onSubmit={sendCapabilityAdd}
          onClose={closeCapabilityModal}
        />
      )}
      {state.improvementDone && (
        <RelaunchPrompt onLater={dismissImprovementDone} />
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
      {state.spotifyOpen && (
        <SpotifyPanel onClose={toggleSpotify} nowPlaying={state.spotifyNowPlaying} send={send} />
      )}
      {state.githubOpen && (
        <GitHubPanel onClose={toggleGithub} githubData={state.githubData} send={send} />
      )}
    </div>
  )
}
