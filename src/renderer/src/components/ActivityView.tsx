import { useState } from 'react'
import type { ActivityEntry } from '../hooks/useAnimState'
import { Reveal } from './Reveal'

interface Props {
  entries: ActivityEntry[]
  onClose: () => void
}

type Pane = 'action' | 'console'

const TABS: { id: Pane; label: string }[] = [
  { id: 'action', label: 'ACTIVITY' },
  { id: 'console', label: 'CONSOLE' },
]

function clock(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/**
 * The Activity tab: a friendly plain-language feed of what Jarvis is doing, and
 * a technical Console stream (tool names, args, status) for debugging. Both
 * read the same activity buffer, filtered by `kind`. Newest first.
 */
export function ActivityView({ entries, onClose }: Props): JSX.Element {
  const [pane, setPane] = useState<Pane>('action')
  const rows = entries.filter(e => e.kind === pane).slice().reverse()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Reveal>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, letterSpacing: '0.22em', color: 'var(--ov-text)' }}>
            ACTIVITY LOG
          </div>
          <div style={{ display: 'flex', gap: 6 }} className="no-drag">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`pill-btn pill-btn--sm${pane === t.id ? ' pill-btn--active' : ''}`}
                onClick={() => setPane(t.id)}
              >
                {t.label}
              </button>
            ))}
            <button className="pill-btn pill-btn--sm pill-btn--icon" onClick={onClose} aria-label="Close activity" title="Back to chat">✕</button>
          </div>
        </div>
      </Reveal>

      <Reveal delay={60}>
        <div style={{
          background: 'var(--ov-bg)',
          border: '1px solid var(--ov-border)',
          borderRadius: 'var(--ov-radius)',
          boxShadow: 'var(--ov-shadow)',
          padding: '12px 4px 12px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: pane === 'console' ? 11 : 12,
          lineHeight: 1.7,
          minHeight: 200,
          maxHeight: 'calc(100vh - 200px)',
          overflowY: 'auto',
        }}>
          {rows.length === 0 && (
            <div style={{ color: 'var(--ov-text-dim)', padding: '6px 0' }}>
              {pane === 'action' ? 'No activity yet. Jarvis will log what it does here.' : 'No console events yet.'}
            </div>
          )}
          {rows.map(e => (
            <div key={e.id} className="bubble-in" style={{ display: 'flex', gap: 10, padding: '2px 0' }}>
              <span style={{ color: 'var(--ov-text-dim)', flexShrink: 0, fontSize: 10 }}>{clock(e.ts)}</span>
              <span style={{ color: pane === 'console' ? '#7dd3fc' : 'var(--accent)', flexShrink: 0 }}>›</span>
              <span style={{ color: 'var(--ov-text)', minWidth: 0 }}>
                {e.text}
                {e.detail && <span style={{ color: 'var(--ov-text-mid)' }}>  {e.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  )
}
