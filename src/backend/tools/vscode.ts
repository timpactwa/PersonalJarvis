import { exec } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'
import { assertNoShellBreakout } from './shellSafe'

const execAsync = promisify(exec)

export async function openInVSCode(target: string, line?: number): Promise<string> {
  if (!target) throw new Error('Path is required')
  const resolved = assertNoShellBreakout(resolve(target), 'file path')
  const gotoArg = line ? `:${line}` : ''
  await execAsync(`code "${resolved}${gotoArg}"`, { shell: 'cmd.exe' })
  return `Opened ${target} in VS Code`
}

export const vscodeToolDefs = [
  {
    name: 'vscode_open',
    description: 'Opens a file or folder in the VS Code editor. Use when the user wants to open, edit, view, or work on code/files specifically in VS Code, e.g. "open this project in VS Code", "edit config.ts", "open my Jarvis folder in code". Do NOT use to launch the VS Code app with no target (use app_launch "VS Code") or to read a file\'s contents into the conversation (use fs_read).',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute (preferred) or relative path to the file or folder to open in VS Code, e.g. C:\\Users\\you\\project or C:\\Users\\you\\project\\config.ts.' },
        line: { type: 'number', description: 'Optional line number to jump the cursor to after opening the file.' },
      },
      required: ['path'],
    },
  },
]

export async function handleVSCodeTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name === 'vscode_open') return openInVSCode(input.path as string, input.line as number | undefined)
  throw new Error(`Unknown tool: ${name}`)
}
