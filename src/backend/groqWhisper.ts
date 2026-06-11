import { WHISPER_SAMPLE_RATE } from './audioCapture'

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODEL = 'whisper-large-v3'

// Wrap raw Float32 PCM in a minimal WAV container so Groq can ingest it.
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 32
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)          // fmt chunk size
  header.writeUInt16LE(3, 20)           // AudioFormat 3 = IEEE float
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

function isHallucination(text: string): boolean {
  if (!text) return true
  const letters = text.replace(/[^a-z0-9]/gi, '')
  if (letters.length === 0) return true
  if (/^(.)\1+$/.test(letters)) return true
  const normalized = text.toLowerCase().replace(/[^a-z]/g, '')
  return normalized === 'blankaudio' || normalized === 'thankyou' || normalized === 'youyou'
}

export async function transcribe(audioBuffer: Buffer): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY ?? ''
  if (!apiKey) throw new Error('GROQ_API_KEY not set')

  if (audioBuffer.byteLength === 0 || audioBuffer.byteLength % 4 !== 0) {
    console.error(`[groqWhisper] invalid buffer: ${audioBuffer.byteLength} bytes — expected Float32 PCM`)
    return ''
  }

  const wav = pcmToWav(audioBuffer, WHISPER_SAMPLE_RATE)
  // Copy into a plain Uint8Array — Node's Buffer doesn't satisfy BlobPart
  const blob = new Blob([new Uint8Array(wav)], { type: 'audio/wav' })

  const form = new FormData()
  form.append('file', blob, 'audio.wav')
  form.append('model', MODEL)
  form.append('response_format', 'json')
  form.append('language', 'en')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 20_000)

  let res: Response
  try {
    res = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Groq Whisper timed out after 20s')
    }
    throw new Error(`Groq Whisper request failed: ${String(err)}`)
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) throw new Error('Groq API key invalid — check GROQ_API_KEY in .env.local')
    throw new Error(`Groq Whisper HTTP ${res.status}: ${body}`)
  }

  const data = await res.json() as { text?: string }
  const text = (data.text ?? '').trim()
  console.error(`[groqWhisper] transcribed: "${text}"`)
  return isHallucination(text) ? '' : text
}
