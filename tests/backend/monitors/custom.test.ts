import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseFireAt, createRemindAlertText, startCustomMonitor } from '../../../src/backend/monitors/custom'
import type { EnqueueFn, RegisterFn } from '../../../src/backend/monitors/index'

vi.mock('../../../src/backend/memory/db', () => ({
  getDueReminders: vi.fn(),
  markReminderFired: vi.fn(),
  insertReminder: vi.fn(),
}))

vi.mock('../../../src/backend/memory/settings', () => ({
  getSettings: vi.fn(),
}))

import { getDueReminders, markReminderFired } from '../../../src/backend/memory/db'
import { getSettings } from '../../../src/backend/memory/settings'

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

describe('startCustomMonitor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(getSettings as ReturnType<typeof vi.fn>).mockReturnValue({ monitorCustom: true })
    ;(getDueReminders as ReturnType<typeof vi.fn>).mockReturnValue([])
  })

  it('enqueues due reminders with correct shape', () => {
    const reminder = { id: 'remind:abc-123', text: 'take a break' }
    ;(getDueReminders as ReturnType<typeof vi.fn>).mockReturnValue([reminder])
    ;(markReminderFired as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

    const enqueue = vi.fn() as unknown as EnqueueFn
    const register = vi.fn() as unknown as RegisterFn

    startCustomMonitor(enqueue, register)

    expect(enqueue).toHaveBeenCalledOnce()
    expect(enqueue).toHaveBeenCalledWith({
      id: reminder.id,
      text: reminder.text,
      priority: 'normal',
      source: 'custom',
    })
  })

  it('marks reminders fired after enqueue', () => {
    const reminder = { id: 'remind:xyz-456', text: 'stand up' }
    ;(getDueReminders as ReturnType<typeof vi.fn>).mockReturnValue([reminder])
    ;(markReminderFired as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

    const enqueue = vi.fn() as unknown as EnqueueFn
    const register = vi.fn() as unknown as RegisterFn

    startCustomMonitor(enqueue, register)

    expect(markReminderFired).toHaveBeenCalledOnce()
    expect(markReminderFired).toHaveBeenCalledWith(reminder.id)
  })

  it('skips entirely when monitorCustom is false', () => {
    ;(getSettings as ReturnType<typeof vi.fn>).mockReturnValue({ monitorCustom: false })

    const enqueue = vi.fn() as unknown as EnqueueFn
    const register = vi.fn() as unknown as RegisterFn

    startCustomMonitor(enqueue, register)

    expect(enqueue).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })
})
