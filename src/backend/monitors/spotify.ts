import { getSettings } from '../memory/settings'
import { getAccessToken } from '../tools/spotify'
import type { EnqueueFn, RegisterFn } from './index'

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

  let stoppedCount = 0
  let prevDeviceId: string | null = null

  const poll = async (): Promise<void> => {
    if (!getSettings().monitorSpotify) return
    try {
      let token: string
      try {
        token = await getAccessToken()
      } catch {
        return  // Spotify not configured or auth failed, skip silently
      }
      const state = await fetchPlayback(token)
      if (!state) {
        stoppedCount = 0
        return
      }

      const device = state.device
      const currentDeviceId = device?.id ?? null
      if (device && device.type !== 'Computer' && currentDeviceId !== prevDeviceId) {
        const devAlertId = `spotify:device:${device.id}:${Date.now()}`
        enqueue({ id: devAlertId, text: `Spotify switched to ${device.name}.`, priority: 'normal', source: 'spotify' })
      }
      prevDeviceId = currentDeviceId

      if (!state.is_playing) {
        stoppedCount++
        if (stoppedCount === 2) {
          const stoppedAlertId = `spotify:stopped:${Date.now()}`
          enqueue({ id: stoppedAlertId, text: 'Music stopped. Want me to queue something?', priority: 'normal', source: 'spotify' })
        }
      } else {
        stoppedCount = 0
      }
    } catch (err) {
      console.error('[monitor:spotify] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 10_000)
  register(() => clearInterval(timer))
}
