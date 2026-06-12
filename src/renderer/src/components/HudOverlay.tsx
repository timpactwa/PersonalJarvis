import type { AnimState, LlmProvider } from '../../../backend/types'

const PROVIDER_CYCLE: LlmProvider[] = ['auto', 'groq', 'ollama', 'claude']

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  auto: 'AUTO',
  claude: 'CLAUDE',
  groq: 'GROQ',
  ollama: 'OLLAMA',
}

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
  llmProvider?: LlmProvider
  onProviderChange?: (provider: LlmProvider) => void
  onStatsClick?: () => void
  textVisible?: boolean
  onToggleText?: () => void
}

export function HudOverlay({ animState, tokensToday, costToday, model, llmProvider = 'auto', onProviderChange, onStatsClick, textVisible = true, onToggleText }: Props): JSX.Element {
  const cycleProvider = (): void => {
    if (!onProviderChange) return
    const idx = PROVIDER_CYCLE.indexOf(llmProvider)
    const next = PROVIDER_CYCLE[(idx + 1) % PROVIDER_CYCLE.length]
    onProviderChange(next)
  }

  const providerLabel = PROVIDER_LABELS[llmProvider] ?? model.replace(/^groq:/, '').replace(/^ollama:/, '').toUpperCase()

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
          fontSize: 15,
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
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ fontSize: 8 }}>●</span>
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
            className="pill-btn"
          >
            DASHBOARD
          </button>
          <button
            onClick={onToggleText}
            title={textVisible ? 'Hide transcript' : 'Show transcript'}
            className="pill-btn"
            style={{
              background: textVisible ? 'rgba(3,105,161,0.18)' : 'rgba(3,105,161,0.04)',
              color: textVisible ? 'var(--accent)' : 'var(--text-dim)',
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
        <button
          onClick={cycleProvider}
          title="Click to switch LLM provider (Auto → Groq → Ollama → Claude)"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: onProviderChange ? 'pointer' : 'default',
            fontFamily: 'var(--font-data)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.12em',
            color: llmProvider === 'claude' ? 'var(--text-dim)' : 'var(--accent)',
            textDecoration: onProviderChange ? 'underline dotted' : 'none',
          }}
        >
          {providerLabel}
        </button>
      </div>
    </>
  )
}
