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
  idle:      '#34d399', // emerald
  listening: '#22d3ee', // cyan
  thinking:  '#f5a524', // amber
  speaking:  '#a78bfa', // violet
}

interface Props {
  animState: AnimState
  tokensToday: number
  costToday: number
  model: string
  llmProvider?: LlmProvider
  onProviderChange?: (provider: LlmProvider) => void
  textVisible?: boolean
  onToggleText?: () => void
  spotifyOpen?: boolean
  githubOpen?: boolean
  quietMode?: boolean
  onToggleSpotify?: () => void
  onToggleGithub?: () => void
  onToggleQuietMode?: () => void
}

export function HudOverlay({ animState, tokensToday, costToday, model, llmProvider = 'auto', onProviderChange, textVisible = true, onToggleText, spotifyOpen, githubOpen, quietMode, onToggleSpotify, onToggleGithub, onToggleQuietMode }: Props): JSX.Element {
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
          fontFamily: 'var(--font-display)',
          fontSize: 15,
          fontWeight: 700,
          color: 'rgba(230, 246, 255, 0.96)',
          letterSpacing: '0.34em',
          textShadow: '0 0 18px rgba(34, 211, 238, 0.45)',
        }}>
          JARVIS
        </div>
        <div style={{
          width: 36,
          height: 1,
          background: 'linear-gradient(90deg, var(--accent), transparent)',
          margin: '5px 0',
          boxShadow: '0 0 8px rgba(34, 211, 238, 0.5)',
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
          <span style={{
            fontSize: 8,
            textShadow: '0 0 8px currentColor',
            animation: animState === 'thinking' ? 'statusPulse 1.2s ease-in-out infinite' : undefined,
          }}>●</span>
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
            onClick={onToggleText}
            title={textVisible ? 'Hide transcript' : 'Show transcript'}
            className="pill-btn"
            style={{
              background: textVisible ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--accent-rgb),0.04)',
              color: textVisible ? 'var(--accent)' : 'var(--text-dim)',
            }}
          >
            TEXT
          </button>
          <button
            onClick={onToggleSpotify}
            title="Spotify"
            className={`pill-btn pill-btn--icon${spotifyOpen ? ' pill-btn--active' : ''}`}
          >
            ♫
          </button>
          <button
            onClick={onToggleGithub}
            title="GitHub"
            className={`pill-btn pill-btn--icon${githubOpen ? ' pill-btn--active' : ''}`}
          >
            GH
          </button>
          <button
            onClick={onToggleQuietMode}
            title={quietMode ? 'Quiet mode on — click to disable' : 'Enable quiet mode'}
            className={`pill-btn pill-btn--icon${quietMode ? ' pill-btn--active' : ''}`}
          >
            {quietMode ? '🔇' : '🔊'}
          </button>
        </div>
        <div style={{
          fontFamily: 'var(--font-data)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          color: 'var(--text)',
          textAlign: 'right',
          lineHeight: 1.5,
          background: 'var(--glass)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '2px 8px',
        }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
            {tokensToday > 0 ? tokensToday.toLocaleString() : '—'}
          </span>
          <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>·</span>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>
            {costToday > 0 ? `$${costToday.toFixed(4)}` : '$0.00'}
          </span>
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
