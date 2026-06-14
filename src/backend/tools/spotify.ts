import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import { emitEvent } from '../events'
import { getSettings, setSettings } from '../memory/settings'

const SPOTIFY_API = 'https://api.spotify.com/v1'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const REDIRECT_URI = 'http://127.0.0.1:8919/spotify-callback'

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

export async function getAccessToken(): Promise<string> {
  if (isTokenExpired()) return refreshAccessToken()
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

export const spotifyToolDefs = [
  {
    name: 'spotify_auth',
    description: 'Connect Spotify by opening an OAuth browser window. Run this once to authenticate. After completion, all other Spotify tools will work.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_current',
    description: 'Show what\'s currently playing on Spotify — track name, artist, album, and playback progress. Use when the user asks "what\'s playing?", "what song is this?", or "what am I listening to?".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_play',
    description: 'Starts or resumes Spotify playback NOW. With a query/uri it plays that track, artist, album, or playlist immediately; with no arguments it resumes whatever was paused. Use for "play [something]", "play something chill", "play my workout playlist", "resume music". For playlists pass type:"playlist" — it matches the user\'s own library first. Do NOT use to add a song after the current one (use spotify_queue) or just to find items without playing (use spotify_search).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "lofi beats", "Taylor Swift"' },
        uri: { type: 'string', description: 'Spotify URI, e.g. spotify:track:1234. Use instead of query if you have the exact URI.' },
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
    description: 'Searches Spotify\'s public catalog for tracks, albums, artists, or playlists and returns their names and URIs — it does NOT play anything. Use only when the user wants to browse/find options ("search Spotify for X", "find songs by Y") or when you need a URI before another action. For "play X" just call spotify_play directly; for the user\'s own saved playlists use spotify_my_playlists.',
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
    name: 'spotify_my_playlists',
    description: "List the user's own Spotify playlists (saved and created). Use when user asks 'what are my playlists', 'show my playlists', or refers to a playlist by name and you need to find its URI.",
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'spotify_queue',
    description: 'Adds a track to the END of the Spotify play queue without interrupting the current song. Use for "queue up [song]", "add [song] to the queue", "play [song] next". Do NOT use to start playback immediately (use spotify_play).',
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

async function authHandler(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID ?? ''
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? ''
  if (!clientId || !clientSecret) {
    return 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local first. Get them from https://developer.spotify.com/dashboard'
  }

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(8).toString('hex')

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

  // Spin up a one-shot callback server before opening the browser
  const code = await new Promise<string>((resolve, reject) => {
    const srv = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost:8919')
        if (!url.pathname.includes('spotify-callback')) { res.end('Not found'); return }

        const returnedState = url.searchParams.get('state')
        const authCode = url.searchParams.get('code')
        const error = url.searchParams.get('error')

        if (error) {
          res.end(`<html><body style="font-family:monospace;padding:24px">Spotify auth error: ${error}<br>You can close this tab.</body></html>`)
          srv.close()
          reject(new Error(`Spotify auth denied: ${error}`))
          return
        }

        if (returnedState !== state || !authCode) {
          res.end('<html><body style="font-family:monospace;padding:24px">Invalid callback. Try connecting again.</body></html>')
          return
        }

        res.end('<html><body style="font-family:monospace;padding:24px;background:#0a1628;color:#1db954">&#10003; Spotify connected! You can close this tab.</body></html>')
        srv.close()
        resolve(authCode)
      } catch (e) {
        reject(e)
      }
    })

    srv.listen(8919, '127.0.0.1', () => {
      require('child_process').exec(`start "" "${authUrl}"`)
    })

    srv.on('error', (err) => reject(err))

    // Timeout after 5 minutes
    setTimeout(() => { srv.close(); reject(new Error('Spotify auth timed out')) }, 5 * 60 * 1000)
  })

  // Exchange code for tokens
  const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '')
    throw new Error(`Spotify token exchange failed: ${tokenRes.status} ${body}`)
  }

  const data = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number }
  setSettings({
    spotifyAccessToken: data.access_token,
    spotifyRefreshToken: data.refresh_token,
    spotifyExpiresAt: Date.now() + data.expires_in * 1000,
  })

  return 'Spotify connected! You can now control playback with commands like "play some jazz", "pause", "next track", etc.'
}

