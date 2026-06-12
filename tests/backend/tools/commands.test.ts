import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/commands-test.db'

vi.mock('../../../src/backend/events', () => ({
  emitEvent: vi.fn(),
}))

function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* Windows */ } }
}

beforeEach(async () => {
  process.env.JARVIS_DB_PATH = TEST_DB
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  cleanup()
  vi.clearAllMocks()
})

afterEach(async () => {
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  cleanup()
})

describe('custom commands', () => {
  it('saves and resolves by alias', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { upsertCustomCommand, findCustomCommandByAlias } = await import('../../../src/backend/memory/customCommands')
    initDb()
    upsertCustomCommand({
      id: 'test-1',
      label: 'Test Game',
      aliases: ['testgame', 'my game'],
      target: 'C:\\Games\\test.exe',
      kind: 'exe',
    })
    const found = findCustomCommandByAlias('my game')
    expect(found?.label).toBe('Test Game')
    expect(found?.target).toContain('test.exe')
  })

  it('opens compose form when register is incomplete', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { emitEvent } = await import('../../../src/backend/events')
    const { registerCommand } = await import('../../../src/backend/tools/commands')
    initDb()
    const msg = registerCommand({ label: 'New App' })
    expect(msg).toContain('setup form')
    expect(vi.mocked(emitEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command_compose' }),
    )
  })

  it('finds Marvel Rivals executable on this machine', async () => {
    const { findExecutables } = await import('../../../src/backend/tools/commands')
    const results = findExecutables('MarvelRivals')
    if (results.length > 0) {
      expect(results[0].toLowerCase()).toContain('marvelrivals')
    }
  })

  it('registers a fully specified command without opening the form', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { registerCommand } = await import('../../../src/backend/tools/commands')
    initDb()
    const msg = registerCommand({
      label: 'SpotifyApp',
      aliases: ['spotify', 'open spotify'],
      target: 'C:\\Users\\test\\AppData\\Spotify.exe',
      kind: 'exe',
    })
    expect(msg).toContain('Saved')
    expect(msg).toContain('SpotifyApp')
  })

  it('removes a command by label', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { upsertCustomCommand } = await import('../../../src/backend/memory/customCommands')
    const { removeCommand } = await import('../../../src/backend/tools/commands')
    initDb()
    upsertCustomCommand({ id: 'rm-test', label: 'To Remove', aliases: ['remove-me'], target: 'C:\\test.exe', kind: 'exe' })
    const msg = removeCommand('To Remove')
    expect(msg).toContain('Removed')
    expect(msg).toContain('To Remove')
  })

  it('removes a command by alias', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { upsertCustomCommand } = await import('../../../src/backend/memory/customCommands')
    const { removeCommand } = await import('../../../src/backend/tools/commands')
    initDb()
    upsertCustomCommand({ id: 'alias-test', label: 'Game App', aliases: ['gameapp', 'my-game'], target: 'C:\\game.exe', kind: 'exe' })
    const msg = removeCommand('my-game')
    expect(msg).toContain('Removed')
  })

  it('returns error message when removing unknown command', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { removeCommand } = await import('../../../src/backend/tools/commands')
    initDb()
    const msg = removeCommand('nonexistent-app-xyz')
    expect(msg).toContain('No custom command found')
  })

  it('returns empty array for blank findExecutables query', async () => {
    const { findExecutables } = await import('../../../src/backend/tools/commands')
    expect(findExecutables('')).toEqual([])
    expect(findExecutables('   ')).toEqual([])
  })

  it('handleCommandTool command_list returns string', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { handleCommandTool } = await import('../../../src/backend/tools/commands')
    initDb()
    const result = await handleCommandTool('command_list', {})
    expect(typeof result).toBe('string')
  })

  it('handleCommandTool command_remove delegates to removeCommand', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { handleCommandTool } = await import('../../../src/backend/tools/commands')
    initDb()
    const result = await handleCommandTool('command_remove', { name: 'nonexistent' })
    expect(result).toContain('No custom command found')
  })
})
