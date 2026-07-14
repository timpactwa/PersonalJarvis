import type { ReactNode } from 'react'
import type { UsagePoint, ModelUsage } from '../../../backend/types'
import { UsageGraph } from './UsageGraph'
import { Reveal } from './Reveal'

/** Live system metrics gathered by the backend (Phase 4 fills these in). */
export interface DashboardData {
  memoryCount: number
  entityCount: number
  sttEngine: string
  uptimeSec: number
}

interface Props {
  tokensToday: number
  costToday: number
  model: string
  provider: string
  connected: boolean
  daily: UsagePoint[]
  byModel: ModelUsage[]
  nowPlaying: { track?: string; artist?: string; isPlaying: boolean; albumArt?: string } | null
  data: DashboardData | null
  onOpenSettings: () => void
  onClose: () => void
}

const LABEL = { fontFamily: 'var(--font-hud)', fontSize: 9.5, letterSpacing: '0.18em', color: 'var(--ov-text-mid)' } as const

function Card({ title, children, delay, span }: { title: string; children: ReactNode; delay: number; span?: number }): JSX.Element {
  return (
    <Reveal delay={delay} style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <div style={{
        background: 'var(--ov-bg)',
        border: '1px solid var(--ov-border)',
        borderRadius: 'var(--ov-radius)',
        boxShadow: 'var(--ov-shadow)',
        padding: '16px 18px',
        height: '100%',
      }}>
        <div style={{ ...LABEL, marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </Reveal>
  )
}

function Stat({ label, value, accent, delay }: { label: string; value: string; accent?: string; delay: number }): JSX.Element {
  return (
    <Reveal delay={delay}>
      <div style={{
        background: 'var(--ov-bg)',
        border: '1px solid var(--ov-border)',
        borderRadius: 'var(--ov-radius)',
        boxShadow: 'var(--ov-shadow)',
        padding: '14px 16px',
      }}>
        <div style={{ ...LABEL, marginBottom: 8 }}>{label}</div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 600,
          color: accent ?? 'var(--ov-text)',
          textShadow: accent ? `0 0 18px ${accent}55` : 'none',
          letterSpacing: '0.02em',
        }}>{value}</div>
      </div>
    </Reveal>
  )
}

function fmtUptime(sec: number): string {
  if (sec <= 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function DashboardView({ tokensToday, costToday, model, provider, connected, daily, byModel, nowPlaying, data, onOpenSettings, onClose }: Props): JSX.Element {
  const rowGap = 14
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap }}>
      <Reveal>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, letterSpacing: '0.22em', color: 'var(--ov-text)' }}>
            SYSTEM DASHBOARD
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="pill-btn pill-btn--sm no-drag" onClick={onOpenSettings}>SETTINGS</button>
            <button className="pill-btn pill-btn--sm pill-btn--icon no-drag" onClick={onClose} aria-label="Close dashboard" title="Back to chat">✕</button>
          </div>
        </div>
      </Reveal>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: rowGap }}>
        <Stat label="TOKENS TODAY" value={tokensToday.toLocaleString()} accent="var(--accent)" delay={40} />
        <Stat label="COST TODAY" value={`$${costToday.toFixed(4)}`} accent="var(--amber)" delay={80} />
        <Stat label="ACTIVE MODEL" value={(model || '—').toUpperCase()} delay={120} />
        <Stat label="LINK" value={connected ? 'ONLINE' : 'OFFLINE'} accent={connected ? '#34d399' : '#ef4444'} delay={160} />
      </div>

      {/* Charts + side column */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: rowGap, alignItems: 'start' }}>
        <Card title="USAGE" delay={200}>
          <UsageGraph daily={daily} byModel={byModel} />
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap }}>
          <Card title="MEMORY & KNOWLEDGE" delay={240}>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--accent)' }}>{data ? data.memoryCount : '—'}</div>
                <div style={{ ...LABEL, marginTop: 4 }}>MEMORIES</div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--accent)' }}>{data ? data.entityCount : '—'}</div>
                <div style={{ ...LABEL, marginTop: 4 }}>ENTITIES</div>
              </div>
            </div>
          </Card>

          <Card title="SESSION" delay={280}>
            <Row k="PROVIDER" v={(provider || 'auto').toUpperCase()} />
            <Row k="SPEECH-TO-TEXT" v={data?.sttEngine?.toUpperCase() ?? '—'} />
            <Row k="UPTIME" v={fmtUptime(data?.uptimeSec ?? 0)} />
          </Card>

          <Card title="NOW PLAYING" delay={320}>
            {nowPlaying?.track ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {nowPlaying.albumArt
                  ? <img src={nowPlaying.albumArt} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} />
                  : <div style={{ width: 48, height: 48, borderRadius: 6, background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid var(--ov-border)' }} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ov-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nowPlaying.track}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ov-text-mid)' }}>{nowPlaying.artist ?? ''}</div>
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ov-text-dim)' }}>Nothing playing.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--ov-separator)' }}>
      <span style={{ fontFamily: 'var(--font-hud)', fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--ov-text-mid)' }}>{k}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ov-text)' }}>{v}</span>
    </div>
  )
}
