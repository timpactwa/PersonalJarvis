import { useState } from 'react'
import type { EmailDraft } from '../../../backend/types'

interface Props {
  draft: EmailDraft
  onSend: (draft: EmailDraft) => void
  onSaveDraft: (draft: EmailDraft) => void
  onClose: () => void
}

export function EmailComposer({ draft, onSend, onSaveDraft, onClose }: Props): JSX.Element {
  const [fields, setFields] = useState<EmailDraft>({ ...draft })
  const [showCcBcc, setShowCcBcc] = useState(!!(draft.cc || draft.bcc))

  const set = (k: keyof EmailDraft, v: string) => setFields(f => ({ ...f, [k]: v }))

  const backdrop: React.CSSProperties = {
    position: 'absolute', inset: 0,
    background: 'rgba(200,220,240,0.3)',
    backdropFilter: 'blur(3px)',
    zIndex: 149,
  }

  const panel: React.CSSProperties = {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 560,
    background: 'rgba(255,255,255,0.97)',
    border: '1px solid rgba(3,105,161,0.18)',
    borderRadius: 14,
    fontFamily: '"Orbitron", monospace',
    color: 'var(--text)',
    backdropFilter: 'blur(24px)',
    boxShadow: '0 12px 60px rgba(3,80,140,0.18)',
    zIndex: 150,
    overflow: 'hidden',
  }

  const header: React.CSSProperties = {
    padding: '14px 20px 12px',
    borderBottom: '1px solid rgba(3,105,161,0.1)',
    background: 'rgba(3,105,161,0.04)',
  }

  const eyebrow: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.35em',
    color: 'var(--accent)',
    marginBottom: 2,
    textTransform: 'uppercase' as const,
  }

  const title: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--text)',
  }

  const body: React.CSSProperties = { padding: '16px 20px 4px' }

  const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  }

  const lbl: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.12em',
    color: 'var(--text-mid)',
    width: 52,
    flexShrink: 0,
    textTransform: 'uppercase' as const,
  }

  const input: React.CSSProperties = {
    flex: 1,
    background: 'rgba(3,105,161,0.04)',
    border: '1px solid rgba(3,105,161,0.15)',
    borderRadius: 5,
    color: 'var(--text)',
    padding: '7px 10px',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: 12,
    outline: 'none',
  }

  const divider: React.CSSProperties = {
    height: 1,
    background: 'rgba(3,105,161,0.08)',
    margin: '6px 0 10px',
  }

  const textarea: React.CSSProperties = {
    ...input,
    display: 'block',
    width: '100%',
    resize: 'vertical' as const,
    minHeight: 160,
    lineHeight: 1.6,
    fontSize: 12,
    boxSizing: 'border-box' as const,
    marginBottom: 4,
  }

  const footer: React.CSSProperties = {
    padding: '12px 20px 16px',
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    borderTop: '1px solid rgba(3,105,161,0.08)',
    marginTop: 8,
  }

  const btnBase: React.CSSProperties = {
    fontFamily: '"Orbitron", monospace',
    fontSize: 10,
    letterSpacing: '0.12em',
    padding: '9px 18px',
    borderRadius: 5,
    cursor: 'pointer',
    border: '1px solid rgba(3,105,161,0.25)',
    background: 'rgba(3,105,161,0.06)',
    color: 'var(--accent)',
  }

  const btnSend: React.CSSProperties = {
    ...btnBase,
    background: 'var(--accent)',
    color: '#fff',
    border: '1px solid transparent',
  }

  const toggleCcBcc: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.1em',
    color: 'var(--text-mid)',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: '0 0 6px',
    textDecoration: 'underline',
    fontFamily: '"Orbitron", monospace',
  }

  return (
    <>
      <div style={backdrop} onClick={onClose} />
      <div style={panel} className="no-drag">
        <div style={header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={eyebrow}>Outbound Transmission</div>
              <div style={title}>COMPOSE EMAIL</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
          </div>
        </div>

        <div style={body}>
          <div style={fieldRow}>
            <span style={lbl}>To</span>
            <input style={input} value={fields.to} onChange={e => set('to', e.target.value)} placeholder="recipient@example.com" />
          </div>

          {showCcBcc ? (
            <>
              <div style={fieldRow}>
                <span style={lbl}>Cc</span>
                <input style={input} value={fields.cc} onChange={e => set('cc', e.target.value)} placeholder="cc@example.com" />
              </div>
              <div style={fieldRow}>
                <span style={lbl}>Bcc</span>
                <input style={input} value={fields.bcc} onChange={e => set('bcc', e.target.value)} placeholder="bcc@example.com" />
              </div>
            </>
          ) : (
            <button style={toggleCcBcc} onClick={() => setShowCcBcc(true)}>+ Add Cc / Bcc</button>
          )}

          <div style={fieldRow}>
            <span style={lbl}>Subject</span>
            <input style={input} value={fields.subject} onChange={e => set('subject', e.target.value)} placeholder="Subject line" />
          </div>

          <div style={divider} />

          <textarea
            style={textarea}
            value={fields.body}
            onChange={e => set('body', e.target.value)}
            placeholder="Write your message…"
          />
        </div>

        <div style={footer}>
          <button style={btnBase} onClick={onClose}>DISCARD</button>
          <button style={btnBase} onClick={() => onSaveDraft(fields)}>SAVE DRAFT</button>
          <button style={btnSend} onClick={() => onSend(fields)}>SEND →</button>
        </div>
      </div>
    </>
  )
}
