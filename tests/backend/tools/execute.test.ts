import { describe, it, expect } from 'vitest'

describe('execute tool', () => {
  it('exports executeToolDefs and handleExecuteTool', async () => {
    const mod = await import('../../../src/backend/tools/execute')
    expect(Array.isArray(mod.executeToolDefs)).toBe(true)
    expect(typeof mod.handleExecuteTool).toBe('function')
    expect(mod.executeToolDefs.map(t => t.name)).toContain('execute_file')
  })

  it('execute_file queues a confirmation instead of running immediately', async () => {
    const { clearPending, hasPending } = await import('../../../src/backend/confirm')
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    clearPending()
    const home = process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users'
    const reply = await handleExecuteTool('execute_file', { path: `${home}\\demo.bat` })
    expect(reply.toLowerCase()).toContain('confirm')
    expect(hasPending()).toBe(true)
    clearPending()
  })

  it('execute_file rejects paths outside allowed roots', async () => {
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    await expect(handleExecuteTool('execute_file', { path: 'C:\\Windows\\System32\\evil.exe' })).rejects.toThrow()
  })
})
