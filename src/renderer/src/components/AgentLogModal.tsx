import type { AgentInfo } from '../../../backend/types'

interface Props {
  agent: AgentInfo
  onClose: () => void
}

export function AgentLogModal({ agent, onClose }: Props): JSX.Element {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,5,12,0.55)', backdropFilter: 'blur(3px)', zIndex: 139 }} />
      <div
        className="no-drag"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(560px, 84vw)', maxHeight: '70vh', overflowY: 'auto',
          background: 'var(--ov-bg)', border: '1px solid var(--ov-border)', borderRadius: 'var(--ov-radius)',
          padding: 24, zIndex: 140, fontFamily: 'var(--font-hud)', color: 'var(--ov-text)',
          boxShadow: 'var(--ov-shadow)',
          animation: 'materializeCentered 0.28s cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--ov-accent)' }}>{agent.name} · LOG</span>
          <button className="pill-btn pill-btn--icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ov-text)', lineHeight: 1.6 }}>
          {agent.actions.length === 0
            ? <div style={{ color: 'var(--ov-text-dim)' }}>No actions recorded.</div>
            : agent.actions.map((act, i) => <div key={i} style={{ marginBottom: 6 }}>› {act}</div>)}
        </div>
      </div>
    </>
  )
}
