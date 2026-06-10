import { pipeline } from '@xenova/transformers'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

// Cache model in resources/ directory
const MODEL_CACHE = join(process.cwd(), 'resources')

let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null

async function getTranscriber(): Promise<Awaited<ReturnType<typeof pipeline>>> {
  if (!transcriber) {
    console.log('[whisper] loading model (first run downloads ~150MB)...')
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', {
      cache_dir: MODEL_CACHE,
    })
    console.log('[whisper] model ready')
  }
  return transcriber
}

export async function transcribe(audioBuffer: Buffer): Promise<string> {
  const tmp = join(tmpdir(), `jarvis-${randomBytes(6).toString('hex')}.webm`)
  await writeFile(tmp, audioBuffer)

  try {
    const t = await getTranscriber()
    const result = await (t as any)(tmp, { language: 'english' })
    return (result as any).text?.trim() ?? ''
  } finally {
    await unlink(tmp).catch(() => {})
  }
}
