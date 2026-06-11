interface Props {
  message: string | null
  onDismiss: () => void
}

export function ErrorToast({ message, onDismiss }: Props): JSX.Element | null {
  if (!message) return null

  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute',
        top: 44,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 'min(660px, 88vw)',
        background: 'rgba(255, 245, 245, 0.96)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        borderRadius: 8,
        padding: '9px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        boxShadow: '0 4px 16px rgba(239, 68, 68, 0.1)',
        backdropFilter: 'blur(10px)',
        zIndex: 200,
      }}
    >
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11.5,
        color: '#991b1b',
        flex: 1,
        lineHeight: 1.55,
        wordBreak: 'break-word',
        letterSpacing: '0.02em',
      }}>
        ⚠ {message}
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(153,27,27,0.5)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: '1px 3px',
          flexShrink: 0,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#dc2626' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(153,27,27,0.5)' }}
        aria-label="Dismiss"
      >×</button>
    </div>
  )
}
