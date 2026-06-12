import { useState, useEffect } from 'react'
import type { Settings } from '../../../backend/types'

interface Props {
  open: boolean
  settings: Settings | null
  onClose: () => void
  onSave: (partial: Partial<Settings>) => void
  onHotkeyChange: (accelerator: string) => void
  onOpenMemories?: () => void
}

const DRAWER_W = 340
const LAYER_Z = 550 // above TitleBar (500)

export function SettingsPanel({ open, settings, onClose, onSave, onHotkeyChange, onOpenMemories }: Props): JSX.Element | null {
  const [draft, setDraft] = useState<Settings | null>(settings)
  useEffect(() => { setDraft(settings) }, [settings])

  if (!draft) return null
  if (!open) return null

  const save = (): void => {
    onSave(draft)
    onHotkeyChange(draft.hotkey)
    onClose()
  }

  const label: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', display: 'block', marginBottom: 6, color: 'var(--ov-text-mid)' }
  const fieldWrap: React.CSSProperties = { marginBottom: 16 }
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--ov-accent)',
    marginTop: 8, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--ov-separator)',
  }

  return (
    <>
      <div
        className="no-drag"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
          zIndex: LAYER_Z,
        }}
      />
      <div
        className="no-drag"
        style={{
          position: 'fixed', top: 36, right: 0, height: 'calc(100vh - 36px)', width: DRAWER_W,
          background: 'var(--ov-bg)', borderLeft: '1px solid var(--ov-border)',
          boxShadow: 'var(--ov-shadow)',
          padding: 24, zIndex: LAYER_Z + 1, overflowY: 'auto',
          fontFamily: 'var(--font-hud)', color: 'var(--ov-text)',
          animation: 'drawerIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em' }}>SETTINGS</span>
          <button onClick={onClose} className="pill-btn pill-btn--icon">✕</button>
        </div>

        <div style={sectionLabel}>ABOUT YOU</div>
        <label style={label}>JARVIS REMEMBERS THIS ABOUT YOU EVERY CONVERSATION</label>
        <textarea
          className="ov-input"
          style={{ ...fieldWrap, minHeight: 96, resize: 'vertical', lineHeight: 1.5 }}
          value={draft.userProfile}
          onChange={e => setDraft({ ...draft, userProfile: e.target.value })}
          placeholder="e.g. I'm Tim, a CS student at Virginia Tech. I prefer concise answers and work mostly in TypeScript. Coffee over tea."
        />

        <div style={sectionLabel}>VOICE</div>
        <label style={label}>PUSH-TO-TALK HOTKEY</label>
        <input className="ov-input" style={fieldWrap} value={draft.hotkey} onChange={e => setDraft({ ...draft, hotkey: e.target.value })} placeholder="Alt+Space" />
        <label style={label}>SCREENSHOT HOTKEY</label>
        <input className="ov-input" style={fieldWrap} value={draft.screenshotHotkey} onChange={e => setDraft({ ...draft, screenshotHotkey: e.target.value })} placeholder="Alt+Shift+S" />
        <label style={label}>ELEVENLABS VOICE ID</label>
        <input className="ov-input" style={fieldWrap} value={draft.voiceId} onChange={e => setDraft({ ...draft, voiceId: e.target.value })} />

        <div style={sectionLabel}>QUIET MODE</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={!!draft.quietMode}
            onChange={e => setDraft({ ...draft, quietMode: e.target.checked })}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--ov-accent)' }}
          />
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--ov-text-mid)' }}>
            DISABLE TTS + STT (CHAT ONLY)
          </span>
        </label>
        <p style={{ fontSize: 10, color: 'var(--ov-text-dim)', marginTop: -12, marginBottom: 16, lineHeight: 1.5 }}>
          Use in libraries or quiet spaces. Text input still works.
        </p>

        <div style={sectionLabel}>AI MODEL</div>
        <label style={label}>LLM PROVIDER</label>
        <select className="ov-input" style={fieldWrap} value={draft.llmProvider ?? 'auto'} onChange={e => setDraft({ ...draft, llmProvider: e.target.value as Settings['llmProvider'] })}>
          <option value="auto">Auto (smart routing)</option>
          <option value="claude">Claude only</option>
          <option value="groq">Groq only</option>
          <option value="ollama">Ollama only (local)</option>
        </select>
        <label style={label}>CLAUDE MODEL (when using Claude)</label>
        <select className="ov-input" style={fieldWrap} value={draft.modelPreference} onChange={e => setDraft({ ...draft, modelPreference: e.target.value as Settings['modelPreference'] })}>
          <option value="auto">Auto (route by length/keywords)</option>
          <option value="fable">Always Fable</option>
          <option value="haiku">Always Haiku</option>
        </select>
        <label style={label}>OLLAMA MODEL</label>
        <input className="ov-input" style={fieldWrap} value={draft.ollamaModel} onChange={e => setDraft({ ...draft, ollamaModel: e.target.value })} placeholder="llama3.1:8b" />
        <label style={label}>OLLAMA BASE URL</label>
        <input className="ov-input" style={fieldWrap} value={draft.ollamaBaseUrl} onChange={e => setDraft({ ...draft, ollamaBaseUrl: e.target.value })} placeholder="http://127.0.0.1:11434" />

        <div style={sectionLabel}>MEMORY</div>
        <label style={label}>SHORT-TERM MEMORY (TURNS)</label>
        <input className="ov-input" style={fieldWrap} type="number" min={2} max={50} value={draft.shortTurns}
          onChange={e => setDraft({ ...draft, shortTurns: parseInt(e.target.value || '20', 10) })} />
        <button className="pill-btn" style={{ width: '100%', marginBottom: 20 }} onClick={() => onOpenMemories?.()}>
          BROWSE STORED MEMORIES
        </button>

        <button className="pill-btn" style={{ width: '100%', padding: '10px 0', fontSize: 12 }} onClick={save}>
          SAVE
        </button>
      </div>
    </>
  )
}
