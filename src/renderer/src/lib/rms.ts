/**
 * Compute a normalized 0..1 loudness value from a byte time-domain buffer
 * (as produced by AnalyserNode.getByteTimeDomainData, where 128 = silence).
 */
export function rmsFromBytes(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  let sum = 0
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128 // -1..1
    sum += v * v
  }
  const rms = Math.sqrt(sum / bytes.length)
  return Math.max(0, Math.min(1, rms))
}
