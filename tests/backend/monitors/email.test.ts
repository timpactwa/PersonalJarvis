import { describe, it, expect } from 'vitest'
import { buildEmailAlerts } from '../../../src/backend/monitors/email'

interface FakeMsg { id: string; payload?: { headers?: Array<{ name: string; value: string }> } }

function makeMsg(id: string, from: string, subject: string): FakeMsg {
  return {
    id,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
      ],
    },
  }
}

describe('buildEmailAlerts', () => {
  it('returns one alert per new message (≤ 3)', () => {
    const seen = new Set<string>()
    const msgs = [
      makeMsg('m1', 'prof@vt.edu', 'Research update needed'),
      makeMsg('m2', 'mom@gmail.com', 'Dinner plans'),
    ]
    const alerts = buildEmailAlerts(msgs, seen)
    expect(alerts).toHaveLength(2)
    expect(alerts[0].text).toContain('Research update needed')
    expect(alerts[0].id).toBe('email:m1')
  })

  it('deduplicates already-seen message IDs', () => {
    const seen = new Set(['email:m1'])
    const msgs = [makeMsg('m1', 'x@x.com', 'Hi')]
    expect(buildEmailAlerts(msgs, seen)).toHaveLength(0)
  })

  it('rolls up when more than 3 new messages', () => {
    const seen = new Set<string>()
    const msgs = Array.from({ length: 5 }, (_, i) => makeMsg(`m${i}`, 'x@x.com', `Email ${i}`))
    const alerts = buildEmailAlerts(msgs, seen)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].text).toMatch(/5 new emails/)
  })

  it('strips angle brackets and quotes from From header', () => {
    const seen = new Set<string>()
    const msg = {
      id: 'mx',
      payload: {
        headers: [
          { name: 'From', value: '"John Doe" <john@vt.edu>' },
          { name: 'Subject', value: 'Test' },
        ],
      },
    }
    const alerts = buildEmailAlerts([msg], seen)
    expect(alerts[0].text).toContain('John Doe')
    expect(alerts[0].text).not.toContain('"')
    expect(alerts[0].text).not.toContain('<')
  })
})
