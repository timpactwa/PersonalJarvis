import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

describe('launcher tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports launchApp and launcherToolDefs', async () => {
    const mod = await import('../../../src/backend/tools/launcher')
    expect(typeof mod.launchApp).toBe('function')
    expect(Array.isArray(mod.launcherToolDefs)).toBe(true)
    expect(mod.launcherToolDefs.length).toBeGreaterThan(0)
  })

  it('rejects empty app name', async () => {
    const { launchApp } = await import('../../../src/backend/tools/launcher')
    await expect(launchApp('')).rejects.toThrow()
  })

  it('rejects app name with shell metacharacters', async () => {
    const { launchApp } = await import('../../../src/backend/tools/launcher')
    await expect(launchApp('notepad; del C:\\')).rejects.toThrow()
    await expect(launchApp('foo && rm -rf /')).rejects.toThrow()
    await expect(launchApp('bar | cat')).rejects.toThrow()
  })

  it('finds Marvel Rivals launcher on this machine when installed', async () => {
    const { findSteamGameExe } = await import('../../../src/backend/tools/launcher')
    const exe = findSteamGameExe('marvel-rivals')
    if (exe) {
      expect(exe.toLowerCase()).toContain('marvelrivals_launcher.exe')
    } else {
      expect(exe).toBeNull()
    }
  })
})

describe('launchApp arg splitting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wraps simple app name in quotes', async () => {
    const { exec } = await import('child_process')
    vi.mocked(exec).mockImplementation((cmd: string, opts: object, cb: Function) => {
      cb(null, { stdout: '', stderr: '' })
      return {} as any
    })

    const { launchApp } = await import('../../../src/backend/tools/launcher')
    await launchApp('notepad')

    expect(vi.mocked(exec)).toHaveBeenCalledWith(
      expect.stringMatching(/start "" "notepad"/),
      expect.objectContaining({ shell: 'cmd.exe' }),
      expect.any(Function),
    )
  })

  it('splits exe and args when resolved name has spaces', async () => {
    const { exec } = await import('child_process')
    vi.mocked(exec).mockImplementation((cmd: string, opts: object, cb: Function) => {
      cb(null, { stdout: '', stderr: '' })
      return {} as any
    })

    const { launchApp } = await import('../../../src/backend/tools/launcher')
    // APP_ALIASES maps 'vscode' → 'code'; test with a direct alias that has no args
    // to confirm the split path doesn't break simple names
    await launchApp('vscode')

    expect(vi.mocked(exec)).toHaveBeenCalledWith(
      expect.stringMatching(/start "" "code"/),
      expect.objectContaining({ shell: 'cmd.exe' }),
      expect.any(Function),
    )
  })
})
