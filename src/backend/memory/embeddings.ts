import { pipeline } from '@xenova/transformers'
import { join } from 'path'

// Cache model in resources/ directory
const MODEL_CACHE = join(process.cwd(), 'resources')

let embedder: Awaited<ReturnType<typeof pipeline>> | null = null

async function getEmbedder(): Promise<Awaited<ReturnType<typeof pipeline>>> {
  if (!embedder) {
    console.log('[embeddings] loading model (first run downloads ~80MB)...')
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      cache_dir: MODEL_CACHE,
    })
    console.log('[embeddings] model ready')
  }
  return embedder
}

export async function embed(text: string): Promise<Float32Array> {
  const model = await getEmbedder()
  const output = await (model as any)(text, { pooling: 'mean', normalize: true })
  return output.data as Float32Array
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

export function findTopK(
  query: Float32Array,
  memories: Array<{ id: number; text: string; embedding: Float32Array }>,
  k: number,
): Array<{ id: number; text: string; score: number }> {
  return memories
    .map(m => ({ id: m.id, text: m.text, score: cosineSimilarity(query, m.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
