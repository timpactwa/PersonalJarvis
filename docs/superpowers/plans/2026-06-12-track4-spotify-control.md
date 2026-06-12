# Track 4: Spotify Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Spotify playback control via the Spotify Web API, with OAuth PKCE auth flow and 8 playback tools.

**Architecture:** New `src/backend/tools/spotify.ts` calls the Spotify Web API. OAuth tokens are stored in the settings DB (access token + expiry + refresh token). Client ID/Secret come from `.env.local`. A `spotify_auth` tool opens the browser PKCE flow. All playback tools auto-refresh the access token on expiry. All 9 tools are registered in `getTools()`, `getToolsForGroq()`, and `getToolsForAgent()`.

**Tech Stack:** TypeScript, Spotify Web API (REST), `electron.shell.openExternal` for OAuth, Vitest

**Prerequisites:** Track 1 must be merged first.

---

## Task 1: Update settings for Spotify token storage

**Files:**
- Modify: `src/backend/types.ts`
- Modify: `src/backend/memory/settings.ts`

- [ ] **Step 1: Add Spotify fields to `Settings`**

In `src/backend/types.ts`, add to the `Settings` interface:

```ts
spotifyAccessToken: string
spotifyExpiresAt: number
spotifyRefreshToken: string
```

- [ ] **Step 2: Add defaults in `settings.ts`**

Read `src/backend/memory/settings.ts`. In the defaults object, add:

```ts
spotifyAccessToken: '',
spotifyExpiresAt: 0,
spotifyRefreshToken: '',
```

- [ ] **Step 3: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add src/backend/types.ts src/backend/memory/settings.ts
git commit -m "feat(settings): Spotify token storage fields"
```

---

## Task 2: Create `tools/spotify.ts`

**Files:**
- Create: `src/backend/tools/spotify.ts`

- [ ] **Step 1: Create the module**

Create `src/backend/tools/spotify.ts`:

```ts
import { createHash, randomBytes } from 'crypto'
import { getSettings, setSettings } from '../memory/settings'

const SPOTIFY_API = 'https://api.spotify.com/v1'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const REDIRECT_URI = 'http://localhost:8919/spotify-callback'

// --- Token management ---

function isTokenExpired(): boolean {
  const { spotifyExpiresAt } = getSettings()
  return Date.now() >= spotifyExpiresAt - 30_000
}

async function refreshAccessToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? ''
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? ''
  const { spotifyRefreshToken } = getSettings()

  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env.local')
  }
  if (!spotifyRefreshToken) {
    throw new Error('Spotify not connected — say "connect Spotify" to authenticate')
  }

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: spotifyRefreshToken,
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Spotify token refresh failed: ${res.status} ${body}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string }
  const expiresAt = Date.now() + data.expires_in * 1000

  setSettings({
    spotifyAccessToken: data.access_token,
    spotifyExpiresAt: expiresAt,
    ...(data.refresh_token ? { spotifyRefreshToken: data.refresh_token } : {}),
  })

  return data.access_token
}

async function getAccessToken(): Promise<string> {
  if (isTokenExpired()) {
    return refreshAccessToken()
  }
  return getSettings().spotifyAccessToken
}

