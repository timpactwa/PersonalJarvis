// NOTE: tools/index is mocked below, so the real getToolsForGroq cannot be tested here.
// The regression test ensuring spawn_agent is excluded from the Groq tool set (it caused
// Groq HTTP 400s on complex queries) lives in tests/backend/tools/index.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BackendEvent } from '../../src/backend/types'

vi.mock('../../src/backend/tools/index', () => ({
  getToolsForGroq: () => [],
  handleTool: vi.fn(async () => 'tool ok'),
}))

/** Build a mock Response whose .body is a ReadableStream of SSE-encoded chunks. */
function makeStreamResponse(
  chunks: object[],
  usage?: { prompt_tokens: number; completion_tokens: number },
): { ok: true; status: 200; body: ReadableStream<Uint8Array>; text: () => Promise<string> } {
  const lines: string[] = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`)
  if (usage) {
    lines.push(`data: ${JSON.stringify({ choices: [], usage })}\n\n`)
  }
  lines.push('data: [DONE]\n\n')
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(line))
      }
      controller.close()
    },
  })
  return { ok: true, status: 200, body, text: async () => '' }
}

/** Convenience: build SSE chunks for a plain text reply. */
function textChunks(
  content: string,
  usage = { prompt_tokens: 10, completion_tokens: 5 },
): { chunks: object[]; usage: typeof usage } {
  return {
    chunks: [
      { choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ],
    usage,
  }
}

function mockFetch(responses: Array<{ chunks: object[]; usage?: { prompt_tokens: number; completion_tokens: number } }>): void {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]
    return makeStreamResponse(r.chunks, r.usage)
  }))
}

function mockFetchError(status: number, body = ''): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status, json: async () => ({}), text: async () => body,
  })))
}

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GROQ_API_KEY
})

describe('groq chat', () => {
  it('returns text and token counts for a simple turn', async () => {
    const { chunks, usage } = textChunks('Hello there.')
    mockFetch([{ chunks, usage }])
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
    const { chunks, usage } = textChunks('Done.')
    mockFetch([{ chunks, usage }])
    const { chat } = await import('../../src/backend/groq')
    const events: BackendEvent[] = []
    await chat('hi', [], [], e => events.push(e))
    const finals = events.filter(e => e.type === 'transcript' && !e.partial)
    expect(finals.length).toBeGreaterThanOrEqual(1)
  })

  it('extracts [REMEMBER: ...] and strips it from text', async () => {
    const { chunks, usage } = textChunks('Got it. [REMEMBER: user prefers dark mode]')
    mockFetch([{ chunks, usage }])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('note this', [], [], () => {})
    expect(result.pendingMemory).toBe('user prefers dark mode')
    expect(result.text).toBe('Got it.')
    expect(result.text).not.toContain('REMEMBER')
  })

  it('extracts [PERSON: ...] entity tag and strips it from text', async () => {
    const { chunks, usage } = textChunks("I'll remember her. [PERSON: Amanda | girlfriend | biology at Virginia Tech]")
    mockFetch([{ chunks, usage }])
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
    const { chunks, usage } = textChunks('Noted. [PLACE: The Lyric | coffee shop in Blacksburg]')
    mockFetch([{ chunks, usage }])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('remember The Lyric', [], [], () => {})
    expect(result.pendingEntities).toHaveLength(1)
    expect(result.pendingEntities[0].type).toBe('place')
    expect(result.pendingEntities[0].name).toBe('The Lyric')
    expect(result.text).not.toContain('[PLACE')
  })

  it('extracts [PROJECT: ...] entity tag', async () => {
    const { chunks, usage } = textChunks('Stored it. [PROJECT: Jarvis | personal AI desktop assistant]')
    mockFetch([{ chunks, usage }])
    const { chat } = await import('../../src/backend/groq')
    const result = await chat('save project Jarvis', [], [], () => {})
    expect(result.pendingEntities[0].type).toBe('project')
    expect(result.pendingEntities[0].name).toBe('Jarvis')
  })

  it('handles empty choices array gracefully instead of throwing', async () => {
    // Send a usage-only chunk with no choices content — simulates empty response.
    // The streaming path returns empty text (rather than crashing) when choices is empty.
    const emptyChunks = [
      { choices: [], model: 'x', usage: { prompt_tokens: 0, completion_tokens: 0 } },
    ]
    mockFetch([{ chunks: emptyChunks }])
    const { chat } = await import('../../src/backend/groq')
    // Should not throw — and returns empty or fallback text
    const result = await chat('hi', [], [], () => {})
    expect(typeof result.text).toBe('string')
  })

  it('executes a tool call and broadcasts a → progress indicator', async () => {
    // Tool call stream: name chunk + arguments chunk + finish chunk
    const toolChunks = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'tc1', type: 'function', function: { name: 'app_launch', arguments: '' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"name":"spotify"}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]
    const { chunks: replyChunks, usage: replyUsage } = textChunks('Spotify is now open.')
    mockFetch([
      { chunks: toolChunks, usage: { prompt_tokens: 15, completion_tokens: 3 } },
      { chunks: replyChunks, usage: replyUsage },
    ])
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
      const { chunks, usage } = textChunks('Sure.')
      return makeStreamResponse(chunks, usage)
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
      const { chunks, usage } = textChunks('Response.')
      return makeStreamResponse(chunks, usage)
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

  it('recovers gmail_compose from Groq tool_use_failed XML output', async () => {
    const { handleTool } = await import('../../src/backend/tools/index')
    vi.mocked(handleTool).mockResolvedValueOnce('composer opened')

    const toolUseFailedBody = JSON.stringify({
      error: {
        code: 'tool_use_failed',
        failed_generation: '<function=gmail_compose>{"to": "mom", "subject": "Hello", "body": "Hi there"}</function>\n',
      },
    })

    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++
      if (call === 1) {
        return { ok: false, status: 400, json: async () => ({}), text: async () => toolUseFailedBody }
      }
      const { chunks, usage } = textChunks('Email composer is ready.')
      return makeStreamResponse(chunks, usage)
    }))

    const { chat } = await import('../../src/backend/groq')
    const result = await chat('send email to mom', [], [], () => {})
    expect(handleTool).toHaveBeenCalledWith('gmail_compose', { to: 'mom', subject: 'Hello', body: 'Hi there' }, { userText: 'send email to mom' })
    expect(result.text).toBe('Email composer is ready.')
  })
})

describe('parseFailedToolGeneration', () => {
  it('parses XML function block format', async () => {
    const { parseFailedToolGeneration } = await import('../../src/backend/groq')
    const body = JSON.stringify({
      error: {
        code: 'tool_use_failed',
        failed_generation: '<function=gmail_compose>{"to":"mom","subject":"Hi","body":"Hello"}</function>',
      },
    })
    const parsed = parseFailedToolGeneration(body)
    expect(parsed?.name).toBe('gmail_compose')
    expect(parsed?.arguments).toEqual({ to: 'mom', subject: 'Hi', body: 'Hello' })
  })

  it('returns null for unrelated errors', async () => {
    const { parseFailedToolGeneration } = await import('../../src/backend/groq')
    expect(parseFailedToolGeneration('{"error":{"code":"other"}}')).toBeNull()
  })

  it('parses tool name with embedded JSON args from error message', async () => {
    const { parseFailedToolGeneration } = await import('../../src/backend/groq')
    const body = JSON.stringify({
      error: {
        code: 'tool_use_failed',
        message: 'tool call validation failed: attempted to call tool \'web_search [{"query": "jarvis ai cost", "count": 1}]\' which was not in request.tools',
      },
    })
    const parsed = parseFailedToolGeneration(body)
    expect(parsed?.name).toBe('web_search')
    expect(parsed?.arguments).toEqual({ query: 'jarvis ai cost', count: 1 })
  })
})
