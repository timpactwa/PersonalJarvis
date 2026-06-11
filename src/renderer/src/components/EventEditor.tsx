import { useState } from 'react'
import type { CalendarEventDraft } from '../../../backend/types'

interface Props {
  event: CalendarEventDraft
  onCreate: (event: CalendarEventDraft) => void
  onClose: () => void
}

function toLocalDatetimeValue(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return iso }
}

function fromLocalDatetimeValue(val: string): string {
  if (!val) return ''
  try { return new Date(val).toISOString() } catch { return val }
}

export function EventEditor({ event, onCreate, onClose }: Props): JSX.Element {
  const [fields, setFields] = useState<CalendarEventDraft>({ ...event })

  const set = (k: keyof CalendarEventDraft, v: string) => setFields(f => ({ ...f, [k]: v }))

  const backdrop: React.CSSProperties = {
    position: 'absolute', inset: 0,
    background: 'rgba(200,220,240,0.3)',
    backdropFilter: 'blur(3px)',
    zIndex: 149,
  }

  const panel: React.CSSProperties = {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 500,
    background: 'rgba(255,255,255,0.97)',
    border: '1px solid rgba(3,105,161,0.18)',
    borderRadius: 14,
    fontFamily: '"Orbitron", monospace',
    color: 'var(--text)',
    backdropFilter: 'blur(24px)',
    boxShadow: '0 12px 60px rgba(3,80,140,0.18)',
    zIndex: 150,
    overflow: 'hidden',
  }

  const header: React.CSSProperties = {
    padding: '14px 20px 12px',
    borderBottom: '1px solid rgba(3,105,161,0.1)',
    background: 'rgba(3,105,161,0.04)',
  }

  const eyebrow: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.35em',
    color: 'var(--accent)',
    marginBottom: 2,
    textTransform: 'uppercase' as const,
  }

  const body: React.CSSProperties = { padding: '16px 20px 4px' }

  const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  }

  const lbl: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.12em',
    color: 'var(--text-mid)',
    width: 68,
    flexShrink: 0,
    textTransform: 'uppercase' as const,
  }

  const input: React.CSSProperties = {
    flex: 1,
    background: 'rgba(3,105,161,0.04)',
    border: '1px solid rgba(3,105,161,0.15)',
    borderRadius: 5,
    color: 'var(--text)',
    padding: '7px 10px',
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: 12,
    outline: 'none',
  }

  const textarea: React.CSSProperties = {
    ...input,
    display: 'block',
    width: '100%',
    resize: 'vertical' as const,
    minHeight: 80,
    lineHeight: 1.6,
    boxSizing: 'border-box' as const,
  }

  const footer: React.CSSProperties = {
    padding: '12px 20px 16px',
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    borderTop: '1px solid rgba(3,105,161,0.08)',
    marginTop: 8,
  }

  const btnBase: React.CSSProperties = {
    fontFamily: '"Orbitron", monospace',
    fontSize: 10,
    letterSpacing: '0.12em',
    padding: '9px 18px',
    borderRadius: 5,
    cursor: 'pointer',
    border: '1px solid rgba(3,105,161,0.25)',
    background: 'rgba(3,105,161,0.06)',
    color: 'var(--accent)',
  }

  const btnCreate: React.CSSProperties = {
    ...btnBase,
    background: 'var(--accent)',
    color: '#fff',
    border: '1px solid transparent',
  }

  const handleCreate = () => {
    onCreate({
      ...fields,
      start: fromLocalDatetimeValue(fields.start),
      end: fromLocalDatetimeValue(fields.end),
    })
  }

  return (
    <>
      <div style={backdrop} onClick={onClose} />
      <div style={panel} className="no-drag">
        <div style={header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={eyebrow}>Calendar</div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em' }}>NEW EVENT</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
          </div>
        </div>

        <div style={body}>
          <div style={fieldRow}>
            <span style={lbl}>Title</span>
            <input style={input} value={fields.title} onChange={e => set('title', e.target.value)} placeholder="Event title" />
          </div>

          <div style={fieldRow}>
            <span style={lbl}>Start</span>
            <input
              style={input}
              type="datetime-local"
              value={toLocalDatetimeValue(fields.start)}
              onChange={e => set('start', e.target.value)}
            />
          </div>

          <div style={fieldRow}>
            <span style={lbl}>End</span>
            <input
              style={input}
              type="datetime-local"
              value={toLocalDatetimeValue(fields.end)}
              onChange={e => set('end', e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 4 }}>
            <div style={{ ...lbl, marginBottom: 6 }}>Description</div>
            <textarea
              style={textarea}
              value={fields.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional description…"
            />
          </div>
        </div>

        <div style={footer}>
          <button style={btnBase} onClick={onClose}>DISCARD</button>
          <button style={btnCreate} onClick={handleCreate}>ADD TO CALENDAR →</button>
        </div>
      </div>
    </>
  )
}
