import { UsageGraph } from './UsageGraph'
import type { UsagePoint, ModelUsage } from '../../../backend/types'

interface DashboardStats {
  tokensToday: number
  costToday: number
  model: string
}

interface Props extends DashboardStats {
  open: boolean
  onClose: () => void
  daily: UsagePoint[]
  byModel: ModelUsage[]
  onOpenSettings: () => void
}

export function Dashboard({ open, onClose, tokensToday, costToday, model, daily, byModel, onOpenSettings }: Props): JSX.Element | null {
  if (!open) return null

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '480px',
    background: 'rgba(255, 255, 255, 0.94)',
    border: '1px solid rgba(3, 105, 161, 0.15)',
    borderRadius: '12px',
    padding: '32px',
    fontFamily: 'var(--font-hud)',
    color: 'var(--text)',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 8px 40px rgba(3, 80, 140, 0.14), 0 2px 8px rgba(3, 80, 140, 0.06)',
    zIndex: 100,
    animation: 'dashboardIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 0',
    borderBottom: '1px solid rgba(3, 105, 161, 0.07)',
    fontSize: '11px',
    letterSpacing: '0.1em',
    color: 'var(--text-mid)',
  }

  const val: React.CSSProperties = {
    color: '#0a2540',
    fontSize: '15px',
    fontWeight: 700,
    fontFamily: 'var(--font-data)',
    letterSpacing: '0.05em',
  }

  const divider: React.CSSProperties = {
    width: '100%',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(3,105,161,0.25), transparent)',
    margin: '4px 0',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(200, 220, 240, 0.25)',
          backdropFilter: 'blur(2px)',
          zIndex: 99,
        }}
      />

      {/* Panel */}
      <div style={panelStyle} className="no-drag" id="dashboard-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.15em', color: 'var(--text)' }}>SYSTEM DASHBOARD</span>
            <div style={divider} />
          </div>
          <button
            onClick={onClose}
            id="dashboard-close"
            style={{
              background: 'none',
              border: '1px solid rgba(3,105,161,0.18)',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '4px 10px',
              borderRadius: '4px',
              fontFamily: '"Orbitron", monospace',
              letterSpacing: '0.1em',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(3,105,161,0.45)'
              e.currentTarget.style.background = 'rgba(3,105,161,0.07)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(3,105,161,0.18)'
              e.currentTarget.style.background = 'none'
            }}
          >✕</button>
        </div>

        <div style={row}>
          <span>TOKENS TODAY</span>
          <span style={val}>{tokensToday.toLocaleString()}</span>
        </div>
        <div style={row}>
          <span>COST TODAY</span>
          <span style={val}>${costToday.toFixed(4)}</span>
        </div>
        <div style={row}>
          <span>ACTIVE MODEL</span>
          <span style={val}>{model.toUpperCase()}</span>
        </div>
        <div style={row}>
          <span>MEMORY SYSTEM</span>
          <span style={{ ...val, color: '#16a34a' }}>ACTIVE</span>
        </div>
        <div style={{ ...row, borderBottom: 'none' }}>
          <span>STATUS</span>
          <span style={{ ...val, color: '#16a34a' }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#16a34a',
              marginRight: '8px',
              boxShadow: '0 0 6px rgba(22,163,74,0.5)',
            }} />
            OPERATIONAL
          </span>
        </div>

        <UsageGraph daily={daily} byModel={byModel} />

        <button
          onClick={onOpenSettings}
          className="no-drag"
          style={{
            marginTop: 18, width: '100%', background: 'none',
            border: '1px solid rgba(3,105,161,0.2)', color: 'var(--accent)',
            cursor: 'pointer', fontFamily: '"Orbitron", monospace', fontSize: 11,
            letterSpacing: '0.12em', padding: '8px 0', borderRadius: 4,
            transition: 'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(3,105,161,0.07)'
            e.currentTarget.style.borderColor = 'rgba(3,105,161,0.4)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'none'
            e.currentTarget.style.borderColor = 'rgba(3,105,161,0.2)'
          }}
        >OPEN SETTINGS</button>

        <div style={{
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid rgba(3, 105, 161, 0.07)',
          fontSize: '9px',
          color: 'var(--text-dim)',
          letterSpacing: '0.12em',
          textAlign: 'center',
        }}>
          JARVIS v1.0 — PHASE 1 MVP
        </div>
      </div>
    </>
  )
}
