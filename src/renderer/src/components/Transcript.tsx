import { useEffect, useRef } from 'react'
import type { ConversationTurn } from '../hooks/useAnimState'

interface Props {
  history: ConversationTurn[]
  streamingText?: string | null
  visible?: boolean
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*\*(.*?)\*\*\*/gs, '$1')
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/\*(.*?)\*/gs, '$1')
    .replace(/_(.*?)_/gs, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
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
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.38)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    lineHeight: 1.55,
    wordBreak: 'break-word' as const,
    letterSpacing: '0.02em',
  }

  return (
    <div className="no-drag" style={{
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
      pointerEvents: 'auto',
      cursor: 'default',
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
            background: turn.role === 'user' ? 'rgba(34, 211, 238, 0.12)' : 'rgba(10, 16, 30, 0.72)',
            border: turn.role === 'user'
              ? '1px solid rgba(34, 211, 238, 0.32)'
              : '1px solid rgba(34, 211, 238, 0.12)',
            color: turn.role === 'user' ? 'rgba(232, 247, 255, 0.95)' : 'rgba(220, 238, 252, 0.90)',
          }}>
            {turn.role === 'assistant' ? stripMarkdown(turn.text) : turn.text}
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
            background: 'rgba(10, 16, 30, 0.62)',
            border: '1px solid rgba(34, 211, 238, 0.10)',
            color: 'rgba(220, 238, 252, 0.88)',
            opacity: 0.88,
          }}>
            {stripMarkdown(streamingText)}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  )
}
