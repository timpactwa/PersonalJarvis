import { randomUUID } from 'crypto'
import { getDb, isDbAvailable } from './db'
import { hasShellBreakout } from '../tools/shellSafe'
import type { CustomCommand, CustomCommandDraft, CustomCommandKind } from '../types'

function parseAliases(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.map(String).map(a => a.toLowerCase().trim()).filter(Boolean)
  } catch { /* legacy */ }
  return raw.split(',').map(a => a.toLowerCase().trim()).filter(Boolean)
}

function rowToCommand(row: {
  id: string
  label: string
  aliases: string
  target: string
  kind: string
  updated_at: number
}): CustomCommand {
  return {
    id: row.id,
    label: row.label,
    aliases: parseAliases(row.aliases),
    target: row.target,
    kind: (row.kind === 'uri' || row.kind === 'shell' ? row.kind : 'exe') as CustomCommandKind,
    updatedAt: row.updated_at,
  }
}

export function getAllCustomCommands(): CustomCommand[] {
  if (!isDbAvailable()) return []
  const rows = getDb().prepare(
    'SELECT id, label, aliases, target, kind, updated_at FROM custom_commands ORDER BY label COLLATE NOCASE',
  ).all() as Array<{ id: string; label: string; aliases: string; target: string; kind: string; updated_at: number }>
  return rows.map(rowToCommand)
}

export function findCustomCommandByAlias(name: string): CustomCommand | null {
  const normalized = name.toLowerCase().trim()
  if (!normalized || !isDbAvailable()) return null

  for (const cmd of getAllCustomCommands()) {
    if (cmd.label.toLowerCase() === normalized) return cmd
    if (cmd.aliases.some(a => a === normalized)) return cmd
  }
  return null
}

export function upsertCustomCommand(draft: CustomCommandDraft): CustomCommand {
  if (!isDbAvailable()) throw new Error('Database not available — cannot save custom commands.')

  const label = draft.label.trim()
  const target = draft.target.trim()
  if (!label) throw new Error('A label is required.')
  if (!target) throw new Error('A target path or URI is required.')
  // Refuse to persist a target that could break out of the quoted cmd.exe
  // argument used to launch it — stops a malicious/garbled registration from
  // becoming a stored command-injection that fires on every later launch.
  if (hasShellBreakout(target)) {
    throw new Error('That target contains an unsafe character (a quote, percent, or line break) and was not saved.')
  }

  const aliases = (draft.aliases ?? [])
    .map(a => a.toLowerCase().trim())
    .filter(Boolean)
  const kind: CustomCommandKind =
    draft.kind === 'uri' || draft.kind === 'shell' ? draft.kind : 'exe'
  const id = draft.id?.trim() || randomUUID()

  getDb().prepare(`
    INSERT INTO custom_commands (id, label, aliases, target, kind, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      aliases = excluded.aliases,
      target = excluded.target,
      kind = excluded.kind,
      updated_at = excluded.updated_at
  `).run(id, label, JSON.stringify(aliases), target, kind, Date.now())

  return rowToCommand(getDb().prepare(
    'SELECT id, label, aliases, target, kind, updated_at FROM custom_commands WHERE id = ?',
  ).get(id) as { id: string; label: string; aliases: string; target: string; kind: string; updated_at: number })
}

export function deleteCustomCommand(id: string): boolean {
  if (!isDbAvailable()) return false
  const result = getDb().prepare('DELETE FROM custom_commands WHERE id = ?').run(id)
  return result.changes > 0
}

export function formatCustomCommandsList(): string {
  const cmds = getAllCustomCommands()
  if (cmds.length === 0) return 'No custom launch commands saved yet.'
  return cmds.map(c =>
    `• ${c.label} — say "${c.aliases[0] ?? c.label.toLowerCase()}" → ${c.target} (${c.kind})`,
  ).join('\n')
}
