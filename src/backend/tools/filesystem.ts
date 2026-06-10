import { readFile as fsRead, readdir } from 'fs/promises'
import { resolve, join } from 'path'

// Allowed roots — prevents path traversal outside user dirs
const ALLOWED_ROOTS = [
  resolve(process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users'),
]

function assertSafePath(filePath: string): string {
  const resolved = resolve(filePath)
  const allowed = ALLOWED_ROOTS.some(root => resolved.startsWith(root))
  if (!allowed) throw new Error(`Access denied: ${filePath}`)
  return resolved
}

export async function readFile(filePath: string): Promise<string> {
  const safe = assertSafePath(filePath)
  const content = await fsRead(safe, 'utf-8')
  return content.slice(0, 50_000) // cap at 50KB
}

export async function listDir(dirPath: string): Promise<string[]> {
  const safe = assertSafePath(dirPath)
  return readdir(safe)
}

export async function searchFiles(basePath: string, query: string): Promise<string[]> {
  const safe = assertSafePath(basePath)
  const matches: string[] = []
  const lowerQuery = query.toLowerCase()

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5 || matches.length >= 20) return
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (matches.length >= 20) break
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const fullPath = join(dir, entry.name)
        if (entry.name.toLowerCase().includes(lowerQuery)) {
          matches.push(fullPath)
        }
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1)
        }
      }
    } catch { /* permission denied or similar */ }
  }

  await walk(safe, 0)
  return matches
}

export const filesystemToolDefs = [
  {
    name: 'fs_read',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the file' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_list',
    description: 'List files in a directory',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to directory' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_search',
    description: 'Search for files by name within a directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        base_path: { type: 'string', description: 'Directory to search in' },
        query: { type: 'string', description: 'Filename pattern to search for' },
      },
      required: ['base_path', 'query'],
    },
  },
]

export async function handleFilesystemTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case 'fs_read':   return readFile(input.path)
    case 'fs_list':   return JSON.stringify(await listDir(input.path))
    case 'fs_search': return JSON.stringify(await searchFiles(input.base_path, input.query))
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
