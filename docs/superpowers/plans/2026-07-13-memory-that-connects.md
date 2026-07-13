# Memory That Connects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Jarvis long-term memory that recalls across the user's whole history, ranks by relevance (not recency), and weaves recalled context into conversation with natural attribution.

**Architecture:** Extract recall out of the inline `index.ts` pipeline into a dedicated `memory/recall.ts` that owns an in-memory embedding index loaded once at startup. `db.ts` stays pure persistence; `recall.ts` imports `db.ts` (no cycle). Stage 1 fixes the retrieval engine (kill the 100-row cap, relevance floor, dynamic K, recency/salience weighting, off the DB hot path). Stage 2 adds dedup-on-insert, typed/attributed recall, richer auto-extraction, and a batched consolidation pass.

**Tech Stack:** TypeScript, Electron utility-process backend, better-sqlite3, `@xenova/transformers` (MiniLM-L6-v2, 384-dim normalized embeddings), Vitest under Electron.

## Global Constraints

- **Test runner:** run tests with `npm test` (Electron ABI). Bare `npx vitest run` fails on the native `better-sqlite3` addon.
- **Build green before "done":** `npm run build:backend` (backend bundle) must compile with no TS errors; `npm run build` for a full check.
- **Test DB pattern:** set `process.env.JARVIS_DB_PATH` to a temp path, `closeDb()` + unlink in `beforeEach`/`afterEach` (see existing `tests/backend/memory/db.test.ts`).
- **Do not break existing db tests:** `getAllMemories()` must keep returning `embedding` (there is a byteOffset round-trip regression test). Extend it; do not remove fields.
- **Embeddings are 384-dim, mean-pooled, L2-normalized.** Cosine over them is in `[-1, 1]`, practically `[0, ~1]` for related text.
- **No em dashes in user-facing shipped copy** (system-prompt text the model may echo counts as borderline; prefer plain punctuation there).
- **Platform:** Windows / Electron 28. `better-sqlite3` calls are synchronous.
- **Tunable defaults (not hard constants):** relevance floor `0.35`, `MAX_K` `6`, recency half-life `~90 days`, dedup threshold `0.90`.

---

## Stage 1 — Retrieval engine (ships and is verified before Stage 2)

### Task 1: Memory schema migration + db helpers

Add the metadata columns and the read/write helpers `recall.ts` needs. Keep `getAllMemories()` backward-compatible (still returns `embedding`) but drop its 100-row cap and add the new columns.

**Files:**
- Modify: `src/backend/memory/db.ts` (schema `ALTER` block ~L95-100; `insertMemory` ~L355-363; `getAllMemories` ~L365-374; add `bumpMemoryAccess`, `mergeMemory`)
- Test: `tests/backend/memory/db.test.ts`

**Interfaces:**
- Produces:
  - `insertMemory(text: string, embedding: Float32Array, type?: string, source?: string): number` — returns new row id (`0` if db unavailable).
  - `getAllMemories(): Array<{ id: number; text: string; timestamp: number; embedding: Float32Array; type: string; salience: number; lastAccessed: number; accessCount: number }>` — no row cap.
  - `bumpMemoryAccess(ids: number[], ts: number): void`
  - `mergeMemory(id: number, text: string, ts: number, salienceBump?: number): void`

- [ ] **Step 1: Write the failing tests**

Add to `tests/backend/memory/db.test.ts` (inside the top-level `describe('database', …)`):

```ts
it('adds metadata columns with defaults for new memories', async () => {
  const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
  initDb()
  insertMemory('Likes espresso', new Float32Array([0.1, 0.2, 0.3]))
  const [m] = getAllMemories()
  expect(m.type).toBe('fact')
  expect(m.salience).toBe(1)
  expect(m.lastAccessed).toBe(0)
  expect(m.accessCount).toBe(0)
})

it('insertMemory returns the new row id and accepts type/source', async () => {
  const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
  initDb()
  const id = insertMemory("Mom's email is a@b.com", new Float32Array([0.1, 0.2, 0.3]), 'contact', 'contact-hint')
  expect(id).toBeGreaterThan(0)
  const [m] = getAllMemories()
  expect(m.id).toBe(id)
  expect(m.type).toBe('contact')
})

it('getAllMemories is no longer capped at 100 rows', async () => {
  const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
  initDb()
  for (let i = 0; i < 105; i++) insertMemory(`fact ${i}`, new Float32Array([i, 0, 0]))
  expect(getAllMemories().length).toBe(105)
})

it('bumpMemoryAccess updates last_accessed and increments access_count', async () => {
  const { initDb, insertMemory, getAllMemories, bumpMemoryAccess } = await import('../../../src/backend/memory/db')
  initDb()
  const id = insertMemory('bump me', new Float32Array([0.1, 0.2, 0.3]))
  bumpMemoryAccess([id], 1_700_000_000_000)
  const [m] = getAllMemories()
  expect(m.lastAccessed).toBe(1_700_000_000_000)
  expect(m.accessCount).toBe(1)
})

it('mergeMemory replaces text, refreshes timestamp, and raises salience', async () => {
  const { initDb, insertMemory, getAllMemories, mergeMemory } = await import('../../../src/backend/memory/db')
  initDb()
  const id = insertMemory('old vague text', new Float32Array([0.1, 0.2, 0.3]))
  mergeMemory(id, 'more specific text', 1_700_000_000_001, 0.5)
  const [m] = getAllMemories()
  expect(m.text).toBe('more specific text')
  expect(m.timestamp).toBe(1_700_000_000_001)
  expect(m.salience).toBeCloseTo(1.5)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/backend/memory/db.test.ts`