async function currentTrack(): Promise<string> {
  const res = await spotifyFetch('/me/player/currently-playing')
  if (res.status === 204) {
    emitEvent({ type: 'spotify_now_playing', isPlaying: false })
    return 'Nothing is playing right now.'
  }
  if (!res.ok) return `Spotify error: ${res.status}`

  const data = await res.json() as {
    item?: { name: string; artists: Array<{ name: string }>; album: { name: string } }
    progress_ms?: number
    duration_ms?: number
    is_playing?: boolean
  }

  if (!data.item) {
    emitEvent({ type: 'spotify_now_playing', isPlaying: false })
    return 'Nothing is playing right now.'
  }

  const track = data.item
  const artist = track.artists.map(a => a.name).join(', ')
  const progress = data.progress_ms ?? 0
  const duration = data.duration_ms ?? 1
  const pct = Math.round((progress / duration) * 100)
  const status = data.is_playing ? 'Playing' : 'Paused'

  emitEvent({ type: 'spotify_now_playing', track: track.name, artist, isPlaying: data.is_playing ?? false })

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

async function getActiveDeviceId(): Promise<string | null> {
  const res = await spotifyFetch('/me/player/devices')
  if (!res.ok) return null
  const data = await res.json() as { devices: Array<{ id: string; is_active: boolean; name: string; type: string }> }
  const devices = data.devices

  // Prefer a computer device that's already active
  const activeComputer = devices.find(d => d.is_active && d.type === 'Computer')
  if (activeComputer) return activeComputer.id

  // Any active device
  const anyActive = devices.find(d => d.is_active)
  if (anyActive) return anyActive.id

  // No active device — prefer transferring to a Computer, then any device
  const computer = devices.find(d => d.type === 'Computer')
  const target = computer ?? devices[0]
  if (!target) return null

  await spotifyFetch('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [target.id] }) })
  await new Promise(r => setTimeout(r, 800))
  return target.id
}

async function ensureDevice(): Promise<boolean> {
  const id = await getActiveDeviceId()
  if (id) return true
  // No devices at all — launch Spotify and wait
  require('child_process').exec('start "" "spotify:"')
  await new Promise(r => setTimeout(r, 4000))
  const retry = await getActiveDeviceId()
  return retry !== null
}

async function myPlaylists(limit = 50): Promise<Array<{ name: string; uri: string; id: string }>> {
  const res = await spotifyFetch(`/me/playlists?limit=${limit}`)
  if (!res.ok) throw new Error(`Failed to fetch playlists: ${res.status}`)
  const data = await res.json() as { items: Array<{ id: string; name: string; uri: string }> }
  return data.items.map(p => ({ id: p.id, name: p.name, uri: p.uri }))
}

async function playHandler(input: Record<string, unknown>): Promise<string> {
  let contextUri: string | undefined
  let uris: string[] | undefined
  let label = ''

  if (input.uri) {
    const uri = String(input.uri)
    if (uri.startsWith('spotify:track:')) uris = [uri]
    else contextUri = uri
    label = uri
  } else if (input.query) {
    const query = String(input.query)
    const type = String(input.type ?? 'track')
    label = query

    // For playlists, search user's own library first
    if (type === 'playlist') {
      const playlists = await myPlaylists()
      const match = playlists.find(p => p.name.toLowerCase().includes(query.toLowerCase()))
      if (match) {
        contextUri = match.uri
        label = match.name
      }
    }

    // Fall back to public Spotify search
    if (!contextUri && !uris) {
      const results = await searchSpotify(query, type, 1)
      if (results.length === 0) return `No ${type} found for "${query}".`
      const found = results[0]
      if (found.uri.startsWith('spotify:track:')) uris = [found.uri]
      else contextUri = found.uri
    }
  }

  await ensureDevice()

  const body: Record<string, unknown> = {}
  if (contextUri) body.context_uri = contextUri
  if (uris) body.uris = uris
  const bodyStr = JSON.stringify(body)

  const res = await spotifyFetch('/me/player/play', { method: 'PUT', body: bodyStr })

  if (res.status === 204) {
    setTimeout(() => { void currentTrack().catch(() => {}) }, 800)
    return label ? `Now playing: "${label}".` : 'Playback resumed.'
  }
  if (res.status === 403) return 'Playback requires Spotify Premium.'
  if (res.status === 404) return 'No Spotify device available — open Spotify on any device and try again.'
  return `Spotify play error: ${res.status}`
}

async function myPlaylistsHandler(): Promise<string> {
  const playlists = await myPlaylists()
  if (playlists.length === 0) return 'No playlists found in your Spotify library.'
  return playlists.map((p, i) => `[${i + 1}] ${p.name}\n  URI: ${p.uri}`).join('\n\n')
}

async function simpleAction(endpoint: string, method: 'PUT' | 'POST', successMsg: string): Promise<string> {
  const res = await spotifyFetch(endpoint, { method })
  if (res.status === 204 || res.status === 200) {
    // Emit updated playback state after a brief delay for the Spotify API to settle
    setTimeout(() => { void currentTrack().catch(() => {}) }, 600)
    return successMsg
  }
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

export async function handleSpotifyTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'spotify_auth':         return await authHandler()
      case 'spotify_current':      return await currentTrack()
      case 'spotify_play':         return await playHandler(input)
      case 'spotify_pause':        return await simpleAction('/me/player/pause', 'PUT', 'Playback paused.')
      case 'spotify_next':         return await simpleAction('/me/player/next', 'POST', 'Skipped to next track.')
      case 'spotify_prev':         return await simpleAction('/me/player/previous', 'POST', 'Went to previous track.')
      case 'spotify_volume':       return await volumeHandler(Number(input.volume))
      case 'spotify_search':       return await searchHandler(String(input.query ?? ''), String(input.type ?? 'track'), Number(input.limit ?? 5))
      case 'spotify_my_playlists': return await myPlaylistsHandler()
      case 'spotify_queue':        return await queueHandler(input)
      default: throw new Error(`Unknown spotify tool: ${name}`)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not connected') || msg.includes('authenticate')) return msg
    if (msg.includes('token refresh failed')) return 'Spotify session expired — say "connect Spotify" to re-authenticate.'
    throw err
  }
}
