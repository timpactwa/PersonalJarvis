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

export function SettingsPanel({ open, settings, onClose, onSave, onHotkeyChange, onOpenMemories }: Props): JSX.Element | null {
  const [draft, setDraft] = useState<Settings | null>(settings)
  useEffect(() => { setDraft(settings) }, [settings])

  if (!draft) return null

  const save = (): void => {
    onSave(draft)
    onHotkeyChange(draft.hotkey)
    onClose()
  }

  const label: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', display: 'block', marginBottom: 6, color: 'var(--text-mid)' }
  const field: React.CSSProperties = {
    width: '100%', background: 'rgba(3,105,161,0.05)', border: '1px solid rgba(3,105,161,0.18)',
    borderRadius: 6, color: '#0a2540', padding: '8px 10px', fontFamily: 'var(--font-mono)',
    fontSize: 12, marginBottom: 16, outline: 'none',
  }
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--accent)',
    marginTop: 8, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(3,105,161,0.15)',
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(200,220,240,0.25)', backdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s', zIndex: 129,
        }}
      />
      <div
        className="no-drag"
        style={{
          position: 'absolute', top: 0, right: 0, height: '100vh', width: DRAWER_W,
          background: 'rgba(255,255,255,0.96)', borderLeft: '1px solid rgba(3,105,161,0.15)',
          backdropFilter: 'blur(20px)', boxShadow: '-8px 0 40px rgba(3,80,140,0.12)',
          padding: 24, zIndex: 130, overflowY: 'auto',
          fontFamily: 'var(--font-hud)', color: 'var(--text)',
          transform: open ? 'translateX(0)' : `translateX(${DRAWER_W}px)`,
          transition: 'transform 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em' }}>SETTINGS</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <div style={sectionLabel}>ABOUT YOU</div>
        <label style={label}>JARVIS REMEMBERS THIS ABOUT YOU EVERY CONVERSATION</label>
        <textarea
          style={{ ...field, minHeight: 96, resize: 'vertical', lineHeight: 1.5 }}
          value={draft.userProfile}
          onChange={e => setDraft({ ...draft, userProfile: e.target.value })}
          placeholder="e.g. I'm Tim, a CS student at Virginia Tech. I prefer concise answers and work mostly in TypeScript. Coffee over tea."
        />

        <div style={sectionLabel}>VOICE</div>
        <label style={label}>PUSH-TO-TALK HOTKEY</label>
        <input style={field} value={draft.hotkey} onChange={e => setDraft({ ...draft, hotkey: e.target.value })} placeholder="Alt+Space" />
        <label style={label}>ELEVENLABS VOICE ID</label>
        <input style={field} value={draft.voiceId} onChange={e => setDraft({ ...draft, voiceId: e.target.value })} />

        <div style={sectionLabel}>AI MODEL</div>
        <label style={label}>LLM PROVIDER</label>
        <select style={field} value={draft.llmProvider ?? 'auto'} onChange={e => setDraft({ ...draft, llmProvider: e.target.value as Settings['llmProvider'] })}>
          <option value="auto">Auto (smart routing)</option>
          <option value="claude">Claude only</option>
          <option value="groq">Groq only</option>
          <option value="ollama">Ollama only (local)</option>
        </select>
        <label style={label}>CLAUDE MODEL (when using Claude)</label>
        <select style={field} value={draft.modelPreference} onChange={e => setDraft({ ...draft, modelPreference: e.target.value as Settings['modelPreference'] })}>
          <option value="auto">Auto (route by length/keywords)</option>
          <option value="fable">Always Fable</option>
          <option value="haiku">Always Haiku</option>
        </select>
        <label style={label}>OLLAMA MODEL</label>
        <input style={field} value={draft.ollamaModel} onChange={e => setDraft({ ...draft, ollamaModel: e.target.value })} placeholder="llama3.1:8b" />
        <label style={label}>OLLAMA BASE URL</label>
        <input style={field} value={draft.ollamaBaseUrl} onChange={e => setDraft({ ...draft, ollamaBaseUrl: e.target.value })} placeholder="http://127.0.0.1:11434" />

        <div style={sectionLabel}>MEMORY</div>
        <label style={label}>SHORT-TERM MEMORY (TURNS)</label>
        <input style={field} type="number" min={2} max={50} value={draft.shortTurns}
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
