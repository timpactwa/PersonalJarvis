import type { UsagePoint, ModelUsage } from '../../../backend/types'

interface Props {
  daily: UsagePoint[]
  byModel: ModelUsage[]
}

export function UsageGraph({ daily, byModel }: Props): JSX.Element {
  const maxTokens = Math.max(1, ...daily.map(d => d.tokens))
  const totalCost = byModel.reduce((a, m) => a + m.cost, 0)

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#7dd3fc', marginBottom: 10 }}>
        TOKENS · LAST {daily.length} DAY{daily.length === 1 ? '' : 'S'}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
        {daily.length === 0 && (
          <div style={{ fontSize: 10, color: '#4a6a8a', fontFamily: '"Share Tech Mono", monospace' }}>No usage recorded yet.</div>
        )}
        {daily.map(d => (
          <div key={d.date} title={`${d.date}: ${d.tokens.toLocaleString()} tokens`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{
              height: `${Math.round((d.tokens / maxTokens) * 100)}%`,
              minHeight: 2,
              background: 'linear-gradient(180deg, #7dd3fc, #3b82f6)',
              borderRadius: '2px 2px 0 0',
              boxShadow: '0 0 8px rgba(125,211,252,0.4)',
            }} />
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#7dd3fc', margin: '18px 0 8px' }}>
        COST BY MODEL · 30D (${totalCost.toFixed(4)})
      </div>
      {byModel.map(m => {
        const pct = totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0
        return (
          <div key={m.model} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', fontFamily: '"Share Tech Mono", monospace' }}>
              <span>{m.model}</span>
              <span>${m.cost.toFixed(4)} · {m.tokens.toLocaleString()} tok</span>
            </div>
            <div style={{ height: 6, background: 'rgba(125,211,252,0.08)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #7dd3fc, #a78bfa)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
