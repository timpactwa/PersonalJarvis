import { getDb } from './db'
import type { Settings } from '../types'

const DEFAULTS: Settings = {
  hotkey: 'Alt+Space',
  voiceId: process.env.ELEVENLABS_VOICE_ID ?? 'pqHfZKP75CvOlQylNhV4',
  modelPreference: 'auto',
  shortTurns: 20,
}

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map(r => [r.key, r.value]))
  return {
    hotkey: map.get('hotkey') ?? DEFAULTS.hotkey,
    voiceId: map.get('voiceId') ?? DEFAULTS.voiceId,
    modelPreference: (map.get('modelPreference') as Settings['modelPreference']) ?? DEFAULTS.modelPreference,
    shortTurns: map.has('shortTurns') ? parseInt(map.get('shortTurns')!, 10) : DEFAULTS.shortTurns,
  }
}

export function setSettings(partial: Partial<Settings>): Settings {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) stmt.run(k, String(v))
  }
  return getSettings()
}
