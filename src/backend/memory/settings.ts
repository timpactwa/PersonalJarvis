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

  const rawPref = map.get('modelPreference')
  const modelPreference: Settings['modelPreference'] =
    rawPref === 'fable' || rawPref === 'haiku' || rawPref === 'auto' ? rawPref : DEFAULTS.modelPreference

  const rawTurns = map.has('shortTurns') ? parseInt(map.get('shortTurns')!, 10) : DEFAULTS.shortTurns
  const shortTurns = Number.isFinite(rawTurns) ? rawTurns : DEFAULTS.shortTurns

  return {
    hotkey: map.get('hotkey') ?? DEFAULTS.hotkey,
    voiceId: map.get('voiceId') ?? DEFAULTS.voiceId,
    modelPreference,
    shortTurns,
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
