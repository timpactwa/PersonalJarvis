import { join } from 'path'

const DB_PATH = process.env.JARVIS_DB_PATH ?? join(process.cwd(), 'jarvis.db')

let db: any = null
let dbAvailable = false
let dbError: string | null = null

export function getDb(): any {
  if (!db && !dbAvailable) throw new Error('Database not available')
  return db
}

export function isDbAvailable(): boolean {
  return dbAvailable
}

// First line of the load error, for surfacing in diagnostics.
export function getDbError(): string | null {
  return dbError
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    dbAvailable = false
  }
}

export function initDb(): void {
  try {
    const Database = require('better-sqlite3')
    db = new Database(DB_PATH)
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE,
        aliases TEXT NOT NULL DEFAULT '[]',
        type TEXT NOT NULL DEFAULT 'person',
        relationship TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_events_ts ON user_events(ts);
      CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);
    `)
    dbAvailable = true
    dbError = null
    console.error('[db] SQLite ready at', DB_PATH)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    dbError = msg.split('\n')[0]
    dbAvailable = false
    console.error('[db] SQLite unavailable — running WITHOUT persistence (memories, settings, and usage stats will not be saved).')
    if (msg.includes('NODE_MODULE_VERSION')) {
      console.error('[db] Cause: better-sqlite3 was compiled for a different runtime (system Node vs Electron ABI mismatch).')
      console.error('[db] Fix:   npm run rebuild:native')
    } else {
      console.error('[db] Error:', msg)
    }
  }
}

const MODEL_COST: Record<string, { input: number; output: number }> = {
  'claude-fable-5':            { input: 0.000003,  output: 0.000015 },
  'claude-sonnet-4-6':         { input: 0.000003,  output: 0.000015 },
  'claude-haiku-4-5-20251001': { input: 0.0000008, output: 0.000001 },
}

export function logApiCall(params: { model: string; inputTokens: number; outputTokens: number }): void {
  if (!dbAvailable) return
  const costUsd = params.model.startsWith('ollama') || params.model.startsWith('groq')
    ? 0
    : (() => {
        const rates = MODEL_COST[params.model] ?? MODEL_COST['claude-fable-5']
        return rates.input * params.inputTokens + rates.output * params.outputTokens
      })()
  getDb().prepare(`
    INSERT INTO api_calls (timestamp, model, input_tokens, output_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?)
  `).run(Date.now(), params.model, params.inputTokens, params.outputTokens, costUsd)
}

export function getStatsToday(): { tokens: number; cost: number } {
  if (!dbAvailable) return { tokens: 0, cost: 0 }
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const row = getDb().prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
      COALESCE(SUM(cost_usd), 0) as cost
    FROM api_calls
    WHERE timestamp >= ?
  `).get(midnight.getTime()) as { tokens: number; cost: number }
  return { tokens: row.tokens, cost: row.cost }
}

export function getUsageDaily(days: number): Array<{ date: string; tokens: number; cost: number }> {
  if (!dbAvailable) return []
  const since = Date.now() - days * 86_400_000
  return getDb().prepare(`
    SELECT date(timestamp / 1000, 'unixepoch', 'localtime') as date,
           COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
           COALESCE(SUM(cost_usd), 0) as cost
    FROM api_calls
    WHERE timestamp >= ?
    GROUP BY date
    ORDER BY date
  `).all(since) as Array<{ date: string; tokens: number; cost: number }>
}

export function getUsageByModel(days: number): Array<{ model: string; tokens: number; cost: number }> {
  if (!dbAvailable) return []
  const since = Date.now() - days * 86_400_000
  return getDb().prepare(`
    SELECT model,
           COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
           COALESCE(SUM(cost_usd), 0) as cost
    FROM api_calls
    WHERE timestamp >= ?
    GROUP BY model
    ORDER BY cost DESC
  `).all(since) as Array<{ model: string; tokens: number; cost: number }>
}

// ── User Events / Preferences ────────────────────────────────────────────────

