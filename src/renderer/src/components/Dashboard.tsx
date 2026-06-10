interface DashboardStats {
  tokensToday: number
  costToday: number
  model: string
}

interface Props extends DashboardStats {
  open: boolean
  onClose: () => void
}

export function Dashboard({ open, onClose, tokensToday, costToday, model }: Props): JSX.Element | null {
  if (!open) return null

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '480px',
    background: 'rgba(6, 11, 20, 0.92)',
    border: '1px solid rgba(125, 211, 252, 0.2)',
    borderRadius: '8px',
    padding: '32px',
    fontFamily: '"Orbitron", monospace',
    color: '#7dd3fc',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 0 40px rgba(59, 130, 246, 0.15), inset 0 0 60px rgba(59, 130, 246, 0.03)',
    zIndex: 100,
    animation: 'dashboardIn 0.3s ease-out',
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 0',
    borderBottom: '1px solid rgba(125, 211, 252, 0.08)',
    fontSize: '11px',
    letterSpacing: '0.1em',
  }

  const val: React.CSSProperties = {
    color: '#e0f2fe',
    fontSize: '15px',
    fontWeight: 700,
    textShadow: '0 0 8px rgba(125, 211, 252, 0.3)',
  }

  const divider: React.CSSProperties = {
    width: '100%',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, rgba(125,211,252,0.3), transparent)',
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
          background: 'rgba(0, 0, 0, 0.3)',
          zIndex: 99,
        }}
      />

      {/* Panel */}
      <div style={panelStyle} className="no-drag" id="dashboard-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.15em' }}>SYSTEM DASHBOARD</span>
            <div style={divider} />
          </div>
          <button
            onClick={onClose}
            id="dashboard-close"
            style={{
              background: 'none',
              border: '1px solid rgba(125, 211, 252, 0.15)',
              color: '#7dd3fc',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '4px 10px',
              borderRadius: '4px',
              fontFamily: '"Orbitron", monospace',
              letterSpacing: '0.1em',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(125, 211, 252, 0.5)'
              e.currentTarget.style.background = 'rgba(125, 211, 252, 0.08)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(125, 211, 252, 0.15)'
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
          <span style={{ ...val, color: '#4ade80' }}>ACTIVE</span>
        </div>
        <div style={{ ...row, borderBottom: 'none' }}>
          <span>STATUS</span>
          <span style={{ ...val, color: '#4ade80' }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#4ade80',
              marginRight: '8px',
              boxShadow: '0 0 8px #4ade80',
            }} />
            OPERATIONAL
          </span>
        </div>

        <div style={{
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid rgba(125, 211, 252, 0.08)',
          fontSize: '9px',
          color: '#4a6a8a',
          letterSpacing: '0.12em',
          textAlign: 'center',
        }}>
          JARVIS v1.0 — PHASE 1 MVP
        </div>
      </div>
    </>
  )
}
