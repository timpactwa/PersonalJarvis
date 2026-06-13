import { describe, it, expect } from 'vitest'
import { buildCalendarAlerts } from '../../../src/backend/monitors/calendar'

interface FakeEvent {
  id: string
  summary: string
  start: { dateTime?: string; date?: string }
}

function makeEvent(id: string, summary: string, minutesFromNow: number): FakeEvent {
  return {
    id,
    summary,
    start: { dateTime: new Date(Date.now() + minutesFromNow * 60_000).toISOString() },
  }
}

describe('buildCalendarAlerts', () => {
  it('emits urgent alert for event ≤ 15 min away', () => {
    const alerts = buildCalendarAlerts([makeEvent('e1', 'Team Standup', 10)], new Set())
    expect(alerts).toHaveLength(1)
    expect(alerts[0].priority).toBe('urgent')
    expect(alerts[0].text).toMatch(/Team Standup/)
    expect(alerts[0].id).toBe('cal:e1:15')
  })

  it('emits normal alert for event ≤ 30 min away (and > 15)', () => {
    const alerts = buildCalendarAlerts([makeEvent('e2', 'Lunch', 25)], new Set())
    expect(alerts).toHaveLength(1)
    expect(alerts[0].priority).toBe('normal')
    expect(alerts[0].id).toBe('cal:e2:30')
  })

  it('emits no alert for event > 30 min away', () => {
    const alerts = buildCalendarAlerts([makeEvent('e3', 'Future', 45)], new Set())
    expect(alerts).toHaveLength(0)
  })

  it('deduplicates — skips already-seen alert IDs', () => {
    const seen = new Set(['cal:e4:15'])
    const alerts = buildCalendarAlerts([makeEvent('e4', 'Meeting', 5)], seen)
    expect(alerts).toHaveLength(0)
  })

  it('can emit both 30-min and 15-min alerts for same event at different poll times', () => {
    // Event at 12 min → only 15-min window fires
    const seen = new Set<string>()
    const alerts1 = buildCalendarAlerts([makeEvent('e5', 'Demo', 12)], seen)
    expect(alerts1[0].id).toBe('cal:e5:15')
    seen.add('cal:e5:15')

    // Same event at 28 min (from a previous poll) — 30-min window fires
    const seen2 = new Set<string>()
    const alerts2 = buildCalendarAlerts([makeEvent('e5b', 'Demo', 28)], seen2)
    expect(alerts2[0].id).toBe('cal:e5b:30')
  })
})