Expected: FAIL — `m.type` is undefined, `insertMemory` returns undefined, `bumpMemoryAccess`/`mergeMemory` are not exported, 105-row test returns 100.

- [ ] **Step 3: Add the migration columns**

In `src/backend/memory/db.ts`, in `initDb()` right after the existing `entities` `ALTER TABLE … email` block (~L96-97), add the memory-column migrations (same idempotent try/catch idiom):

```ts
    for (const col of [
      `ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'fact'`,
      `ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'explicit'`,
      `ALTER TABLE memories ADD COLUMN salience REAL NOT NULL DEFAULT 1.0`,
      `ALTER TABLE memories ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`,
    ]) {
      try { db.exec(col) } catch { /* column already exists */ }
    }
```

Also add the columns to the `CREATE TABLE IF NOT EXISTS memories` statement (~L45-50) so fresh DBs get them directly:

```ts
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        type TEXT NOT NULL DEFAULT 'fact',
        source TEXT NOT NULL DEFAULT 'explicit',
        salience REAL NOT NULL DEFAULT 1.0,
        last_accessed INTEGER NOT NULL DEFAULT 0,
        access_count INTEGER NOT NULL DEFAULT 0
      );
```

- [ ] **Step 4: Update `insertMemory` to take type/source and return the id**

Replace `insertMemory` (~L355-363):

```ts
export function insertMemory(
  text: string,
  embedding: Float32Array,
  type = 'fact',
  source = 'explicit',
): number {
  if (!dbAvailable) return 0
  // Serialize ONLY this view's bytes — transformers.js returns subarray views
  // into a pooled buffer; Buffer.from(embedding.buffer) would capture garbage.
  const info = getDb().prepare(`
    INSERT INTO memories (timestamp, text, embedding, type, source, salience, last_accessed, access_count)
    VALUES (?, ?, ?, ?, ?, 1.0, 0, 0)
  `).run(Date.now(), text, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength), type, source)
  return Number(info.lastInsertRowid)
}
```

- [ ] **Step 5: Update `getAllMemories` — drop the cap, return the new columns**

Replace `getAllMemories` (~L365-374):

```ts
export function getAllMemories(): Array<{
  id: number; text: string; timestamp: number; embedding: Float32Array
  type: string; salience: number; lastAccessed: number; accessCount: number
}> {
  if (!dbAvailable) return []
  const rows = getDb().prepare(
    'SELECT id, text, timestamp, embedding, type, salience, last_accessed, access_count FROM memories ORDER BY timestamp DESC',
  ).all() as Array<{
    id: number; text: string; timestamp: number; embedding: Buffer
    type: string; salience: number; last_accessed: number; access_count: number
  }>
  return rows.map(r => ({
    id: r.id,
    text: r.text,
    timestamp: r.timestamp,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4),
    type: r.type,
    salience: r.salience,
    lastAccessed: r.last_accessed,
    accessCount: r.access_count,
  }))
}
```

- [ ] **Step 6: Add `bumpMemoryAccess` and `mergeMemory`**

Add after `getMemoryCount` (~L380):

```ts
export function bumpMemoryAccess(ids: number[], ts: number): void {
  if (!dbAvailable || ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  try {
    getDb().prepare(
      `UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id IN (${placeholders})`,
    ).run(ts, ...ids)
  } catch { /* non-critical: ranking still works from in-memory bumps */ }
}

export function mergeMemory(id: number, text: string, ts: number, salienceBump = 0.25): void {
  if (!dbAvailable) return
  getDb().prepare(
    `UPDATE memories SET text = ?, timestamp = ?, salience = salience + ? WHERE id = ?`,
  ).run(text, ts, salienceBump, id)
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- tests/backend/memory/db.test.ts`
Expected: PASS (all new tests + the pre-existing byteOffset/round-trip tests still green).

