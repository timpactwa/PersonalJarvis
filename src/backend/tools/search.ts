export interface SearchToolDef {
  name: string
  description: string
  input_schema: { type: string; properties: Record<string, unknown>; required: string[] }
}

export const searchToolDefs: SearchToolDef[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information, news, weather, prices, facts, or any topic needing up-to-date data. Returns top results with titles, URLs, and descriptions. Use proactively whenever you are unsure about current or recent information — never say you lack real-time access without trying this tool first.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        count: { type: 'number', description: 'Number of results (default 5, max 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_read',
    description: 'Fetch and extract the readable text content from a specific URL. Use after web_search to read the full content of a result for deeper research or to answer detailed questions.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The HTTP/HTTPS URL to fetch and read' },
      },
      required: ['url'],
    },
  },
]

interface BraveSearchResult {
  title: string
  url: string
  description: string
}

interface BraveSearchResponse {
  web?: { results?: BraveSearchResult[] }
}

export async function webSearch(query: string, count = 5): Promise<string> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) {
    return 'Web search is not configured. Please set BRAVE_SEARCH_API_KEY in .env.local (get a free key at brave.com/search/api).'
  }

  const n = Math.min(Math.max(1, count), 10)
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': key,
    },
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Brave Search API error ${res.status}: ${body.slice(0, 200) || '(no body)'}`)
  }

  const data = await res.json() as BraveSearchResponse
  const results = data.web?.results?.slice(0, n) ?? []

  if (results.length === 0) return 'No results found for that query.'

  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description}`
  ).join('\n\n')
}

export async function webRead(rawUrl: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'Only HTTP/HTTPS URLs are supported.'
    }
  } catch {
    return 'Invalid URL provided.'
  }

  const res = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,text/plain',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) return `Failed to fetch URL: ${res.status} ${res.statusText}`

  const html = await res.text()

  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim()

  const MAX_CHARS = 8000
  return text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n\n[...content truncated at ${MAX_CHARS} characters]`
    : text
}

export async function handleSearchTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'web_search': {
      const query = String(input.query ?? '').trim()
      if (!query) return 'A search query is required.'
      const count = Number(input.count ?? 5)
      return webSearch(query, isNaN(count) ? 5 : count)
    }
    case 'web_read': {
      const url = String(input.url ?? '').trim()
      if (!url) return 'A URL is required.'
      return webRead(url)
    }
    default:
      throw new Error(`Unknown search tool: ${name}`)
  }
}
