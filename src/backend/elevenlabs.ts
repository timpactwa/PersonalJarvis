const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? ''
// "Bill" — deep British male, close to MCU Jarvis feel
// User can override via ELEVENLABS_VOICE_ID in .env.local
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? 'pqHfZKP75CvOlQylNhV4'

export async function synthesize(text: string): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not set in .env.local')
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.4, similarity_boost: 0.85 },
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