- [ ] **Step 8: Commit**

```bash
git add src/backend/memory/db.ts tests/backend/memory/db.test.ts
git commit -m "feat(memory): schema metadata columns + uncapped getAllMemories + access/merge helpers"
```

---

### Task 2: `recall.ts` — in-memory index + relevance ranking

The core engine: an in-memory array of memories, cosine ranking with a relevance floor, dynamic K, and recency/salience weighting. Pure enough to unit-test by seeding the index directly.

**Files:**
- Create: `src/backend/memory/recall.ts`
- Modify: `src/backend/memory/embeddings.ts` (export `cosineSimilarity`)
- Test: `tests/backend/memory/recall.test.ts`

**Interfaces:**
- Consumes: `cosineSimilarity` (embeddings), `getAllMemories`, `insertMemory`, `deleteMemory`, `bumpMemoryAccess` (db, Task 1).
- Produces:
  - `type MemoryType = 'fact' | 'preference' | 'decision' | 'event' | 'contact'`
  - `interface IndexedMemory { id: number; text: string; embedding: Float32Array; timestamp: number; type: MemoryType; salience: number; lastAccessed: number; accessCount: number }`
  - `interface RecallHit { id: number; text: string; type: MemoryType; score: number; timestamp: number; lastAccessed: number }`
  - `interface RecallOpts { floor?: number; maxK?: number; halfLifeMs?: number }`
  - `initRecallIndex(): void`
  - `indexMemory(m: IndexedMemory): void`
  - `unindexMemory(id: number): void`
  - `indexSize(): number`
  - `clearIndex(): void` (test helper)
  - `recall(queryVec: Float32Array, opts?: RecallOpts): RecallHit[]`
  - `nearestExisting(queryVec: Float32Array): { id: number; score: number } | null`
  - `saveMemory(text: string, embedding: Float32Array, opts?: { type?: MemoryType; source?: string }): number`
  - `forgetMemory(id: number): void`
  - `const DEDUP_THRESHOLD = 0.9`

- [ ] **Step 1: Export `cosineSimilarity` from embeddings.ts**

In `src/backend/memory/embeddings.ts`, change the `cosineSimilarity` declaration (~L43) from `function cosineSimilarity` to:

```ts
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0   // guard against a stray malformed BLOB
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/backend/memory/recall.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/backend/memory/recall.test.ts`
Expected: FAIL — module `recall.ts` does not exist.

- [ ] **Step 4: Implement `recall.ts`**

Create `src/backend/memory/recall.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/backend/memory/recall.test.ts`
Expected: PASS (all 8 ranking tests).

- [ ] **Step 6: Build**

Run: `npm run build:backend`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/backend/memory/recall.ts src/backend/memory/embeddings.ts tests/backend/memory/recall.test.ts
git commit -m "feat(memory): recall.ts in-memory index with relevance floor, dynamic K, recency/salience ranking"
```

---

### Task 3: Wire `recall.ts` into the pipeline, startup, and write/delete sites

Swap the inline `getAllMemories()+findTopK(...,3)` recall for `recall(queryVec)`, load the index at startup, and route all memory writes/deletes through `saveMemory`/`forgetMemory` so the index stays in sync.

**Files:**
- Modify: `src/backend/index.ts` (imports ~L161-166; startup ~L199; write sites L878, L934, L997, L1020; recall block L947-953; delete handler L591)
- Test: `tests/backend/memory/recall.test.ts` (add a db-backed integration test)

**Interfaces:**
- Consumes: `initRecallIndex`, `recall`, `saveMemory`, `forgetMemory` (Task 2); `getAllMemories` (still used by the UI list).

- [ ] **Step 1: Write the failing integration test (cap removal end-to-end)**

Append to `tests/backend/memory/recall.test.ts`:

```ts
import { unlinkSync, existsSync } from 'fs'

describe('recall integration (db-backed)', () => {
  const TEST_DB = 'tests/recall-test.db'
  function cleanup(): void { if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held on Windows */ } } }

  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup(); clearIndex()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
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
})
```

(You need `afterEach` imported — add `afterEach` to the existing `vitest` import at the top of the file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/backend/memory/recall.test.ts`
Expected: FAIL before wiring only if `saveMemory` is not yet used end-to-end — this test actually passes against Task 2 code (saveMemory + initRecallIndex already exist). Treat it as a regression guard: run it, confirm it PASSES. If it fails, the index/db wiring in Task 2 is broken — fix before continuing.

- [ ] **Step 3: Update imports in `index.ts`**

At `src/backend/index.ts` L161, remove `insertMemory` and `deleteMemory` from the db import (keep `getAllMemories` — the UI list still uses it):

