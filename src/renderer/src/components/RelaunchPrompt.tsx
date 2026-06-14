interface Props {
  onLater: () => void
}

const GREEN = '#22c55e'

export function RelaunchPrompt({ onLater }: Props): JSX.Element {
  const relaunch = (): void => {
    try {
      ;(window as any).jarvis?.relaunch?.()
    } catch (err) {
      console.error('[relaunch] failed:', err)
    }
    onLater()
  }

  return (
    <div
      className="no-drag"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        backdropFilter: 'blur(4px)',
      }}
    >
      <style>{`
        @keyframes relaunchGlow {
          0%, 100% { box-shadow: var(--ov-shadow), 0 0 16px rgba(34,197,94,0.25); border-color: rgba(34,197,94,0.35); }
          50%       { box-shadow: var(--ov-shadow), 0 0 36px rgba(34,197,94,0.55); border-color: rgba(34,197,94,0.75); }
        }
      `}</style>
      <div
        style={{
          width: 460,
          maxWidth: '86vw',
          background: 'var(--ov-bg)',
          border: '1px solid rgba(34, 197, 94, 0.4)',
          borderRadius: 'var(--ov-radius)',
          padding: '26px 28px',
          textAlign: 'center',
          animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards, relaunchGlow 2.4s ease-in-out infinite',
        }}
      >
        <div
          style={{
            fontFamily: "'Orbitron', var(--font-hud)",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.22em',
            color: GREEN,
            marginBottom: 10,
            textShadow: '0 0 14px rgba(34,197,94,0.5)',
          }}
        >
          UPDATE READY
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--ov-text-mid)',
            marginBottom: 22,
          }}
        >
          Jarvis has been updated. Relaunch to apply the new capability.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="pill-btn" onClick={onLater}>LATER</button>
          <button
            className="pill-btn"
            onClick={relaunch}
            style={{
              background: 'rgba(34, 197, 94, 0.16)',
              borderColor: 'rgba(34, 197, 94, 0.6)',
              color: GREEN,
              boxShadow: '0 0 10px rgba(34,197,94,0.35)',
            }}
          >
            RELAUNCH NOW
          </button>
        </div>
      </div>
    </div>
  )
}
