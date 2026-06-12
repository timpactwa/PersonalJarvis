import { useState } from 'react'
import type { AgentInfo } from '../../../backend/types'
import { AgentLogModal } from './AgentLogModal'

interface Props {
  agents: AgentInfo[]
  onClose: (id: string) => void
}

const STATUS_COLOR: Record<AgentInfo['status'], string> = {
  running: '#0369a1',
  done: '#16a34a',
  error: '#dc2626',
}

export function AgentCards({ agents, onClose }: Props): JSX.Element | null {
  if (agents.length === 0) return null
  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 12,
        zIndex: 90, maxWidth: '70vw', overflowX: 'auto',
      }}
    >
      {agents.map(a => <AgentCard key={a.id} agent={a} onClose={onClose} />)}
    </div>
  )
}

function AgentCard({ agent, onClose }: { agent: AgentInfo; onClose: (id: string) => void }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const last = agent.actions[agent.actions.length - 1] ?? 'Starting…'
  const color = STATUS_COLOR[agent.status]
  const done = agent.status === 'done'

  const copy = (): void => {
    if (agent.result) {
      void navigator.clipboard.writeText(agent.result)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div style={{
      width: 280, flex: '0 0 auto', background: 'rgba(255,255,255,0.9)',
      border: `1px solid ${color}55`, borderRadius: 10, padding: 14,
      fontFamily: 'var(--font-hud)', color: 'var(--accent)',
      backdropFilter: 'blur(10px)', boxShadow: '0 4px 16px rgba(3,80,140,0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0a2540' }}>{agent.name}</span>
        <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 8, color }}>●</span>
          <span style={{ fontSize: 9, color, letterSpacing: '0.1em' }}>{agent.status.toUpperCase()}</span>
        </span>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mid)', marginBottom: 10 }}>
        {agent.task}
      </div>

      {done && agent.result && (
        <div style={{
          background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 6,
          padding: 8, marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#14532d',
          maxHeight: 120, overflowY: 'auto', wordBreak: 'break-word',
        }}>
          {agent.result}
        </div>
      )}

      {!done && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>
          {expanded
            ? agent.actions.map((act, i) => <div key={i} style={{ marginBottom: 4 }}>› {act}</div>)
            : <div>› {last}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {!done && agent.actions.length > 1 && (
          <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => setExpanded(e => !e)}>
            {expanded ? '▴ LOG' : '▾ LOG'}
          </button>
        )}
        {done && (
          <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => setLogOpen(true)}>
            ▾ LOG
          </button>
        )}
        {done && agent.result && (
          <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={copy}>
            {copied ? 'COPIED' : 'COPY'}
          </button>
        )}
        <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => onClose(agent.id)}>
          {done ? 'DISMISS' : '✕'}
        </button>
      </div>
      {logOpen && <AgentLogModal agent={agent} onClose={() => setLogOpen(false)} />}
    </div>
  )
}
