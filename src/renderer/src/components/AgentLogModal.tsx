import type { AgentInfo } from '../../../backend/types'

interface Props {
  agent: AgentInfo
  onClose: () => void
}

export function AgentLogModal({ agent, onClose }: Props): JSX.Element {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(200,220,240,0.3)', backdropFilter: 'blur(3px)', zIndex: 139 }} />
      <div
        className="no-drag"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(560px, 84vw)', maxHeight: '70vh', overflowY: 'auto',
          background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(3,105,161,0.18)', borderRadius: 12,
          padding: 24, zIndex: 140, fontFamily: 'var(--font-hud)', color: 'var(--text)',
          backdropFilter: 'blur(20px)', boxShadow: '0 8px 40px rgba(3,80,140,0.16)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em' }}>{agent.name} · LOG</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: '#1a4060', lineHeight: 1.6 }}>
          {agent.actions.length === 0
            ? <div style={{ color: 'var(--text-dim)' }}>No actions recorded.</div>
            : agent.actions.map((act, i) => <div key={i} style={{ marginBottom: 6 }}>› {act}</div>)}
        </div>
      </div>
    </>
  )
}
