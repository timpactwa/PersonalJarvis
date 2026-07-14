import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import {
  clearIndex, indexMemory, unindexMemory, indexSize, recall, nearestExisting,
  type IndexedMemory, type MemoryType,
} from '../../../src/backend/memory/recall'

function mem(id: number, embedding: number[], over: Partial<IndexedMemory> = {}): IndexedMemory {
  return {
    id, text: `mem ${id}`, embedding: new Float32Array(embedding),
    timestamp: Date.now(), type: 'fact' as MemoryType, salience: 1, lastAccessed: 0, accessCount: 0,
    ...over,
  }
}

describe('recall', () => {
  beforeEach(() => clearIndex())

  it('indexes and unindexes memories', () => {
    indexMemory(mem(1, [1, 0, 0]))
    indexMemory(mem(2, [0, 1, 0]))
    expect(indexSize()).toBe(2)
    unindexMemory(1)
    expect(indexSize()).toBe(1)
  })

  it('drops hits below the relevance floor', () => {
    indexMemory(mem(1, [1, 0, 0]))   // cosine 1.0 with query
    indexMemory(mem(2, [0, 1, 0]))   // cosine 0.0 with query — below floor
    const hits = recall(new Float32Array([1, 0, 0]), { floor: 0.35 })
    expect(hits.map(h => h.id)).toEqual([1])
  })

  it('returns nothing (not 3 noise) when no memory clears the floor', () => {
    indexMemory(mem(1, [0, 1, 0]))
    indexMemory(mem(2, [0, 0, 1]))
    expect(recall(new Float32Array([1, 0, 0]), { floor: 0.35 })).toEqual([])
  })

  it('returns more than 3 when many clear the floor (dynamic K)', () => {
    for (let i = 1; i <= 5; i++) indexMemory(mem(i, [1, 0.05 * i, 0]))
    expect(recall(new Float32Array([1, 0, 0]), { floor: 0.3, maxK: 6 }).length).toBe(5)
  })

  it('caps results at maxK', () => {
    for (let i = 1; i <= 10; i++) indexMemory(mem(i, [1, 0.01 * i, 0]))
    expect(recall(new Float32Array([1, 0, 0]), { floor: 0.3, maxK: 6 }).length).toBe(6)
  })

  it('breaks a cosine near-tie in favor of higher salience', () => {
    indexMemory(mem(1, [1, 0, 0], { salience: 1 }))
    indexMemory(mem(2, [1, 0, 0], { salience: 3 }))
    expect(recall(new Float32Array([1, 0, 0]))[0].id).toBe(2)
  })

  it('breaks a cosine tie in favor of the more recent memory', () => {
    const old = Date.now() - 400 * 86_400_000
    indexMemory(mem(1, [1, 0, 0], { timestamp: old, lastAccessed: 0 }))
    indexMemory(mem(2, [1, 0, 0], { timestamp: Date.now() }))
    expect(recall(new Float32Array([1, 0, 0]), { halfLifeMs: 90 * 86_400_000 })[0].id).toBe(2)
  })

  it('nearestExisting returns the closest memory and its cosine', () => {
    indexMemory(mem(1, [1, 0, 0]))
    indexMemory(mem(2, [0, 1, 0]))
    const near = nearestExisting(new Float32Array([0.9, 0.1, 0]))
    expect(near?.id).toBe(1)
    expect(near?.score).toBeGreaterThan(0.9)
  })

  it('filters on raw cosine, not weighted score: excludes memory whose raw cosine is below floor despite high salience', () => {
    // Memory with embedding [0.2, 1, 0] vs query [1, 0, 0] gives cosine ≈ 0.196 (below default floor 0.35)
    // But with salience: 5, weighted score ≈ 0.196 * (1 + 4) ≈ 0.98 (above floor)
    // This verifies the filter uses raw cosine, not weighted score.
    indexMemory(mem(1, [0.2, 1, 0], { salience: 5 }))
    const hits = recall(new Float32Array([1, 0, 0]), { floor: 0.35 })
    expect(hits.map(h => h.id)).toEqual([])
  })
})

describe('recall integration (db-backed)', () => {
  const TEST_DB = 'tests/recall-test.db'
  function cleanup(): void { if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held on Windows */ } } }

  // `recall.ts` is statically imported at the top of this file, which
  // transitively loads `db.ts` and freezes its module-level DB_PATH constant
  // BEFORE this beforeEach ever runs. Without vi.resetModules(), setting
  // process.env.JARVIS_DB_PATH here would have no effect and this "isolated"
  // test would silently read/write the real project jarvis.db. Reset the
  // module registry so the dynamic imports below re-evaluate db.ts against
  // the freshly-set env var.
  beforeEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    process.env.JARVIS_DB_PATH = TEST_DB
    vi.resetModules()
    cleanup()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  it('recalls a memory written beyond the old 100-row window', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { saveMemory, initRecallIndex, recall } = await import('../../../src/backend/memory/recall')
    initDb()
    // The distinctive memory is written FIRST, then buried under 120 newer ones.
    saveMemory('the vault code is 4815', new Float32Array([1, 0, 0]))
    for (let i = 0; i < 120; i++) saveMemory(`filler ${i}`, new Float32Array([0, 1, 0]))
    initRecallIndex()  // reload from db as it would at startup
    const hits = recall(new Float32Array([1, 0, 0]), { floor: 0.35 })
    expect(hits.some(h => h.text.includes('4815'))).toBe(true)
  })

  it('saveMemory merges into a near-duplicate instead of inserting a new row', async () => {
    const { initDb, getAllMemories } = await import('../../../src/backend/memory/db')
    const { saveMemory, initRecallIndex } = await import('../../../src/backend/memory/recall')
    initDb()
    initRecallIndex()

    const id1 = saveMemory('User likes espresso in the morning', new Float32Array([1, 0, 0]))
    const id2 = saveMemory('User likes espresso in the mornings', new Float32Array([1, 0.001, 0]))  // ~identical
    expect(id2).toBe(id1)                    // merged, same row
    expect(getAllMemories().length).toBe(1)  // no duplicate row
  })
})
