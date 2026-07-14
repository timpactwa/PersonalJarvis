import { describe, it, expect } from 'vitest'
import { describeTool, summarizeArgs, describeAgentTool, describeAgentMessage } from '../../../src/backend/tools/describe'

describe('describeTool', () => {
  it('produces friendly text for known tools, interpolating args', () => {
    // The real tool parameter is `app_name`; `name` is also accepted for resilience.
    expect(describeTool('app_launch', { app_name: 'Spotify' })).toBe('Launching Spotify')
    expect(describeTool('app_launch', { name: 'Spotify' })).toBe('Launching Spotify')
    expect(describeTool('web_search', { query: 'weather' })).toBe('Searching the web for “weather”')
    expect(describeTool('spotify_play', { query: 'lofi' })).toBe('Playing “lofi”')
    expect(describeTool('spotify_pause')).toBe('Pausing music')
    expect(describeTool('jarvis_screenshot')).toBe('Taking a screenshot')
  })

  it('falls back to generic text when args are missing', () => {
    expect(describeTool('app_launch')).toBe('Launching an app')
    expect(describeTool('spotify_play')).toBe('Starting playback')
    expect(describeTool('web_search')).toBe('Searching the web')
  })

  it('matches by prefix for tool families', () => {
    expect(describeTool('fs_read')).toBe('Accessing files')
    expect(describeTool('gmail_search')).toBe('Working with your email')
    expect(describeTool('calendar_list')).toBe('Checking your calendar')
    expect(describeTool('github_status')).toBe('Checking GitHub')
  })

  it('humanizes unknown tool names rather than leaking raw snake_case', () => {
    expect(describeTool('some_new_tool')).toBe('Some new tool')
  })

  it('never returns an empty string', () => {
    for (const name of ['app_launch', 'spotify_next', 'fs_write', 'totally_unknown', '']) {
      expect(describeTool(name).length).toBeGreaterThan(0)
    }
  })
})

describe('describeAgentTool', () => {
  it('translates Agent SDK file tools to a friendly action with just the basename', () => {
    expect(describeAgentTool('Read', { file_path: 'C:\\proj\\src\\backend\\index.ts' })).toBe('Reading index.ts')
    expect(describeAgentTool('Edit', { file_path: '/home/user/proj/src/foo.ts' })).toBe('Editing foo.ts')
    expect(describeAgentTool('Write', { file_path: 'a/b/new.ts' })).toBe('Writing new.ts')
    expect(describeAgentTool('MultiEdit', { file_path: 'a/b/c.ts' })).toBe('Editing c.ts')
  })

  it('describes search/web/bash tools, clipping long values', () => {
    expect(describeAgentTool('Glob', { pattern: '**/*.ts' })).toBe('Finding files: **/*.ts')
    expect(describeAgentTool('Grep', { pattern: 'needsTool' })).toBe('Searching for “needsTool”')
    expect(describeAgentTool('Bash', { command: 'npm run build:backend' })).toBe('Running: npm run build:backend')
    expect(describeAgentTool('WebSearch', { query: 'fast-check' })).toBe('Searching the web for “fast-check”')
    const long = describeAgentTool('Bash', { command: 'x'.repeat(200) })
    expect(long.length).toBeLessThan(75)
    expect(long.endsWith('…')).toBe(true)
  })

  it('falls back to generic text when args are missing', () => {
    expect(describeAgentTool('Read')).toBe('Reading a file')
    expect(describeAgentTool('Bash')).toBe('Running a command')
    expect(describeAgentTool('WebSearch')).toBe('Searching the web')
  })

  it('falls through to app-tool descriptions / humanization for unknown names', () => {
    expect(describeAgentTool('spotify_pause')).toBe('Pausing music')
    expect(describeAgentTool('some_new_tool')).toBe('Some new tool')
    expect(describeAgentTool('').length).toBeGreaterThan(0)
  })
})

describe('describeAgentMessage', () => {
  const assistant = (content: unknown[]): unknown => ({ type: 'assistant', message: { content } })

  it('extracts narration text and translated tool calls in order', () => {
    const msg = assistant([
      { type: 'text', text: '  Let me read the entry point.  ' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'src/index.ts' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ])
    expect(describeAgentMessage(msg)).toEqual([
      'Let me read the entry point.',
      'Reading index.ts',
      'Running: npm test',
    ])
  })

  it('omits narration text but keeps tool calls when includeText is false', () => {
    const msg = assistant([
      { type: 'text', text: '{"summary":"do a thing","steps":["a","b"]}' },
      { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } },
    ])
    expect(describeAgentMessage(msg, { includeText: false })).toEqual(['Finding files: **/*.ts'])
  })

  it('ignores empty text blocks and non-assistant messages', () => {
    expect(describeAgentMessage(assistant([{ type: 'text', text: '   ' }]))).toEqual([])
    expect(describeAgentMessage({ type: 'result', result: 'done' })).toEqual([])
    expect(describeAgentMessage({ type: 'assistant', message: {} })).toEqual([])
    expect(describeAgentMessage(null)).toEqual([])
    expect(describeAgentMessage({})).toEqual([])
  })
})

describe('summarizeArgs', () => {
  it('joins key=value pairs and skips internal/empty fields', () => {
    expect(summarizeArgs({ query: 'jazz', type: 'track' })).toBe('query=jazz type=track')
    expect(summarizeArgs({ name: 'X', _suppressUi: false })).toBe('name=X')
    expect(summarizeArgs({ a: '', b: null, c: 'ok' })).toBe('c=ok')
  })

  it('truncates very long values', () => {
    const out = summarizeArgs({ q: 'x'.repeat(100) })
    expect(out.length).toBeLessThan(70)
    expect(out.endsWith('…')).toBe(true)
  })
})
