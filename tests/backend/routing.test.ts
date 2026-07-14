import { describe, it, expect } from 'vitest'
import { buildProviderChain } from '../../src/backend/routing'

describe('buildProviderChain', () => {
  const both = { claude: true, groq: true }

  it('auto routes Claude → Groq → Ollama when all are available', () => {
    expect(buildProviderChain('auto', both)).toEqual(['claude', 'groq', 'ollama'])
  })

  it('auto skips providers without credentials but always keeps Ollama as last resort', () => {
    expect(buildProviderChain('auto', { claude: false, groq: true })).toEqual(['groq', 'ollama'])
    expect(buildProviderChain('auto', { claude: true, groq: false })).toEqual(['claude', 'ollama'])
    expect(buildProviderChain('auto', { claude: false, groq: false })).toEqual(['ollama'])
  })

  it('a forced preference starts at that provider and degrades downward only', () => {
    expect(buildProviderChain('claude', both)).toEqual(['claude', 'groq', 'ollama'])
    expect(buildProviderChain('groq', both)).toEqual(['groq', 'ollama'])
    expect(buildProviderChain('ollama', both)).toEqual(['ollama'])
  })

  it('never hard-locks: an unavailable forced provider falls through to what is usable', () => {
    // The exact bug that stranded the user: stuck on a provider that is down.
    expect(buildProviderChain('claude', { claude: false, groq: true })).toEqual(['groq', 'ollama'])
    expect(buildProviderChain('groq', { claude: true, groq: false })).toEqual(['ollama'])
    // Forced Claude with nothing else configured still yields a runnable chain.
    expect(buildProviderChain('claude', { claude: false, groq: false })).toEqual(['ollama'])
  })

  it('does not fall upward — a forced lower provider never re-adds Claude/Groq above it', () => {
    expect(buildProviderChain('ollama', both)).not.toContain('claude')
    expect(buildProviderChain('ollama', both)).not.toContain('groq')
    expect(buildProviderChain('groq', both)).not.toContain('claude')
  })
})
