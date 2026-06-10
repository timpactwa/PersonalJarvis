import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Only allow alphanumeric + spaces + dots + hyphens in app names
const SAFE_NAME_RE = /^[a-zA-Z0-9 .\-_]+$/

// Common Windows app aliases
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
  'teams': 'ms-teams',
  'task manager': 'taskmgr',
}

export async function launchApp(appName: string): Promise<string> {
  if (!appName) throw new Error('App name is required')
  const normalized = appName.toLowerCase().trim()
  const resolved = APP_ALIASES[normalized] ?? normalized

  if (!SAFE_NAME_RE.test(resolved)) {
    throw new Error(`Invalid app name: "${appName}"`)
  }

  await execAsync(`start "" "${resolved}"`, { shell: 'cmd.exe' })
  return `Launched ${appName}`
}

export const launcherToolDefs = [
  {
    name: 'app_launch',
    description: 'Launch a Windows application by name (e.g., "VS Code", "Chrome", "Spotify", "File Explorer")',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string', description: 'Application name (e.g., "VS Code", "Chrome", "Spotify")' },
      },
      required: ['app_name'],
    },
  },
]

export async function handleLauncherTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'app_launch') return launchApp(input.app_name)
  throw new Error(`Unknown tool: ${name}`)
}
