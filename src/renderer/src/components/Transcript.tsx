interface Props {
  userText: string
  assistantText: string
}

export function Transcript({ userText, assistantText }: Props): JSX.Element {
  const text = assistantText || userText
  const prefix = assistantText ? '» ' : '> '

  return (
    <div style={{
      position: 'absolute',
      bottom: 40,
      left: '50%',
      transform: 'translateX(-50%)',
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '13px',
      color: assistantText ? '#7dd3fc' : '#94a3b8',
      letterSpacing: '0.05em',
      maxWidth: '60vw',
      textAlign: 'center',
      pointerEvents: 'none',
      textShadow: assistantText ? '0 0 12px rgba(125,211,252,0.4)' : 'none',
    }}>
      {text ? `${prefix}${text}` : ''}
    </div>
  )
}