async function spotifyFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  return fetch(`${SPOTIFY_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
}

// --- Tool definitions ---

export const spotifyToolDefs = [
  {
    name: 'spotify_auth',
    description:
      'Connect Spotify by opening an OAuth browser window. Run this once to authenticate. After completion, all other Spotify tools will work.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_current',
    description:
      'Show what\'s currently playing on Spotify — track name, artist, album, and playback progress. Use when the user asks "what\'s playing?", "what song is this?", or "what am I listening to?".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_play',
    description:
      'Start or resume Spotify playback. Can play a specific track, artist, album, or playlist by query, or resume the current track if no query is given. Use for "play [something]", "play something chill", "resume music".',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "lofi beats", "Taylor Swift", "Daft Punk Random Access Memories"' },
        uri: { type: 'string', description: 'Spotify URI, e.g. spotify:track:1234 or spotify:playlist:abc. Use instead of query if you have the exact URI.' },
        type: { type: 'string', enum: ['track', 'artist', 'album', 'playlist'], description: 'Type to search for (default: track)' },
      },
      required: [],
    },
  },
  {
    name: 'spotify_pause',
    description: 'Pause Spotify playback. Use for "pause", "stop music", "pause Spotify".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_next',
    description: 'Skip to the next track. Use for "next song", "skip", "next track".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_prev',
    description: 'Go to the previous track. Use for "previous song", "go back", "last track".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_volume',
    description: 'Set the Spotify playback volume. Use for "turn it up to 80", "lower the volume to 30", "mute Spotify".',
    input_schema: {
      type: 'object' as const,
      properties: {
        volume: { type: 'number', description: 'Volume level 0–100' },
      },
      required: ['volume'],
    },
  },
  {
    name: 'spotify_search',
    description:
      'Search Spotify for tracks, albums, artists, or playlists. Returns names and URIs. Use before spotify_play when you need to find a specific item, or when the user asks "find" or "search for" something on Spotify.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', enum: ['track', 'artist', 'album', 'playlist'], description: 'What to search for (default: track)' },
        limit: { type: 'number', description: 'Results count (default 5, max 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'spotify_queue',
    description:
      'Add a track to the Spotify play queue. Use for "queue up [song]", "add [song] to queue", "play [song] next".',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Track name to search and queue' },
        uri: { type: 'string', description: 'Spotify track URI — use instead of query if you already have it' },
      },
      required: [],
    },
  },
]

// --- Handlers ---

async function authHandler(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? ''
  if (!clientId) {
    return 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local first. Get them from https://developer.spotify.com/dashboard'
  }

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(8).toString('hex')

  // Store verifier temporarily in settings for the callback server to use
  setSettings({ spotifyAccessToken: `pkce:${verifier}:${state}` })

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing',
  })

  const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`

  // Use Electron's shell to open the browser
  try {
    const { shell } = require('electron')
    await shell.openExternal(authUrl)
    return 'Spotify authentication browser window opened. After you log in and authorize, say "Spotify connected" and I\'ll verify the connection. (Note: the callback server on localhost:8919 must receive the code — this is handled automatically.)'
  } catch {
    return `Open this URL to connect Spotify:\n${authUrl}`
  }
}

async function currentTrack(): Promise<string> {
  const res = await spotifyFetch('/me/player/currently-playing')
  if (res.status === 204) return 'Nothing is playing right now.'
  if (!res.ok) return `Spotify error: ${res.status}`

  const data = await res.json() as {
    item?: { name: string; artists: Array<{ name: string }>; album: { name: string } }
    progress_ms?: number
    duration_ms?: number
    is_playing?: boolean
  }

  if (!data.item) return 'Nothing is playing right now.'

  const track = data.item
  const artist = track.artists.map(a => a.name).join(', ')
  const progress = data.progress_ms ?? 0
  const duration = data.duration_ms ?? 1
  const pct = Math.round((progress / duration) * 100)
  const status = data.is_playing ? 'Playing' : 'Paused'

  return `${status}: "${track.name}" by ${artist} — ${track.album.name} (${pct}% through)`
}

