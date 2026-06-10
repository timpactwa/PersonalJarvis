import { describe, it, expect } from 'vitest'

describe('embeddings module', () => {
  it('exports embed and findTopK functions', async () => {
    const mod = await import('../../../src/backend/memory/embeddings')
    expect(typeof mod.embed).toBe('function')
    expect(typeof mod.findTopK).toBe('function')
  })

  it('findTopK returns empty array when no memories', async () => {
    const { findTopK } = await import('../../../src/backend/memory/embeddings')
    const queryVec = new Float32Array(384).fill(0.1)
    const result = findTopK(queryVec, [], 3)
    expect(result).toEqual([])
  })

  it('findTopK returns top K by cosine similarity', async () => {
    const { findTopK } = await import('../../../src/backend/memory/embeddings')
    const memories = [
      { id: 1, text: 'a', embedding: new Float32Array(4).fill(1) },
      { id: 2, text: 'b', embedding: new Float32Array(4).fill(0) },
      { id: 3, text: 'c', embedding: new Float32Array([1, 0, 0, 0]) },
    ]
    const query = new Float32Array(4).fill(1)
    const result = findTopK(query, memories, 1)
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('a')
    expect(result[0].score).toBeCloseTo(1, 5)
  })
})
