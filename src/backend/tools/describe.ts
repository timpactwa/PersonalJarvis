/**
 * Maps a tool call to a short, plain-language description for the Activity log.
 * Keeps raw tool names (`spotify_play`, `app_launch`) out of the user-facing
 * feed — those go to the technical Console pane instead.
 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function describeTool(name: string, input: Record<string, unknown> = {}): string {
  if (!name) return 'Working…'
  switch (name) {
    case 'app_launch': {
      // The tool's parameter is `app_name`; fall back to `name` for resilience.
      const app = str(input.app_name) || str(input.name)
      return app ? `Launching ${app}` : 'Launching an app'
    }
    case 'web_search': {
      const q = str(input.query)
      return q ? `Searching the web for “${q}”` : 'Searching the web'
    }
    case 'spotify_play': {
      const q = str(input.query)
      return q ? `Playing “${q}”` : 'Starting playback'
    }
    case 'spotify_pause':   return 'Pausing music'
    case 'spotify_next':    return 'Skipping to the next track'
    case 'spotify_prev':    return 'Going to the previous track'
    case 'spotify_current': return 'Checking what’s playing'
    case 'spotify_volume':  return 'Adjusting the volume'
    case 'spotify_queue':   return 'Adding to the queue'
    case 'spotify_search':  return 'Searching Spotify'
    case 'spotify_my_playlists': return 'Looking up your playlists'
    case 'jarvis_screenshot': return 'Taking a screenshot'
    case 'spawn_agent':     return 'Dispatching an agent'
    case 'execute_file':    return 'Running a command'
    case 'vscode_open':     return 'Opening VS Code'
    case 'request_capability': return 'Requesting a new capability'
  }

  if (name.startsWith('fs_'))        return 'Accessing files'
  if (name.startsWith('gmail_'))     return 'Working with your email'
  if (name.startsWith('calendar_'))  return 'Checking your calendar'
  if (name.startsWith('github_'))    return 'Checking GitHub'
  if (name.startsWith('web_'))       return 'Searching the web'
  if (name.startsWith('command_'))   return 'Running a saved command'
  if (name.startsWith('jarvis_'))    return 'Adjusting Jarvis'

  // Fallback: humanize the raw name.
  return name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

/** Last path segment of a file path, tolerant of both `/` and `\` separators. */
function baseName(p: unknown): string {
  const s = str(p)
  if (!s) return ''
  const seg = s.split(/[\\/]/).filter(Boolean).pop()
  return seg ?? s
}

function clip(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Plain-language description of a Claude Agent SDK tool call (Read/Edit/Bash/…),
 * for streaming an improvement/worker agent's live actions to the Activity log.
 * These are distinct from the app's own tools handled by `describeTool`, so an
 * unknown name falls through to `describeTool` (which humanizes as a last resort).
 */
export function describeAgentTool(name: string, input: Record<string, unknown> = {}): string {
  if (!name) return 'Working…'
  switch (name) {
    case 'Read':      { const f = baseName(input.file_path); return f ? `Reading ${f}` : 'Reading a file' }
    case 'Edit':      { const f = baseName(input.file_path); return f ? `Editing ${f}` : 'Editing a file' }
    case 'MultiEdit': { const f = baseName(input.file_path); return f ? `Editing ${f}` : 'Editing a file' }
    case 'Write':     { const f = baseName(input.file_path); return f ? `Writing ${f}` : 'Writing a file' }
    case 'NotebookEdit': { const f = baseName(input.notebook_path); return f ? `Editing ${f}` : 'Editing a notebook' }
    case 'Glob':      { const p = str(input.pattern); return p ? `Finding files: ${p}` : 'Finding files' }
    case 'Grep':      { const p = str(input.pattern); return p ? `Searching for “${clip(p, 40)}”` : 'Searching the code' }
    case 'Bash':      { const c = str(input.command); return c ? `Running: ${clip(c)}` : 'Running a command' }
    case 'WebSearch': { const q = str(input.query); return q ? `Searching the web for “${clip(q, 40)}”` : 'Searching the web' }
    case 'WebFetch':  { const u = str(input.url); return u ? `Fetching ${clip(u)}` : 'Fetching a page' }
    case 'Task':      return 'Delegating to a sub-agent'
    case 'TodoWrite': return 'Updating its task list'
  }
  return describeTool(name, input)
}

/**
 * Extracts a flat list of human-readable actions from one Agent SDK `assistant`
 * message: narration text blocks verbatim, and `tool_use` blocks translated via
 * `describeAgentTool`. Non-assistant messages and empty content yield `[]`.
 */
export function describeAgentMessage(
  message: unknown,
  opts: { includeText?: boolean } = {},
): string[] {
  const includeText = opts.includeText ?? true
  if (!message || typeof message !== 'object') return []
  const m = message as {
    type?: string
    message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }> }
  }
  if (m.type && m.type !== 'assistant') return []
  const blocks = m.message?.content
  if (!Array.isArray(blocks)) return []
  const out: string[] = []
  for (const b of blocks) {
    if (b.type === 'text') {
      if (!includeText) continue
      const t = b.text?.trim()
      if (t) out.push(t)
    } else if (b.type === 'tool_use' && b.name) {
      out.push(describeAgentTool(b.name, b.input ?? {}))
    }
  }
  return out
}

/** Compact one-line summary of tool args for the Console pane. */
export function summarizeArgs(input: Record<string, unknown> = {}): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith('_')) continue // internal flags like _suppressUi
    if (v == null || v === '') continue
    let val = typeof v === 'string' ? v : JSON.stringify(v)
    if (val.length > 60) val = val.slice(0, 57) + '…'
    parts.push(`${k}=${val}`)
  }
  return parts.join(' ')
}
