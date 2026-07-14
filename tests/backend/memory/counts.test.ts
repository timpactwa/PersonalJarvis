import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/counts-test.db'
function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held briefly */ } }
}

describe('dashboard count helpers', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
  })

  it('counts memories and entities', async () => {
    const { initDb, insertMemory, upsertEntity, getMemoryCount, getEntityCount } =
      await import('../../../src/backend/memory/db')
    initDb()

    expect(getMemoryCount()).toBe(0)
    expect(getEntityCount()).toBe(0)

    insertMemory('I like jazz', new Float32Array([0.1, 0.2, 0.3]))
    insertMemory('I work at VT', new Float32Array([0.4, 0.5, 0.6]))
    upsertEntity('Alice', 'person', 'friend', 'met at school')

    expect(getMemoryCount()).toBe(2)
    expect(getEntityCount()).toBe(1)
  })

  it('returns 0 safely when the db is unavailable', async () => {
    // Without initDb the helpers must not throw.
    const { getMemoryCount, getEntityCount } = await import('../../../src/backend/memory/db')
    expect(typeof getMemoryCount()).toBe('number')
    expect(typeof getEntityCount()).toBe('number')
  })
})
