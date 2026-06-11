import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  exec: vi.fn((
    _cmd: string,
    _opts: object,
    cb: (err: null, stdout: string, stderr: string) => void,
  ) => {
    cb(null, '', '')
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('vscodeToolDefs', () => {
  it('exports vscode_open with a required path field', async () => {
    const { vscodeToolDefs } = await import('../../../src/backend/tools/vscode')
    expect(vscodeToolDefs.map(t => t.name)).toContain('vscode_open')
    const def = vscodeToolDefs.find(t => t.name === 'vscode_open')!
    expect(def.input_schema.required).toContain('path')
  })

  it('vscode_open has path and optional line properties', async () => {
    const { vscodeToolDefs } = await import('../../../src/backend/tools/vscode')
    const def = vscodeToolDefs.find(t => t.name === 'vscode_open')!
    expect(def.input_schema.properties).toHaveProperty('path')
    expect(def.input_schema.properties).toHaveProperty('line')
  })
})

describe('openInVSCode', () => {
  it('throws when path is an empty string', async () => {
    const { openInVSCode } = await import('../../../src/backend/tools/vscode')
    await expect(openInVSCode('')).rejects.toThrow('Path is required')
  })

  it('returns a success message containing the path', async () => {
    const { openInVSCode } = await import('../../../src/backend/tools/vscode')
    const result = await openInVSCode('C:\\projects\\jarvis')
    expect(result).toContain('VS Code')
    expect(result).toContain('jarvis')
  })

  it('appends :line to the code command when a line number is provided', async () => {
    const { exec } = await import('child_process')
    const { openInVSCode } = await import('../../../src/backend/tools/vscode')
    await openInVSCode('C:\\file.ts', 42)
    expect(vi.mocked(exec)).toHaveBeenCalledWith(
      expect.stringContaining(':42'),
      expect.any(Object),
      expect.any(Function),
    )
  })

  it('does not append a colon suffix when no line is given', async () => {
    const { exec } = await import('child_process')
    const { openInVSCode } = await import('../../../src/backend/tools/vscode')
    await openInVSCode('C:\\file.ts')
    const callArgs = vi.mocked(exec).mock.calls[0]
    expect(callArgs[0]).not.toMatch(/:\d+/)
  })

  it('passes shell: cmd.exe option to exec', async () => {
    const { exec } = await import('child_process')
    const { openInVSCode } = await import('../../../src/backend/tools/vscode')
    await openInVSCode('C:\\test')
    expect(vi.mocked(exec)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ shell: 'cmd.exe' }),
      expect.any(Function),
    )
  })
})

describe('handleVSCodeTool', () => {
  it('dispatches vscode_open to openInVSCode', async () => {
    const { handleVSCodeTool } = await import('../../../src/backend/tools/vscode')
    const result = await handleVSCodeTool('vscode_open', { path: 'C:\\project' })
    expect(result).toContain('VS Code')
  })

  it('throws for an unknown tool name', async () => {
    const { handleVSCodeTool } = await import('../../../src/backend/tools/vscode')
    await expect(handleVSCodeTool('unknown_tool', { path: 'C:\\test' })).rejects.toThrow('Unknown tool')
  })
})
