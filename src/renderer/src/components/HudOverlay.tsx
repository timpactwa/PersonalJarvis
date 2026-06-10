import type { AnimState } from '../../../backend/types'

const STATUS_LABELS: Record<AnimState, string> = {
  idle: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'SPEAKING',
}

const STATUS_COLORS: Record<AnimState, string> = {
  idle: '#4ade80',
  listening: '#60a5fa',
  thinking: '#f59e0b',
  speaking: '#a78bfa',
}

interface Props {
  animState: AnimState
  tokensToday: number
  costToday: number
  model: string
}

const hud: React.CSSProperties = {
  position: 'absolute',
  fontFamily: '"Orbitron", monospace',
  fontSize: '11px',
  letterSpacing: '0.1em',
  color: '#7dd3fc',
  lineHeight: 1.6,
  pointerEvents: 'none',
}

const line: React.CSSProperties = {
  width: 40,
  height: 1,
  background: 'rgba(125,211,252,0.3)',
  margin: '3px 0',
}

export function HudOverlay({ animState, tokensToday, costToday, model }: Props): JSX.Element {
  return (
    <>
      {/* Top-left: identity + status */}
      <div style={{ ...hud, top: 24, left: 24 }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#e0f2fe' }}>JARVIS</div>
        <div style={line} />
        <div style={{ color: STATUS_COLORS[animState] }}>{STATUS_LABELS[animState]}</div>
      </div>

      {/* Top-right: stats */}
      <div style={{ ...hud, top: 24, right: 24, textAlign: 'right' }}>
        <div>{tokensToday.toLocaleString()} TOKENS</div>
        <div style={{ ...line, marginLeft: 'auto' }} />
        <div>${costToday.toFixed(4)} TODAY</div>
        <div style={{ color: '#94a3b8', marginTop: 2 }}>{model.toUpperCase()}</div>
      </div>
    </>
  )
}
