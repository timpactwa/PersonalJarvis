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
        background: 'rgba(6, 11, 20, 0.94)',
        border: '1px solid rgba(245, 158, 11, 0.5)',
        borderRadius: 8,
        padding: 20,
        fontFamily: '"Orbitron", monospace',
        color: '#fde68a',
        boxShadow: '0 0 32px rgba(245, 158, 11, 0.18)',
        backdropFilter: 'blur(12px)',
        zIndex: 120,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 8 }}>
        CONFIRM · {action.toUpperCase()}
      </div>
      <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 12, color: '#e0f2fe', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
        {detail}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btn('#94a3b8')}>CANCEL</button>
        <button onClick={onConfirm} style={btn('#f59e0b')}>CONFIRM</button>
      </div>
      <div style={{ marginTop: 10, fontSize: 9, color: '#7a6a3a', letterSpacing: '0.1em' }}>
        OR SAY “YES” / “CANCEL”
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
