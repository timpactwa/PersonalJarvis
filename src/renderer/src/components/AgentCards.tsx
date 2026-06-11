import { useState } from 'react'
import type { AgentInfo } from '../../../backend/types'

interface Props {
  agents: AgentInfo[]
  onClose: (id: string) => void
}

const STATUS_COLOR: Record<AgentInfo['status'], string> = {
  running: '#60a5fa',
  done: '#4ade80',
  error: '#f87171',
}

export function AgentCards({ agents, onClose }: Props): JSX.Element | null {
  if (agents.length === 0) return null
  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        display: 'flex',
        gap: 12,
        zIndex: 90,
        maxWidth: '70vw',
        overflowX: 'auto',
      }}
    >
      {agents.map(a => <AgentCard key={a.id} agent={a} onClose={onClose} />)}
    </div>
  )
}

function AgentCard({ agent, onClose }: { agent: AgentInfo; onClose: (id: string) => void }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const last = agent.actions[agent.actions.length - 1] ?? 'Starting…'
  return (
    <div
      style={{
        width: 260,
        flex: '0 0 auto',
        background: 'rgba(255, 255, 255, 0.88)',
        border: `1px solid ${STATUS_COLOR[agent.status]}66`,
        borderRadius: 8,
        padding: 14,
        fontFamily: '"Orbitron", monospace',
        color: 'var(--accent)',
        backdropFilter: 'blur(10px)',
        boxShadow: `0 4px 16px rgba(3,80,140,0.1)`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0a2540' }}>{agent.name}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: STATUS_COLOR[agent.status], letterSpacing: '0.1em' }}>
            {agent.status.toUpperCase()}
          </span>
          <button
            onClick={() => onClose(agent.id)}
            style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 12 }}
          >✕</button>
        </span>
      </div>
      <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: 'var(--text-mid)', marginBottom: 8 }}>
        {agent.task}
      </div>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }}
      >
        {expanded
          ? agent.actions.map((act, i) => <div key={i} style={{ marginBottom: 4 }}>› {act}</div>)
          : <div>› {agent.result ?? last}</div>}
      </div>
    </div>
  )
}
