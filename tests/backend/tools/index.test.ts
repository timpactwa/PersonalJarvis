import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/backend/tools/filesystem', () => ({
  filesystemToolDefs: [{ name: 'fs_read', description: 'read', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleFilesystemTool: vi.fn(async () => 'fs result'),
}))

vi.mock('../../../src/backend/tools/launcher', () => ({
  launcherToolDefs: [{ name: 'app_launch', description: 'launch', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleLauncherTool: vi.fn(async () => 'launched'),
}))

vi.mock('../../../src/backend/tools/gmail', () => ({
  gmailToolDefs: [{ name: 'gmail_search', description: 'search', input_schema: { type: 'object', properties: {}, required: [] } }],
  calendarToolDefs: [{ name: 'calendar_list', description: 'list', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleGmailTool: vi.fn(async () => 'email sent'),
}))

vi.mock('../../../src/backend/tools/execute', () => ({
  executeToolDefs: [{ name: 'execute_file', description: 'execute', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleExecuteTool: vi.fn(async () => 'executed'),
}))

vi.mock('../../../src/backend/tools/vscode', () => ({
  vscodeToolDefs: [{ name: 'vscode_open', description: 'open', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleVSCodeTool: vi.fn(async () => 'opened'),
}))

vi.mock('../../../src/backend/agents', () => ({
  agentToolDefs: [{ name: 'spawn_agent', description: 'spawn', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleAgentTool: vi.fn(async () => 'spawned'),
}))

vi.mock('../../../src/backend/tools/search', () => ({
  searchToolDefs: [
    { name: 'web_search', description: 'search', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'web_read', description: 'read', input_schema: { type: 'object', properties: {}, required: [] } },
  ],
  handleSearchTool: vi.fn(async () => 'search result'),
}))

vi.mock('../../../src/backend/tools/commands', () => ({
  commandToolDefs: [
    { name: 'command_register', description: 'register', input_schema: { type: 'object', properties: {}, required: [] } },
  ],
  handleCommandTool: vi.fn(async () => 'command result'),
}))

vi.mock('../../../src/backend/tools/jarvis', () => ({
  jarvisToolDefs: [
    { name: 'jarvis_get_settings', description: 'settings', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'jarvis_set_settings', description: 'set', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'jarvis_get_usage', description: 'usage', input_schema: { type: 'object', properties: {}, required: [] } },
  ],
  handleJarvisTool: vi.fn(async () => 'jarvis result'),
}))

vi.mock('../../../src/backend/tools/vision', () => ({
  visionToolDefs: [{ name: 'jarvis_screenshot', description: 'screenshot', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleVisionTool: vi.fn(async () => 'screenshot result'),
}))

vi.mock('../../../src/backend/tools/github', () => ({
  githubToolDefs: [{ name: 'github_pr_list', description: 'list prs', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleGithubTool: vi.fn(async () => 'github result'),
}))

vi.mock('../../../src/backend/tools/spotify', () => ({
  spotifyToolDefs: [{ name: 'spotify_play', description: 'play', input_schema: { type: 'object', properties: {}, required: [] } }],
  handleSpotifyTool: vi.fn(async () => 'spotify result'),
}))

vi.mock('../../../src/backend/memory/db', () => ({
  insertUserEvent: vi.fn(),
}))

vi.mock('../../../src/backend/events', () => ({
  emitEvent: vi.fn(),
}))

// The destructive-tool gate (fs_write / execute_file) awaits user approval
// inside handleTool before dispatch. Default the mock to "approved" so the
// plain dispatch tests below pass straight through; the gate-specific tests
// override the resolution per call.
vi.mock('../../../src/backend/confirm', () => ({
  awaitApproval: vi.fn(async () => true),
}))

vi.mock('../../../src/backend/turnManager', () => ({
  setAwaitingApproval: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tool registry', () => {
  describe('getTools', () => {
    it('includes all tool families including search', async () => {
      const { getTools } = await import('../../../src/backend/tools/index')
      const names = getTools().map(t => (t as any).name)
      expect(names).toContain('fs_read')
      expect(names).toContain('app_launch')
      expect(names).toContain('gmail_search')
      expect(names).toContain('calendar_list')
      expect(names).toContain('execute_file')
      expect(names).toContain('vscode_open')
      expect(names).toContain('spawn_agent')
      expect(names).toContain('web_search')
      expect(names).toContain('web_read')
      expect(names).toContain('jarvis_get_settings')
      expect(names).toContain('command_register')
    })
  })

  describe('getToolsForGroq', () => {
    it('excludes execute_file (requires human confirmation gate)', async () => {
      const { getToolsForGroq } = await import('../../../src/backend/tools/index')
      const names = getToolsForGroq().map(t => (t as any).name)
      expect(names).not.toContain('execute_file')
    })

    it('includes web_search and app_launch', async () => {
      const { getToolsForGroq } = await import('../../../src/backend/tools/index')
      const names = getToolsForGroq().map(t => (t as any).name)
      expect(names).toContain('web_search')
      expect(names).toContain('app_launch')
    })

    it('does not include spawn_agent (causes Groq HTTP 400)', async () => {
      const { getToolsForGroq } = await import('../../../src/backend/tools/index')
      const names = getToolsForGroq().map(t => (t as any).name)
      expect(names).not.toContain('spawn_agent')
    })
  })

  describe('getToolsForAgent', () => {
    it('excludes spawn_agent to prevent recursive spawning', async () => {
      const { getToolsForAgent } = await import('../../../src/backend/tools/index')
      const names = getToolsForAgent().map(t => (t as any).name)
      expect(names).not.toContain('spawn_agent')
    })

    it('includes filesystem and search tools', async () => {
      const { getToolsForAgent } = await import('../../../src/backend/tools/index')
      const names = getToolsForAgent().map(t => (t as any).name)
      expect(names).toContain('fs_read')
      expect(names).toContain('web_search')
    })
  })
})

describe('handleTool dispatch', () => {
  it('routes fs_ prefix to filesystem handler', async () => {
    const { handleFilesystemTool } = await import('../../../src/backend/tools/filesystem')
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('fs_read', { path: 'file.txt' })
    expect(result).toBe('fs result')
    expect(vi.mocked(handleFilesystemTool)).toHaveBeenCalledWith('fs_read', { path: 'file.txt' })
  })

  it('routes app_launch to launcher handler', async () => {
    const { handleLauncherTool } = await import('../../../src/backend/tools/launcher')
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('app_launch', { name: 'spotify' })
    expect(result).toBe('launched')
    expect(vi.mocked(handleLauncherTool)).toHaveBeenCalledWith('app_launch', { name: 'spotify' })
  })

  it('routes gmail_ prefix to gmail handler', async () => {
    const { handleGmailTool } = await import('../../../src/backend/tools/gmail')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('gmail_search', { query: 'test' })
    expect(vi.mocked(handleGmailTool)).toHaveBeenCalledWith('gmail_search', { query: 'test' })
  })

  it('routes calendar_ prefix to gmail handler (same module)', async () => {
    const { handleGmailTool } = await import('../../../src/backend/tools/gmail')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('calendar_list', {})
    expect(vi.mocked(handleGmailTool)).toHaveBeenCalledWith('calendar_list', {})
  })

  it('routes execute_file to execute handler', async () => {
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('execute_file', { path: 'test.bat' })
    expect(vi.mocked(handleExecuteTool)).toHaveBeenCalled()
  })

  it('routes vscode_open to vscode handler', async () => {
    const { handleVSCodeTool } = await import('../../../src/backend/tools/vscode')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('vscode_open', { path: 'C:\\project' })
    expect(vi.mocked(handleVSCodeTool)).toHaveBeenCalled()
  })

  it('routes spawn_agent to agent handler', async () => {
    const { handleAgentTool } = await import('../../../src/backend/agents')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('spawn_agent', { name: 'Researcher', task: 'do research' })
    expect(vi.mocked(handleAgentTool)).toHaveBeenCalled()
  })

  it('routes web_ prefix to search handler', async () => {
    const { handleSearchTool } = await import('../../../src/backend/tools/search')
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('web_search', { query: 'test' })
    expect(result).toBe('search result')
    expect(vi.mocked(handleSearchTool)).toHaveBeenCalledWith('web_search', { query: 'test' })
  })

  it('routes command_ prefix to commands handler', async () => {
    const { handleCommandTool } = await import('../../../src/backend/tools/commands')
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('command_list', {})
    expect(result).toBe('command result')
    expect(vi.mocked(handleCommandTool)).toHaveBeenCalledWith('command_list', {})
  })

  it('routes jarvis_ prefix to jarvis handler', async () => {
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('jarvis_get_usage', { days: 7 })
    expect(result).toBe('jarvis result')
    expect(vi.mocked(handleJarvisTool)).toHaveBeenCalledWith('jarvis_get_usage', { days: 7 })
  })

  it('throws for an unknown tool name', async () => {
    const { handleTool } = await import('../../../src/backend/tools/index')
    await expect(handleTool('unknown_tool', {})).rejects.toThrow('Unknown tool: unknown_tool')
  })

  it('emits an error event when tool name is unknown', async () => {
    const { emitEvent } = await import('../../../src/backend/events')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await expect(handleTool('nonexistent_tool', {})).rejects.toThrow()
    expect(vi.mocked(emitEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })
})

describe('handleTool preference tracking', () => {
  it('calls insertUserEvent with tool_used for generic tools', async () => {
    const { insertUserEvent } = await import('../../../src/backend/memory/db')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('fs_read', { path: 'file.txt' })
    expect(vi.mocked(insertUserEvent)).toHaveBeenCalledWith('tool_used', 'fs_read')
  })

  it('includes the app name in the tool_used event for app_launch', async () => {
    const { insertUserEvent } = await import('../../../src/backend/memory/db')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('app_launch', { name: 'spotify' })
    expect(vi.mocked(insertUserEvent)).toHaveBeenCalledWith('tool_used', 'app_launch:spotify')
  })

  it('logs both tool_used and web_search events for web_search', async () => {
    const { insertUserEvent } = await import('../../../src/backend/memory/db')
    const { handleTool } = await import('../../../src/backend/tools/index')
    await handleTool('web_search', { query: 'weather today' })
    expect(vi.mocked(insertUserEvent)).toHaveBeenCalledWith('tool_used', 'web_search')
    expect(vi.mocked(insertUserEvent)).toHaveBeenCalledWith('web_search', 'weather today')
  })

  it('still returns the tool result even when insertUserEvent throws', async () => {
    const { insertUserEvent } = await import('../../../src/backend/memory/db')
    vi.mocked(insertUserEvent).mockImplementation(() => { throw new Error('db down') })
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('fs_read', { path: 'file.txt' })
    expect(result).toBe('fs result')
  })
})

describe('handleTool destructive gate', () => {
  it('fs_write awaits approval before dispatching, arming the awaiting-approval flag', async () => {
    const { awaitApproval } = await import('../../../src/backend/confirm')
    const { setAwaitingApproval } = await import('../../../src/backend/turnManager')
    const { handleFilesystemTool } = await import('../../../src/backend/tools/filesystem')
    const { handleTool } = await import('../../../src/backend/tools/index')

    const result = await handleTool('fs_write', { path: 'C:\\notes.txt', content: 'hi' })
    expect(vi.mocked(awaitApproval)).toHaveBeenCalledWith('Write file', 'C:\\notes.txt', expect.anything())
    expect(vi.mocked(setAwaitingApproval)).toHaveBeenNthCalledWith(1, true)
    expect(vi.mocked(setAwaitingApproval)).toHaveBeenNthCalledWith(2, false)
    expect(vi.mocked(handleFilesystemTool)).toHaveBeenCalled()
    expect(result).toBe('fs result')
  })

  it('execute_file awaits approval and returns the real handler output on approve', async () => {
    const { awaitApproval } = await import('../../../src/backend/confirm')
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    const { handleTool } = await import('../../../src/backend/tools/index')

    const result = await handleTool('execute_file', { path: 'C:\\demo.bat' })
    expect(vi.mocked(awaitApproval)).toHaveBeenCalledWith('Run file', 'C:\\demo.bat', expect.anything())
    expect(vi.mocked(handleExecuteTool)).toHaveBeenCalledTimes(1) // exactly one gate, one dispatch
    expect(result).toBe('executed')
  })

  it('declined approval returns the decline string and never dispatches', async () => {
    const { awaitApproval } = await import('../../../src/backend/confirm')
    const { setAwaitingApproval } = await import('../../../src/backend/turnManager')
    const { handleFilesystemTool } = await import('../../../src/backend/tools/filesystem')
    const { handleTool } = await import('../../../src/backend/tools/index')

    vi.mocked(awaitApproval).mockResolvedValueOnce(false)
    const result = await handleTool('fs_write', { path: 'C:\\notes.txt', content: 'hi' })
    expect(result).toBe('User declined this action — do not retry it. Acknowledge and move on.')
    expect(vi.mocked(handleFilesystemTool)).not.toHaveBeenCalled()
    // Flag still cleared on the decline path.
    expect(vi.mocked(setAwaitingApproval)).toHaveBeenLastCalledWith(false)
  })

  it('threads the turn abort signal into awaitApproval', async () => {
    const { awaitApproval } = await import('../../../src/backend/confirm')
    const { handleTool } = await import('../../../src/backend/tools/index')

    const controller = new AbortController()
    await handleTool('fs_write', { path: 'C:\\a.txt', content: 'x' }, { signal: controller.signal })
    expect(vi.mocked(awaitApproval)).toHaveBeenCalledWith('Write file', 'C:\\a.txt', { signal: controller.signal })
  })

  it('non-destructive tools are not gated', async () => {
    const { awaitApproval } = await import('../../../src/backend/confirm')
    const { handleTool } = await import('../../../src/backend/tools/index')

    await handleTool('fs_read', { path: 'file.txt' })
    await handleTool('web_search', { query: 'weather' })
    expect(vi.mocked(awaitApproval)).not.toHaveBeenCalled()
  })

  it('gmail_compose and calendar_create are not gated (editor UIs are the consent)', async () => {
    const { awaitApproval } = await import('../../../src/backend/confirm')
    const { handleTool } = await import('../../../src/backend/tools/index')

    await handleTool('gmail_compose', {}, { userText: 'send an email to bob' })
    await handleTool('calendar_create', {})
    expect(vi.mocked(awaitApproval)).not.toHaveBeenCalled()
  })
})

describe('handleTool gmail guard', () => {
  it('blocks gmail_compose when userText is not an explicit compose request', async () => {
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('gmail_compose', {}, { userText: 'remind me to email bob later' })
    expect(result).toContain('No composer opened')
  })

  it('allows gmail_compose when userText is an explicit compose request', async () => {
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('gmail_compose', {}, { userText: 'send an email to bob' })
    expect(result).toBe('email sent')
  })

  it('allows gmail_compose when no userText context provided', async () => {
    const { handleTool } = await import('../../../src/backend/tools/index')
    const result = await handleTool('gmail_compose', {})
    expect(result).toBe('email sent')
  })
})
