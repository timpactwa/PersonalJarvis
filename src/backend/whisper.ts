import { join } from 'path'

// Cache model in resources/ directory
const MODEL_CACHE = join(process.cwd(), 'resources')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null

async function getTranscriber(): Promise<any> {
  if (!transcriber) {
    // Must use Function constructor to prevent Vite from converting import() to require()
    // @xenova/transformers is ESM-only and require() of it throws ERR_REQUIRE_ESM
    const dynamicImport = new Function('specifier', 'return import(specifier)')
    const { pipeline } = await dynamicImport('@xenova/transformers')
    console.log('[whisper] loading model (first run downloads ~150MB)...')
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', {
      cache_dir: MODEL_CACHE,
    })
    console.log('[whisper] model ready')
  }
  return transcriber
}

// audioBuffer holds raw mono 16kHz Float32 PCM samples (little-endian) decoded
// in the renderer. transformers.js cannot decode webm/opus in Node (no
// AudioContext), so we feed it the Float32Array directly.
export async function transcribe(audioBuffer: Buffer): Promise<string> {
  // Expect raw Float32 PCM (4 bytes/sample). A non-multiple-of-4 length means
  // we received something else (e.g. a raw webm blob from a stale renderer);
  // bail gracefully instead of crashing the pipeline.
  if (audioBuffer.byteLength === 0 || audioBuffer.byteLength % 4 !== 0) {
    console.error(
      `[whisper] expected Float32 PCM but got ${audioBuffer.byteLength} bytes ` +
        '(not a multiple of 4) — ignoring. Ensure the renderer is sending decoded PCM.',
    )
    return ''
  }

  // Re-align into a fresh ArrayBuffer in case the Buffer isn't 4-byte aligned.
  const aligned = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength,
  )
  const samples = new Float32Array(aligned)

  const t = await getTranscriber()
  const result = await (t as any)(samples, { language: 'english' })
  const text = ((result as any).text ?? '').trim()
  return isHallucination(text) ? '' : text
}

// Whisper emits garbage on silence/noise: strings of repeated punctuation
// ("!!!!!", "...."), bracketed tags ("[BLANK_AUDIO]"), or a couple of canned
// phrases. Treat those as empty so the pipeline stays idle instead of querying
// the LLM with nonsense.
function isHallucination(text: string): boolean {
  if (!text) return true
  const letters = text.replace(/[^a-z0-9]/gi, '')
  // No alphanumerics at all (pure punctuation like "!!!!" or "...").
  if (letters.length === 0) return true
  // A single character repeated (e.g. "aaaa") with no real words.
  if (/^(.)\1+$/.test(letters)) return true
  const normalized = text.toLowerCase().replace(/[^a-z]/g, '')
  return normalized === 'blankaudio' || normalized === 'thankyou' || normalized === 'youyou'
}
