import { cosineSimilarity } from './embeddings'
import { getAllMemories, insertMemory, deleteMemory, bumpMemoryAccess } from './db'

export type MemoryType = 'fact' | 'preference' | 'decision' | 'event' | 'contact'

export interface IndexedMemory {
  id: number
  text: string
  embedding: Float32Array
  timestamp: number
  type: MemoryType
  salience: number
  lastAccessed: number
  accessCount: number
}

export interface RecallHit {
  id: number
  text: string
  type: MemoryType
  score: number
  timestamp: number
  lastAccessed: number
}

export interface RecallOpts {
  floor?: number
  maxK?: number
  halfLifeMs?: number
}

const DAY = 86_400_000
const DEFAULT_FLOOR = 0.35
const DEFAULT_MAX_K = 6
const DEFAULT_HALF_LIFE = 90 * DAY
export const DEDUP_THRESHOLD = 0.9

let index: IndexedMemory[] = []

/** Load the full memories table into memory once at startup. */
export function initRecallIndex(): void {
  try {
    index = getAllMemories().map(m => ({
      id: m.id,
      text: m.text,
      embedding: m.embedding,
      timestamp: m.timestamp,
      type: (m.type as MemoryType) ?? 'fact',
      salience: m.salience ?? 1,
      lastAccessed: m.lastAccessed ?? 0,
      accessCount: m.accessCount ?? 0,
    }))
    console.error(`[recall] index loaded: ${index.length} memories`)
  } catch (err) {
    console.error('[recall] index load failed — continuing empty:', err instanceof Error ? err.message : err)
    index = []
  }
}

export function indexMemory(m: IndexedMemory): void {
  const i = index.findIndex(x => x.id === m.id)
  if (i >= 0) index[i] = m
  else index.push(m)
}

export function unindexMemory(id: number): void {
  index = index.filter(m => m.id !== id)
}

export function indexSize(): number {
  return index.length
}

/** Test helper — reset the in-memory index. */
export function clearIndex(): void {
  index = []
}

function recencyDecay(effectiveTs: number, now: number, halfLifeMs: number): number {
  const age = Math.max(0, now - effectiveTs)
  return Math.pow(0.5, age / halfLifeMs)
}

export function recall(queryVec: Float32Array, opts: RecallOpts = {}): RecallHit[] {
  const floor = opts.floor ?? DEFAULT_FLOOR
  const maxK = opts.maxK ?? DEFAULT_MAX_K
  const halfLifeMs = opts.halfLifeMs ?? DEFAULT_HALF_LIFE
  const now = Date.now()

  const ranked = index
    .map(m => {
      const cos = cosineSimilarity(queryVec, m.embedding)
      const effectiveTs = Math.max(m.timestamp, m.lastAccessed)
      const salienceBoost = Math.max(0, m.salience - 1)     // salience 1.0 => no boost
      const score = cos * (1 + salienceBoost) * recencyDecay(effectiveTs, now, halfLifeMs)
      return { m, cos, score }
    })
    .filter(r => r.cos >= floor)                            // floor on raw relevance, not weighted score
    .sort((a, b) => b.score - a.score)
    .slice(0, maxK)

  // Salience-on-access: bump in-memory immediately, persist best-effort.
  for (const r of ranked) {
    r.m.lastAccessed = now
    r.m.accessCount += 1
  }
  bumpMemoryAccess(ranked.map(r => r.m.id), now)

  return ranked.map(r => ({
    id: r.m.id, text: r.m.text, type: r.m.type,
    score: r.score, timestamp: r.m.timestamp, lastAccessed: r.m.lastAccessed,
  }))
}

export function nearestExisting(queryVec: Float32Array): { id: number; score: number } | null {
  let best: { id: number; score: number } | null = null
  for (const m of index) {
    const cos = cosineSimilarity(queryVec, m.embedding)
    if (!best || cos > best.score) best = { id: m.id, score: cos }
  }
  return best
}

/** Persist a memory AND keep the in-memory index in sync. Stage 1: no dedup. */
export function saveMemory(
  text: string,
  embedding: Float32Array,
  opts: { type?: MemoryType; source?: string } = {},
): number {
  const type = opts.type ?? 'fact'
  const id = insertMemory(text, embedding, type, opts.source ?? 'explicit')
  if (id > 0) {
    indexMemory({ id, text, embedding, timestamp: Date.now(), type, salience: 1, lastAccessed: 0, accessCount: 0 })
  }
  return id
}

export function forgetMemory(id: number): void {
  deleteMemory(id)
  unindexMemory(id)
}
