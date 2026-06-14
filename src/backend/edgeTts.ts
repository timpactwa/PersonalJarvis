import { webcrypto } from 'crypto'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { getSettings } from './memory/settings'

// msedge-tts uses globalThis.crypto — polyfill for Electron utility process context
if (!globalThis.crypto) {
  (globalThis as typeof globalThis & { crypto: typeof webcrypto }).crypto = webcrypto
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

async function getOrCreateTts(voice: string): Promise<MsEdgeTTS> {
  if (_tts && _ttsVoice === voice) return _tts
  try { _tts?.close() } catch {}
  const tts = new MsEdgeTTS()
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  _tts = tts
  _ttsVoice = voice
  return tts
}

export async function synthesizeEdge(text: string): Promise<Buffer> {
  const voice = resolveVoice()
  const tts = await getOrCreateTts(voice)
  const { audioStream } = tts.toStream(text, { rate: '+25%' })

  const chunks: Buffer[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Edge TTS timed out after 15s')), 15_000)
      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      audioStream.on('end', () => { clearTimeout(timeout); resolve() })
      audioStream.on('error', (err: Error) => { clearTimeout(timeout); reject(err) })
    })
  } catch (err) {
    // Reset singleton on stream error so next call gets a fresh connection
    try { _tts?.close() } catch {}
    _tts = null
    _ttsVoice = ''
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
