import { describe, it, expect, vi } from 'vitest'

vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: unknown, out: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: 'ran ok', stderr: '' })
  }),
}))

describe('execute tool', () => {
  it('exports executeToolDefs and handleExecuteTool', async () => {
    const mod = await import('../../../src/backend/tools/execute')
    expect(Array.isArray(mod.executeToolDefs)).toBe(true)
    expect(typeof mod.handleExecuteTool).toBe('function')
    expect(mod.executeToolDefs.map(t => t.name)).toContain('execute_file')
  })

  // Approval now happens upstream in handleTool's destructive-tool gate
  // (tools/index.ts) — by the time queueExecute/handleExecuteTool runs, the
  // user has already approved. It runs the file directly and returns the
  // real output string for the model to report.
  it('execute_file runs the file directly and returns its output', async () => {
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    const home = process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users'
    const reply = await handleExecuteTool('execute_file', { path: `${home}\\demo.bat` })
    expect(reply).toBe('ran ok')
  })

  it('execute_file rejects paths outside allowed roots', async () => {
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    await expect(handleExecuteTool('execute_file', { path: 'C:\\Windows\\System32\\evil.exe' })).rejects.toThrow()
  })
})
