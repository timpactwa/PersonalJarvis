import { useEffect } from 'react'
import type { Toast } from '../hooks/useAnimState'

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function CompletionToast({ toasts, onDismiss }: Props): JSX.Element | null {
  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'absolute', top: 88, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200, alignItems: 'center',
    }}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/**
 * One toast owning its own auto-dismiss timer. Keeping the timer per-item
 * (rather than one effect over the whole array) means adding a new toast
 * never resets the countdown of toasts already on screen.
 */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      onClick={() => onDismiss(toast.id)}
      className="bubble-in no-drag"
      style={{
        background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.35)', borderRadius: 20,
        padding: '6px 16px', fontFamily: 'var(--font-hud)', fontSize: 10, letterSpacing: '0.1em',
        color: '#14532d', cursor: 'pointer', backdropFilter: 'blur(8px)',
        boxShadow: '0 2px 12px rgba(22,163,74,0.15)',
      }}
    >
      ● {toast.text}
    </div>
  )
}
