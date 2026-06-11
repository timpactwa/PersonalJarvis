import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/logger-test.db'

function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held briefly */ } }
}

describe('logger module', () => {
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

  it('logApiCall delegates to db and getStatsToday reflects the logged call', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { logApiCall, getStatsToday } = await import('../../../src/backend/memory/logger')
    initDb()
    await logApiCall({ model: 'claude-haiku-4-5-20251001', inputTokens: 50, outputTokens: 50 })
    const stats = getStatsToday()
    expect(stats.tokens).toBe(100)
    expect(stats.cost).toBeGreaterThan(0)
  })

  it('getStatsToday returns zero tokens and cost when db is not initialized', async () => {
    const { getStatsToday } = await import('../../../src/backend/memory/logger')
    const stats = getStatsToday()
    expect(stats.tokens).toBe(0)
    expect(stats.cost).toBe(0)
  })
})
