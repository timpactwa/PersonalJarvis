import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/backend/memory/settings', () => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}))

import { getSettings } from '../../../src/backend/memory/settings'
import { handleSpotifyTool } from '../../../src/backend/tools/spotify'

const NOW = Date.now()

const validSettings = {
  hotkey: 'Alt+Space',
  screenshotHotkey: 'Alt+Shift+S',
  voiceId: 'voice123',
  llmProvider: 'auto' as const,
  modelPreference: 'auto' as const,
  shortTurns: 20,
  ollamaModel: 'llama3.1:8b',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  userProfile: '',
  spotifyAccessToken: 'valid-token',
  spotifyExpiresAt: NOW + 3_600_000,
  spotifyRefreshToken: 'refresh-token',
}

beforeEach(() => {
  vi.mocked(getSettings).mockReturnValue(validSettings as any)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function mockFetch(response: {
  ok: boolean
  status: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}): void {
  vi.stubGlobal('fetch', vi.fn(async () => response))
}

function mockFetchSequence(responses: Array<{
  ok: boolean
  status: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}>): void {
  let callIndex = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1]
    callIndex++
    return resp
  }))
}

// ─── spotify_current ─────────────────────────────────────────────────────────

describe('spotify_current', () => {
  it('formats playing track with artist and progress percentage', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          name: 'Blinding Lights',
          artists: [{ name: 'The Weeknd' }],
          album: { name: 'After Hours' },
        },
        progress_ms: 60000,
        duration_ms: 200000,
        is_playing: true,
      }),
    })

    const result = await handleSpotifyTool('spotify_current', {})
    expect(result).toContain('"Blinding Lights"')
    expect(result).toContain('The Weeknd')
    expect(result).toContain('After Hours')
    expect(result).toContain('30%')
    expect(result).toContain('Playing')
  })

  it('returns "Nothing is playing" on 204', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_current', {})
    expect(result).toBe('Nothing is playing right now.')
  })

  it('returns "Nothing is playing" when item is null', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ item: null, is_playing: false }),
    })

    const result = await handleSpotifyTool('spotify_current', {})
    expect(result).toBe('Nothing is playing right now.')
  })

  it('shows Paused status when not playing', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          name: 'Song',
          artists: [{ name: 'Artist' }],
          album: { name: 'Album' },
        },
        progress_ms: 0,
        duration_ms: 100000,
        is_playing: false,
      }),
    })

    const result = await handleSpotifyTool('spotify_current', {})
    expect(result).toContain('Paused')
  })

  it('formats multiple artists with comma', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          name: 'Track',
          artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
          album: { name: 'Album' },
        },
        progress_ms: 50000,
        duration_ms: 100000,
        is_playing: true,
      }),
    })

    const result = await handleSpotifyTool('spotify_current', {})
    expect(result).toContain('Artist A, Artist B')
    expect(result).toContain('50%')
  })
})

// ─── spotify_pause ───────────────────────────────────────────────────────────

describe('spotify_pause', () => {
  it('returns success on 204', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toBe('Playback paused.')
  })

  it('returns Premium message on 403', async () => {
    mockFetch({ ok: false, status: 403 })

    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toContain('Premium')
  })

  it('returns active device message on 404', async () => {
    mockFetch({ ok: false, status: 404 })

    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toContain('active Spotify device')
  })
})

// ─── spotify_next / spotify_prev ─────────────────────────────────────────────

describe('spotify_next', () => {
  it('returns success message on 204', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_next', {})
    expect(result).toContain('next track')
  })
})

describe('spotify_prev', () => {
  it('returns success message on 204', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_prev', {})
    expect(result).toContain('previous track')
  })
})

// ─── spotify_volume ──────────────────────────────────────────────────────────

describe('spotify_volume', () => {
  it('sets volume and returns percentage message', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_volume', { volume: 75 })
    expect(result).toContain('75%')
  })

  it('clamps volume above 100 to 100', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_volume', { volume: 150 })
    expect(result).toContain('100%')
  })

  it('clamps volume below 0 to 0', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_volume', { volume: -10 })
    expect(result).toContain('0%')
  })
})

// ─── spotify_search ──────────────────────────────────────────────────────────

