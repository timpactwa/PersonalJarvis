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
