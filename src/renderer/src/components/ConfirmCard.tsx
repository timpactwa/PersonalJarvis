interface Props {
  action: string
  detail: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmCard({ action, detail, onConfirm, onCancel }: Props): JSX.Element {
  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute',
        bottom: 100,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 460,
        maxWidth: '70vw',
        background: 'rgba(255, 253, 240, 0.96)',
        border: '1px solid rgba(180, 120, 0, 0.3)',
        borderRadius: 10,
        padding: 20,
        fontFamily: '"Orbitron", monospace',
        color: '#78350f',
        boxShadow: '0 8px 32px rgba(180, 120, 0, 0.14)',
        backdropFilter: 'blur(12px)',
        zIndex: 120,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 8 }}>
        CONFIRM · {action.toUpperCase()}
      </div>
      <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 12, color: '#0a2540', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
        {detail}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btn('#64748b')}>CANCEL</button>
        <button onClick={onConfirm} style={btn('#b45309')}>CONFIRM</button>
      </div>
      <div style={{ marginTop: 10, fontSize: 9, color: '#a87940', letterSpacing: '0.1em' }}>
        OR SAY "YES" / "CANCEL"
      </div>
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${color}`,
    color,
    cursor: 'pointer',
    fontFamily: '"Orbitron", monospace',
    fontSize: 11,
    letterSpacing: '0.1em',
    padding: '6px 16px',
    borderRadius: 4,
  }
}
