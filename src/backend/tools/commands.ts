import { randomUUID } from 'crypto'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { emitEvent } from '../events'
import {
  deleteCustomCommand,
  formatCustomCommandsList,
  getAllCustomCommands,
  upsertCustomCommand,
} from '../memory/customCommands'
import type { CustomCommandDraft, CustomCommandKind } from '../types'
import { getSteamLibraryRoots } from './launcher'

export const commandToolDefs = [
  {
    name: 'command_find_executable',
    description:
      'Searches the user\'s PC (Steam libraries, Program Files, user profile) for executables whose filename matches a query and returns their full paths. Use as the FIRST step when the user wants to teach Jarvis to launch an app you don\'t have a path for, or right after app_launch fails for an unknown app. Follow up with command_register to save the chosen path. This only locates the .exe — it does not launch it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'App or executable name to look for (matched as a filename substring), e.g. "MarvelRivals", "obs", "discord".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'command_register',
    description:
      'Saves a new custom voice launch command (label + voice triggers + launch target), or opens an interactive setup form for the user to confirm the details. Use when the user says "add a command", "teach you to open X", or "remember how to launch X", or after command_find_executable located the .exe. If label, target, or aliases are missing/incomplete it auto-opens the setup form instead of saving blindly. Do NOT use to launch an already-known app (use app_launch).',
    input_schema: {
      type: 'object' as const,
      properties: {
        label: { type: 'string', description: 'Human-readable display name for the command, e.g. "Marvel Rivals".' },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Spoken phrases that should trigger this launch, e.g. ["rivals", "marvel rivals"].',
        },
        target: { type: 'string', description: 'What to launch: a full path to an .exe, a steam:// or app:// URI, or a shell command — depending on "kind".' },
        kind: { type: 'string', enum: ['exe', 'uri', 'shell'], description: 'How "target" is launched: "exe" (file path, default), "uri" (protocol URI), or "shell" (command name on PATH).' },
        open_form: { type: 'boolean', description: 'Set true to force the confirmation setup popup open even when all fields are already provided.' },
      },
      required: [],
    },
  },
  {
    name: 'command_list',
    description: 'Returns the list of custom voice launch commands the user has already saved (their labels, triggers, and targets). Use when the user asks "what commands have I taught you?", "list my custom launchers", or "what can you open?".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'command_remove',
    description: 'Deletes a previously saved custom launch command, matched by its label or one of its voice aliases. Use when the user says "forget the rivals command", "remove the X launcher", or "delete that custom command".',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'The label or an alias of the saved command to remove, e.g. "Marvel Rivals" or "rivals".' },
      },
      required: ['name'],
    },
  },
]

const SEARCH_ROOTS = [
  process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  process.env.ProgramFiles ?? 'C:\\Program Files',
  process.env.USERPROFILE ?? 'C:\\Users',
].filter(Boolean)

function walkForExe(dir: string, query: string, matches: string[], depth: number): void {
  if (depth > 4 || matches.length >= 10 || !existsSync(dir)) return
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>
  } catch {
    return
  }

  const q = query.toLowerCase()
  for (const entry of entries) {
    if (matches.length >= 10) break
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'WindowsApps') continue
    const full = join(dir, entry.name)
    if (entry.name.toLowerCase().endsWith('.exe') && entry.name.toLowerCase().includes(q)) {
      matches.push(full)
    }
    if (entry.isDirectory()) walkForExe(full, query, matches, depth + 1)
  }
}

export function findExecutables(query: string): string[] {
  const q = query.trim().toLowerCase().replace(/\.exe$/i, '')
  if (!q) return []

  const matches: string[] = []

  for (const root of getSteamLibraryRoots()) {
    const common = join(root, 'steamapps', 'common')
    if (!existsSync(common)) continue
    try {
      for (const folder of readdirSync(common)) {
        if (matches.length >= 10) break
        const dir = join(common, folder)
        walkForExe(dir, q, matches, 0)
      }
    } catch { /* ignore */ }
  }

  for (const root of SEARCH_ROOTS) {
    if (matches.length >= 10) break
    walkForExe(root, q, matches, 0)
  }

  return [...new Set(matches)].slice(0, 10)
}

function parseAliases(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String).map(a => a.trim()).filter(Boolean)
  if (typeof input === 'string') return input.split(',').map(a => a.trim()).filter(Boolean)
  return []
}

function parseKind(input: unknown): CustomCommandKind {
  if (input === 'uri' || input === 'shell') return input
  return 'exe'
}

export function registerCommand(input: Record<string, unknown>): string {
  const label = String(input.label ?? '').trim()
  const aliases = parseAliases(input.aliases)
  const target = String(input.target ?? '').trim()
  const kind = parseKind(input.kind)
  const openForm = !!input.open_form

  const needsForm = openForm || !label || !target || aliases.length === 0

  if (needsForm) {
    const draft: CustomCommandDraft = {
      id: randomUUID(),
      label,
      aliases,
      target,
      kind,
    }
    emitEvent({ type: 'command_compose', draft })
    return 'Opened the launch command setup form — confirm the name, voice triggers, and path, then save.'
  }

  const saved = upsertCustomCommand({ id: randomUUID(), label, aliases, target, kind })
  const triggers = saved.aliases.join(', ')
  return `Saved launch command "${saved.label}". Say "${triggers.split(',')[0]}" to open it.`
}

export function removeCommand(name: string): string {
  const normalized = name.toLowerCase().trim()
  const cmds = getAllCustomCommands()
  const match = cmds.find(c =>
    c.label.toLowerCase() === normalized ||
    c.aliases.some(a => a === normalized),
  )
  if (!match) return `No custom command found for "${name}".`
  deleteCustomCommand(match.id)
  return `Removed launch command "${match.label}".`
}

export async function handleCommandTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'command_find_executable': {
      const query = String(input.query ?? '').trim()
      if (!query) return 'A search query is required.'
      const results = findExecutables(query)
      if (results.length === 0) {
        return `No executables found matching "${query}". Try a shorter name or ask the user for the install folder.`
      }
      return results.map((p, i) => `[${i + 1}] ${p}`).join('\n')
    }
    case 'command_register':
      return registerCommand(input)
    case 'command_list':
      return formatCustomCommandsList()
    case 'command_remove':
      return removeCommand(String(input.name ?? ''))
    default:
      throw new Error(`Unknown command tool: ${name}`)
  }
}
