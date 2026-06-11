import { useEffect, useRef } from 'react'
import type { ConversationTurn } from '../hooks/useAnimState'

interface Props {
  history: ConversationTurn[]
  streamingText?: string | null
  visible?: boolean
}

export function Transcript({ history, streamingText, visible = true }: Props): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length, streamingText])

  if (history.length === 0 && !streamingText) return <></>

  const bubbleBase = {
    maxWidth: '82%',
    padding: '8px 14px',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 2px 8px rgba(3, 80, 140, 0.06)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    lineHeight: 1.55,
    wordBreak: 'break-word' as const,
    letterSpacing: '0.02em',
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: 72,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(640px, 82vw)',
      maxHeight: '42vh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 7,
      pointerEvents: 'none',
      zIndex: 10,
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 16%, black 100%)',
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 16%, black 100%)',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.35s ease',
    }}>
      {history.map(turn => (
        <div
          key={turn.id}
          className="bubble-in"
          style={{ display: 'flex', justifyContent: turn.role === 'user' ? 'flex-end' : 'flex-start' }}
        >
          <div style={{
            ...bubbleBase,
            borderRadius: turn.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
            background: turn.role === 'user' ? 'rgba(3, 105, 161, 0.1)' : 'rgba(255, 255, 255, 0.82)',
            border: turn.role === 'user'
              ? '1px solid rgba(3, 105, 161, 0.25)'
              : '1px solid rgba(3, 105, 161, 0.1)',
            color: turn.role === 'user' ? '#0a2540' : '#1a4060',
          }}>
            {turn.text}
          </div>
        </div>
      ))}
      {streamingText && (
        <div
          className="bubble-in"
          style={{ display: 'flex', justifyContent: 'flex-start' }}
        >
          <div style={{
            ...bubbleBase,
            borderRadius: '12px 12px 12px 3px',
            background: 'rgba(255, 255, 255, 0.72)',
            border: '1px solid rgba(3, 105, 161, 0.08)',
            color: '#1a4060',
            opacity: 0.88,
          }}>
            {streamingText}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
