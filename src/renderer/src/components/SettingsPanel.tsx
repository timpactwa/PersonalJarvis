import { useState, useEffect } from 'react'
import type { Settings } from '../../../backend/types'

interface Props {
  open: boolean
  settings: Settings | null
  onClose: () => void
  onSave: (partial: Partial<Settings>) => void
  onHotkeyChange: (accelerator: string) => void
}

export function SettingsPanel({ open, settings, onClose, onSave, onHotkeyChange }: Props): JSX.Element | null {
  const [draft, setDraft] = useState<Settings | null>(settings)
  useEffect(() => { setDraft(settings) }, [settings])

  if (!open || !draft) return null

  const save = (): void => {
    onSave(draft)
    onHotkeyChange(draft.hotkey)
    onClose()
  }

  const panel: React.CSSProperties = {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    width: 460, background: 'rgba(6, 11, 20, 0.94)', border: '1px solid rgba(125,211,252,0.2)',
    borderRadius: 8, padding: 28, fontFamily: '"Orbitron", monospace', color: '#7dd3fc',
    backdropFilter: 'blur(12px)', zIndex: 130, boxShadow: '0 0 40px rgba(59,130,246,0.15)',
  }
  const label: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', display: 'block', marginBottom: 6, color: '#94a3b8' }
  const field: React.CSSProperties = {
    width: '100%', background: 'rgba(125,211,252,0.06)', border: '1px solid rgba(125,211,252,0.18)',
    borderRadius: 4, color: '#e0f2fe', padding: '8px 10px', fontFamily: '"Share Tech Mono", monospace',
    fontSize: 12, marginBottom: 16,
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 129 }} />
      <div style={panel} className="no-drag">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em' }}>SETTINGS</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <label style={label}>PUSH-TO-TALK HOTKEY</label>
        <input style={field} value={draft.hotkey} onChange={e => setDraft({ ...draft, hotkey: e.target.value })} placeholder="Alt+Space" />

        <label style={label}>ELEVENLABS VOICE ID</label>
        <input style={field} value={draft.voiceId} onChange={e => setDraft({ ...draft, voiceId: e.target.value })} />

        <label style={label}>MODEL PREFERENCE</label>
        <select
          style={field}
          value={draft.modelPreference}
          onChange={e => setDraft({ ...draft, modelPreference: e.target.value as Settings['modelPreference'] })}
        >
          <option value="auto">Auto (route by length/keywords)</option>
          <option value="fable">Always Fable</option>
          <option value="haiku">Always Haiku</option>
        </select>

        <label style={label}>SHORT-TERM MEMORY (TURNS)</label>
        <input
          style={field}
          type="number"
          min={2}
          max={50}
          value={draft.shortTurns}
          onChange={e => setDraft({ ...draft, shortTurns: parseInt(e.target.value || '20', 10) })}
        />

        <label style={label}>OLLAMA MODEL</label>
        <input style={field} value={draft.ollamaModel} onChange={e => setDraft({ ...draft, ollamaModel: e.target.value })} placeholder="llama3.1:8b" />

        <label style={label}>OLLAMA BASE URL</label>
        <input style={field} value={draft.ollamaBaseUrl} onChange={e => setDraft({ ...draft, ollamaBaseUrl: e.target.value })} placeholder="http://127.0.0.1:11434" />

        <button
          onClick={save}
          style={{
            width: '100%', background: 'rgba(125,211,252,0.1)', border: '1px solid rgba(125,211,252,0.4)',
            color: '#e0f2fe', cursor: 'pointer', fontFamily: '"Orbitron", monospace', fontSize: 12,
            letterSpacing: '0.12em', padding: '10px 0', borderRadius: 4,
          }}
        >SAVE</button>
      </div>
    </>
  )
}
