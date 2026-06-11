import { useState } from 'react'
import type { EmailMessage } from '../../../backend/types'

interface Props {
  emails: EmailMessage[]
  onReply: (email: EmailMessage) => void
  onClose: () => void
}

export function EmailViewer({ emails, onReply, onClose }: Props): JSX.Element {
  const [idx, setIdx] = useState(0)
  const email = emails[idx] ?? null
  const n = emails.length

  const backdrop: React.CSSProperties = {
    position: 'absolute', inset: 0,
    background: 'rgba(200,220,240,0.3)',
    backdropFilter: 'blur(3px)',
    zIndex: 149,
  }

  const panel: React.CSSProperties = {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 580,
    maxHeight: '72vh',
    display: 'flex',
    flexDirection: 'column' as const,
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
    flexShrink: 0,
  }

  const eyebrow: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.35em',
    color: 'var(--accent)',
    marginBottom: 2,
    textTransform: 'uppercase' as const,
  }

  const meta: React.CSSProperties = {
    padding: '14px 20px 10px',
    borderBottom: '1px solid rgba(3,105,161,0.07)',
    flexShrink: 0,
  }

  const metaRow: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    marginBottom: 6,
    alignItems: 'flex-start',
  }

  const metaLbl: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.12em',
    color: 'var(--text-mid)',
    width: 52,
    flexShrink: 0,
    textTransform: 'uppercase' as const,
    paddingTop: 1,
  }

  const metaVal: React.CSSProperties = {
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: 12,
    color: 'var(--text)',
    lineHeight: 1.4,
    wordBreak: 'break-word' as const,
  }

  const bodyArea: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '14px 20px',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: 12,
    lineHeight: 1.7,
    color: 'var(--text)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  }

  const footer: React.CSSProperties = {
    padding: '10px 20px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTop: '1px solid rgba(3,105,161,0.08)',
    flexShrink: 0,
  }

  const pager: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  }

  const pagerBtn: React.CSSProperties = {
    fontFamily: '"Orbitron", monospace',
    fontSize: 10,
    letterSpacing: '0.1em',
    padding: '7px 14px',
    borderRadius: 5,
    cursor: 'pointer',
    border: '1px solid rgba(3,105,161,0.2)',
    background: 'rgba(3,105,161,0.05)',
    color: 'var(--accent)',
  }

  const pagerBtnDisabled: React.CSSProperties = {
    ...pagerBtn,
    opacity: 0.35,
    cursor: 'not-allowed',
  }

  const pagerCount: React.CSSProperties = {
    fontFamily: '"Rajdhani", monospace',
    fontSize: 13,
    letterSpacing: '0.1em',
    color: 'var(--text-mid)',
    minWidth: 36,
    textAlign: 'center' as const,
  }

  const btnBase: React.CSSProperties = {
    fontFamily: '"Orbitron", monospace',
    fontSize: 10,
    letterSpacing: '0.12em',
    padding: '8px 16px',
    borderRadius: 5,
    cursor: 'pointer',
    border: '1px solid rgba(3,105,161,0.25)',
    background: 'rgba(3,105,161,0.06)',
    color: 'var(--accent)',
    marginLeft: 8,
  }

  const btnReply: React.CSSProperties = {
    ...btnBase,
    background: 'var(--accent)',
    color: '#fff',
    border: '1px solid transparent',
  }

  if (n === 0) {
    return (
      <>
        <div style={backdrop} onClick={onClose} />
        <div style={{ ...panel, maxHeight: 200 }} className="no-drag">
          <div style={header}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={eyebrow}>Inbox</div>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em' }}>NO MESSAGES</div>
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 16, padding: 4 }}>✕</button>
            </div>
          </div>
          <div style={{ padding: 20, fontFamily: '"Share Tech Mono", monospace', fontSize: 12, color: 'var(--text-mid)' }}>
            No messages matched your query.
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div style={backdrop} onClick={onClose} />
      <div style={panel} className="no-drag">
        <div style={header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={eyebrow}>Inbox · {idx + 1} / {n}</div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {email?.subject || '(no subject)'}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
          </div>
        </div>

        {email && (
          <div style={meta}>
            <div style={metaRow}>
              <span style={metaLbl}>From</span>
              <span style={metaVal}>{email.from || '(unknown)'}</span>
            </div>
            <div style={metaRow}>
              <span style={metaLbl}>Date</span>
              <span style={metaVal}>{email.date || '(unknown)'}</span>
            </div>
          </div>
        )}

        <div style={bodyArea}>
          {email?.body || '(no body)'}
        </div>

        <div style={footer}>
          <div style={pager}>
            <button
              style={idx === 0 ? pagerBtnDisabled : pagerBtn}
              disabled={idx === 0}
              onClick={() => setIdx(i => i - 1)}
            >‹ PREV</button>
            <span style={pagerCount}>{idx + 1} / {n}</span>
            <button
              style={idx === n - 1 ? pagerBtnDisabled : pagerBtn}
              disabled={idx === n - 1}
              onClick={() => setIdx(i => i + 1)}
            >NEXT ›</button>
          </div>
          <div style={{ display: 'flex' }}>
            <button style={btnBase} onClick={onClose}>CLOSE</button>
            {email && <button style={btnReply} onClick={() => onReply(email)}>REPLY →</button>}
          </div>
        </div>
      </div>
    </>
  )
}
