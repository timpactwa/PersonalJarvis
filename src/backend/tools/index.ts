import { filesystemToolDefs, handleFilesystemTool } from './filesystem'
import { launcherToolDefs, handleLauncherTool } from './launcher'
import { gmailToolDefs, calendarToolDefs, handleGmailTool } from './gmail'
import { executeToolDefs, handleExecuteTool } from './execute'
import { vscodeToolDefs, handleVSCodeTool } from './vscode'
import { agentToolDefs, handleAgentTool } from '../agents'
import { searchToolDefs, handleSearchTool } from './search'
import { insertUserEvent } from '../memory/db'
import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...calendarToolDefs,
    ...executeToolDefs,
    ...vscodeToolDefs,
    ...agentToolDefs,
    ...searchToolDefs,
  ] as Tool[]
}

// Tools for Groq — excludes execute_file (requires confirmation gate).
// gmail_compose and gmail_browse are safe (non-destructive, UI-only).
export function getToolsForGroq(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...calendarToolDefs,
    ...vscodeToolDefs,
    ...agentToolDefs,
    ...searchToolDefs,
  ] as Tool[]
}

// Tools available to spawned worker agents — excludes spawn_agent to prevent
// recursive agent spawning.
export function getToolsForAgent(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...calendarToolDefs,
    ...executeToolDefs,
    ...vscodeToolDefs,
    ...searchToolDefs,
  ] as Tool[]
}

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  let result: string

  if (name.startsWith('fs_'))             result = await handleFilesystemTool(name, input as Record<string, string>)
  else if (name === 'app_launch')         result = await handleLauncherTool(name, input as Record<string, string>)
  else if (name.startsWith('gmail_'))     result = await handleGmailTool(name, input)
  else if (name.startsWith('calendar_'))  result = await handleGmailTool(name, input)
  else if (name === 'execute_file')       result = await handleExecuteTool(name, input as Record<string, string>)
  else if (name === 'vscode_open')        result = await handleVSCodeTool(name, input)
  else if (name === 'spawn_agent')        result = await handleAgentTool(name, input as Record<string, string>)
  else if (name.startsWith('web_'))       result = await handleSearchTool(name, input)
  else throw new Error(`Unknown tool: ${name}`)

  // Preference learning — track usage (fire-and-forget, non-critical)
  try {
    if (name === 'app_launch') {
      insertUserEvent('tool_used', `app_launch:${String(input.name ?? '')}`)
    } else if (name === 'web_search') {
      insertUserEvent('tool_used', 'web_search')
      insertUserEvent('web_search', String(input.query ?? ''))
    } else {
      insertUserEvent('tool_used', name)
    }
  } catch { /* non-critical */ }

  return result
}
