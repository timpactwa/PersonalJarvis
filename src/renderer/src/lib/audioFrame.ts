/**
 * Binary audio frames from the backend now carry a 4-byte little-endian
 * uint32 turn-id header before the MP3 payload. Turn id 0 means "unowned"
 * audio (e.g. monitor alerts) and should always play; any other id must be
 * compared against the renderer's latest known turn id by the caller — a
 * mismatch means the frame belongs to a cancelled turn and must be dropped.
 *
 * This module only parses the header; it deliberately has zero dependencies
 * (no backend imports) so it stays trivially unit-testable.
 */
export interface ParsedAudioFrame {
  turnId: number
  payload: ArrayBuffer
}

/**
 * Split a raw binary audio frame into its turn-id header and MP3 payload.
 * Frames shorter than the 4-byte header are treated defensively as unowned
 * (turnId 0) with the original bytes passed through as the payload, rather
 * than throwing on a malformed/truncated frame.
 */
export function parseAudioFrame(buf: ArrayBuffer): ParsedAudioFrame {
  if (buf.byteLength < 4) return { turnId: 0, payload: buf }
  const view = new DataView(buf)
  const turnId = view.getUint32(0, true)
  const payload = buf.slice(4)
  return { turnId, payload }
}
