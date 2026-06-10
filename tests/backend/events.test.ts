import { describe, it, expect, vi } from 'vitest'

describe('events shim', () => {
  it('is a no-op before an emitter is registered', async () => {
    vi.resetModules()
    const { emitEvent } = await import('../../src/backend/events')
    expect(() => emitEvent({ type: 'error', message: 'x' })).not.toThrow()
  })

  it('routes emitted events to the registered emitter', async () => {
    vi.resetModules()
    const { setEmitter, emitEvent } = await import('../../src/backend/events')
    const seen: unknown[] = []
    setEmitter(e => seen.push(e))
    emitEvent({ type: 'state', state: 'idle' })
    expect(seen).toEqual([{ type: 'state', state: 'idle' }])
  })
})
