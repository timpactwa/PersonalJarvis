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
    background: 'var(--ov-bg)',
    border: '1px solid var(--ov-border)',
    borderRadius: 'var(--ov-radius)',
    padding: '32px',
    fontFamily: 'var(--font-hud)',
    color: 'var(--ov-text)',
    boxShadow: 'var(--ov-shadow)',
    zIndex: 550,
    animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 0',
    borderBottom: '1px solid var(--ov-separator)',
    fontSize: '11px',
    letterSpacing: '0.1em',
    color: 'var(--ov-text-mid)',
  }

  const val: React.CSSProperties = {
    color: 'var(--ov-text)',
    fontSize: '15px',
    fontWeight: 700,
    fontFamily: 'var(--font-data)',
    letterSpacing: '0.05em',
  }

  const divider: React.CSSProperties = {
    width: '100%',
    height: '1px',
    background: 'linear-gradient(90deg, transparent, var(--ov-border-hot), transparent)',
    margin: '4px 0',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="no-drag"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(2px)',
          zIndex: 549,
        }}
      />

      {/* Panel */}
      <div style={panelStyle} className="no-drag" id="dashboard-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.15em', color: 'var(--ov-text)' }}>SYSTEM DASHBOARD</span>
            <div style={divider} />
          </div>
          <button
            onClick={onClose}
            id="dashboard-close"
            className="pill-btn pill-btn--icon"
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
          className="pill-btn no-drag"
          style={{ marginTop: 18, width: '100%', padding: '8px 0' }}
        >OPEN SETTINGS</button>

        <div style={{
          marginTop: '20px',
          paddingTop: '16px',
          borderTop: '1px solid var(--ov-separator)',
          fontSize: '9px',
          color: 'var(--ov-text-dim)',
          letterSpacing: '0.12em',
          textAlign: 'center',
        }}>
          JARVIS v1.0 — PHASE 1 MVP
        </div>
      </div>
    </>
  )
}
