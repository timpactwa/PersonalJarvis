import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/settings-test.db'

function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held briefly on Windows */ } }
}

describe('settings store', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  it('returns defaults when nothing is stored', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { getSettings } = await import('../../../src/backend/memory/settings')
    initDb()
    const s = getSettings()
    expect(s.hotkey).toBe('Alt+Space')
    expect(s.modelPreference).toBe('auto')
    expect(s.shortTurns).toBe(20)
  })

  it('persists and merges partial updates', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setSettings, getSettings } = await import('../../../src/backend/memory/settings')
    initDb()
    setSettings({ hotkey: 'Control+Space', modelPreference: 'fable' })
    const s = getSettings()
    expect(s.hotkey).toBe('Control+Space')
    expect(s.modelPreference).toBe('fable')
    expect(s.shortTurns).toBe(20) // untouched default
  })

  it('coerces numeric shortTurns from stored string', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setSettings, getSettings } = await import('../../../src/backend/memory/settings')
    initDb()
    setSettings({ shortTurns: 8 })
    expect(getSettings().shortTurns).toBe(8)
  })
})
