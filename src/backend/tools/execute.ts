import { exec } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'
import { requestConfirmation } from '../confirm'
import { emitEvent } from '../events'

const execAsync = promisify(exec)

const ALLOWED_ROOTS = [resolve(process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users')]

function assertSafePath(filePath: string): string {
  const r = resolve(filePath)
  if (!ALLOWED_ROOTS.some(root => r.startsWith(root))) throw new Error(`Access denied: ${filePath}`)
  return r
}

async function runFileNow(safePath: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`start "" "${safePath}"`, { shell: 'cmd.exe' })
  return (stdout || stderr || '').trim() || `Executed ${safePath}`
}

export async function queueExecute(filePath: string): Promise<string> {
  if (!filePath) throw new Error('File path is required')
  const safe = assertSafePath(filePath)
  const conf = requestConfirmation('Run file', safe, () => runFileNow(safe))
  emitEvent({ type: 'confirm_request', id: conf.id, action: conf.action, detail: conf.detail })
  return `Ready to run ${filePath}. Please confirm you want me to execute it.`
}

export const executeToolDefs = [
  {
    name: 'execute_file',
    description: 'Run a file or script on the system. Destructive: queued for explicit user confirmation before running. Restricted to the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the file to execute' } },
      required: ['path'],
    },
  },
]

export async function handleExecuteTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'execute_file') return queueExecute(input.path)
  throw new Error(`Unknown tool: ${name}`)
}
