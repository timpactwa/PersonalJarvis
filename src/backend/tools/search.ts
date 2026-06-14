export interface SearchToolDef {
  name: string
  description: string
  input_schema: { type: string; properties: Record<string, unknown>; required: string[] }
}

export const searchToolDefs: SearchToolDef[] = [
  {
    name: 'web_search',
    description: 'Searches the public web and returns the top results (title, URL, snippet) for current or factual information. Use for anything that could be recent, changing, or outside your training, e.g. news, weather, sports scores, stock/crypto prices, product info, "look up X", "search for X". Use this proactively rather than saying you lack real-time access. Do NOT use it for the user\'s own Jarvis usage/cost (use jarvis_get_usage), their email (use gmail_search), or their files (use fs_search).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query phrased as you would type into a search engine, e.g. "weather Blacksburg VA today" or "Electron 28 release notes".' },
        count: { type: 'number', description: 'Number of results to return (default 5, max 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_read',
    description: 'Fetches one specific URL and returns its readable text content (HTML stripped, first 8000 chars). Use after web_search when a result\'s snippet is not enough and you need the full page to answer a detailed question, or when the user gives you a URL to read. Requires an exact http/https URL — do NOT pass a search phrase here (use web_search to find the URL first).',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'An exact HTTP or HTTPS URL, e.g. https://example.com/article. Usually obtained from a prior web_search result.' },
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
    return 'Web search is not configured. Set BRAVE_SEARCH_API_KEY in .env.local (get a free key at brave.com/search/api).'
  }
  if (key.length !== 32) {
    return `Web search key looks wrong (${key.length} chars, expected 32). Check BRAVE_SEARCH_API_KEY in .env.local.`
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
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Brave Search: invalid API key (${res.status}). Check BRAVE_SEARCH_API_KEY in .env.local.`)
    }
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
