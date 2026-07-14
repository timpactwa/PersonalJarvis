import { useEffect, useRef } from 'react'
import type { RendererEvent } from '../../../backend/types'

interface Props {
  onClose: () => void
  nowPlaying: { track?: string; artist?: string; isPlaying: boolean; albumArt?: string } | null
  send: (event: RendererEvent) => void
}

export function SpotifyPanel({ onClose, nowPlaying, send }: Props): JSX.Element {
  const sendRef = useRef(send)
  sendRef.current = send

  // On open: fetch current state directly (bypasses LLM)
  useEffect(() => {
    sendRef.current({ type: 'spotify_refresh' })
  }, [])

  // Poll every 5 seconds while panel is open
  useEffect(() => {
    const id = setInterval(() => {
      sendRef.current({ type: 'spotify_refresh' })
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const isPlaying = nowPlaying?.isPlaying === true
  // Show skeleton only before the first response arrives
  const isLoading = nowPlaying === null

  const sendCommand = (text: string): void => {
    send({ type: 'command', text })
  }

  return (
    <div
      className="no-drag"
      role="dialog"
      aria-label="Spotify"
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 200,
        width: 560,
        background: 'var(--ov-bg)',
        border: '1px solid var(--ov-border)',
        borderRadius: 'var(--ov-radius)',
        boxShadow: 'var(--ov-shadow-hot)',
        padding: '22px 26px',
        animation: 'materializeCentered 0.28s cubic-bezier(0.16,1,0.3,1) both',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.12em',
            color: 'var(--ov-text-dim)',
          }}
        >
          {'♫'} SPOTIFY
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="pill-btn pill-btn--icon"
            onClick={() => sendRef.current({ type: 'spotify_refresh' })}
            aria-label="Refresh"
            title="Refresh playback state"
          >
            ↺
          </button>
          <button className="pill-btn pill-btn--icon" onClick={onClose} aria-label="Close">
            {'✕'}
          </button>
        </div>
      </div>

      {/* Now-playing card */}
      <div
        style={{
          marginTop: 18,
          background: 'var(--ov-bg-raised)',
          borderRadius: 12,
          padding: 18,
          border: '1px solid var(--ov-separator)',
        }}
      >
        {isLoading ? (
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="skeleton-row" style={{ width: 104, height: 104, borderRadius: 8 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
              <div className="skeleton-row" style={{ width: '70%' }} />
              <div className="skeleton-row" style={{ width: '45%' }} />
            </div>
          </div>
        ) : nowPlaying?.track ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {/* Album art */}
            {nowPlaying.albumArt ? (
              <img
                src={nowPlaying.albumArt}
                alt=""
                style={{
                  width: 104,
                  height: 104,
                  flexShrink: 0,
                  borderRadius: 8,
                  objectFit: 'cover',
                  border: '1px solid var(--ov-border)',
                  boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 104,
                  height: 104,
                  flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--ov-accent-dim), rgba(14,165,233,0.04))',
                  border: '1px solid var(--ov-border)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 34,
                  color: 'var(--ov-text-dim)',
                }}
              >
                {'♪'}
              </div>
            )}
            {/* Track info */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-hud)',
                  letterSpacing: '0.16em',
                  color: isPlaying ? 'var(--ov-accent)' : 'var(--ov-text-dim)',
                  marginBottom: 8,
                }}
              >
                {isPlaying ? '● NOW PLAYING' : '❙❙ PAUSED'}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--ov-text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {nowPlaying.track}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--ov-text-mid)',
                  marginTop: 4,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {nowPlaying.artist ?? 'Unknown artist'}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--ov-text-dim)',
              padding: '24px 0',
            }}
          >
            Nothing playing
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 8 }}>
        <button
          className="pill-btn pill-btn--icon"
          onClick={() => sendCommand('spotify previous')}
          aria-label="Previous track"
        >
          {'⏮'}
        </button>
        <button
          className={`pill-btn pill-btn--icon${isPlaying ? ' pill-btn--active' : ''}`}
          onClick={() => sendCommand(isPlaying ? 'spotify pause' : 'spotify play')}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          className="pill-btn pill-btn--icon"
          onClick={() => sendCommand('spotify next')}
          aria-label="Next track"
        >
          {'⏭'}
        </button>
        <button
          className="pill-btn pill-btn--icon"
          onClick={() => sendCommand('spotify volume down')}
          aria-label="Volume down"
        >
          {'−'}
        </button>
        <button
          className="pill-btn pill-btn--icon"
          onClick={() => sendCommand('spotify volume up')}
          aria-label="Volume up"
        >
          {'+'}
        </button>
      </div>

      {/* Divider */}
      <div style={{ margin: '16px 0', height: 1, background: 'var(--ov-separator)' }} />

      {/* Search */}
      <SearchRow send={sendCommand} />

      {/* Footer hint */}
      <div
        style={{
          marginTop: 12,
          textAlign: 'center',
          fontSize: 9,
          color: 'var(--ov-text-dim)',
        }}
      >
        Say &quot;play [song]&quot; or &quot;pause&quot; at any time
      </div>
    </div>
  )
}

function SearchRow({ send }: { send: (text: string) => void }): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const submit = (): void => {
    const q = inputRef.current?.value.trim() ?? ''
    if (!q) return
    send(`spotify play ${q}`)
    if (inputRef.current) inputRef.current.value = ''
  }
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        ref={inputRef}
        className="ov-input"
        style={{ flex: 1 }}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder="Search tracks, artists…"
      />
      <button className="pill-btn pill-btn--sm" onClick={submit}>
        {'▶'} PLAY
      </button>
    </div>
  )
}
