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
        embedding BLOB NOT NULL,
        type TEXT NOT NULL DEFAULT 'fact',
        source TEXT NOT NULL DEFAULT 'explicit',
        salience REAL NOT NULL DEFAULT 1.0,
        last_accessed INTEGER NOT NULL DEFAULT 0,
        access_count INTEGER NOT NULL DEFAULT 0
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
        email TEXT NOT NULL DEFAULT '',
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
      CREATE INDEX IF NOT EXISTS idx_user_events_composite ON user_events(event_type, ts);

      CREATE TABLE IF NOT EXISTS custom_commands (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        target TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'exe',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        fire_at INTEGER NOT NULL,
        fired INTEGER DEFAULT 0
      );
    `)
    try {
      db.exec(`ALTER TABLE entities ADD COLUMN email TEXT NOT NULL DEFAULT ''`)
    } catch { /* column already exists */ }
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_unique ON entities(name COLLATE NOCASE)`)
    } catch { /* already exists */ }
    for (const col of [
      `ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'fact'`,
      `ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'explicit'`,
      `ALTER TABLE memories ADD COLUMN salience REAL NOT NULL DEFAULT 1.0`,
      `ALTER TABLE memories ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`,
    ]) {
      try { db.exec(col) } catch { /* column already exists */ }
    }

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
    _prefCache = null // a new event invalidates the cached preference summary
  } catch { /* non-critical */ }
}

// Preference summary is rebuilt from a 30-day aggregate query on every turn, but
// the underlying counts barely move minute-to-minute — cache it briefly so chat
// latency doesn't pay for two GROUP BY scans each request.
let _prefCache: { value: string | null; at: number; days: number } | null = null
const PREF_CACHE_TTL_MS = 5 * 60_000

export function getPreferenceSummary(days = 30): string | null {
  if (!dbAvailable) return null
  const nowTs = Date.now()
  if (_prefCache && _prefCache.days === days && nowTs - _prefCache.at < PREF_CACHE_TTL_MS) {
    return _prefCache.value
  }
  const since = nowTs - days * 86_400_000
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

    if (topTools.length === 0 && topSearches.length === 0) {
      _prefCache = { value: null, at: nowTs, days }
      return null
    }

    const parts: string[] = []
    if (topTools.length > 0) {
      parts.push(`Frequently used: ${topTools.map(t => `${t.value.replace(/_/g, ' ')} (${t.cnt}×)`).join(', ')}`)
    }
    if (topSearches.length > 0) {
      parts.push(`Common searches: ${topSearches.map(t => t.value).join(', ')}`)
    }
    const result = parts.join('. ')
    _prefCache = { value: result, at: nowTs, days }
    return result
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
  email: string
  updatedAt: number
}

function relationshipAliases(relationship: string): string[] {
  const lower = relationship.toLowerCase()
  const aliases: string[] = []
  if (lower.includes('mother') || lower.includes('mom')) aliases.push('mom', 'mother')
  if (lower.includes('father') || lower.includes('dad')) aliases.push('dad', 'father')
  return aliases
}

export function upsertEntity(
  name: string,
  type: string,
  relationship: string,
  context: string,
  aliases: string[] = [],
  email = '',
): void {
  if (!dbAvailable) return
  const existing = getDb().prepare(
    `SELECT * FROM entities WHERE name = ? COLLATE NOCASE`
  ).get(name) as {
    id: number
    relationship: string
    context: string
    email: string
    aliases: string
  } | undefined

  const relAliases = relationshipAliases(relationship)
  const mergedAliases = [...new Set([
    ...aliases,
    ...relAliases,
    ...(existing ? JSON.parse(existing.aliases ?? '[]') as string[] : []),
  ])]

  if (existing) {
    const mergedRelationship = relationship.trim() || existing.relationship
    const mergedEmail = email.trim() || existing.email || ''
    const mergedContext = mergeEntityContext(existing.context, context)
    getDb().prepare(
      `UPDATE entities SET type=?, relationship=?, context=?, email=?, aliases=?, updated_at=? WHERE id=?`
    ).run(type, mergedRelationship, mergedContext, mergedEmail, JSON.stringify(mergedAliases), Date.now(), existing.id)
  } else {
    getDb().prepare(
      `INSERT INTO entities (name, type, relationship, context, email, aliases, updated_at) VALUES (?,?,?,?,?,?,?)`
    ).run(name, type, relationship, context, email.trim(), JSON.stringify(mergedAliases), Date.now())
  }
}

function mergeEntityContext(oldCtx: string, newCtx: string): string {
  const o = oldCtx.trim()
  const n = newCtx.trim()
  if (!n) return o
  if (!o) return n
  const vague = /^(email recipient|mom'?s email|dad'?s email|email|email address)$/i
  if (vague.test(n) && !vague.test(o)) return o
  if (o.includes(n)) return o
  if (n.includes(o)) return n
  return `${o}; ${n}`
}