```ts
import { initDb, closeDb, isDbAvailable, getDbError, getUsageDaily, getUsageByModel, getAllMemories, getMemoryCount, getEntityCount } from './memory/db'
```

At L163, drop `findTopK` (keep `embed`):

```ts
import { embed } from './memory/embeddings'
```

Add a new import line just after L163:

```ts
import { initRecallIndex, recall, saveMemory, forgetMemory } from './memory/recall'
```

- [ ] **Step 4: Load the index at startup**

In `index.ts`, immediately after `initDb()` (L199):

```ts
initDb()
initRecallIndex()
```

- [ ] **Step 5: Replace the recall block**

Replace L947-953 (the `// Semantic memory retrieval` block):

```ts
    // Semantic memory retrieval — ranked across the FULL history (in-memory
    // index, off the DB hot path), relevance-floored and recency/salience-weighted.
    const queryVec = await embedPromise
    for (const hit of recall(queryVec)) {
      topMems.push(hit.text)
    }
```

- [ ] **Step 6: Route writes through `saveMemory`**

Replace each `insertMemory(...)` call:

L878 (bulk contacts):
```ts
        saveMemory(mem, vec, { type: 'contact', source: 'contact-hint' })
```

L934 (contact email hint):
```ts
          saveMemory(mem, vec, { type: 'contact', source: 'contact-hint' })
```

L997 (model `[REMEMBER]` pendingMemory):
```ts
      saveMemory(pendingMemory, vec)
```

L1020 (fallback `cleaned.pendingMemory`):
```ts
      saveMemory(cleaned.pendingMemory, vec)
```

- [ ] **Step 7: Route the delete handler through `forgetMemory`**

Replace L591 (`deleteMemory(event.id)`):

```ts
      forgetMemory(event.id)
```

- [ ] **Step 8: Build and run the full suite**

Run: `npm run build:backend`
Expected: no TS errors (verify `insertMemory`/`deleteMemory`/`findTopK` are no longer referenced in `index.ts`).

Run: `npm test`
Expected: full suite green.

- [ ] **Step 9: Manual smoke test**

Run: `npm run dev`. Tell Jarvis a durable fact ("remember that my locker code is 4815"). Confirm it says it saved. Then in a later turn ask "what's my locker code?" and confirm it recalls it. Restart the app and ask again — it should still recall (index reloaded from db at startup).

- [ ] **Step 10: Commit**

```bash
git add src/backend/index.ts tests/backend/memory/recall.test.ts
git commit -m "feat(memory): wire recall engine into pipeline, startup, and write/delete sites — kills 100-row cap"
```

**Stage 1 complete.** Recall now works across the full history, relevance-weighted, off the DB hot path. Verify with the smoke test before starting Stage 2.

---

## Stage 2 — Proactive weaving (on top of Stage 1)

### Task 4: Dedup-on-insert — merge near-duplicates instead of piling up rows

**Files:**
- Modify: `src/backend/memory/recall.ts` (`saveMemory`)
- Test: `tests/backend/memory/recall.test.ts`

**Interfaces:**
- Consumes: `nearestExisting`, `mergeMemory` (db, Task 1).
- Produces: `saveMemory` gains dedup — merges into the nearest memory when cosine ≥ `DEDUP_THRESHOLD`, returning that existing id.

- [ ] **Step 1: Write the failing test**

Add to the `describe('recall', …)` block in `tests/backend/memory/recall.test.ts`:

```ts
it('saveMemory merges into a near-duplicate instead of inserting a new row', async () => {
  const { unlinkSync, existsSync } = await import('fs')
  const TEST_DB = 'tests/dedup-test.db'
  process.env.JARVIS_DB_PATH = TEST_DB
  const { initDb, closeDb, getAllMemories } = await import('../../../src/backend/memory/db')
  const { saveMemory, initRecallIndex, clearIndex } = await import('../../../src/backend/memory/recall')
  closeDb(); if (existsSync(TEST_DB)) try { unlinkSync(TEST_DB) } catch { /* held */ }
  clearIndex(); initDb(); initRecallIndex()

  const id1 = saveMemory('User likes espresso in the morning', new Float32Array([1, 0, 0]))
  const id2 = saveMemory('User likes espresso in the mornings', new Float32Array([1, 0.001, 0]))  // ~identical
  expect(id2).toBe(id1)                    // merged, same row
  expect(getAllMemories().length).toBe(1)  // no duplicate row

  closeDb(); if (existsSync(TEST_DB)) try { unlinkSync(TEST_DB) } catch { /* held */ }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/backend/memory/recall.test.ts`
Expected: FAIL — `id2 !== id1` and there are 2 rows (no dedup yet).

- [ ] **Step 3: Add dedup to `saveMemory`**

In `src/backend/memory/recall.ts`, add `mergeMemory` to the db import:

