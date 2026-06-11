import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BackendEvent } from '../../src/backend/types'

vi.mock('../../src/backend/tools/index', () => ({
  getToolsForGroq: () => [],
  handleTool: vi.fn(async () => 'tool ok'),
}))

function mockFetch(responses: object[]): void {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const data = responses[Math.min(i++, responses.length - 1)]
    return { ok: true, status: 200, json: async () => data, text: async () => '' }
  }))
}

function mockFetchError(status: number, body = ''): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status, json: async () => ({}), text: async () => body,
  })))
}

const reply = (content: string) => ({
  choices: [{ message: { role: 'assistant', content, tool_calls: null }, finish_reason: 'stop' }],
  model: 'llama-3.3-70b-versatile',
  usage: { prompt_tokens: 10, completion_tokens: 5 },
})

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GROQ_API_KEY
})

describe('groq chat', () => {
  it('returns text and token counts for a simple turn', async () => {
    mockFetch([reply('Hello there.')])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('hi', [], [], () => {})
    expect(result.text).toBe('Hello there.')
    expect(result.model).toContain('groq:')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
    expect(result.pendingMemory).toBeNull()
    expect(result.pendingEntities).toHaveLength(0)
  })

  it('broadcasts the final text as a non-partial transcript event', async () => {
    mockFetch([reply('Done.')])
    const { chat } = await import('../../src/backend/groq')
    const events: BackendEvent[] = []
    await chat('hi', [], [], e => events.push(e))
    const finals = events.filter(e => e.type === 'transcript' && !e.partial)
    expect(finals.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts [REMEMBER: ...] and strips it from text', async () => {
    mockFetch([reply('Got it. [REMEMBER: user prefers dark mode]')])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('note this', [], [], () => {})
    expect(result.pendingMemory).toBe('user prefers dark mode')
    expect(result.text).toBe('Got it.')
    expect(result.text).not.toContain('REMEMBER')
  })

  it('extracts [PERSON: ...] entity tag and strips it from text', async () => {
    mockFetch([reply("I'll remember her. [PERSON: Amanda | girlfriend | biology at Virginia Tech]")])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('remember Amanda', [], [], () => {})
    expect(result.pendingEntities).toHaveLength(1)
    const entity = result.pendingEntities[0]
    expect(entity.name).toBe('Amanda')
    expect(entity.type).toBe('person')
    expect(entity.relationship).toBe('girlfriend')
    expect(entity.context).toBe('biology at Virginia Tech')
    expect(result.text).not.toContain('[PERSON')
  })

  it('extracts [PLACE: ...] entity tag', async () => {
    mockFetch([reply('Noted. [PLACE: The Lyric | coffee shop in Blacksburg]')])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('remember The Lyric', [], [], () => {})
    expect(result.pendingEntities).toHaveLength(1)
    expect(result.pendingEntities[0].type).toBe('place')
    expect(result.pendingEntities[0].name).toBe('The Lyric')
    expect(result.text).not.toContain('[PLACE')
  })

  it('extracts [PROJECT: ...] entity tag', async () => {
    mockFetch([reply('Stored it. [PROJECT: Jarvis | personal AI desktop assistant]')])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('save project Jarvis', [], [], () => {})
    expect(result.pendingEntities[0].type).toBe('project')
    expect(result.pendingEntities[0].name).toBe('Jarvis')
  })

  it('handles empty choices array gracefully instead of throwing', async () => {
    mockFetch([{ choices: [], model: 'x', usage: { prompt_tokens: 0, completion_tokens: 0 } }])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('hi', [], [], () => {})
    expect(result.text).toContain('problem')
  })

  it('executes a tool call and broadcasts a → progress indicator', async () => {
    const toolStep = {
      choices: [{
        message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'app_launch', arguments: '{"name":"spotify"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      model: 'llama-3.3-70b-versatile',
      usage: { prompt_tokens: 15, completion_tokens: 3 },
    }
    mockFetch([toolStep, reply('Spotify is now open.')])
    const { chat } = await import('../../src/backend/groq')
    const events: BackendEvent[] = []
    const result = await chat('open spotify', [], [], e => events.push(e))
    expect(result.text).toBe('Spotify is now open.')
    const progressBroadcast = events.find(e => e.type === 'transcript' && e.partial && e.text?.includes('→'))
    expect(progressBroadcast).toBeDefined()
  })

  it('includes memory context strings in the system message', async () => {
    let capturedBody: any
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string)
      return { ok: true, json: async () => reply('Sure.'), text: async () => '' }
    }))
    const { chat } = await import('../../src/backend/groq')
    await chat('hi', [], ['User likes coffee'], () => {})
    const systemMsg = capturedBody.messages.find((m: any) => m.role === 'system')
    expect(systemMsg.content).toContain('User likes coffee')
  })

  it('passes conversation history to the API', async () => {
    let capturedBody: any
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string)
      return { ok: true, json: async () => reply('Response.'), text: async () => '' }
    }))
    const { chat } = await import('../../src/backend/groq')
    await chat('follow-up', [
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'first reply' },
    ], [], () => {})
    const userMsgs = capturedBody.messages.filter((m: any) => m.role === 'user')
    expect(userMsgs.length).toBeGreaterThanOrEqual(2)
  })

  it('throws when GROQ_API_KEY is not set', async () => {
    delete process.env.GROQ_API_KEY
    const { chat } = await import('../../src/backend/groq')
    await expect(chat('hi', [], [], () => {})).rejects.toThrow('GROQ_API_KEY')
  })

  it('throws with informative message on 401', async () => {
    mockFetchError(401, 'Unauthorized')
    const { chat } = await import('../../src/backend/groq')
    await expect(chat('hi', [], [], () => {})).rejects.toThrow(/invalid/i)
  })

  it('throws with informative message on 429', async () => {
    mockFetchError(429, 'Rate limited')
    const { chat } = await import('../../src/backend/groq')
    await expect(chat('hi', [], [], () => {})).rejects.toThrow(/rate limit/i)
  })

  it('throws with HTTP status on other errors', async () => {
    mockFetchError(500, 'Internal Server Error')
    const { chat } = await import('../../src/backend/groq')
    await expect(chat('hi', [], [], () => {})).rejects.toThrow('500')
  })
})
