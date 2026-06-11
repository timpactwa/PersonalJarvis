import type { AnimState } from '../../../backend/types'

const STATUS_LABELS: Record<AnimState, string> = {
  idle:      'ONLINE',
  listening: 'LISTENING',
  thinking:  'PROCESSING',
  speaking:  'SPEAKING',
}

const STATUS_COLORS: Record<AnimState, string> = {
  idle:      '#16a34a',
  listening: '#0369a1',
  thinking:  '#b45309',
  speaking:  '#7c3aed',
}

interface Props {
  animState: AnimState
  tokensToday: number
  costToday: number
  model: string
  onStatsClick?: () => void
  textVisible?: boolean
  onToggleText?: () => void
}

export function HudOverlay({ animState, tokensToday, costToday, model, onStatsClick, textVisible = true, onToggleText }: Props): JSX.Element {
  const cleanModel = model.replace(/^groq:/, '').replace(/^ollama:/, '').toUpperCase()

  return (
    <>
      {/* Top-left: identity + status */}
      <div style={{
        position: 'absolute',
        top: 52,
        left: 22,
        zIndex: 10,
        pointerEvents: 'none',
      }}>
        <div style={{
          fontFamily: 'var(--font-hud)',
          fontSize: 13,
          fontWeight: 700,
          color: '#0a2540',
          letterSpacing: '0.3em',
        }}>
          JARVIS
        </div>
        <div style={{
          width: 36,
          height: 1,
          background: 'linear-gradient(90deg, var(--accent), transparent)',
          margin: '4px 0',
        }} />
        <div style={{
          fontFamily: 'var(--font-data)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.18em',
          color: STATUS_COLORS[animState],
          transition: 'color 0.4s',
        }}>
          {STATUS_LABELS[animState]}
        </div>
      </div>

      {/* Top-right: dashboard button + stats */}
      <div
        className="no-drag"
        style={{
          position: 'absolute',
          top: 52,
          right: 22,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 5,
        }}
      >
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={onStatsClick}
            style={{
              background: 'rgba(3, 105, 161, 0.07)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--accent)',
              cursor: 'pointer',
              fontFamily: 'var(--font-hud)',
              fontSize: 8,
              letterSpacing: '0.22em',
              padding: '4px 11px',
              transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.background = 'rgba(3,105,161,0.14)'
              el.style.borderColor = 'var(--border-hot)'
              el.style.boxShadow = '0 2px 12px rgba(3,105,161,0.15)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              el.style.background = 'rgba(3, 105, 161, 0.07)'
              el.style.borderColor = 'var(--border)'
              el.style.boxShadow = 'none'
            }}
          >
            DASHBOARD
          </button>
          <button
            onClick={onToggleText}
            title={textVisible ? 'Hide transcript' : 'Show transcript'}
            style={{
              background: textVisible ? 'rgba(3,105,161,0.12)' : 'rgba(3,105,161,0.03)',
              border: textVisible ? '1px solid rgba(3,105,161,0.4)' : '1px solid var(--border)',
              borderRadius: 4,
              color: textVisible ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'var(--font-hud)',
              fontSize: 8,
              letterSpacing: '0.22em',
              padding: '4px 9px',
              transition: 'background 0.2s, border-color 0.2s, color 0.2s',
            }}
          >
            TEXT
          </button>
        </div>
        <div style={{
          fontFamily: 'var(--font-data)',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.08em',
          color: 'var(--text-mid)',
          textAlign: 'right',
          lineHeight: 1.5,
        }}>
          <span style={{ color: 'var(--accent)' }}>{tokensToday.toLocaleString()}</span>
          <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>·</span>
          <span style={{ color: 'var(--text-mid)' }}>${costToday.toFixed(4)}</span>
        </div>
        <div style={{
          fontFamily: 'var(--font-data)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.12em',
          color: 'var(--text-dim)',
        }}>
          {cleanModel}
        </div>
      </div>
    </>
  )
}
