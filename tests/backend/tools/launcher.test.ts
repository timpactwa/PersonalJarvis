import { describe, it, expect } from 'vitest'

describe('launcher tool', () => {
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
})
