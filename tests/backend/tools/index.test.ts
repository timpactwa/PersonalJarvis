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
  handleGmailTool: vi.fn(async () => 'gmail result'),
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

vi.mock('../../../src/backend/memory/db', () => ({
  insertUserEvent: vi.fn(),
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

  it('throws for an unknown tool name', async () => {
    const { handleTool } = await import('../../../src/backend/tools/index')
    await expect(handleTool('unknown_tool', {})).rejects.toThrow('Unknown tool: unknown_tool')
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
