import { filesystemToolDefs, handleFilesystemTool } from './filesystem'
import { launcherToolDefs, handleLauncherTool } from './launcher'
import { gmailToolDefs, calendarToolDefs, handleGmailTool } from './gmail'
import { executeToolDefs, handleExecuteTool } from './execute'
import { vscodeToolDefs, handleVSCodeTool } from './vscode'
import { agentToolDefs, handleAgentTool } from '../agents'
import { searchToolDefs, handleSearchTool } from './search'
import { jarvisToolDefs, handleJarvisTool } from './jarvis'
import { commandToolDefs, handleCommandTool } from './commands'
import { visionToolDefs, handleVisionTool } from './vision'
import { githubToolDefs, handleGithubTool } from './github'
import { spotifyToolDefs, handleSpotifyTool } from './spotify'
import { insertUserEvent } from '../memory/db'
import { isExplicitEmailComposeRequest } from '../toolGuards'
import { emitEvent } from '../events'
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
    ...jarvisToolDefs,
    ...commandToolDefs,
    ...visionToolDefs,
    ...githubToolDefs,
    ...spotifyToolDefs,
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
    ...searchToolDefs,
    ...jarvisToolDefs,
    ...commandToolDefs,
    ...visionToolDefs,
    ...(githubToolDefs.filter((t: { name: string }) => t.name !== 'github_pr_describe') as Tool[]),
    ...spotifyToolDefs,
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
    ...jarvisToolDefs,
    ...commandToolDefs,
    ...visionToolDefs,
    ...githubToolDefs,
    ...spotifyToolDefs,
  ] as Tool[]
}

export async function handleTool(
  name: string,
  input: Record<string, unknown>,
  ctx?: { userText?: string },
): Promise<string> {
  // Gmail compose guard — must be an explicit user request
  if (name === 'gmail_compose') {
    if (ctx?.userText && !isExplicitEmailComposeRequest(ctx.userText)) {
      return 'No composer opened — the user did not ask for a new email.'
    }
    input = { ...input, _suppressUi: false }
  }

  let result: string

  if (name.startsWith('fs_'))             result = await handleFilesystemTool(name, input as Record<string, string>)
  else if (name === 'app_launch')         result = await handleLauncherTool(name, input as Record<string, string>)
  else if (name.startsWith('gmail_'))     result = await handleGmailTool(name, input)
  else if (name.startsWith('calendar_'))  result = await handleGmailTool(name, input)
  else if (name === 'execute_file')       result = await handleExecuteTool(name, input as Record<string, string>)
  else if (name === 'vscode_open')        result = await handleVSCodeTool(name, input)
  else if (name === 'spawn_agent')        result = await handleAgentTool(name, input as Record<string, string>)
  else if (name.startsWith('web_'))       result = await handleSearchTool(name, input)
  else if (name === 'jarvis_screenshot')  result = await handleVisionTool(name, input)
  else if (name.startsWith('jarvis_'))    result = await handleJarvisTool(name, input)
  else if (name.startsWith('command_'))   result = await handleCommandTool(name, input)
  else if (name.startsWith('github_'))    result = await handleGithubTool(name, input)
  else if (name.startsWith('spotify_'))   result = await handleSpotifyTool(name, input)
  else {
    const msg = `Unknown tool: ${name}`
    console.error('[tools]', msg)
    emitEvent({ type: 'error', message: `Jarvis tried to call an unknown tool "${name}" — this is a bug.` })
    throw new Error(msg)
  }

  // Preference learning (fire-and-forget)
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
