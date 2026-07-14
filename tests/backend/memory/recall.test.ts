import { describe, it, expect, beforeEach } from 'vitest'
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
})
