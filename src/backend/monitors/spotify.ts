import { getSettings } from '../memory/settings'
import type { Alert, EnqueueFn, RegisterFn } from './index'

interface SpotifyPlaybackState {
  is_playing: boolean
  item?: { id: string; name: string } | null
  device?: { id: string; name: string; type: string } | null
}

async function fetchPlayback(token: string): Promise<SpotifyPlaybackState | null> {
  if (!token) return null
  const res = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 204 || res.status === 401 || res.status === 403) return null
  if (!res.ok) return null
  return res.json() as Promise<SpotifyPlaybackState>
}

export function startSpotifyMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  if (!getSettings().monitorSpotify) return

  let prevIsPlaying = false
  let stoppedCount = 0
  const seenDevices = new Set<string>()

  const poll = async (): Promise<void> => {
    if (!getSettings().monitorSpotify) return
    try {
      const token = getSettings().spotifyAccessToken
      const state = await fetchPlayback(token)
      if (!state) {
        prevIsPlaying = false
        stoppedCount = 0
        return
      }

      // Track change to non-Computer device
      const device = state.device
      if (device && device.type !== 'Computer') {
        const devAlertId = `spotify:device:${device.id}`
        if (!seenDevices.has(devAlertId)) {
          seenDevices.add(devAlertId)
          enqueue({ id: devAlertId, text: `Spotify switched to ${device.name}.`, priority: 'normal', source: 'spotify' })
        }
      }

      // Playback stopped detection (2 consecutive stopped polls)
      if (!state.is_playing && prevIsPlaying) {
        stoppedCount++
        if (stoppedCount >= 2) {
          const trackId = state.item?.id ?? 'unknown'
          enqueue({ id: `spotify:stopped:${trackId}`, text: 'Music stopped. Want me to queue something?', priority: 'normal', source: 'spotify' })
          stoppedCount = 0
        }
      } else if (state.is_playing) {
        stoppedCount = 0
      }

      prevIsPlaying = state.is_playing
    } catch (err) {
      console.error('[monitor:spotify] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 10_000)
  register(() => clearInterval(timer))
}
