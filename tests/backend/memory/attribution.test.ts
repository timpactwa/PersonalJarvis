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
