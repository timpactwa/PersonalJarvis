# Memory That Connects — Design Spec

**Date:** 2026-07-13
**Branch:** `fix/stability-and-ui-overhaul`
**Status:** Approved design, ready for implementation planning

## Goal

Make Jarvis's long-term memory feel like it *connects*: recall that works across the
user's whole history (not just the last 100 rows), ranks by relevance rather than
recency, weaves recalled context into conversation with natural attribution ("last
time you decided X"), and captures durable facts more reliably. Built as two shippable
stages so the assistant visibly gets smarter in steps.

## Non-goals (deliberately skipped)

- **Knowledge-graph memory** (memory↔entity traversal, multi-hop queries). Over-engineered
  for a single-user assistant; revisit only if flat recall proves insufficient.
- **Per-turn LLM extraction call.** Cost-sensitive: Stage 2 capture is prompt-first plus a
  batched consolidation pass, not an extra model call on every response.
- **Vector DB / sqlite-vec native extension.** The native-addon ABI surface (better-sqlite3
  already fights Electron ABI mismatches) is not worth it at personal scale. An in-memory
  index over a few thousand embeddings is sub-10ms.

## Current state

Memory today (`src/backend/memory/db.ts`, `embeddings.ts`, and inline logic in
`src/backend/index.ts` ~900-953):

- **Storage:** `memories(id, timestamp, text, embedding BLOB)` — 384-dim normalized
  vectors from `Xenova/all-MiniLM-L6-v2`. Separate `entities` table for structured
  people/places/projects/orgs.
- **Creation:** passive and model-driven. A memory is written only when the model emits a
  `[REMEMBER: …]` tag (parsed in `responseTags.ts`); entities via `[PERSON:/PROJECT:…]` tags.
  Plus contact-email hints.
- **Recall (per turn):** `index.ts` builds a `topMems: string[]`, embeds the user text,
  calls `getAllMemories()` then `findTopK(queryVec, allMems, 3)`, and injects the 3 texts
  into model context alongside time, profile, preference summary, and substring-matched
  entities.

### The limits this spec fixes

1. **100-row cap (critical).** `getAllMemories()` is `ORDER BY timestamp DESC LIMIT 100`.
   Semantic search only ever sees the 100 most-recent memories; everything older is
   unreachable — the opposite of "connects across history."
2. **Relevance-blind.** `findTopK` always returns exactly 3, no score floor: irrelevant turns
   still inject 3 weak matches (noise); rich turns are starved at 3 (miss). Pure cosine, no
   recency/salience weighting.
3. **O(n) cosine on the DB hot path.** Every turn loads all embedding BLOBs from SQLite.
   Fine at 100 rows; lifting the cap naively pulls megabytes of BLOBs through better-sqlite3
   on the main thread each turn (event-loop stalls have frozen PTT before on this project).
4. **Softer:** brittle substring entity match; no dedup/consolidation (same fact piles up as
   N rows); memories are opaque strings with no type/source/salience.

## Architecture

### Module boundaries (after)

| Module | Responsibility |
|---|---|
| `memory/db.ts` | Persistence only — schema, CRUD, dedup-lookup helper |
| `memory/embeddings.ts` | Embedder + cosine (generalized scorer) |
| **`memory/recall.ts`** *(new)* | In-memory index, relevance ranking, recency/salience weighting, dedup decision |
| `index.ts` | Calls `recall()`, formats attributed injection — gets thinner |

Extracting recall into its own module is what makes Stage 2 testable and stops `index.ts`
(already ~1000+ lines) from growing.

### `memory/recall.ts` — public API (sketch)

```ts
interface MemoryRow {
  id: number
  text: string
  embedding: Float32Array
  timestamp: number
  type: MemoryType          // 'fact' | 'preference' | 'decision' | 'event' | 'contact'
  salience: number          // default 1.0
  lastAccessed: number
  accessCount: number
}

interface RecallHit { id: number; text: string; type: MemoryType; score: number; timestamp: number; lastAccessed: number }

// Load the full memories table once at startup; keep the in-memory array warm.
export function initRecallIndex(): void

// Keep the in-memory index in sync (called from db insert/delete).
export function indexMemory(row: MemoryRow): void
export function unindexMemory(id: number): void

// Rank the in-memory index against a query vector. Applies relevance floor,
// recency/salience weighting, and dynamic K. Bumps last_accessed/access_count
// on returned hits (persisted async).
export function recall(queryVec: Float32Array, opts?: RecallOpts): RecallHit[]

// Dedup decision for insert time: nearest existing memory + its cosine.
export function nearestExisting(queryVec: Float32Array): { id: number; score: number } | null
```

`RecallOpts` carries the tunables (floor, maxK, decay half-life) with the defaults below so
they are not hard-coded constants.

### Ranking formula (Stage 1)

```
finalScore = cosine × (1 + salienceBoost) × recencyDecay(effectiveTs)
```

- **Relevance floor:** drop any hit with `cosine < FLOOR` (default 0.35).
- **Dynamic K:** return all hits above the floor, capped at `MAX_K` (default 6), replacing the
  fixed top-3.
- **Recency:** `recencyDecay` is a mild exponential on `effectiveTs = max(timestamp, lastAccessed)`
  with a long half-life (default ~90 days) — a fresh or recently-used fact edges out a stale
  near-tie without burying old-but-highly-relevant memories.
- **Salience:** `salienceBoost` scales with the memory's `salience` (bumped on access and on
  dedup-merge), so recurring concerns stay sharp.

## Data flow

