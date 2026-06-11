import { describe, it, expect } from 'vitest'
import { PcmRecorder, WHISPER_SAMPLE_RATE } from '../../src/backend/audioCapture'

const BYTES_PER_SAMPLE = 4

function pcm(samples: number, fill = 1): Buffer {
  const buf = Buffer.alloc(samples * BYTES_PER_SAMPLE)
  buf.fill(fill)
  return buf
}

describe('PcmRecorder', () => {
  it('returns null when stopped with less than 0.2s of audio', () => {
    const r = new PcmRecorder()
    r.start()
    r.push(pcm(Math.floor(WHISPER_SAMPLE_RATE * 0.1)))
    expect(r.stop()).toBeNull()
  })

  it('returns captured audio when stopped with enough samples', () => {
    const r = new PcmRecorder()
    r.start()
    r.push(pcm(WHISPER_SAMPLE_RATE)) // 1s
    const out = r.stop()
    expect(out).not.toBeNull()
    expect(out!.length).toBe(WHISPER_SAMPLE_RATE * BYTES_PER_SAMPLE)
  })

  it('keeps a bounded pre-roll while idle and includes it in the next recording', () => {
    const r = new PcmRecorder()
    // Push 5s of idle audio — only ~0.4s should be retained as pre-roll
    for (let i = 0; i < 50; i++) r.push(pcm(Math.floor(WHISPER_SAMPLE_RATE * 0.1), i))
    r.start()
    r.push(pcm(WHISPER_SAMPLE_RATE)) // 1s of "spoken" audio
    const out = r.stop()
    expect(out).not.toBeNull()
    const samples = out!.length / BYTES_PER_SAMPLE
    // Recording must include the spoken second plus some pre-roll, but the
    // pre-roll must be bounded (well under the 5s pushed while idle)
    expect(samples).toBeGreaterThan(WHISPER_SAMPLE_RATE)
    expect(samples).toBeLessThanOrEqual(WHISPER_SAMPLE_RATE * 2)
  })

  it('caps recordings at 30s, keeping the earliest audio', () => {
    const r = new PcmRecorder()
    r.start()
    for (let i = 0; i < 35; i++) r.push(pcm(WHISPER_SAMPLE_RATE)) // 35s
    const out = r.stop()
    expect(out).not.toBeNull()
    expect(out!.length / BYTES_PER_SAMPLE).toBe(WHISPER_SAMPLE_RATE * 30)
  })

  it('cancel discards everything and stops recording', () => {
    const r = new PcmRecorder()
    r.start()
    r.push(pcm(WHISPER_SAMPLE_RATE))
    r.cancel()
    expect(r.isRecording).toBe(false)
    r.start()
    expect(r.stop()).toBeNull()
  })

  it('restarting while already recording begins a fresh recording', () => {
    const r = new PcmRecorder()
    r.start()
    r.push(pcm(WHISPER_SAMPLE_RATE * 5))
    // keyup was missed; user presses M again
    r.start()
    r.push(pcm(WHISPER_SAMPLE_RATE))
    const out = r.stop()
    expect(out).not.toBeNull()
    expect(out!.length / BYTES_PER_SAMPLE).toBe(WHISPER_SAMPLE_RATE)
  })

  it('isRecording reflects state transitions', () => {
    const r = new PcmRecorder()
    expect(r.isRecording).toBe(false)
    r.start()
    expect(r.isRecording).toBe(true)
    r.push(pcm(WHISPER_SAMPLE_RATE))
    r.stop()
    expect(r.isRecording).toBe(false)
  })
})
