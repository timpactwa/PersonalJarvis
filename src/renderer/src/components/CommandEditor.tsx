import { useState } from 'react'
import type { CustomCommandDraft, CustomCommandKind } from '../../../backend/types'

interface Props {
  draft: CustomCommandDraft
  onSave: (draft: CustomCommandDraft) => void
  onClose: () => void
}

export function CommandEditor({ draft, onSave, onClose }: Props): JSX.Element {
  const [fields, setFields] = useState<CustomCommandDraft>({ ...draft })
  const aliasText = fields.aliases.join(', ')

  const set = <K extends keyof CustomCommandDraft>(k: K, v: CustomCommandDraft[K]): void => {
    setFields(f => ({ ...f, [k]: v }))
  }

  const backdrop: React.CSSProperties = {
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.4)',
    backdropFilter: 'blur(3px)',
    zIndex: 149,
  }

  const panel: React.CSSProperties = {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 520,
    background: 'var(--ov-bg)',
    border: '1px solid var(--ov-border)',
    borderRadius: 'var(--ov-radius)',
    fontFamily: 'var(--font-hud)',
    color: 'var(--ov-text)',
    boxShadow: 'var(--ov-shadow)',
    zIndex: 150,
    overflow: 'hidden',
    animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
  }

  const header: React.CSSProperties = {
    padding: '14px 20px 12px',
    borderBottom: '1px solid var(--ov-separator)',
    background: 'var(--ov-bg-raised)',
  }

  const lbl: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.12em',
    color: 'var(--ov-text-mid)',
    display: 'block',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
  }

  const canSave = fields.label.trim() && fields.target.trim() && fields.aliases.length > 0

  return (
    <>
      <div className="no-drag" style={backdrop} onClick={onClose} />
      <div className="no-drag" style={panel}>
        <div style={header}>
          <div style={{ fontSize: 9, letterSpacing: '0.35em', color: 'var(--ov-accent)', marginBottom: 2 }}>NEW LAUNCH COMMAND</div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em' }}>CONFIGURE VOICE TRIGGER</div>
        </div>
        <div style={{ padding: '16px 20px 4px' }}>
          <label style={lbl}>APP NAME</label>
          <input
            className="ov-input"
            style={{ marginBottom: 12 }}
            value={fields.label}
            onChange={e => set('label', e.target.value)}
            placeholder="Marvel Rivals"
          />
          <label style={lbl}>SAY THESE WORDS (comma-separated)</label>
          <input
            className="ov-input"
            style={{ marginBottom: 12 }}
            value={aliasText}
            onChange={e => set('aliases', e.target.value.split(',').map(a => a.trim()).filter(Boolean))}
            placeholder="rivals, marvel rivals"
          />
          <label style={lbl}>TARGET PATH OR URI</label>
          <input
            className="ov-input"
            style={{ marginBottom: 12 }}
            value={fields.target}
            onChange={e => set('target', e.target.value)}
            placeholder="C:\...\MarvelRivals_Launcher.exe or steam://rungameid/2767030"
          />
          <label style={lbl}>LAUNCH TYPE</label>
          <select
            className="ov-input"
            style={{ marginBottom: 16 }}
            value={fields.kind}
            onChange={e => set('kind', e.target.value as CustomCommandKind)}
          >
            <option value="exe">Executable (.exe)</option>
            <option value="uri">URI (steam://, spotify:, etc.)</option>
            <option value="shell">Shell command on PATH</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 20px 18px' }}>
          <button className="pill-btn" style={{ flex: 1, padding: '9px 0' }} onClick={onClose}>CANCEL</button>
          <button
            className={`pill-btn${canSave ? ' pill-btn--active' : ''}`}
            style={{ flex: 1, padding: '9px 0' }}
            disabled={!canSave}
            onClick={() => onSave(fields)}
          >
            SAVE COMMAND
          </button>
        </div>
      </div>
    </>
  )
}