describe('spotify_search', () => {
  it('formats results with names, artists, and URIs', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        tracks: {
          items: [
            { uri: 'spotify:track:abc', name: 'Song One', artists: [{ name: 'Artist One' }] },
            { uri: 'spotify:track:def', name: 'Song Two', artists: [{ name: 'Artist Two' }] },
          ],
        },
      }),
    })

    const result = await handleSpotifyTool('spotify_search', { query: 'test', type: 'track', limit: 5 })
    expect(result).toContain('"Song One"')
    expect(result).toContain('Artist One')
    expect(result).toContain('spotify:track:abc')
    expect(result).toContain('"Song Two"')
    expect(result).toContain('Artist Two')
    expect(result).toContain('spotify:track:def')
  })

  it('returns "No tracks found" for empty results', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ tracks: { items: [] } }),
    })

    const result = await handleSpotifyTool('spotify_search', { query: 'nothinghere', type: 'track', limit: 5 })
    expect(result).toContain('No tracks found')
  })

  it('searches for albums when type is album', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        albums: {
          items: [
            { uri: 'spotify:album:xyz', name: 'Great Album', artists: [{ name: 'Band' }] },
          ],
        },
      }),
    })

    const result = await handleSpotifyTool('spotify_search', { query: 'great', type: 'album', limit: 5 })
    expect(result).toContain('"Great Album"')
    expect(result).toContain('spotify:album:xyz')
  })
})

// ─── spotify_play ─────────────────────────────────────────────────────────────

describe('spotify_play', () => {
  it('searches and plays by query (2 fetch calls)', async () => {
    mockFetchSequence([
      // First call: search
      {
        ok: true,
        status: 200,
        json: async () => ({
          tracks: {
            items: [
              { uri: 'spotify:track:abc123', name: 'Song Name', artists: [{ name: 'Artist' }] },
            ],
          },
        }),
      },
      // Second call: play
      { ok: true, status: 204 },
    ])

    const result = await handleSpotifyTool('spotify_play', { query: 'Song Name' })
    expect(result).toContain('Song Name')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('resumes with no query (1 fetch call)', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_play', {})
    expect(result).toBe('Playback resumed.')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('returns "No track found" when search is empty', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ tracks: { items: [] } }),
    })

    const result = await handleSpotifyTool('spotify_play', { query: 'xyznoexist' })
    expect(result).toContain('No track found')
  })

  it('returns Premium message on 403', async () => {
    mockFetchSequence([
      {
        ok: true,
        status: 200,
        json: async () => ({
          tracks: { items: [{ uri: 'spotify:track:abc', name: 'Song', artists: [{ name: 'Artist' }] }] },
        }),
      },
      { ok: false, status: 403 },
    ])

    const result = await handleSpotifyTool('spotify_play', { query: 'song' })
    expect(result).toContain('Premium')
  })

  it('plays using a direct URI (track)', async () => {
    mockFetch({ ok: true, status: 204 })

    const result = await handleSpotifyTool('spotify_play', { uri: 'spotify:track:abc123' })
    expect(result).toBe('Playback resumed.')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})

// ─── Token expiry ─────────────────────────────────────────────────────────────

describe('Token expiry', () => {
  it('refreshes token when expired then performs action (2 fetch calls)', async () => {
    // Settings report an expired token
    vi.mocked(getSettings).mockReturnValue({
      ...validSettings,
      spotifyAccessToken: 'old-token',
      spotifyExpiresAt: Date.now() - 1000, // expired
      spotifyRefreshToken: 'refresh-token',
    } as any)

    process.env.SPOTIFY_CLIENT_ID = 'test-client-id'
    process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret'

    mockFetchSequence([
      // First call: token refresh
      {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-token',
          expires_in: 3600,
        }),
      },
      // Second call: the actual action
      { ok: true, status: 204 },
    ])

    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toBe('Playback paused.')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)

    delete process.env.SPOTIFY_CLIENT_ID
    delete process.env.SPOTIFY_CLIENT_SECRET
  })

  it('returns re-authenticate message on refresh failure', async () => {
    vi.mocked(getSettings).mockReturnValue({
      ...validSettings,
      spotifyAccessToken: 'old-token',
      spotifyExpiresAt: Date.now() - 1000, // expired
      spotifyRefreshToken: 'refresh-token',
    } as any)

    process.env.SPOTIFY_CLIENT_ID = 'test-client-id'
    process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret'

    mockFetch({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toContain('session expired')
    expect(result).toContain('connect Spotify')

    delete process.env.SPOTIFY_CLIENT_ID
    delete process.env.SPOTIFY_CLIENT_SECRET
  })

  it('returns "not connected" message when refresh token is missing', async () => {
    vi.mocked(getSettings).mockReturnValue({
      ...validSettings,
      spotifyAccessToken: '',
      spotifyExpiresAt: Date.now() - 1000, // expired
      spotifyRefreshToken: '',
    } as any)

    process.env.SPOTIFY_CLIENT_ID = 'test-client-id'
    process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret'

    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toContain('not connected')

    delete process.env.SPOTIFY_CLIENT_ID
    delete process.env.SPOTIFY_CLIENT_SECRET
  })
})

// ─── Dispatch ─────────────────────────────────────────────────────────────────

describe('dispatch', () => {
  it('throws for unknown tool name', async () => {
    await expect(handleSpotifyTool('spotify_unknown_tool', {})).rejects.toThrow(
      'Unknown spotify tool: spotify_unknown_tool',
    )
  })
})
