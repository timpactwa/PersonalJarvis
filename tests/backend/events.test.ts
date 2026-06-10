import { describe, it, expect } from 'vitest'

describe('events shim', () => {
  it('routes emitted events to the registered emitter', async () => {
    const { setEmitter, emitEvent } = await import('../../src/backend/events')
    const seen: unknown[] = []
    setEmitter(e => seen.push(e))
    emitEvent({ type: 'state', state: 'idle' })
    expect(seen).toEqual([{ type: 'state', state: 'idle' }])
  })

  it('is a no-op before an emitter is registered', async () => {
    const { emitEvent } = await import('../../src/backend/events')
    expect(() => emitEvent({ type: 'error', message: 'x' })).not.toThrow()
  })
})
