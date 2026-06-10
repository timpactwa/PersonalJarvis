import { filesystemToolDefs, handleFilesystemTool } from './filesystem'
import { launcherToolDefs, handleLauncherTool } from './launcher'
import { gmailToolDefs, handleGmailTool } from './gmail'
import { executeToolDefs, handleExecuteTool } from './execute'
import { agentToolDefs, handleAgentTool } from '../agents'
import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...executeToolDefs,
    ...agentToolDefs,
  ] as Tool[]
}

// Tools available to spawned worker agents — excludes spawn_agent to prevent
// recursive agent spawning.
export function getToolsForAgent(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...executeToolDefs,
  ] as Tool[]
}

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name.startsWith('fs_'))      return handleFilesystemTool(name, input as Record<string, string>)
  if (name === 'app_launch')       return handleLauncherTool(name, input as Record<string, string>)
  if (name.startsWith('gmail_'))   return handleGmailTool(name, input)
  if (name === 'execute_file')     return handleExecuteTool(name, input as Record<string, string>)
  if (name === 'spawn_agent')      return handleAgentTool(name, input as Record<string, string>)
  throw new Error(`Unknown tool: ${name}`)
}
