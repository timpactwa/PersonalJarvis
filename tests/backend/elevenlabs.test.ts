import { describe, it, expect } from 'vitest'

describe('elevenlabs module', () => {
  it('exports synthesize function', async () => {
    const mod = await import('../../src/backend/elevenlabs')
    expect(typeof mod.synthesize).toBe('function')
  })
})