```ts
import { getAllMemories, insertMemory, deleteMemory, bumpMemoryAccess, mergeMemory } from './db'
```

Replace `saveMemory`:

```ts
export function saveMemory(
  text: string,
  embedding: Float32Array,
  opts: { type?: MemoryType; source?: string } = {},
): number {
  const type = opts.type ?? 'fact'

  // Dedup: if this is nearly identical to an existing memory, merge into it
  // (refresh text/timestamp, bump salience) instead of adding a duplicate row.
  const near = nearestExisting(embedding)
  if (near && near.score >= DEDUP_THRESHOLD) {
    mergeMemory(near.id, text, Date.now())
    const existing = index.find(m => m.id === near.id)
    if (existing) {
      existing.text = text
      existing.timestamp = Date.now()
      existing.salience += 0.25
    }
    return near.id
  }

  const id = insertMemory(text, embedding, type, opts.source ?? 'explicit')
  if (id > 0) {
    indexMemory({ id, text, embedding, timestamp: Date.now(), type, salience: 1, lastAccessed: 0, accessCount: 0 })
  }
  return id
}
```

Note: `index` is the module-level array — reference it directly (it is already in scope within `recall.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/backend/memory/recall.test.ts`
Expected: PASS (dedup test + all Task 2/3 tests still green).

- [ ] **Step 5: Build and commit**

```bash
npm run build:backend
git add src/backend/memory/recall.ts tests/backend/memory/recall.test.ts
git commit -m "feat(memory): dedup-on-insert — merge near-duplicate memories (cosine >= 0.9)"
```

---

### Task 5: Attributed recall — inject memories with recency framing + weave instruction

Stop dumping bare fact-strings. Format recalled memories with light recency/type attribution so the model references them naturally, and add one system-prompt line telling Jarvis to weave recalled context in rather than reciting it.

**Files:**
- Create: `src/backend/memory/attribution.ts`
- Modify: `src/backend/index.ts` (recall block from Task 3 Step 5)
- Modify: `src/backend/claude.ts` (~L165), `src/backend/groq.ts` (~L61)
- Test: `tests/backend/memory/attribution.test.ts`

**Interfaces:**
- Consumes: `RecallHit` (recall).
- Produces: `formatRecalledMemory(hit: RecallHit, now?: number): string`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/memory/attribution.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRecalledMemory } from '../../../src/backend/memory/attribution'
import type { RecallHit } from '../../../src/backend/memory/recall'

const NOW = 1_700_000_000_000
function hit(over: Partial<RecallHit>): RecallHit {
  return { id: 1, text: 'uses VS Code', type: 'fact', score: 0.9, timestamp: NOW, lastAccessed: 0, ...over }
}

