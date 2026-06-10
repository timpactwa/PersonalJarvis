import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/usage-test.db'
function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held briefly */ } }
}

describe('usage aggregation', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
  })

  it('aggregates daily usage and usage by model', async () => {
    const { initDb, logApiCall, getUsageDaily, getUsageByModel } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'claude-fable-5', inputTokens: 100, outputTokens: 100 })
    logApiCall({ model: 'claude-haiku-4-5-20251001', inputTokens: 50, outputTokens: 50 })
    const daily = getUsageDaily(7)
    expect(daily.length).toBeGreaterThanOrEqual(1)
    expect(daily.reduce((a, d) => a + d.tokens, 0)).toBe(300)
    const byModel = getUsageByModel(7)
    expect(byModel.map(m => m.model)).toContain('claude-fable-5')
    expect(byModel.map(m => m.model)).toContain('claude-haiku-4-5-20251001')
  })
})
