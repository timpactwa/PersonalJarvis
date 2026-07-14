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