export function findEntityByContactRef(ref: string): Entity | null {
  const needle = ref.trim().toLowerCase()
  if (!needle) return null
  const all = getAllEntities()
  return all.find(entity => {
    if (entity.name.toLowerCase() === needle) return true
    if ((entity.aliases as string[]).some(a => a.toLowerCase() === needle)) return true
    if (entity.relationship.toLowerCase().includes(needle)) return true
    return relationshipAliases(entity.relationship).some(a => a === needle)
  }) ?? null
}

export function getAllEntities(): Entity[] {
  if (!dbAvailable) return []
  const rows = getDb().prepare('SELECT * FROM entities ORDER BY updated_at DESC').all() as any[]
  return rows.map(r => ({
    ...r,
    email: r.email ?? '',
    aliases: JSON.parse(r.aliases ?? '[]'),
    updatedAt: r.updated_at,
  }))
}

export function getEntityCount(): number {
  if (!dbAvailable) return 0
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM entities').get() as { n: number }
  return row?.n ?? 0
}

export function findMentionedEntities(text: string): Entity[] {
  const all = getAllEntities()
  const lower = text.toLowerCase()
  return all.filter(e => {
    if (lower.includes(e.name.toLowerCase())) return true
    if ((e.aliases as string[]).some((a: string) => lower.includes(a.toLowerCase()))) return true
    const rel = e.relationship.toLowerCase()
    if (rel && lower.includes(rel)) return true
    return relationshipAliases(e.relationship).some(a => lower.includes(a))
  })
}

// ── Memories ──────────────────────────────────────────────────────────────────

export function insertMemory(
  text: string,
  embedding: Float32Array,
  type = 'fact',
  source = 'explicit',
): number {
  if (!dbAvailable) return 0
  // Serialize ONLY this view's bytes — transformers.js returns subarray views
  // into a pooled buffer; Buffer.from(embedding.buffer) would capture garbage.
  const info = getDb().prepare(`
    INSERT INTO memories (timestamp, text, embedding, type, source, salience, last_accessed, access_count)
    VALUES (?, ?, ?, ?, ?, 1.0, 0, 0)
  `).run(Date.now(), text, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength), type, source)
  return Number(info.lastInsertRowid)
}

export function getAllMemories(): Array<{
  id: number; text: string; timestamp: number; embedding: Float32Array
  type: string; salience: number; lastAccessed: number; accessCount: number
}> {
  if (!dbAvailable) return []
  const rows = getDb().prepare(
    'SELECT id, text, timestamp, embedding, type, salience, last_accessed, access_count FROM memories ORDER BY timestamp DESC',
  ).all() as Array<{
    id: number; text: string; timestamp: number; embedding: Buffer
    type: string; salience: number; last_accessed: number; access_count: number
  }>
  return rows.map(r => ({
    id: r.id,
    text: r.text,
    timestamp: r.timestamp,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4),
    type: r.type,
    salience: r.salience,
    lastAccessed: r.last_accessed,
    accessCount: r.access_count,
  }))
}

export function getMemoryCount(): number {
  if (!dbAvailable) return 0
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }
  return row?.n ?? 0
}

export function bumpMemoryAccess(ids: number[], ts: number): void {
  if (!dbAvailable || ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  try {
    getDb().prepare(
      `UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id IN (${placeholders})`,
    ).run(ts, ...ids)
  } catch { /* non-critical: ranking still works from in-memory bumps */ }
}

export function mergeMemory(id: number, text: string, ts: number, salienceBump = 0.25): void {
  if (!dbAvailable) return
  getDb().prepare(
    `UPDATE memories SET text = ?, timestamp = ?, salience = salience + ? WHERE id = ?`,
  ).run(text, ts, salienceBump, id)
}

export function deleteMemory(id: number): void {
  if (!dbAvailable) return
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
}

// ── Reminders ────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string
  text: string
  fireAt: number
  fired: boolean
}

export function insertReminder(id: string, text: string, fireAt: number): void {
  if (!dbAvailable) return
  getDb().prepare(
    'INSERT INTO reminders (id, text, fire_at, fired) VALUES (?, ?, ?, 0)',
  ).run(id, text, fireAt)
}

export function getDueReminders(): Reminder[] {
  if (!dbAvailable) return []
  const now = Date.now()
  return (getDb().prepare(
    'SELECT id, text, fire_at as fireAt, fired FROM reminders WHERE fired = 0 AND fire_at <= ?',
  ).all(now) as Array<{ id: string; text: string; fireAt: number; fired: number }>)
    .map(r => ({ ...r, fired: r.fired === 1 }))
}

export function markReminderFired(id: string): void {
  if (!dbAvailable) return
  getDb().prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(id)
}
