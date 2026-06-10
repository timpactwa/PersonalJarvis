import { describe, it, expect } from 'vitest'

describe('whisper module', () => {
  it('exports transcribe function', async () => {
    const mod = await import('../../src/backend/whisper')
    expect(typeof mod.transcribe).toBe('function')
  })
})
