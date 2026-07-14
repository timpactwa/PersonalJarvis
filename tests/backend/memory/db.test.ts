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

  it('round-trips an embedding that is a VIEW into a larger buffer (byteOffset)', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    // transformers.js often returns a subarray view into a pooled buffer. A naive
    // Buffer.from(embedding.buffer) would serialize the whole pool and corrupt recall.
    const pool = new Float32Array([9, 9, 9, 9, 0.5, 0.25, 0.125, 8, 8])
    const view = pool.subarray(4, 7) // [0.5, 0.25, 0.125], non-zero byteOffset
    expect(view.byteOffset).toBeGreaterThan(0)
    insertMemory('viewed embedding', view)
    const rows = getAllMemories()
    expect(rows).toHaveLength(1)
    expect(rows[0].embedding.length).toBe(3)
    expect(Array.from(rows[0].embedding)).toEqual([0.5, 0.25, 0.125])
  })

  it('returns id and timestamp from getAllMemories', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    insertMemory('Likes espresso', new Float32Array([0.1, 0.2, 0.3]))
    const rows = getAllMemories()
    expect(rows[0].id).toBeGreaterThan(0)
    expect(rows[0].timestamp).toBeGreaterThan(0)
  })

  it('deleteMemory removes a memory by id', async () => {
    const { initDb, insertMemory, getAllMemories, deleteMemory } = await import('../../../src/backend/memory/db')
    initDb()
    insertMemory('First fact', new Float32Array([0.1, 0.2, 0.3]))
    insertMemory('Second fact', new Float32Array([0.4, 0.5, 0.6]))
    const before = getAllMemories()
    expect(before).toHaveLength(2)
    const target = before.find(m => m.text === 'First fact')!
    deleteMemory(target.id)
    const after = getAllMemories()
    expect(after).toHaveLength(1)
    expect(after[0].text).toBe('Second fact')
  })

  it('adds metadata columns with defaults for new memories', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    insertMemory('Likes espresso', new Float32Array([0.1, 0.2, 0.3]))
    const [m] = getAllMemories()
    expect(m.type).toBe('fact')
    expect(m.salience).toBe(1)
    expect(m.lastAccessed).toBe(0)
    expect(m.accessCount).toBe(0)
  })

  it('insertMemory returns the new row id and accepts type/source', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    const id = insertMemory("Mom's email is a@b.com", new Float32Array([0.1, 0.2, 0.3]), 'contact', 'contact-hint')
    expect(id).toBeGreaterThan(0)
    const [m] = getAllMemories()
    expect(m.id).toBe(id)
    expect(m.type).toBe('contact')
  })

  it('getAllMemories is no longer capped at 100 rows', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    for (let i = 0; i < 105; i++) insertMemory(`fact ${i}`, new Float32Array([i, 0, 0]))
    expect(getAllMemories().length).toBe(105)
  })

  it('bumpMemoryAccess updates last_accessed and increments access_count', async () => {
    const { initDb, insertMemory, getAllMemories, bumpMemoryAccess } = await import('../../../src/backend/memory/db')
    initDb()
    const id = insertMemory('bump me', new Float32Array([0.1, 0.2, 0.3]))
    bumpMemoryAccess([id], 1_700_000_000_000)
    const [m] = getAllMemories()
    expect(m.lastAccessed).toBe(1_700_000_000_000)
    expect(m.accessCount).toBe(1)
  })

  it('mergeMemory replaces text, refreshes timestamp, and raises salience', async () => {
    const { initDb, insertMemory, getAllMemories, mergeMemory } = await import('../../../src/backend/memory/db')
    initDb()
    const id = insertMemory('old vague text', new Float32Array([0.1, 0.2, 0.3]))
    mergeMemory(id, 'more specific text', 1_700_000_000_001, 0.5)
    const [m] = getAllMemories()
    expect(m.text).toBe('more specific text')
    expect(m.timestamp).toBe(1_700_000_000_001)
    expect(m.salience).toBeCloseTo(1.5)
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

  it('upsertEntity merges context and keeps email on update', async () => {
    const { initDb, upsertEntity, getAllEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Amanda', 'person', 'girlfriend', 'biology at Virginia Tech', [], 'amanda@vt.edu')
    upsertEntity('Amanda', 'person', 'girlfriend', 'graduated from Virginia Tech', ['Mandy'])
    const entities = getAllEntities()
    expect(entities).toHaveLength(1)
    expect(entities[0].context).toContain('biology at Virginia Tech')
    expect(entities[0].context).toContain('graduated from Virginia Tech')
    expect(entities[0].email).toBe('amanda@vt.edu')
    expect(entities[0].aliases).toContain('Mandy')
  })

  it('upsertEntity does not overwrite substantive context with vague email tags', async () => {
    const { initDb, upsertEntity, getAllEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Mom', 'person', 'mother', 'introduced to Jarvis', ['mom'])
    upsertEntity('mom', 'person', 'mother of Tim', 'email recipient', [])
    const entities = getAllEntities()
    expect(entities).toHaveLength(1)
    expect(entities[0].context).toBe('introduced to Jarvis')
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
