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
    const seen = new Set<string>()

    // First poll: event is 28 min away → fires 30-min alert
    const alerts1 = buildCalendarAlerts([makeEvent('e5', 'Demo', 28)], seen)
    expect(alerts1).toHaveLength(1)
    expect(alerts1[0].id).toBe('cal:e5:30')
    alerts1.forEach(a => seen.add(a.id))  // simulate registry adding to seen

    // Second poll: same event is now 12 min away → fires 15-min alert, 30-min suppressed
    const alerts2 = buildCalendarAlerts([makeEvent('e5', 'Demo', 12)], seen)
    expect(alerts2).toHaveLength(1)
    expect(alerts2[0].id).toBe('cal:e5:15')
    expect(alerts2[0].priority).toBe('urgent')
  })

  it('emits urgent alert for event starting right now (minsUntil ≈ 0)', () => {
    const alerts = buildCalendarAlerts([makeEvent('e6', 'Standup', 0)], new Set())
    expect(alerts).toHaveLength(1)
    expect(alerts[0].priority).toBe('urgent')
    expect(alerts[0].text).toContain('right now')
    expect(alerts[0].id).toBe('cal:e6:15')
  })
})
