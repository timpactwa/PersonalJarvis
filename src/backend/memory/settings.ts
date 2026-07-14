import { getDb, isDbAvailable } from './db'
import type { LlmProvider, Settings } from '../types'

const DEFAULTS: Settings = {
  hotkey: 'Alt+Space',
  screenshotHotkey: 'Alt+Shift+S',
  voiceId: process.env.ELEVENLABS_VOICE_ID ?? 'pqHfZKP75CvOlQylNhV4',
  llmProvider: 'auto',
  modelPreference: 'auto',
  shortTurns: 20,
  ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.1:8b',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  userProfile: '',
  spotifyAccessToken: '',
  spotifyExpiresAt: 0,
  spotifyRefreshToken: '',
  quietMode: false,
  monitorCalendar: true,
  monitorEmail: true,
  monitorSpotify: true,
  monitorSystem: true,
  monitorCustom: true,
}

let _settingsCache: Settings | null = null
let _settingsCacheExpiry = 0

export function getSettings(): Settings {
  if (_settingsCache && Date.now() < _settingsCacheExpiry) return _settingsCache
  if (!isDbAvailable()) return { ...DEFAULTS }

  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map(r => [r.key, r.value]))

  const rawProvider = map.get('llmProvider')
  const llmProvider: LlmProvider =
    rawProvider === 'auto' || rawProvider === 'claude' || rawProvider === 'groq' || rawProvider === 'ollama'
      ? rawProvider
      : DEFAULTS.llmProvider

  const rawPref = map.get('modelPreference')
  const modelPreference: Settings['modelPreference'] =
    rawPref === 'fable' || rawPref === 'haiku' || rawPref === 'auto' ? rawPref : DEFAULTS.modelPreference

  const rawTurns = map.has('shortTurns') ? parseInt(map.get('shortTurns')!, 10) : DEFAULTS.shortTurns
  const shortTurns = Number.isFinite(rawTurns) ? rawTurns : DEFAULTS.shortTurns

  const result: Settings = {
    hotkey: map.get('hotkey') ?? DEFAULTS.hotkey,
    screenshotHotkey: map.get('screenshotHotkey') ?? DEFAULTS.screenshotHotkey,
    voiceId: map.get('voiceId') ?? DEFAULTS.voiceId,
    llmProvider,
    modelPreference,
    shortTurns,
    ollamaModel: map.get('ollamaModel') ?? DEFAULTS.ollamaModel,
    ollamaBaseUrl: map.get('ollamaBaseUrl') ?? DEFAULTS.ollamaBaseUrl,
    userProfile: map.get('userProfile') ?? DEFAULTS.userProfile,
    spotifyAccessToken: map.get('spotifyAccessToken') ?? DEFAULTS.spotifyAccessToken,
    spotifyExpiresAt: map.has('spotifyExpiresAt') ? Number(map.get('spotifyExpiresAt')) : DEFAULTS.spotifyExpiresAt,
    spotifyRefreshToken: map.get('spotifyRefreshToken') ?? DEFAULTS.spotifyRefreshToken,
    quietMode: map.has('quietMode') ? map.get('quietMode') === 'true' : DEFAULTS.quietMode,
    monitorCalendar: map.has('monitorCalendar') ? map.get('monitorCalendar') === 'true' : DEFAULTS.monitorCalendar,
    monitorEmail:    map.has('monitorEmail')    ? map.get('monitorEmail')    === 'true' : DEFAULTS.monitorEmail,
    monitorSpotify:  map.has('monitorSpotify')  ? map.get('monitorSpotify')  === 'true' : DEFAULTS.monitorSpotify,
    monitorSystem:   map.has('monitorSystem')   ? map.get('monitorSystem')   === 'true' : DEFAULTS.monitorSystem,
    monitorCustom:   map.has('monitorCustom')   ? map.get('monitorCustom')   === 'true' : DEFAULTS.monitorCustom,
  }

  _settingsCache = result
  _settingsCacheExpiry = Date.now() + 5000
  return _settingsCache
}

export function setSettings(partial: Partial<Settings>): Settings {
  _settingsCache = null  // invalidate on write
  if (!isDbAvailable()) return { ...DEFAULTS, ...partial }

  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) stmt.run(k, String(v))
  }
  return getSettings()
}
