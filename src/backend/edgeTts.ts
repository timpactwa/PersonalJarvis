import { webcrypto } from 'crypto'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { getSettings } from './memory/settings'

// msedge-tts uses globalThis.crypto — polyfill for Electron utility process context
if (!globalThis.crypto) {
  (globalThis as { crypto?: Crypto }).crypto = webcrypto as unknown as Crypto
}

const DEFAULT_VOICE = 'en-GB-RyanNeural'

function resolveVoice(): string {
  try {
    const id = getSettings().voiceId
    if (id && id.includes('Neural')) return id
  } catch { /* db not ready */ }
  return DEFAULT_VOICE
}

let _tts: MsEdgeTTS | null = null
let _ttsVoice = ''

// Normalizes an aborted upstream signal into an Error with name === 'AbortError'
// so callers can distinguish cancellation from provider failures/timeouts.
function toAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('cancelled', 'AbortError')
}

// Resets the singleton the same way the stream-error path does, so the next
// call gets a fresh connection instead of reusing a possibly-broken one.
function resetTtsSingleton(): void {
  try { _tts?.close() } catch {}
  _tts = null
  _ttsVoice = ''
}

async function getOrCreateTts(voice: string): Promise<MsEdgeTTS> {
  if (_tts && _ttsVoice === voice) return _tts
  try { _tts?.close() } catch {}
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  _tts = tts
  _ttsVoice = voice
  return tts
}

export async function synthesizeEdge(text: string, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) throw toAbortError(signal)

  const voice = resolveVoice()
  const tts = await getOrCreateTts(voice)
  const { audioStream } = tts.toStream(text, { rate: '+25%' })

  const chunks: Buffer[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Edge TTS timed out after 15s')), 15_000)

      const onAbort = (): void => {
        clearTimeout(timeout)
        resetTtsSingleton()
        reject(signal ? toAbortError(signal) : new DOMException('cancelled', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const settle = (fn: () => void): void => {
        signal?.removeEventListener('abort', onAbort)
        fn()
      }

      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      audioStream.on('end', () => settle(() => { clearTimeout(timeout); resolve() }))
      audioStream.on('error', (err: Error) => settle(() => { clearTimeout(timeout); reject(err) }))
    })
  } catch (err) {
    // Reset singleton on stream error so next call gets a fresh connection
    // (abort path already reset it above via resetTtsSingleton).
    if (!(err instanceof Error && err.name === 'AbortError')) resetTtsSingleton()
    throw err
  }

  return Buffer.concat(chunks)
}

export const EDGE_TTS_VOICES = [
  'en-GB-RyanNeural',
  'en-GB-ThomasNeural',
  'en-US-AndrewNeural',
  'en-US-GuyNeural',
  'en-US-EricNeural',
  'en-AU-WilliamNeural',
] as const