describe('formatRecalledMemory', () => {
  it('frames a recent fact with "recently"', () => {
    expect(formatRecalledMemory(hit({ timestamp: NOW - 2 * 86_400_000 }), NOW)).toBe('Recently you mentioned: uses VS Code')
  })

  it('frames an older memory with an approximate age', () => {
    const out = formatRecalledMemory(hit({ timestamp: NOW - 21 * 86_400_000 }), NOW)
    expect(out).toBe('About 3 weeks ago you mentioned: uses VS Code')
  })

  it('frames a decision with "you decided"', () => {
    const out = formatRecalledMemory(hit({ type: 'decision', text: 'to use SQLite', timestamp: NOW - 2 * 86_400_000 }), NOW)
    expect(out).toBe('Recently you decided: to use SQLite')
  })

  it('frames a preference with "you prefer"', () => {
    const out = formatRecalledMemory(hit({ type: 'preference', text: 'morning meetings', timestamp: NOW }), NOW)
    expect(out).toBe('You prefer: morning meetings')
  })

  it('leaves contact facts as plain statements', () => {
    const out = formatRecalledMemory(hit({ type: 'contact', text: "Mom's email is a@b.com", timestamp: NOW - 90 * 86_400_000 }), NOW)
    expect(out).toBe("Mom's email is a@b.com")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/backend/memory/attribution.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `attribution.ts`**

Create `src/backend/memory/attribution.ts`:

```ts
import type { RecallHit } from './recall'

const DAY = 86_400_000

function approxAge(ms: number): string {
  const days = Math.round(ms / DAY)
  if (days <= 3) return 'recent'
  if (days < 14) return `about ${days} days ago`
  if (days < 60) return `about ${Math.round(days / 7)} weeks ago`
  if (days < 365) return `about ${Math.round(days / 30)} months ago`
  return `about ${Math.round(days / 365)} years ago`
}

/** Frame a recalled memory with light provenance so the model weaves it in
 *  naturally instead of reciting a bare fact. `contact` facts stay verbatim. */
export function formatRecalledMemory(hit: RecallHit, now = Date.now()): string {
  if (hit.type === 'contact') return hit.text
  if (hit.type === 'preference') return `You prefer: ${hit.text}`

  const verb = hit.type === 'decision' ? 'decided' : 'mentioned'
  const age = approxAge(now - hit.timestamp)
  if (age === 'recent') return `Recently you ${verb}: ${hit.text}`
  const capitalized = age.charAt(0).toUpperCase() + age.slice(1)
  return `${capitalized} you ${verb}: ${hit.text}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/backend/memory/attribution.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the formatter in the pipeline**

In `src/backend/index.ts`, add to the recall import (from Task 3 Step 3):

```ts
import { initRecallIndex, recall, saveMemory, forgetMemory } from './memory/recall'
import { formatRecalledMemory } from './memory/attribution'
```

Replace the recall push loop (Task 3 Step 5):

```ts
    const queryVec = await embedPromise
    for (const hit of recall(queryVec)) {
      topMems.push(formatRecalledMemory(hit))
    }
```

- [ ] **Step 6: Add the weave instruction to the system prompts**

In `src/backend/claude.ts` (~L165), replace the `STORING FACTS` line with:

```
STORING FACTS: For general facts use [REMEMBER: fact].
USING MEMORY: Lines like "Recently you decided:" or "You prefer:" are your own recollections of this user. Weave them into your reply naturally when relevant (e.g. "last time you went with X") — do not recite them verbatim or announce that you are remembering.
```

In `src/backend/groq.ts` (~L61), replace the `STORING FACTS` line with the same two lines.

- [ ] **Step 7: Build and smoke test**

Run: `npm run build:backend`
Then `npm run dev`: state a preference ("I prefer dark mode"), then later ask something adjacent and confirm Jarvis references it naturally rather than reciting a fact-string.

- [ ] **Step 8: Commit**

```bash
git add src/backend/memory/attribution.ts tests/backend/memory/attribution.test.ts src/backend/index.ts src/backend/claude.ts src/backend/groq.ts
git commit -m "feat(memory): attributed recall — recency/type framing + weave-naturally prompt"
```

---

### Task 6: Typed memories — optional `[REMEMBER: fact | type]` tag

Let the model classify what it stores so attribution is richer (decision vs preference vs fact). Backward-compatible: a plain `[REMEMBER: fact]` still parses as `type: 'fact'`.

**Files:**
- Modify: `src/backend/responseTags.ts` (`REMEMBER_TAG_RE`, `stripResponseTags`)
- Modify: `src/backend/claude.ts` (`ChatResult` L204-212, strip destructure L364, return L368, STORING FACTS ~L165)
- Modify: `src/backend/groq.ts` (`ChatResult` L86-93, strip destructure L466, return L471, STORING FACTS ~L61)
- Modify: `src/backend/index.ts` (L997 save site — pass parsed type)
- Test: `tests/backend/responseTags.test.ts`

**Interfaces:**
- Produces:
  - `stripResponseTags(raw)` return type gains `pendingMemoryType: MemoryType | null`.
  - `ChatResult` (both `claude.ts` and `groq.ts`) gains `pendingMemoryType: MemoryType | null`.

**Why providers must change:** Claude and Groq pre-strip response tags before returning, so `result.text` reaching `index.ts` has no `[REMEMBER]` tag and the re-strip (`cleaned`) can't recover the type. The type must ride out on `ChatResult.pendingMemoryType`, or typed memory silently defaults to `fact` on every Claude/Groq turn. (Ollama uses its own inline regex and is not told to emit `| type`, so it needs no change — its memories stay `fact`.)

- [ ] **Step 1: Write the failing test**

Add to `tests/backend/responseTags.test.ts`:

```ts
it('parses an optional type from the REMEMBER tag', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const r = stripResponseTags('Sure. [REMEMBER: switched to pnpm | decision]')
  expect(r.pendingMemory).toBe('switched to pnpm')
  expect(r.pendingMemoryType).toBe('decision')
})

it('defaults REMEMBER type to fact when absent', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const r = stripResponseTags('Noted. [REMEMBER: the wifi password is hunter2]')
  expect(r.pendingMemory).toBe('the wifi password is hunter2')
  expect(r.pendingMemoryType).toBe('fact')
})

it('ignores an unknown type and falls back to fact', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const r = stripResponseTags('[REMEMBER: something | bogus]')
  expect(r.pendingMemory).toBe('something')
  expect(r.pendingMemoryType).toBe('fact')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/backend/responseTags.test.ts`
Expected: FAIL — `pendingMemoryType` is undefined; the `| decision` suffix is currently kept inside `pendingMemory`.

- [ ] **Step 3: Update `responseTags.ts`**

In `src/backend/responseTags.ts`, add an import and a valid-type set at the top:

```ts
import type { MemoryType } from './memory/recall'

const VALID_MEMORY_TYPES: ReadonlySet<string> = new Set(['fact', 'preference', 'decision', 'event', 'contact'])
```

Change the return type of `stripResponseTags` to add `pendingMemoryType: MemoryType | null`, initialize it, and parse the optional `| type` segment. Replace the `REMEMBER` handling block (~L28-34):

```ts
  let pendingMemory: string | null = null
  let pendingMemoryType: MemoryType | null = null

  const memMatch = text.match(REMEMBER_TAG_RE)
  if (memMatch) {
    const body = memMatch[1].trim()
    const pipe = body.lastIndexOf('|')
    if (pipe >= 0) {
      const candidate = body.slice(pipe + 1).trim().toLowerCase()
      if (VALID_MEMORY_TYPES.has(candidate)) {
        pendingMemoryType = candidate as MemoryType
        pendingMemory = body.slice(0, pipe).trim()
      }
    }
    if (pendingMemory === null) {
      pendingMemory = body
      pendingMemoryType = 'fact'
    }
    text = text.replace(memMatch[0], '').trim()
  }
```

Update the `return` statement to include the new field:

```ts
  return { text, pendingMemory, pendingMemoryType, pendingEntities, pendingReport }
```

Update the function's return type annotation (~L20-25) to add `pendingMemoryType: MemoryType | null`.

- [ ] **Step 4: Thread `pendingMemoryType` through the providers**

In `src/backend/claude.ts`:
- Add to the `ChatResult` interface (after `pendingMemory: string | null`, ~L209):
  ```ts
  pendingMemoryType: import('./memory/recall').MemoryType | null
  ```
- Update the strip destructure (L364):
  ```ts
  const { text, pendingMemory, pendingMemoryType, pendingEntities, pendingReport } = stripResponseTags(fullText)
  ```
- Update the return (L368):
  ```ts
  return { text: fullText, model, inputTokens, outputTokens, pendingMemory, pendingMemoryType, pendingEntities, pendingReport }
  ```

Apply the identical three changes in `src/backend/groq.ts` (`ChatResult` ~L91, strip destructure L466, return L471).

- [ ] **Step 5: Thread the type through the save site**

The model's parsed memory is returned from the provider as `pendingMemory`. In `src/backend/index.ts`, the `result` object carries provider output. At the L997 save site (from Task 3 Step 6), read the provider's `pendingMemoryType`, falling back to the re-strip then `'fact'`:

```ts
  if (pendingMemory) {
    try {
      const vec = await embed(pendingMemory)
      const memType = (result as { pendingMemoryType?: MemoryType }).pendingMemoryType
        ?? cleaned.pendingMemoryType
        ?? 'fact'
      saveMemory(pendingMemory, vec, { type: memType })
      console.log(`[memory] saved (${memType}): "${pendingMemory}"`)
    } catch (err) {
      console.error('[memory] save error:', err)
    }
  }
```

Add `MemoryType` to the recall import in `index.ts`:

```ts
import { initRecallIndex, recall, saveMemory, forgetMemory, type MemoryType } from './memory/recall'
```

(The L1020 fallback save may also pass `cleaned.pendingMemoryType ?? 'fact'`; keeping it `'fact'` is acceptable.)

- [ ] **Step 6: Update the prompt so the model uses the type field**

In `src/backend/claude.ts` (~L165) and `src/backend/groq.ts` (~L61), change the STORING FACTS line:

```
STORING FACTS: To remember something durable use [REMEMBER: fact | type] where type is one of fact, preference, decision, event, contact. Example: [REMEMBER: user switched the project to pnpm | decision]. Tag liberally — decisions, stable preferences, and project state are worth remembering; skip trivia and one-off chit-chat.
```

- [ ] **Step 7: Run the tests + build**

Run: `npm test -- tests/backend/responseTags.test.ts`
Expected: PASS.

Run: `npm run build:backend`
Expected: no TS errors. Confirm `index.ts` reads `pendingMemoryType` off `result` without a cast error, and `ollama.ts`'s `ChatResult` (which lacks the field) still compiles at the `index.ts` access via the optional-property read.

- [ ] **Step 8: Commit**

```bash
git add src/backend/responseTags.ts src/backend/index.ts src/backend/claude.ts src/backend/groq.ts tests/backend/responseTags.test.ts
git commit -m "feat(memory): typed REMEMBER tag — liberal, classified fact capture for richer attribution"
```

---

### Task 7: Batched consolidation pass (idle job)

A low-frequency background job that collapses near-duplicate memories that slipped past insert-time dedup (e.g. two facts that only became similar after later merges) and keeps salience from drifting. Runs off the response path.

**Files:**
- Create: `src/backend/memory/consolidate.ts`
- Modify: `src/backend/index.ts` (schedule the pass; wire index refresh)
- Test: `tests/backend/memory/consolidate.test.ts`

**Interfaces:**
- Consumes: the in-memory index + `mergeMemory`/`deleteMemory` (via recall/db).
- Produces: `consolidateOnce(threshold?: number): { merged: number }` — merges pairs with cosine ≥ threshold, returns how many rows were removed.

- [ ] **Step 1: Write the failing test**

Create `tests/backend/memory/consolidate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/consolidate-test.db'
function cleanup(): void { if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held */ } } }

describe('consolidateOnce', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/backend/memory/consolidate.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Expose an index snapshot from `recall.ts`**

`consolidate.ts` needs to read the current index. Add to `src/backend/memory/recall.ts`:

```ts
/** Read-only snapshot of the current in-memory index (for consolidation). */
export function indexSnapshot(): IndexedMemory[] {
  return index.slice()
}
```

- [ ] **Step 4: Implement `consolidate.ts`**

Create `src/backend/memory/consolidate.ts`:

```ts
import { cosineSimilarity } from './embeddings'
import { mergeMemory, deleteMemory } from './db'
import { indexSnapshot, unindexMemory, indexMemory, DEDUP_THRESHOLD } from './recall'

/** One consolidation sweep: for each near-duplicate pair (cosine >= threshold),
 *  keep the higher-salience / more-recent row, fold the other into it, and drop
 *  the loser. O(n^2) — fine at personal scale, and it runs at idle, not per turn. */
export function consolidateOnce(threshold = DEDUP_THRESHOLD): { merged: number } {
  const rows = indexSnapshot()
  const removed = new Set<number>()
  let merged = 0

  for (let i = 0; i < rows.length; i++) {
    if (removed.has(rows[i].id)) continue
    for (let j = i + 1; j < rows.length; j++) {
      if (removed.has(rows[j].id)) continue
      const sim = cosineSimilarity(rows[i].embedding, rows[j].embedding)
      if (sim < threshold) continue

      // Keeper = higher salience, tie-break on recency.
      const a = rows[i], b = rows[j]
      const keeper = (b.salience > a.salience || (b.salience === a.salience && b.timestamp > a.timestamp)) ? b : a
      const loser = keeper === a ? b : a

      const text = keeper.timestamp >= loser.timestamp ? keeper.text : loser.text
      const ts = Math.max(keeper.timestamp, loser.timestamp)
      mergeMemory(keeper.id, text, ts, loser.salience)  // fold loser's salience in
      deleteMemory(loser.id)
      unindexMemory(loser.id)

      keeper.text = text
      keeper.timestamp = ts
      keeper.salience += loser.salience
      indexMemory(keeper)
      removed.add(loser.id)
      merged++
    }
  }
  return { merged }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/backend/memory/consolidate.test.ts`
Expected: PASS.

- [ ] **Step 6: Schedule the pass at idle**

In `src/backend/index.ts`, import it near the recall import:

```ts
import { consolidateOnce } from './memory/consolidate'
```

After `initRecallIndex()` (Task 3 Step 4), schedule a low-frequency sweep (every 30 min; cheap and off the response path):

```ts
initDb()
initRecallIndex()
setInterval(() => {
  try {
    const { merged } = consolidateOnce()
    if (merged > 0) console.error(`[recall] consolidation merged ${merged} duplicate memories`)
  } catch (err) {
    console.error('[recall] consolidation error:', err instanceof Error ? err.message : err)
  }
}, 30 * 60_000).unref?.()
```

(`.unref()` so the timer never keeps the process alive on shutdown.)

- [ ] **Step 7: Build, full suite, commit**

Run: `npm run build:backend && npm test`
Expected: no TS errors; full suite green.

```bash
git add src/backend/memory/consolidate.ts src/backend/memory/recall.ts src/backend/index.ts tests/backend/memory/consolidate.test.ts
git commit -m "feat(memory): batched idle consolidation pass — collapse near-duplicate memories"
```

**Stage 2 complete.** Capture is richer and typed, duplicates fold together, and recall reads as natural memory.

---

## Final verification

- [ ] `npm run build` (full: main + preload + renderer + backend) — no TS errors.
- [ ] `npm test` — full suite green.
- [ ] Manual: state a decision ("I decided to use SQLite for the cache"), restart the app, ask an adjacent question next session, and confirm Jarvis references the decision naturally ("last time you went with SQLite"). Confirm a memory older than 100 rows is still recalled.
- [ ] Update the `memory-that-connects` and `project-sprint-state` memory files with the shipped state.
