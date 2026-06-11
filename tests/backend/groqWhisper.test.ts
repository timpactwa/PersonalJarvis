import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GROQ_API_KEY
})

// 4 bytes per Float32 sample; minimum valid buffer is 4 bytes (1 sample)
const SAMPLES_4 = Buffer.alloc(16)  // 4 Float32 samples

describe('groqWhisper transcribe', () => {
  it('throws when GROQ_API_KEY is not set', async () => {
    delete process.env.GROQ_API_KEY
    const { transcribe } = await import('../../src/backend/groqWhisper')
    await expect(transcribe(Buffer.alloc(4))).rejects.toThrow('GROQ_API_KEY')
  })

  it('returns empty string for a zero-length buffer', async () => {
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(Buffer.alloc(0))).toBe('')
  })

  it('returns empty string for a buffer whose byte count is not a multiple of 4', async () => {
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(Buffer.alloc(7))).toBe('')
    expect(await transcribe(Buffer.alloc(9))).toBe('')
  })

  it('returns transcribed text on a successful API response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'Hello world.' }),
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(SAMPLES_4)).toBe('Hello world.')
  })

  it('trims whitespace from the returned transcript', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: '   Hello world.   ' }),
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(SAMPLES_4)).toBe('Hello world.')
  })

  it('returns empty string when API response has no text field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(SAMPLES_4)).toBe('')
  })

  it('returns empty string for hallucination "Thank you."', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'Thank you.' }),
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(SAMPLES_4)).toBe('')
  })

  it('returns empty string for hallucination "you you"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'you you' }),
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(SAMPLES_4)).toBe('')
  })

  it('returns empty string for text that is all repeated characters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'aaaaaaaaaa' }),
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(SAMPLES_4)).toBe('')
  })

  it('returns empty string for text with no letters or digits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: '...' }),
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    expect(await transcribe(SAMPLES_4)).toBe('')
  })

  it('throws with "invalid" message on 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401, text: async () => 'Unauthorized',
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    await expect(transcribe(SAMPLES_4)).rejects.toThrow(/invalid/i)
  })

  it('throws with HTTP status on other error responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, text: async () => 'Internal Server Error',
    })))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    await expect(transcribe(SAMPLES_4)).rejects.toThrow('500')
  })

  it('throws "timed out" message when fetch throws an AbortError', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn(async () => { throw abortError }))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    await expect(transcribe(SAMPLES_4)).rejects.toThrow(/timed out/i)
  })

  it('throws a generic request-failed message for non-AbortError network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network error') }))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    await expect(transcribe(SAMPLES_4)).rejects.toThrow(/request failed/i)
  })

  it('sends a multipart form with model and language fields', async () => {
    let capturedForm: FormData | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      capturedForm = opts.body as FormData
      return { ok: true, json: async () => ({ text: 'test' }) }
    }))
    const { transcribe } = await import('../../src/backend/groqWhisper')
    await transcribe(SAMPLES_4)
    expect(capturedForm).toBeDefined()
    expect(capturedForm!.get('model')).toBe('whisper-large-v3')
    expect(capturedForm!.get('language')).toBe('en')
  })
})