### Recall (per turn) — after
1. `index.ts` embeds user text (already does, `embedPromise`).
2. Calls `recall(queryVec)` → `RecallHit[]` from the in-memory index. No DB read on the hot path.
3. Formats hits with attribution by `type` (Stage 2) and pushes into `topMems`.
4. `recall()` fire-and-forget persists `last_accessed`/`access_count` bumps for returned hits.

### Write (memory creation) — after
1. Model emits `[REMEMBER: …]` (or auto-extraction / contact hint) → candidate text.
2. Embed candidate. `nearestExisting(vec)`: if cosine > `DEDUP_THRESHOLD` (default 0.9),
   **merge** into the existing row (bump salience, keep the more specific text, refresh
   timestamp) instead of inserting a duplicate.
3. Otherwise `insertMemory(...)` writes the row (with `type`/`source`/`salience` defaults) and
   `indexMemory(...)` adds it to the warm index.

## Schema changes

`memories` table, added via the existing idempotent `ALTER TABLE … ADD COLUMN … DEFAULT`
pattern in `initDb()` (each wrapped in try/catch like the current `email` column):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `type` | TEXT | `'fact'` | Format/weight by kind (fact/preference/decision/event/contact) |
| `source` | TEXT | `'explicit'` | Provenance (explicit / auto / contact-hint / merged) |
| `salience` | REAL | `1.0` | Importance weight; bumped on access + dedup-merge |
| `last_accessed` | INTEGER | `0` | Recency-of-use for ranking |
| `access_count` | INTEGER | `0` | How often recalled |

Note: the current `ALTER TABLE` block "swallows all errors" (flagged in backend review). Keep
the per-column try/catch idiom but the migration for these columns is additive and low-risk.

## Stage 1 — Retrieval engine (ships alone)

Deliverable: recall works across full history, relevance-weighted, off the DB hot path.

- New `memory/recall.ts` with the in-memory index + ranking above.
- `getAllMemories()` loses `LIMIT 100`; used only for the one-time index load.
- `insertMemory`/`deleteMemory` call `indexMemory`/`unindexMemory`.
- `initRecallIndex()` invoked at backend init, parallel with the embedder warmup that already
  runs there.
- `index.ts` recall block swapped from `getAllMemories()+findTopK(...,3)` to `recall(queryVec)`.
- Schema columns added (defaults make existing rows valid immediately).
- `findTopK` in `embeddings.ts` generalized to accept a scorer/threshold (or superseded by
  `recall.ts` using the raw `cosineSimilarity` export).

## Stage 2 — Proactive weaving (on top of Stage 1)

Deliverable: capture is richer and recall reads as natural memory.

- **Auto fact-extraction (prompt-first).** Strengthen the system-prompt guidance so the model
  tags durable facts (decisions, stable preferences, project state) far more liberally than
  today's occasional `[REMEMBER:]`. No extra per-turn call.
- **Batched consolidation pass.** A periodic/idle job that collapses near-duplicate memories
  (cosine > `DEDUP_THRESHOLD`) and re-scores salience. Runs off the response path.
- **Dedup on insert.** `nearestExisting` merge (see Write data flow) so duplicates never
  accumulate in the first place.
- **Attributed recall.** Replace raw fact-string injection with `type`-aware framing:
  "Earlier you decided: …", "You prefer: …", "~3 weeks ago you mentioned: …". Add one
  system-prompt line instructing Jarvis to weave recalled context naturally rather than
  reciting it. This is what turns injected facts into "last time you chose X."
- **Salience-on-access.** `recall()` bumps `last_accessed`/`access_count` on returned hits.

## Error handling & edge cases

- **DB unavailable:** `recall()` returns `[]` and all writes no-op, mirroring existing
  `dbAvailable` guards. Assistant degrades to no-memory, never crashes.
- **Index staleness:** the in-memory array is the source of truth for reads after init; every
  write path updates it. A failed persist must not desync the index (persist errors are logged,
  index reflects intent). Deletes from the settings/UI path must also call `unindexMemory`.
- **Migration on old DBs:** additive columns with defaults; existing 100+ memories become fully
  reachable the moment the cap is removed and the index loads them all.
- **Embedding dimension drift:** all rows are 384-dim MiniLM; guard cosine against length
  mismatch (return 0) so a stray malformed BLOB can't throw mid-turn.

## Testing

`recall.ts` is near-pure and is the test surface:

- Cap removed: index loads > 100 memories and ranks across all of them.
- Relevance floor: sub-floor cosine hits are excluded.
- Dynamic K: rich query returns > 3 (up to MAX_K); empty-relevance query returns 0, not 3 noise.
- Recency/salience weighting: near-tie cosine, higher salience / more-recent wins.
- Dedup: `nearestExisting` above threshold triggers merge, not insert.
- Schema migration: fresh DB and upgraded-old-DB both expose the new columns.

Run via `npm test` (Electron-ABI runner). Bare `npx vitest run` fails on the native DB —
see the test-runner memory.

## Tunable defaults (not hard constants)

| Param | Default | Notes |
|---|---|---|
| `FLOOR` (relevance) | 0.35 | Below this cosine, a memory is not injected |
| `MAX_K` | 6 | Cap on injected memories per turn |
| Recency half-life | ~90 days | Mild; do not bury old-but-relevant |
| `DEDUP_THRESHOLD` | 0.90 | Merge instead of insert above this cosine |

## Rollout

Stage 1 lands and is verified (recall works across full history, no per-turn DB BLOB load)
before Stage 2 begins. Each stage builds green (`npm run build`) and passes `npm test`.
