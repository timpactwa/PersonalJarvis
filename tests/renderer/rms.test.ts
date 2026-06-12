import { describe, it, expect } from 'vitest'
import { rmsFromBytes } from '../../src/renderer/src/lib/rms'

describe('rmsFromBytes', () => {
  it('returns 0 for perfect silence (all 128)', () => {
    const bytes = new Uint8Array(64).fill(128)
    expect(rmsFromBytes(bytes)).toBeCloseTo(0, 5)
  })

  it('returns ~1 for full-scale square wave (alternating 0 and 255)', () => {
    const bytes = new Uint8Array(64)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 2 === 0 ? 255 : 0
    expect(rmsFromBytes(bytes)).toBeGreaterThan(0.95)
  })

  it('clamps output to the 0..1 range', () => {
    const bytes = new Uint8Array(8).fill(0)
    const v = rmsFromBytes(bytes)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(1)
  })
})
