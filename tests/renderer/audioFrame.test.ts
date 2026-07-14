import { describe, it, expect } from 'vitest'
import { parseAudioFrame } from '../../src/renderer/src/lib/audioFrame'

function frame(turnId: number, payloadBytes: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(4 + payloadBytes.length)
  const view = new DataView(buf)
  view.setUint32(0, turnId, true)
  payloadBytes.forEach((b, i) => view.setUint8(4 + i, b))
  return buf
}

describe('parseAudioFrame', () => {
  it('extracts turn id 0 (unowned) and the payload after the header', () => {
    const buf = frame(0, [1, 2, 3])
    const { turnId, payload } = parseAudioFrame(buf)
    expect(turnId).toBe(0)
    expect(new Uint8Array(payload)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('extracts a non-zero turn id correctly (little-endian)', () => {
    const buf = frame(42, [9, 9])
    const { turnId, payload } = parseAudioFrame(buf)
    expect(turnId).toBe(42)
    expect(new Uint8Array(payload)).toEqual(new Uint8Array([9, 9]))
  })

  it('handles a turn id requiring the high byte (>255)', () => {
    const buf = frame(70000, [])
    expect(parseAudioFrame(buf).turnId).toBe(70000)
  })

  it('returns an empty payload when the frame is exactly the header', () => {
    const buf = frame(7, [])
    const { turnId, payload } = parseAudioFrame(buf)
    expect(turnId).toBe(7)
    expect(payload.byteLength).toBe(0)
  })

  it('treats a too-short frame defensively as unowned instead of throwing', () => {
    const buf = new ArrayBuffer(2)
    expect(() => parseAudioFrame(buf)).not.toThrow()
    const { turnId, payload } = parseAudioFrame(buf)
    expect(turnId).toBe(0)
    expect(payload.byteLength).toBe(2)
  })
})
