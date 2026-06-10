import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BackendEvent } from '../../src/backend/types'

// Keep the provider hermetic: stub the tool registry so no real app launches
// and no DB access happen during these unit tests.
vi.mock('../../src/backend/tools/index', () => ({
  getTools: () => [
    { name: 'app_launch', description: 'launch an app', input_schema: { type: 'object', properties: {} } },
  ],
  handleTool: vi.fn(async () => 'tool ok'),
}))

function mockFetchSequence(responses: object[]): void {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => responses[Math.min(i++, responses.length - 1)],
    text: async () => '',
  })) as unknown as typeof fetch)
}

beforeEach(() => {
  process.env.OLLAMA_MODEL = 'llama3.1:8b'
  process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
})

afterEach(() => vi.unstubAllGlobals())

describe('ollama main-loop provider', () => {
  it('returns assistant text for a simple turn', async () => {
    mockFetchSequence([{ message: { role: 'assistant', content: 'Hello there.' }, prompt_eval_count: 10, eval_count: 5 }])
    const { chat } = await import('../../src/backend/ollama')
    const events: BackendEvent[] = []
    const result = await chat('hi', [], [], e => events.push(e))
    expect(result.text).toBe('Hello there.')
    expect(result.model).toContain('ollama:')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
  })

  it('executes a tool call then returns the follow-up answer', async () => {
    mockFetchSequence([
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'app_launch', arguments: { app_name: 'calculator' } } }] }, prompt_eval_count: 20, eval_count: 4 },
      { message: { role: 'assistant', content: 'Calculator is open.' }, prompt_eval_count: 8, eval_count: 6 },
    ])
    const { chat } = await import('../../src/backend/ollama')
    const result = await chat('open calculator', [], [], () => {})
    expect(result.text).toBe('Calculator is open.')
    expect(result.inputTokens).toBe(28)
    expect(result.outputTokens).toBe(10)
  })

  it('extracts a [REMEMBER: ...] instruction and strips it from the reply', async () => {
    mockFetchSequence([{ message: { role: 'assistant', content: 'Noted. [REMEMBER: user likes tea]' }, prompt_eval_count: 3, eval_count: 3 }])
    const { chat } = await import('../../src/backend/ollama')
    const result = await chat('remember I like tea', [], [], () => {})
    expect(result.pendingMemory).toBe('user likes tea')
    expect(result.text).not.toContain('REMEMBER')
  })
})
