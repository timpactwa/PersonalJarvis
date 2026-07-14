import type { RecallHit } from './recall'

const DAY = 86_400_000

function approxAge(ms: number): string {
  const days = Math.round(ms / DAY)
  if (days <= 3) return 'recent'
  if (days < 14) return `about ${days} days ago`
  const weeks = Math.round(days / 7)
  if (days < 60) return weeks === 1 ? 'about 1 week ago' : `about ${weeks} weeks ago`
  const months = Math.round(days / 30)
  if (days < 365) return months === 1 ? 'about 1 month ago' : `about ${months} months ago`
  const years = Math.round(days / 365)
  return years === 1 ? 'about 1 year ago' : `about ${years} years ago`
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
