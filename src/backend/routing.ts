import type { LlmProvider } from './types'

// The three concrete LLM backends, in descending preference order. `auto` walks
// the whole list; a forced preference starts at its own position and degrades
// DOWNWARD only (claude → groq → ollama), never upward. Ollama is the permanent
// last resort, so a chain is never empty — that is what stops the system from
// hard-locking on a provider that happens to be down (the failure mode that
// stranded the user on a forced, unreachable Ollama).
export type ConcreteProvider = 'claude' | 'groq' | 'ollama'

const ORDER: ConcreteProvider[] = ['claude', 'groq', 'ollama']

export interface ProviderAvailability {
  claude: boolean
  groq: boolean
}

export function buildProviderChain(
  pref: LlmProvider,
  avail: ProviderAvailability,
): ConcreteProvider[] {
  const startIdx = pref === 'auto' ? 0 : ORDER.indexOf(pref)
  const from = startIdx < 0 ? 0 : startIdx
  const chain = ORDER.slice(from).filter((p) => {
    if (p === 'claude') return avail.claude
    if (p === 'groq') return avail.groq
    return true // ollama is always attemptable (last resort)
  })
  // Ollama is always in `slice(from)` for every preference except none, so this
  // is belt-and-suspenders — guarantees a runnable chain in all cases.
  return chain.length > 0 ? chain : ['ollama']
}
