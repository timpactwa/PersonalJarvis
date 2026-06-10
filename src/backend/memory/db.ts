import Database from 'better-sqlite3'
import { join } from 'path'

const DB_PATH = process.env.JARVIS_DB_PATH ?? join(process.cwd(), 'jarvis.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) db = new Database(DB_PATH)
  return db
}

export function initDb(): void {
  const d = getDb()
  d.exec(`
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
  `)
}

const MODEL_COST: Record<string, { input: number; output: number }> = {
  'claude-fable-5':            { input: 0.000003,  output: 0.000015 },
  'claude-haiku-4-5-20251001': { input: 0.0000008, output: 0.000001 },
}

export function logApiCall(params: { model: string; inputTokens: number; outputTokens: number }): void {
  const cost = MODEL_COST[params.model] ?? MODEL_COST['claude-fable-5']
  const costUsd = cost.input * params.inputTokens + cost.output * params.outputTokens
  getDb().prepare(`
    INSERT INTO api_calls (timestamp, model, input_tokens, output_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?)
  `).run(Date.now(), params.model, params.inputTokens, params.outputTokens, costUsd)
}

export function getStatsToday(): { tokens: number; cost: number } {
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

export function insertMemory(text: string, embedding: Float32Array): void {
  getDb().prepare(`
    INSERT INTO memories (timestamp, text, embedding) VALUES (?, ?, ?)
  `).run(Date.now(), text, Buffer.from(embedding.buffer))
}

export function getAllMemories(): Array<{ id: number; text: string; embedding: Float32Array }> {
  const rows = getDb().prepare('SELECT id, text, embedding FROM memories').all() as Array<{ id: number; text: string; embedding: Buffer }>
  return rows.map(r => ({
    id: r.id,
    text: r.text,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4),
  }))
}
