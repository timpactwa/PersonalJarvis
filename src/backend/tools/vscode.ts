import { exec } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'

const execAsync = promisify(exec)

export async function openInVSCode(target: string, line?: number): Promise<string> {
  if (!target) throw new Error('Path is required')
  const resolved = resolve(target)
  const gotoArg = line ? `:${line}` : ''
  await execAsync(`code "${resolved}${gotoArg}"`, { shell: 'cmd.exe' })
  return `Opened ${target} in VS Code`
}

export const vscodeToolDefs = [
  {
    name: 'vscode_open',
    description: 'Open a file or folder in VS Code. Use this when the user asks to open, edit, or view code/files in VS Code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file or folder to open' },
        line: { type: 'number', description: 'Optional line number to jump to' },
      },
      required: ['path'],
    },
  },
]

export async function handleVSCodeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === 'vscode_open') return openInVSCode(input.path as string, input.line as number | undefined)
  throw new Error(`Unknown tool: ${name}`)
}
