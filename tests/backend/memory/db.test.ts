import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/test.db'

function cleanup(): void {
  if (existsSync(TEST_DB)) {
    try { unlinkSync(TEST_DB) } catch { /* handle may be held briefly on Windows */ }
  }
}

describe('database', () => {
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

  it('initializes schema without error', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    expect(() => initDb()).not.toThrow()
  })

  it('can insert and retrieve a memory', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    insertMemory('User prefers morning meetings', new Float32Array([0.1, 0.2, 0.3]))
    const rows = getAllMemories()
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('User prefers morning meetings')
    expect(rows[0].embedding.length).toBe(3)
  })

  it('logs api calls and aggregates daily stats', async () => {
    const { initDb, logApiCall, getStatsToday } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'claude-fable-5', inputTokens: 100, outputTokens: 50 })
    const stats = getStatsToday()
    expect(stats.tokens).toBe(150)
    expect(stats.cost).toBeGreaterThan(0)
  })

  it('logs local ollama calls at zero cost', async () => {
    const { initDb, logApiCall, getStatsToday } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'ollama:llama3.1:8b', inputTokens: 500, outputTokens: 500 })
    const stats = getStatsToday()
    expect(stats.tokens).toBe(1000)
    expect(stats.cost).toBe(0)
  })
})
