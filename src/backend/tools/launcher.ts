import { exec } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { findCustomCommandByAlias } from '../memory/customCommands'
import type { CustomCommand } from '../types'

const execAsync = promisify(exec)

// Only allow alphanumeric + spaces + dots + hyphens in app names
const SAFE_NAME_RE = /^[a-zA-Z0-9 .\-_]+$/

// Apps that only respond to their URI protocol, not `start "name"`.
// Discord, Spotify, and Teams are installed per-user and not on PATH.
const PROTOCOL_URIS: Record<string, string> = {
  'discord': 'discord://',
  'spotify': 'spotify:',
  'teams': 'msteams:',
}

// Common Windows app aliases → executable name or protocol key
const APP_ALIASES: Record<string, string> = {
  'vs code': 'code',
  'vscode': 'code',
  'visual studio code': 'code',
  'notepad': 'notepad',
  'chrome': 'chrome',
  'google chrome': 'chrome',
  'spotify': 'spotify',
  'explorer': 'explorer',
  'file explorer': 'explorer',
  'terminal': 'wt',
  'windows terminal': 'wt',
  'powershell': 'powershell',
  'discord': 'discord',
  'slack': 'slack',
  'firefox': 'firefox',
  'edge': 'msedge',
  'microsoft edge': 'msedge',
  'calculator': 'calc',
  'paint': 'mspaint',
  'word': 'winword',
  'excel': 'excel',
  'powerpoint': 'powerpnt',
  'outlook': 'outlook',
  'teams': 'teams',
  'microsoft teams': 'teams',
  'task manager': 'taskmgr',
  'marvel rivals': 'marvel-rivals',
  'rivals': 'marvel-rivals',
  'marvel': 'marvel-rivals',
}

interface SteamGame {
  appId: string
  folder: string
  exe: string
  label: string
}

const STEAM_GAMES: Record<string, SteamGame> = {
  'marvel-rivals': {
    appId: '2767030',
    folder: 'MarvelRivals',
    exe: 'MarvelRivals_Launcher.exe',
    label: 'Marvel Rivals',
  },
}

export function getSteamLibraryRoots(): string[] {
  const roots: string[] = []
  const candidates = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Steam') : '',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Steam') : '',
  ].filter(Boolean)

  for (const root of candidates) {
    if (!existsSync(root)) continue
    roots.push(root)
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    if (!existsSync(vdf)) continue
    try {
      const content = readFileSync(vdf, 'utf8')
      for (const m of content.matchAll(/"path"\s+"([^"]+)"/g)) {
        const lib = m[1].replace(/\\\\/g, '\\')
        if (existsSync(lib)) roots.push(lib)
      }
    } catch { /* ignore malformed vdf */ }
  }

  return [...new Set(roots)]
}

export function findSteamGameExe(gameKey: string): string | null {
  const game = STEAM_GAMES[gameKey]
  if (!game) return null
  for (const root of getSteamLibraryRoots()) {
    const exePath = join(root, 'steamapps', 'common', game.folder, game.exe)
    if (existsSync(exePath)) return exePath
  }
  return null
}

async function launchCustomCommand(cmd: CustomCommand): Promise<string> {
  if (cmd.kind === 'uri') {
    await execAsync(`start "" "${cmd.target}"`, { shell: 'cmd.exe' })
    return `Launched ${cmd.label}`
  }
  if (cmd.kind === 'shell') {
    if (!SAFE_NAME_RE.test(cmd.target)) throw new Error(`Invalid shell target for "${cmd.label}"`)
    const [exe, ...argParts] = cmd.target.split(' ')
    const argStr = argParts.join(' ')
    const shellCmd = argStr ? `start "" "${exe}" ${argStr}` : `start "" "${exe}"`
    await execAsync(shellCmd, { shell: 'cmd.exe' })
    return `Launched ${cmd.label}`
  }
  if (!existsSync(cmd.target)) {
    throw new Error(`"${cmd.label}" target not found: ${cmd.target}. Use command_register to update it.`)
  }
  await execAsync(`start "" "${cmd.target}"`, { shell: 'cmd.exe' })
  return `Launched ${cmd.label}`
}

async function launchSteamGame(gameKey: string): Promise<string> {
  const game = STEAM_GAMES[gameKey]
  if (!game) throw new Error(`Unknown Steam game: ${gameKey}`)

  const exePath = findSteamGameExe(gameKey)
  if (exePath) {
    await execAsync(`start "" "${exePath}"`, { shell: 'cmd.exe' })
    return `Launched ${game.label}`
  }

  await execAsync(`start "" "steam://rungameid/${game.appId}"`, { shell: 'cmd.exe' })
  return `Launched ${game.label} via Steam`
}

export async function launchApp(appName: string): Promise<string> {
  if (!appName) throw new Error('App name is required')
  const normalized = appName.toLowerCase().trim()

  const custom = findCustomCommandByAlias(normalized)
  if (custom) return launchCustomCommand(custom)

  const resolved = APP_ALIASES[normalized] ?? normalized

  if (STEAM_GAMES[resolved]) {
    return launchSteamGame(resolved)
  }

  // Protocol-URI apps (Discord, Spotify, Teams) are not on PATH
  const protocolUri = PROTOCOL_URIS[resolved]
  if (protocolUri) {
    await execAsync(`start "" "${protocolUri}"`, { shell: 'cmd.exe' })
    return `Launched ${appName}`
  }

  if (!SAFE_NAME_RE.test(resolved)) {
    throw new Error(`Invalid app name: "${appName}"`)
  }

  const [exe, ...argParts] = resolved.split(' ')
  const argStr = argParts.join(' ')
  const cmd = argStr
    ? `start "" "${exe}" ${argStr}`
    : `start "" "${exe}"`
  await execAsync(cmd, { shell: 'cmd.exe' })
  return `Launched ${appName}`
}

export const launcherToolDefs = [
  {
    name: 'app_launch',
    description: 'Opens/starts a Windows application, game, or saved custom launch command by its name. Use whenever the user says "open X", "launch X", "start X", or "fire up X" where X is an app or game, e.g. "open Spotify", "launch Chrome", "start Marvel Rivals", "open Discord". Handles common app aliases, Steam games, and protocol apps automatically. Do NOT use this to open a file or folder in an editor (use vscode_open) or to control Spotify playback (use spotify_play). If the app name is unknown and this tool errors, call command_find_executable to locate the .exe, then command_register to save it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string', description: 'The app or game name as the user said it, e.g. "VS Code", "Chrome", "Spotify", "rivals". Aliases and saved custom commands are resolved automatically.' },
      },
      required: ['app_name'],
    },
  },
]

export async function handleLauncherTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'app_launch') return launchApp(input.app_name)
  throw new Error(`Unknown tool: ${name}`)
}
