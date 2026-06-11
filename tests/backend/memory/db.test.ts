import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/test.db'

function cleanup(): void {
  if (existsSync(TEST_DB)) {
    try { unlinkSync(TEST_DB) } catch { /* handle may be held briefly on Windows */ }
  }
}

describe('database', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  it('initializes schema without error', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    expect(() => initDb()).not.toThrow()
  })

  it('can insert and retrieve a memory', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    insertMemory('User prefers morning meetings', new Float32Array([0.1, 0.2, 0.3]))
    const rows = getAllMemories()
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('User prefers morning meetings')
    expect(rows[0].embedding.length).toBe(3)
  })

  it('logs api calls and aggregates daily stats', async () => {
    const { initDb, logApiCall, getStatsToday } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'claude-fable-5', inputTokens: 100, outputTokens: 50 })
    const stats = getStatsToday()
    expect(stats.tokens).toBe(150)
    expect(stats.cost).toBeGreaterThan(0)
  })

  it('logs local ollama calls at zero cost', async () => {
    const { initDb, logApiCall, getStatsToday } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'ollama:llama3.1:8b', inputTokens: 500, outputTokens: 500 })
    const stats = getStatsToday()
    expect(stats.tokens).toBe(1000)
    expect(stats.cost).toBe(0)
  })

  it('logs groq calls at zero cost', async () => {
    const { initDb, logApiCall, getStatsToday } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'groq:llama-3.3-70b-versatile', inputTokens: 200, outputTokens: 100 })
    const stats = getStatsToday()
    expect(stats.tokens).toBe(300)
    expect(stats.cost).toBe(0)
  })
})

describe('user events / preference learning', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  it('getPreferenceSummary returns null before any events are recorded', async () => {
    const { initDb, getPreferenceSummary } = await import('../../../src/backend/memory/db')
    initDb()
    expect(getPreferenceSummary()).toBeNull()
  })

  it('getPreferenceSummary returns tool usage summary after events are inserted', async () => {
    const { initDb, insertUserEvent, getPreferenceSummary } = await import('../../../src/backend/memory/db')
    initDb()
    insertUserEvent('tool_used', 'web_search')
    insertUserEvent('tool_used', 'web_search')
    insertUserEvent('tool_used', 'app_launch:spotify')
    const summary = getPreferenceSummary()
    expect(summary).not.toBeNull()
    expect(summary).toContain('web search')
    expect(summary).toContain('2×')
  })

  it('getPreferenceSummary includes common search queries', async () => {
    const { initDb, insertUserEvent, getPreferenceSummary } = await import('../../../src/backend/memory/db')
    initDb()
    insertUserEvent('web_search', 'weather in Blacksburg')
    insertUserEvent('web_search', 'AI news')
    const summary = getPreferenceSummary()
    expect(summary).not.toBeNull()
    expect(summary).toContain('weather in Blacksburg')
  })

  it('insertUserEvent is silently ignored when db is not initialized', async () => {
    const { insertUserEvent } = await import('../../../src/backend/memory/db')
    expect(() => insertUserEvent('tool_used', 'test')).not.toThrow()
  })

  it('getPreferenceSummary returns null when db is not available', async () => {
    const { getPreferenceSummary } = await import('../../../src/backend/memory/db')
    expect(getPreferenceSummary()).toBeNull()
  })
})

describe('entity storage', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  it('inserts and retrieves a person entity', async () => {
    const { initDb, upsertEntity, getAllEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Amanda', 'person', 'girlfriend', 'biology at Virginia Tech', [])
    const entities = getAllEntities()
    expect(entities).toHaveLength(1)
    expect(entities[0].name).toBe('Amanda')
    expect(entities[0].type).toBe('person')
    expect(entities[0].relationship).toBe('girlfriend')
  })

  it('upsertEntity updates an existing entity on second call', async () => {
    const { initDb, upsertEntity, getAllEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Amanda', 'person', 'girlfriend', 'biology at Virginia Tech', [])
    upsertEntity('Amanda', 'person', 'girlfriend', 'graduated from Virginia Tech', ['Mandy'])
    const entities = getAllEntities()
    expect(entities).toHaveLength(1)
    expect(entities[0].context).toBe('graduated from Virginia Tech')
    expect(entities[0].aliases).toContain('Mandy')
  })

  it('stores place entities correctly', async () => {
    const { initDb, upsertEntity, getAllEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('The Lyric', 'place', '', 'favourite coffee shop in Blacksburg', [])
    const entities = getAllEntities()
    expect(entities[0].type).toBe('place')
    expect(entities[0].context).toContain('Blacksburg')
  })

  it('findMentionedEntities returns entities whose name appears in text', async () => {
    const { initDb, upsertEntity, findMentionedEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Amanda', 'person', 'girlfriend', 'biology major', [])
    upsertEntity('Bob', 'person', 'friend', 'works in CS', [])
    const found = findMentionedEntities('I talked to Amanda today')
    expect(found.map(e => e.name)).toContain('Amanda')
    expect(found.map(e => e.name)).not.toContain('Bob')
  })

  it('findMentionedEntities matches on aliases', async () => {
    const { initDb, upsertEntity, findMentionedEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Amanda', 'person', 'girlfriend', 'biology major', ['Mandy'])
    const found = findMentionedEntities('Mandy called me')
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('Amanda')
  })

  it('findMentionedEntities is case-insensitive', async () => {
    const { initDb, upsertEntity, findMentionedEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Amanda', 'person', 'girlfriend', 'biology major', [])
    const found = findMentionedEntities('AMANDA sent me a message')
    expect(found).toHaveLength(1)
  })
})
