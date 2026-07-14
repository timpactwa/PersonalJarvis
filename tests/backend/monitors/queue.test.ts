import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    expect(reg.queueLength()).toBe(0)  // expired alert was actually removed
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

describe('MonitorRegistry speech_done watchdog', () => {
  let reg: MonitorRegistry

  beforeEach(() => {
    vi.useFakeTimers()
    reg = new MonitorRegistry()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('forces re-idle so the queue cannot wedge if speech_done never arrives', async () => {
    // speakFn resolves but the renderer never calls setIdle(true) — the wedge scenario.
    reg.setSpeakFn(() => Promise.resolve())
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'w1', text: 'first' }))
    await reg.drainOnce()

    // Without speech_done, a second alert is blocked (still not idle).
    reg.enqueue(makeAlert({ id: 'w2', text: 'second' }))
    await reg.drainOnce()
    expect(reg.queueLength()).toBe(1)

    // After the watchdog window, the registry self-heals back to idle.
    await vi.advanceTimersByTimeAsync(90_000)
    await reg.drainOnce()
    expect(reg.queueLength()).toBe(0)
  })

  it('speech_done (setIdle true) clears the watchdog — no spurious later re-idle', async () => {
    const speak = vi.fn().mockResolvedValue(undefined)
    reg.setSpeakFn(speak)
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'w3' }))
    await reg.drainOnce()

    reg.setIdle(true)                       // renderer reports speech_done promptly
    reg.setIdle(false)                       // user starts a real conversation turn
    await vi.advanceTimersByTimeAsync(90_000) // stale watchdog must NOT fire and re-idle mid-turn
    reg.enqueue(makeAlert({ id: 'w4' }))
    await reg.drainOnce()
    expect(reg.queueLength()).toBe(1)        // still blocked — watchdog did not wrongly re-idle
  })
})
