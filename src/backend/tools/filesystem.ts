import { readFile as fsRead, readdir, writeFile as fsWrite } from 'fs/promises'
import { resolve, join, sep } from 'path'

// Allowed roots — prevents path traversal outside user dirs
const ALLOWED_ROOTS = [
  resolve(process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users'),
]

// A bare `startsWith(root)` lets a sibling like `C:\Users\tim-backup` pass when
// the root is `C:\Users\tim`. Require the path to BE the root or sit under it
// with a separator boundary.
export function isUnderRoot(resolved: string, root: string): boolean {
  return resolved === root || resolved.startsWith(root.endsWith(sep) ? root : root + sep)
}

function assertSafePath(filePath: string): string {
  const resolved = resolve(filePath)
  const allowed = ALLOWED_ROOTS.some(root => isUnderRoot(resolved, root))
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

export async function writeFile(filePath: string, content: string): Promise<string> {
  const safe = assertSafePath(filePath)
  await fsWrite(safe, content, 'utf-8')
  return `Wrote ${content.length} characters to ${filePath}`
}

export const filesystemToolDefs = [
  {
    name: 'fs_read',
    description: 'Reads and returns the text contents of a single file (first 50KB). Use when the user says "read file X", "what\'s in this file", "show me the contents of X", or when you need a file\'s contents to answer a question or before editing it with fs_write. Do NOT use to list a folder (use fs_list) or to find a file whose path you don\'t know (use fs_search). Restricted to paths under the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the file, e.g. C:\\Users\\you\\notes.txt. Must be a file, not a directory.' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_list',
    description: 'Lists the names of files and subfolders directly inside one directory (non-recursive). Use when the user says "what\'s in this folder", "list my Documents", or "show the files in X". Do NOT use to read a file\'s contents (use fs_read) or to search nested folders by name (use fs_search). Restricted to the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the directory to list, e.g. C:\\Users\\you\\Documents.' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_search',
    description: 'Recursively searches a directory tree (up to 5 levels deep, 20 matches) for files and folders whose NAME contains the query substring, and returns their full paths. Use when the user wants to locate a file but you do not know its exact path, e.g. "find my resume", "where is config.ts". This matches filenames only, NOT file contents. Use fs_read once you have the path. Restricted to the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        base_path: { type: 'string', description: 'Absolute directory to start searching from, e.g. C:\\Users\\you. Searches this folder and its subfolders.' },
        query: { type: 'string', description: 'Case-insensitive substring to match against file/folder names, e.g. "resume" or ".env".' },
      },
      required: ['base_path', 'query'],
    },
  },
  {
    name: 'fs_write',
    description: 'Writes text to a file, creating it or OVERWRITING it entirely (no append). Use when the user says "save this to a file", "write X to Y", or "create a file with this content". Always fs_read an existing file first if you intend to preserve its current contents. This is a side-effecting write — only call it when the user explicitly asked to save or create a file. Restricted to the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to create or overwrite, e.g. C:\\Users\\you\\notes.txt.' },
        content: { type: 'string', description: 'The full text content to write. Replaces any existing file content entirely.' },
      },
      required: ['path', 'content'],
    },
  },
]

export async function handleFilesystemTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case 'fs_read':   return readFile(input.path)
    case 'fs_list':   return JSON.stringify(await listDir(input.path))
    case 'fs_search': return JSON.stringify(await searchFiles(input.base_path, input.query))
    case 'fs_write':  return writeFile(input.path, input.content)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
