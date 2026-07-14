import { exec } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'
import { isUnderRoot } from './filesystem'
import { assertNoShellBreakout } from './shellSafe'

const execAsync = promisify(exec)

const ALLOWED_ROOTS = [resolve(process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users')]

function assertSafePath(filePath: string): string {
  const r = resolve(filePath)
  if (!ALLOWED_ROOTS.some(root => isUnderRoot(r, root))) throw new Error(`Access denied: ${filePath}`)
  return r
}

async function runFileNow(safePath: string): Promise<string> {
  assertNoShellBreakout(safePath, 'file path')
  const { stdout, stderr } = await execAsync(`start "" "${safePath}"`, { shell: 'cmd.exe' })
  return (stdout || stderr || '').trim() || `Executed ${safePath}`
}

// Approval already happened upstream in handleTool's destructive-tool gate
// (tools/index.ts) before this was ever called — run it now and return the
// real output so the model can report it in the same turn.
export async function queueExecute(filePath: string): Promise<string> {
  if (!filePath) throw new Error('File path is required')
  const safe = assertSafePath(filePath)
  return runFileNow(safe)
}

export const executeToolDefs = [
  {
    name: 'execute_file',
    description: 'Runs/executes a file or script on the system (e.g. a .bat, .ps1, .exe, or other runnable file). DESTRUCTIVE — the call is queued and the user must explicitly confirm before it actually runs, so always state what you are about to run. Use when the user asks to "run this script", "execute X", or "run the file at Y". Do NOT use this to open a normal application (use app_launch) or to open a file in an editor (use vscode_open). Restricted to paths under the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the runnable file/script to execute, e.g. C:\\Users\\you\\scripts\\backup.bat.' } },
      required: ['path'],
    },
  },
]

export async function handleExecuteTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'execute_file') return queueExecute(input.path)
  throw new Error(`Unknown tool: ${name}`)
}