async function searchSpotify(query: string, type: string, limit: number): Promise<{ uri: string; name: string; artist?: string }[]> {
  const params = new URLSearchParams({ q: query, type, limit: String(Math.min(limit, 10)) })
  const res = await spotifyFetch(`/search?${params}`)
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`)
  const data = await res.json() as Record<string, { items: Array<{ uri: string; name: string; artists?: Array<{ name: string }> }> }>
  const key = `${type}s`
  const items = data[key]?.items ?? []
  return items.map(item => ({
    uri: item.uri,
    name: item.name,
    artist: item.artists?.map(a => a.name).join(', '),
  }))
}

async function playHandler(input: Record<string, unknown>): Promise<string> {
  let contextUri: string | undefined
  let uris: string[] | undefined

  if (input.uri) {
    const uri = String(input.uri)
    if (uri.startsWith('spotify:track:')) uris = [uri]
    else contextUri = uri
  } else if (input.query) {
    const type = String(input.type ?? 'track')
    const results = await searchSpotify(String(input.query), type, 1)
    if (results.length === 0) return `No ${type} found for "${input.query}".`
    const found = results[0]
    if (found.uri.startsWith('spotify:track:')) uris = [found.uri]
    else contextUri = found.uri
  }

  const body: Record<string, unknown> = {}
  if (contextUri) body.context_uri = contextUri
  if (uris) body.uris = uris

  const res = await spotifyFetch('/me/player/play', {
    method: 'PUT',
    body: JSON.stringify(body),
  })

  if (res.status === 204) {
    if (input.query) return `Now playing: "${input.query}".`
    return 'Playback resumed.'
  }
  if (res.status === 403) return 'Playback requires Spotify Premium.'
  if (res.status === 404) return 'No active Spotify device found. Open Spotify on your device first.'
  return `Spotify play error: ${res.status}`
}

async function simpleAction(endpoint: string, method: 'PUT' | 'POST', successMsg: string): Promise<string> {
  const res = await spotifyFetch(endpoint, { method })
  if (res.status === 204 || res.status === 200) return successMsg
  if (res.status === 403) return 'This action requires Spotify Premium.'
  if (res.status === 404) return 'No active Spotify device found. Open Spotify on your device first.'
  return `Spotify error: ${res.status}`
}

async function volumeHandler(volume: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Math.round(volume)))
  return simpleAction(`/me/player/volume?volume_percent=${v}`, 'PUT', `Volume set to ${v}%.`)
}

async function searchHandler(query: string, type: string, limit: number): Promise<string> {
  const results = await searchSpotify(query, type, limit)
  if (results.length === 0) return `No ${type}s found for "${query}".`
  return results.map((r, i) =>
    `[${i + 1}] "${r.name}"${r.artist ? ` by ${r.artist}` : ''}\n  URI: ${r.uri}`
  ).join('\n\n')
}

async function queueHandler(input: Record<string, unknown>): Promise<string> {
  let uri = input.uri ? String(input.uri) : ''

  if (!uri && input.query) {
    const results = await searchSpotify(String(input.query), 'track', 1)
    if (results.length === 0) return `No track found for "${input.query}".`
    uri = results[0].uri
  }

  if (!uri) return 'Please provide a query or URI to queue.'

  const res = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: 'POST' })
  if (res.status === 204 || res.status === 200) return 'Track added to queue.'
  if (res.status === 403) return 'Queue requires Spotify Premium.'
  return `Spotify queue error: ${res.status}`
}

// --- Dispatch ---

export async function handleSpotifyTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'spotify_auth':    return authHandler()
      case 'spotify_current': return currentTrack()
      case 'spotify_play':    return playHandler(input)
      case 'spotify_pause':   return simpleAction('/me/player/pause', 'PUT', 'Playback paused.')
      case 'spotify_next':    return simpleAction('/me/player/next', 'POST', 'Skipped to next track.')
      case 'spotify_prev':    return simpleAction('/me/player/previous', 'POST', 'Went to previous track.')
      case 'spotify_volume':  return volumeHandler(Number(input.volume))
      case 'spotify_search':  return searchHandler(String(input.query ?? ''), String(input.type ?? 'track'), Number(input.limit ?? 5))
      case 'spotify_queue':   return queueHandler(input)
      default: throw new Error(`Unknown spotify tool: ${name}`)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not connected') || msg.includes('authenticate')) return msg
    if (msg.includes('token refresh failed')) return 'Spotify session expired — say "connect Spotify" to re-authenticate.'
    throw err
  }
}
```

- [ ] **Step 2: Run tests (no tests yet — will add in Task 3)**

```
npm test
```

Expected: All existing tests PASS.

- [ ] **Step 3: Commit**

```
git add src/backend/tools/spotify.ts
git commit -m "feat: Spotify tool module — auth, playback, search, queue (Spotify Web API)"
```

---

## Task 3: Register Spotify tools in `tools/index.ts`

**Files:**
- Modify: `src/backend/tools/index.ts`
- Modify: `src/backend/groq.ts`
- Modify: `src/backend/claude.ts`

- [ ] **Step 1: Add import and register**

In `src/backend/tools/index.ts`:

Add import:
```ts
import { spotifyToolDefs, handleSpotifyTool } from './spotify'
```

Add to `getTools()`, `getToolsForGroq()`, and `getToolsForAgent()`:
```ts
...spotifyToolDefs,
```

Add to `handleTool` dispatch (before the `else throw` line):
```ts
else if (name.startsWith('spotify_'))  result = await handleSpotifyTool(name, input)
```

- [ ] **Step 2: Update system prompts**

In `src/backend/groq.ts`, add to CAPABILITIES:
```
• Spotify — play, pause, skip, volume, search, queue, what's playing → spotify_play / spotify_pause / spotify_next / spotify_prev / spotify_volume / spotify_search / spotify_queue / spotify_current
```

Also add `spotify` context to the TOOL_KEYWORDS_ROUTE in `src/backend/index.ts` if not already present (check line ~46). `'spotify'` already appears in the list — no change needed.

In `src/backend/claude.ts`, add to CAPABILITIES (same line as Groq above, plus auth):
```
• Spotify — control playback, search, queue; connect account → spotify_auth / spotify_play / spotify_pause / spotify_next / spotify_prev / spotify_volume / spotify_search / spotify_queue / spotify_current
```

- [ ] **Step 3: Add SPOTIFY env vars to `.env.local` documentation**

The `.env.local` file is not checked in. Just note in the commit message that users must add:
```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```
(Refresh token is stored automatically via `spotify_auth` tool.)

- [ ] **Step 4: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
git add src/backend/tools/index.ts src/backend/groq.ts src/backend/claude.ts
git commit -m "feat: register Spotify tools in dispatch and system prompts"
```

---

## Task 4: Write tests for Spotify tools

**Files:**
- Create: `tests/backend/tools/spotify.test.ts`

- [ ] **Step 1: Create test file**

Create `tests/backend/tools/spotify.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/backend/memory/settings', () => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}))

type FetchResponse = {
  ok: boolean
  status: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

function mockFetch(response: FetchResponse): void {
  vi.stubGlobal('fetch', vi.fn(async () => response))
}

const validSettings = {
  spotifyAccessToken: 'valid-token',
  spotifyExpiresAt: Date.now() + 3_600_000,
  spotifyRefreshToken: 'refresh-token',
}

beforeEach(() => {
  const { getSettings } = require('../../../src/backend/memory/settings')
  vi.mocked(getSettings).mockReturnValue(validSettings)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('spotify_current', () => {
  it('formats currently playing track', async () => {
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        item: {
          name: 'Get Lucky',
          artists: [{ name: 'Daft Punk' }, { name: 'Pharrell Williams' }],
          album: { name: 'Random Access Memories' },
        },
        progress_ms: 60000,
        duration_ms: 240000,
        is_playing: true,
      }),
    })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_current', {})
    expect(result).toContain('Get Lucky')
    expect(result).toContain('Daft Punk')
    expect(result).toContain('25%')
    expect(result).toContain('Playing')
  })

  it('returns "Nothing is playing" on 204', async () => {
    mockFetch({ ok: true, status: 204 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_current', {})
    expect(result).toBe('Nothing is playing right now.')
  })
})

describe('spotify_pause', () => {
  it('returns success message on 204', async () => {
    mockFetch({ ok: true, status: 204 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toBe('Playback paused.')
  })

  it('returns helpful message on 403 (no premium)', async () => {
    mockFetch({ ok: false, status: 403 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toContain('Premium')
  })

  it('returns helpful message on 404 (no active device)', async () => {
    mockFetch({ ok: false, status: 404 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toContain('active Spotify device')
  })
})

describe('spotify_next / spotify_prev', () => {
  it('skip returns success on 204', async () => {
    mockFetch({ ok: true, status: 204 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    expect(await handleSpotifyTool('spotify_next', {})).toContain('next')
  })

  it('prev returns success on 204', async () => {
    mockFetch({ ok: true, status: 204 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    expect(await handleSpotifyTool('spotify_prev', {})).toContain('previous')
  })
})

describe('spotify_volume', () => {
  it('clamps volume to 0–100 and returns confirmation', async () => {
    mockFetch({ ok: true, status: 204 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_volume', { volume: 75 })
    expect(result).toContain('75%')
  })

  it('clamps values above 100', async () => {
    mockFetch({ ok: true, status: 204 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_volume', { volume: 150 })
    expect(result).toContain('100%')
  })
})

describe('spotify_search', () => {
  it('formats search results with URIs', async () => {
    mockFetch({
      ok: true, status: 200,
      json: async () => ({
        tracks: {
          items: [
            { uri: 'spotify:track:abc', name: 'Get Lucky', artists: [{ name: 'Daft Punk' }] },
            { uri: 'spotify:track:def', name: 'Instant Crush', artists: [{ name: 'Daft Punk' }] },
          ],
        },
      }),
    })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_search', { query: 'daft punk' })
    expect(result).toContain('Get Lucky')
    expect(result).toContain('spotify:track:abc')
    expect(result).toContain('Daft Punk')
  })

  it('returns "no results" for empty response', async () => {
    mockFetch({
      ok: true, status: 200,
      json: async () => ({ tracks: { items: [] } }),
    })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_search', { query: 'xyznotreal123' })
    expect(result).toContain('No tracks found')
  })
})

describe('spotify_play', () => {
  it('searches and plays by query', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string) => {
      calls++
      if (calls === 1) {
        // search call
        return {
          ok: true, status: 200,
          json: async () => ({
            tracks: { items: [{ uri: 'spotify:track:abc', name: 'Get Lucky', artists: [{ name: 'Daft Punk' }] }] },
          }),
        }
      }
      // play call
      return { ok: true, status: 204 }
    }))
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_play', { query: 'daft punk' })
    expect(result).toContain('Now playing')
    expect(calls).toBe(2)
  })

  it('resumes playback with no query (empty PUT body)', async () => {
    mockFetch({ ok: true, status: 204 })
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_play', {})
    expect(result).toBe('Playback resumed.')
  })
})

describe('token expiry', () => {
  it('refreshes token when expired and retries the action', async () => {
    const { getSettings } = require('../../../src/backend/memory/settings')
    vi.mocked(getSettings).mockReturnValue({
      ...validSettings,
      spotifyExpiresAt: Date.now() - 1000, // expired
    })

    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls++
      if (url.includes('accounts.spotify.com')) {
        return {
          ok: true, status: 200,
          json: async () => ({ access_token: 'new-token', expires_in: 3600 }),
        }
      }
      return { ok: true, status: 204 }
    }))

    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toBe('Playback paused.')
    // First call = token refresh, second = actual API call
    expect(calls).toBe(2)
  })

  it('returns helpful message when refresh fails', async () => {
    const { getSettings } = require('../../../src/backend/memory/settings')
    vi.mocked(getSettings).mockReturnValue({
      ...validSettings,
      spotifyExpiresAt: Date.now() - 1000,
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401,
      text: async () => 'Unauthorized',
    })))

    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    const result = await handleSpotifyTool('spotify_pause', {})
    expect(result).toContain('re-authenticate')
  })
})

describe('handleSpotifyTool', () => {
  it('throws for unknown tool name', async () => {
    const { handleSpotifyTool } = await import('../../../src/backend/tools/spotify')
    await expect(handleSpotifyTool('spotify_unknown', {})).rejects.toThrow('Unknown spotify tool')
  })
})
```

- [ ] **Step 2: Run tests**

```
npx vitest run tests/backend/tools/spotify.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Run full suite**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add tests/backend/tools/spotify.test.ts
git commit -m "test: Spotify tool module coverage — playback, search, token refresh"
```

---

## Task 5: Smoke test in the live app

- [ ] **Step 1: Add Spotify credentials to `.env.local`**

Add these lines to `.env.local` (get credentials from https://developer.spotify.com/dashboard — create an app, set Redirect URI to `http://localhost:8919/spotify-callback`):

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

- [ ] **Step 2: Rebuild and run**

```
npm run build:backend
npm run dev
```

- [ ] **Step 3: Authenticate**

Say "connect Spotify" → `spotify_auth` opens browser → complete OAuth → tokens saved.

- [ ] **Step 4: Test playback commands**

1. "What's playing?" → `spotify_current` returns current track
2. "Play some lo-fi beats" → `spotify_play` searches + plays
3. "Turn the volume up to 80" → `spotify_volume` sets 80%
4. "Next track" → `spotify_next` skips
5. "Pause the music" → `spotify_pause` pauses

- [ ] **Step 5: Commit any fixes**

```
git add <changed files>
git commit -m "fix(spotify): <description>"
```
