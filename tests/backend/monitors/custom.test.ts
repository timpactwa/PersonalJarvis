import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseFireAt, createRemindAlertText } from '../../../src/backend/monitors/custom'

describe('parseFireAt', () => {
  it('parses ISO 8601', () => {
    const ts = Date.now() + 60_000
    const iso = new Date(ts).toISOString()
    expect(parseFireAt(iso)).toBeCloseTo(ts, -2)
  })

  it('parses "in N minutes"', () => {
    const before = Date.now()
    const result = parseFireAt('in 30 minutes')
    expect(result).toBeGreaterThanOrEqual(before + 29 * 60_000)
    expect(result).toBeLessThanOrEqual(before + 31 * 60_000)
  })

  it('parses "in N hours"', () => {
    const before = Date.now()
    const result = parseFireAt('in 2 hours')
    expect(result).toBeGreaterThanOrEqual(before + 2 * 3_600_000 - 1000)
    expect(result).toBeLessThanOrEqual(before + 2 * 3_600_000 + 1000)
  })

  it('parses "at 5pm"', () => {
    const result = parseFireAt('at 5pm')
    const d = new Date(result)
    expect(d.getHours()).toBe(17)
    expect(d.getMinutes()).toBe(0)
  })

  it('parses "at 2:30pm"', () => {
    const result = parseFireAt('at 2:30pm')
    const d = new Date(result)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(30)
  })

  it('throws on unparseable input', () => {
    expect(() => parseFireAt('next tuesday sometime')).toThrow()
  })
})

describe('createRemindAlertText', () => {
  it('returns the reminder text as-is', () => {
    expect(createRemindAlertText('take a break')).toBe('take a break')
  })
})
