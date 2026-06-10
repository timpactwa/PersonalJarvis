import { describe, it, expect } from 'vitest'
import type { BackendEvent, RendererEvent } from '../../src/backend/types'

describe('event types', () => {
  it('BackendEvent state event has correct shape', () => {
    const event: BackendEvent = { type: 'state', state: 'idle' }
    expect(event.type).toBe('state')
  })

  it('RendererEvent audio event has correct shape', () => {
    const event: RendererEvent = { type: 'audio', data: Buffer.from([]) }
    expect(event.type).toBe('audio')
  })
})
