import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/consolidate-test.db'
function cleanup(): void { if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held */ } } }

describe('consolidateOnce', () => {
  // `db.ts` freezes its module-level DB_PATH constant from process.env.JARVIS_DB_PATH
  // the first time it is imported. Without vi.resetModules(), setting the env var here
  // would have no effect and this "isolated" test would silently read/write the real
  // project jarvis.db. Reset the module registry so every dynamic import below
  // re-evaluates db.ts (and recall.ts / consolidate.ts, which import it) against the
  // freshly-set env var. Mirrors the pattern in tests/backend/memory/recall.test.ts's
  // "recall integration (db-backed)" block.
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    vi.resetModules()
    const { closeDb } = await import('../../../src/backend/memory/db')
    const { clearIndex } = await import('../../../src/backend/memory/recall')
    closeDb(); cleanup(); clearIndex()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
  })

  it('merges a near-duplicate pair and removes one row', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    const { initRecallIndex } = await import('../../../src/backend/memory/recall')
    const { consolidateOnce } = await import('../../../src/backend/memory/consolidate')
    initDb()
    // Two near-identical vectors inserted directly (bypassing insert-time dedup).
    insertMemory('user likes espresso', new Float32Array([1, 0, 0]))
    insertMemory('user likes espresso a lot', new Float32Array([1, 0.001, 0]))
    insertMemory('user lives in Denver', new Float32Array([0, 1, 0]))
    initRecallIndex()
    const { merged } = consolidateOnce(0.9)
    expect(merged).toBe(1)
    expect(getAllMemories().length).toBe(2)
  })

  it('is a no-op when nothing is similar enough', async () => {
    const { initDb, insertMemory } = await import('../../../src/backend/memory/db')
    const { initRecallIndex } = await import('../../../src/backend/memory/recall')
    const { consolidateOnce } = await import('../../../src/backend/memory/consolidate')
    initDb()
    insertMemory('a', new Float32Array([1, 0, 0]))
    insertMemory('b', new Float32Array([0, 1, 0]))
    initRecallIndex()
    expect(consolidateOnce(0.9).merged).toBe(0)
  })
})
