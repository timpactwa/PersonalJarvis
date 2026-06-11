import type { AnimState } from '../../../backend/types'

interface Props {
  state: AnimState
}

const BAR_CONFIGS = [
  { h: 0.30, spd: 0.72, delay: 0.00 },
  { h: 0.55, spd: 0.88, delay: 0.07 },
  { h: 0.80, spd: 0.65, delay: 0.13 },
  { h: 0.95, spd: 0.95, delay: 0.06 },
  { h: 1.00, spd: 0.78, delay: 0.19 },
  { h: 0.90, spd: 0.60, delay: 0.03 },
  { h: 0.75, spd: 0.83, delay: 0.15 },
  { h: 0.60, spd: 0.70, delay: 0.09 },
  { h: 0.85, spd: 0.92, delay: 0.22 },
  { h: 0.50, spd: 0.67, delay: 0.05 },
  { h: 0.35, spd: 0.80, delay: 0.11 },
]

const PEAK_BAR = 36

export function ListeningIndicator({ state }: Props): JSX.Element {
  const active = state === 'listening'

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>

      {/* Screen-edge glow */}
      <div
        className={active ? 'li-edge li-edge--on' : 'li-edge'}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Corner brackets */}
      {(['tl', 'tr', 'bl', 'br'] as const).map(pos => (
        <div
          key={pos}
          className={`li-corner li-corner--${pos}${active ? ' li-corner--on' : ''}`}
        />
      ))}

      {/* Waveform + label — positioned above transcript */}
      <div
        style={{
          position: 'absolute',
          bottom: 90,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          opacity: active ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      >
        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: PEAK_BAR }}>
          {BAR_CONFIGS.map(({ h, spd, delay }, i) => (
            <div
              key={i}
              className="li-bar"
              style={{
                width: 3,
                height: Math.round(h * PEAK_BAR),
                borderRadius: '2px 2px 1px 1px',
                background: 'linear-gradient(to top, #0369a1, #38bdf8, #bae6fd)',
                boxShadow: '0 0 6px rgba(56,189,248,0.55), 0 0 12px rgba(56,189,248,0.25)',
                transformOrigin: 'bottom center',
                animationDuration: `${spd}s`,
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </div>

        {/* Label */}
        <div
          className={active ? 'li-label li-label--on' : 'li-label'}
          style={{
            fontFamily: '"Orbitron", monospace',
            fontSize: '9px',
            letterSpacing: '0.32em',
            color: '#7dd3fc',
            textShadow: '0 0 8px rgba(56,189,248,0.9), 0 0 20px rgba(56,189,248,0.4)',
          }}
        >
          ● LISTENING
        </div>
      </div>
    </div>
  )
}