export function insertUserEvent(eventType: string, value: string, metadata?: string): void {
  if (!dbAvailable) return
  try {
    getDb().prepare(
      `INSERT INTO user_events (ts, event_type, value, metadata) VALUES (?, ?, ?, ?)`
    ).run(Date.now(), eventType, value, metadata ?? null)
  } catch { /* non-critical */ }
}

export function getPreferenceSummary(days = 30): string | null {
  if (!dbAvailable) return null
  const since = Date.now() - days * 86_400_000
  try {
    const topTools = getDb().prepare(`
      SELECT value, COUNT(*) as cnt
      FROM user_events
      WHERE ts >= ? AND event_type = 'tool_used'
      GROUP BY value ORDER BY cnt DESC LIMIT 6
    `).all(since) as Array<{ value: string; cnt: number }>

    const topSearches = getDb().prepare(`
      SELECT value, COUNT(*) as cnt
      FROM user_events
      WHERE ts >= ? AND event_type = 'web_search'
      GROUP BY value ORDER BY cnt DESC LIMIT 3
    `).all(since) as Array<{ value: string; cnt: number }>

    if (topTools.length === 0 && topSearches.length === 0) return null

    const parts: string[] = []
    if (topTools.length > 0) {
      parts.push(`Frequently used: ${topTools.map(t => `${t.value.replace(/_/g, ' ')} (${t.cnt}×)`).join(', ')}`)
    }
    if (topSearches.length > 0) {
      parts.push(`Common searches: ${topSearches.map(t => t.value).join(', ')}`)
    }
    return parts.join('. ')
  } catch { return null }
}

// ── Entities ─────────────────────────────────────────────────────────────────

export interface Entity {
  id: number
  name: string
  aliases: string[]
  type: 'person' | 'place' | 'project' | 'org'
  relationship: string
  context: string
  updatedAt: number
}

export function upsertEntity(
  name: string,
  type: string,
  relationship: string,
  context: string,
  aliases: string[] = [],
): void {
  if (!dbAvailable) return
  const existing = getDb().prepare(
    `SELECT id FROM entities WHERE name = ? COLLATE NOCASE`
  ).get(name) as { id: number } | undefined

  if (existing) {
    getDb().prepare(
      `UPDATE entities SET type=?, relationship=?, context=?, aliases=?, updated_at=? WHERE id=?`
    ).run(type, relationship, context, JSON.stringify(aliases), Date.now(), existing.id)
  } else {
    getDb().prepare(
      `INSERT INTO entities (name, type, relationship, context, aliases, updated_at) VALUES (?,?,?,?,?,?)`
    ).run(name, type, relationship, context, JSON.stringify(aliases), Date.now())
  }
}

export function getAllEntities(): Entity[] {
  if (!dbAvailable) return []
  const rows = getDb().prepare('SELECT * FROM entities ORDER BY updated_at DESC').all() as any[]
  return rows.map(r => ({ ...r, aliases: JSON.parse(r.aliases ?? '[]'), updatedAt: r.updated_at }))
}

export function findMentionedEntities(text: string): Entity[] {
  const all = getAllEntities()
  const lower = text.toLowerCase()
  return all.filter(e => {
    if (lower.includes(e.name.toLowerCase())) return true
    return (e.aliases as string[]).some((a: string) => lower.includes(a.toLowerCase()))
  })
}

// ── Memories ──────────────────────────────────────────────────────────────────

export function insertMemory(text: string, embedding: Float32Array): void {
  if (!dbAvailable) return
  getDb().prepare(`
    INSERT INTO memories (timestamp, text, embedding) VALUES (?, ?, ?)
  `).run(Date.now(), text, Buffer.from(embedding.buffer))
}

export function getAllMemories(): Array<{ id: number; text: string; embedding: Float32Array }> {
  if (!dbAvailable) return []
  const rows = getDb().prepare('SELECT id, text, embedding FROM memories').all() as Array<{ id: number; text: string; embedding: Buffer }>
  return rows.map(r => ({
    id: r.id,
    text: r.text,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4),
  }))
}
