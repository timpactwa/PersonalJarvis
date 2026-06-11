import { getSettings } from './memory/settings'

// NOTE: read env *lazily* inside the functions below. dotenv's config() runs in
// the body of backend/index.ts, which (per ESM import hoisting) executes AFTER
// this module's top-level code. Capturing process.env here at import time would
// always read an empty string and make synthesize() throw even with a valid key.
function resolveVoiceId(): string {
  // .env.local takes priority; DB setting is the fallback for UI-based changes
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID
  try { return getSettings().voiceId || 'pqHfZKP75CvOlQylNhV4' } catch { return 'pqHfZKP75CvOlQylNhV4' }
}

export async function synthesize(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY ?? ''
  if (!apiKey || apiKey === 'your_key_from_elevenlabs') {
    throw new Error('ELEVENLABS_API_KEY not set in .env.local')
  }

  const voiceId = resolveVoiceId()
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.85 },
        speed: 1.8,
      }),
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`ElevenLabs error ${res.status}: ${errText}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
