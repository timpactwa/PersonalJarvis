import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/jarvis-tools-test.db'

vi.mock('../../../src/backend/claude', () => ({
  isChatAvailable: vi.fn(() => true),
}))

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

describe('jarvis settings tools', () => {
  it('returns formatted settings', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { getJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const text = getJarvisSettings()
    expect(text).toContain('Active provider:')
    expect(text).toContain('Push-to-talk hotkey: Alt+Space')
  })

  it('updates llmProvider and emits settings event', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { emitEvent } = await import('../../../src/backend/events')
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const result = setJarvisSettings({ llmProvider: 'groq' })
    expect(result).toContain('llmProvider')
    expect(result).toContain('groq')
    expect(vi.mocked(emitEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings', settings: expect.objectContaining({ llmProvider: 'groq' }) }),
    )
  })

  it('rejects invalid provider', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    initDb()
    expect(() => setJarvisSettings({ llmProvider: 'openai' })).toThrow('Invalid llmProvider')
  })

  it('reports usage stats', async () => {
    const { initDb, logApiCall } = await import('../../../src/backend/memory/db')
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    initDb()
    logApiCall({ model: 'groq:llama-3.3-70b-versatile', inputTokens: 100, outputTokens: 50 })
    const text = getJarvisUsage(7)
    expect(text).toContain('Today:')
    expect(text).toContain('tokens')
  })

  it('throws when no settings fields are provided', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    initDb()
    expect(() => setJarvisSettings({})).toThrow('No settings provided')
  })

  it('updates shortTurns and returns value in result', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const result = setJarvisSettings({ shortTurns: 25 })
    expect(result).toContain('25')
  })

  it('throws when shortTurns is too low', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    initDb()
    expect(() => setJarvisSettings({ shortTurns: 1 })).toThrow('shortTurns must be between 2 and 50')
  })

  it('updates userProfile and returns formatted settings', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setJarvisSettings, getJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    initDb()
    setJarvisSettings({ userProfile: 'I am a software engineer in Blacksburg.' })
    const settings = getJarvisSettings()
    expect(settings).toContain('software engineer')
  })

  it('getJarvisUsage output contains Last N days and By model sections', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const text = getJarvisUsage(7)
    expect(text).toContain('Last 7 days:')
    expect(text).toContain('Today:')
    expect(text).toContain('By model:')
  })

  it('getJarvisUsage with no arg defaults to 7 days', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    initDb()
    // getJarvisUsage(0) falsy-coerces to 7; same as calling with no argument
    const text = getJarvisUsage(0)
    expect(text).toContain('Last 7 days:')
  })

  it('getJarvisUsage clamps 999 days to 30', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const text = getJarvisUsage(999)
    expect(text).toContain('Last 30 days:')
  })

  it('handleJarvisTool routes jarvis_get_settings', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const result = await handleJarvisTool('jarvis_get_settings', {})
    expect(result).toContain('Active provider:')
  })

  it('handleJarvisTool routes jarvis_set_settings', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const result = await handleJarvisTool('jarvis_set_settings', { llmProvider: 'groq' })
    expect(result).toContain('groq')
  })

  it('handleJarvisTool routes jarvis_get_usage', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    initDb()
    const result = await handleJarvisTool('jarvis_get_usage', { days: 7 })
    expect(result).toContain('Today:')
  })

  it('handleJarvisTool throws Unknown jarvis tool for unrecognized name', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    initDb()
    await expect(handleJarvisTool('jarvis_unknown_tool', {})).rejects.toThrow('Unknown jarvis tool')
  })
})
