import { filesystemToolDefs, handleFilesystemTool } from './filesystem'
import { launcherToolDefs, handleLauncherTool } from './launcher'
import { gmailToolDefs, handleGmailTool } from './gmail'
import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return [...filesystemToolDefs, ...launcherToolDefs, ...gmailToolDefs] as Tool[]
}

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name.startsWith('fs_'))    return handleFilesystemTool(name, input as Record<string, string>)
  if (name === 'app_launch')     return handleLauncherTool(name, input as Record<string, string>)
  if (name.startsWith('gmail_')) return handleGmailTool(name, input)
  throw new Error(`Unknown tool: ${name}`)
}
