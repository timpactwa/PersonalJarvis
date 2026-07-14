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

  // Regression test: a cluster of 4+ mutually near-duplicate rows where the
  // first pairing's winner (rows[i]) is later dethroned mid-sweep by a much
  // higher-salience row further down the list. Without breaking out of the
  // inner loop when `rows[i]` itself becomes the loser, the sweep keeps
  // comparing the now-deleted `rows[i]` object against the rest of the
  // cluster — which can silently drop a still-valid row's content
  // (mergeMemory targeting a dead id, then deleteMemory on a row that was
  // never folded anywhere) and resurrect a phantom index entry for a
  // row no longer in the db.
  it('handles a keeper flip mid-sweep without losing rows or desyncing the index', async () => {
    const { initDb, insertMemory, getAllMemories, getDb } = await import('../../../src/backend/memory/db')
    const { initRecallIndex, indexSize } = await import('../../../src/backend/memory/recall')
    const { consolidateOnce } = await import('../../../src/backend/memory/consolidate')
    initDb()

    // Four mutually near-duplicate vectors (pairwise cosine > 0.99).
    const idX = insertMemory('coffee', new Float32Array([1, 0, 0]))
    const idY = insertMemory('coffee too', new Float32Array([1, 0.001, 0]))
    const idZ = insertMemory('coffee also', new Float32Array([1, 0.002, 0]))
    const idW = insertMemory('coffee as well', new Float32Array([1, 0.003, 0]))

    // Force explicit timestamps/salience so X sorts newest (rows[0]) but Z
    // — sorted later by timestamp — carries far higher salience, so Z wins
    // the keeper role away from X partway through the sweep. W is oldest
    // and lowest-salience, ensuring the sweep still has a row left to
    // process after the flip.
    const db = getDb()
    db.prepare('UPDATE memories SET timestamp = ?, salience = ? WHERE id = ?').run(4000, 1, idX)
    db.prepare('UPDATE memories SET timestamp = ?, salience = ? WHERE id = ?').run(3000, 1, idY)
    db.prepare('UPDATE memories SET timestamp = ?, salience = ? WHERE id = ?').run(1000, 10, idZ)
    db.prepare('UPDATE memories SET timestamp = ?, salience = ? WHERE id = ?').run(500, 1, idW)

    initRecallIndex()
    const { merged } = consolidateOnce(0.9)

    expect(merged).toBe(3)                    // all 4 collapse into 1 survivor
    const remaining = getAllMemories()
    expect(remaining.length).toBe(1)           // no row silently lost
    expect(remaining[0].salience).toBeCloseTo(13, 5)  // 1+1+10+1, nothing dropped
    expect(indexSize()).toBe(remaining.length)  // no phantom index entries
  })
})
