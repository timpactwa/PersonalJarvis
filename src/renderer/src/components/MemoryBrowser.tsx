import { useState } from 'react'
import type { MemoryEntry } from '../../../backend/types'

interface Props {
  open: boolean
  memories: MemoryEntry[]
  onClose: () => void
  onDelete: (id: number) => void
}

const DRAWER_W = 360
const LAYER_Z = 550

export function MemoryBrowser({ open, memories, onClose, onDelete }: Props): JSX.Element {
  if (!open) return null
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? memories.filter(m => m.text.toLowerCase().includes(query.toLowerCase()))
    : memories

  return (
    <>
      <div
        className="no-drag"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
          zIndex: LAYER_Z,
        }}
      />
      <div
        className="no-drag"
        style={{
          position: 'fixed', top: 36, right: 0, height: 'calc(100vh - 36px)', width: DRAWER_W,
          background: 'var(--ov-bg)', borderLeft: '1px solid var(--ov-border)',
          boxShadow: 'var(--ov-shadow)',
          padding: 24, zIndex: LAYER_Z + 1, overflowY: 'auto', fontFamily: 'var(--font-hud)', color: 'var(--ov-text)',
          animation: 'drawerIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em' }}>MEMORIES</span>
          <button onClick={onClose} className="pill-btn pill-btn--icon">✕</button>
        </div>

        <input
          className="ov-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="search memories…"
          style={{ marginBottom: 16 }}
        />

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--ov-text-dim)', fontSize: 11, letterSpacing: '0.15em', marginTop: 40 }}>
            {memories.length === 0 ? 'NO MEMORIES STORED' : 'NO MATCHES'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(m => (
              <div key={m.id} style={{
                background: 'var(--ov-bg-raised)', border: '1px solid var(--ov-separator)',
                borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ov-text)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {m.text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: 'var(--ov-text-dim)', letterSpacing: '0.08em' }}>
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                  <button className="pill-btn pill-btn--sm pill-btn--danger" onClick={() => onDelete(m.id)}>
                    DELETE
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
