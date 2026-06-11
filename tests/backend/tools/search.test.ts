import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

beforeEach(() => {
  delete process.env.BRAVE_SEARCH_API_KEY
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.BRAVE_SEARCH_API_KEY
})

describe('searchToolDefs', () => {
  it('exports exactly two tool definitions', async () => {
    const { searchToolDefs } = await import('../../../src/backend/tools/search')
    expect(searchToolDefs).toHaveLength(2)
  })

  it('web_search has required query field', async () => {
    const { searchToolDefs } = await import('../../../src/backend/tools/search')
    const def = searchToolDefs.find(t => t.name === 'web_search')!
    expect(def).toBeDefined()
    expect(def.input_schema.required).toContain('query')
  })

  it('web_read has required url field', async () => {
    const { searchToolDefs } = await import('../../../src/backend/tools/search')
    const def = searchToolDefs.find(t => t.name === 'web_read')!
    expect(def).toBeDefined()
    expect(def.input_schema.required).toContain('url')
  })
})

describe('webSearch', () => {
  it('returns config message when API key is not set', async () => {
    const { webSearch } = await import('../../../src/backend/tools/search')
    const result = await webSearch('test query')
    expect(result).toContain('BRAVE_SEARCH_API_KEY')
  })

  it('returns formatted numbered results on success', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Result One', url: 'https://example.com/1', description: 'First result desc' },
            { title: 'Result Two', url: 'https://example.com/2', description: 'Second result desc' },
          ],
        },
      }),
    })))
    const { webSearch } = await import('../../../src/backend/tools/search')
    const result = await webSearch('test query')
    expect(result).toContain('[1] Result One')
    expect(result).toContain('URL: https://example.com/1')
    expect(result).toContain('First result desc')
    expect(result).toContain('[2] Result Two')
  })

  it('returns "No results found" when results array is empty', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    })))
    const { webSearch } = await import('../../../src/backend/tools/search')
    expect(await webSearch('obscure query')).toBe('No results found for that query.')
  })

  it('returns "No results found" when web field is absent', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })))
    const { webSearch } = await import('../../../src/backend/tools/search')
    expect(await webSearch('test')).toBe('No results found for that query.')
  })

  it('throws on API error response', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401, text: async () => 'Unauthorized',
    })))
    const { webSearch } = await import('../../../src/backend/tools/search')
    await expect(webSearch('test')).rejects.toThrow('401')
  })

  it('clamps count to a maximum of 10', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => ({ web: { results: [] } }) }
    }))
    const { webSearch } = await import('../../../src/backend/tools/search')
    await webSearch('test', 99)
    expect(capturedUrl).toContain('count=10')
  })

  it('clamps count to a minimum of 1', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => ({ web: { results: [] } }) }
    }))
    const { webSearch } = await import('../../../src/backend/tools/search')
    await webSearch('test', 0)
    expect(capturedUrl).toContain('count=1')
  })

  it('URL-encodes the query parameter', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => ({ web: { results: [] } }) }
    }))
    const { webSearch } = await import('../../../src/backend/tools/search')
    await webSearch('weather in New York')
    expect(capturedUrl).toContain('weather%20in%20New%20York')
  })
})

describe('webRead', () => {
  it('returns "Invalid URL provided" for malformed URL', async () => {
    const { webRead } = await import('../../../src/backend/tools/search')
    expect(await webRead('not-a-url')).toBe('Invalid URL provided.')
  })

  it('returns error for ftp:// protocol', async () => {
    const { webRead } = await import('../../../src/backend/tools/search')
    expect(await webRead('ftp://example.com')).toBe('Only HTTP/HTTPS URLs are supported.')
  })

  it('returns error for file:// protocol', async () => {
    const { webRead } = await import('../../../src/backend/tools/search')
    expect(await webRead('file:///etc/passwd')).toBe('Only HTTP/HTTPS URLs are supported.')
  })

  it('strips HTML tags and returns readable plain text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '<html><body><h1>Hello World</h1><p>Some text here.</p></body></html>',
    })))
    const { webRead } = await import('../../../src/backend/tools/search')
    const result = await webRead('https://example.com')
    expect(result).toContain('Hello World')
    expect(result).toContain('Some text here.')
    expect(result).not.toContain('<h1>')
    expect(result).not.toContain('<p>')
  })

  it('removes script and style block contents', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '<html><script>alert("xss")</script><style>.a{color:red}</style><p>Real content</p></html>',
    })))
    const { webRead } = await import('../../../src/backend/tools/search')
    const result = await webRead('https://example.com')
    expect(result).not.toContain('alert')
    expect(result).not.toContain('color:red')
    expect(result).toContain('Real content')
  })

  it('decodes common HTML entities', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '<p>Tom &amp; Jerry &lt;3&gt; &quot;hello&quot; &#39;world&#39;</p>',
    })))
    const { webRead } = await import('../../../src/backend/tools/search')
    const result = await webRead('https://example.com')
    expect(result).toContain('Tom & Jerry')
    expect(result).toContain('<3>')
    expect(result).toContain('"hello"')
    expect(result).toContain("'world'")
  })

  it('truncates content at 8000 characters with a truncation notice', async () => {
    const longContent = '<p>' + 'A'.repeat(10_000) + '</p>'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => longContent,
    })))
    const { webRead } = await import('../../../src/backend/tools/search')
    const result = await webRead('https://example.com')
    expect(result).toContain('truncated')
    expect(result.length).toBeLessThanOrEqual(8200)
  })

  it('does not truncate content under 8000 characters', async () => {
    const shortContent = '<p>' + 'B'.repeat(100) + '</p>'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => shortContent,
    })))
    const { webRead } = await import('../../../src/backend/tools/search')
    const result = await webRead('https://example.com')
    expect(result).not.toContain('truncated')
  })

  it('returns error message for non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404, statusText: 'Not Found',
    })))
    const { webRead } = await import('../../../src/backend/tools/search')
    const result = await webRead('https://example.com/nope')
    expect(result).toContain('404')
  })
})

describe('handleSearchTool', () => {
  it('dispatches web_search to webSearch', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        web: { results: [{ title: 'T', url: 'https://t.com', description: 'D' }] },
      }),
    })))
    const { handleSearchTool } = await import('../../../src/backend/tools/search')
    const result = await handleSearchTool('web_search', { query: 'test query' })
    expect(result).toContain('[1]')
    expect(result).toContain('https://t.com')
  })

  it('dispatches web_read to webRead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '<p>Hello from the page</p>',
    })))
    const { handleSearchTool } = await import('../../../src/backend/tools/search')
    const result = await handleSearchTool('web_read', { url: 'https://example.com' })
    expect(result).toContain('Hello from the page')
  })

  it('returns "A search query is required" when query is empty', async () => {
    const { handleSearchTool } = await import('../../../src/backend/tools/search')
    const result = await handleSearchTool('web_search', { query: '' })
    expect(result).toBe('A search query is required.')
  })

  it('returns "A URL is required" when url is empty', async () => {
    const { handleSearchTool } = await import('../../../src/backend/tools/search')
    const result = await handleSearchTool('web_read', { url: '' })
    expect(result).toBe('A URL is required.')
  })

  it('returns "A search query is required" when query is missing', async () => {
    const { handleSearchTool } = await import('../../../src/backend/tools/search')
    const result = await handleSearchTool('web_search', {})
    expect(result).toBe('A search query is required.')
  })

  it('throws for unknown tool name', async () => {
    const { handleSearchTool } = await import('../../../src/backend/tools/search')
    await expect(handleSearchTool('web_unknown', {})).rejects.toThrow('Unknown search tool')
  })
})
