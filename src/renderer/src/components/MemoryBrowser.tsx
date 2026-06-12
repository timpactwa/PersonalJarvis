import { useState } from 'react'
import type { MemoryEntry } from '../../../backend/types'

interface Props {
  open: boolean
  memories: MemoryEntry[]
  onClose: () => void
  onDelete: (id: number) => void
}

const DRAWER_W = 360

export function MemoryBrowser({ open, memories, onClose, onDelete }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? memories.filter(m => m.text.toLowerCase().includes(query.toLowerCase()))
    : memories

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, background: 'rgba(200,220,240,0.25)', backdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.25s', zIndex: 131,
        }}
      />
      <div
        className="no-drag"
        style={{
          position: 'absolute', top: 0, right: 0, height: '100vh', width: DRAWER_W,
          background: 'rgba(255,255,255,0.96)', borderLeft: '1px solid rgba(3,105,161,0.15)',
          backdropFilter: 'blur(20px)', boxShadow: '-8px 0 40px rgba(3,80,140,0.12)',
          padding: 24, zIndex: 132, overflowY: 'auto', fontFamily: 'var(--font-hud)', color: 'var(--text)',
          transform: open ? 'translateX(0)' : `translateX(${DRAWER_W}px)`, transition: 'transform 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em' }}>MEMORIES</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="search memories…"
          style={{
            width: '100%', background: 'rgba(3,105,161,0.05)', border: '1px solid rgba(3,105,161,0.18)',
            borderRadius: 6, color: '#0a2540', padding: '8px 10px', fontFamily: 'var(--font-mono)',
            fontSize: 12, marginBottom: 16, outline: 'none',
          }}
        />

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.15em', marginTop: 40 }}>
            {memories.length === 0 ? 'NO MEMORIES STORED' : 'NO MATCHES'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(m => (
              <div key={m.id} style={{
                background: 'rgba(3,105,161,0.04)', border: '1px solid rgba(3,105,161,0.12)',
                borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: '#1a4060', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {m.text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                  <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => onDelete(m.id)}>
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
