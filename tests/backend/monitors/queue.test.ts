import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MonitorRegistry, type Alert } from '../../../src/backend/monitors/index'

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return { id: 'test-1', text: 'Hello', priority: 'normal', source: 'custom', ...overrides }
}

describe('MonitorRegistry queue', () => {
  let reg: MonitorRegistry

  beforeEach(() => {
    reg = new MonitorRegistry()
  })

  it('deduplicates by id', () => {
    reg.enqueue(makeAlert({ id: 'a', text: 'first' }))
    reg.enqueue(makeAlert({ id: 'a', text: 'second' }))
    expect(reg.queueLength()).toBe(1)
  })

  it('puts urgent alerts before normal', () => {
    reg.enqueue(makeAlert({ id: 'b', priority: 'normal', text: 'normal' }))
    reg.enqueue(makeAlert({ id: 'c', priority: 'urgent', text: 'urgent' }))
    expect(reg.peekNext()?.text).toBe('urgent')
  })

  it('drops expired alerts during drain', async () => {
    const speak = vi.fn().mockResolvedValue(undefined)
    reg.setSpeakFn(speak)
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'd', expiresAt: Date.now() - 1 }))
    await reg.drainOnce()
    expect(speak).not.toHaveBeenCalled()
  })

  it('calls speakFn when idle and queue has items', async () => {
    const speak = vi.fn().mockResolvedValue(undefined)
    reg.setSpeakFn(speak)
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'e', text: 'alert text' }))
    await reg.drainOnce()
    expect(speak).toHaveBeenCalledWith('alert text')
    expect(reg.queueLength()).toBe(0)
  })

  it('does not speak when not idle', async () => {
    const speak = vi.fn().mockResolvedValue(undefined)
    reg.setSpeakFn(speak)
    reg.setIdle(false)
    reg.enqueue(makeAlert({ id: 'f' }))
    await reg.drainOnce()
    expect(speak).not.toHaveBeenCalled()
  })

  it('does not speak when speakFn not set', async () => {
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'g' }))
    await reg.drainOnce() // should not throw
    expect(reg.queueLength()).toBe(1) // still in queue
  })
})
