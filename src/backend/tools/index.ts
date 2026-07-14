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
import { capabilityToolDefs, handleCapabilityTool } from './capabilities'
import { insertUserEvent } from '../memory/db'
import { isExplicitEmailComposeRequest } from '../toolGuards'
import { emitEvent } from '../events'
import { describeTool, summarizeArgs } from './describe'
import { awaitApproval } from '../confirm'
import { setAwaitingApproval } from '../turnManager'
import type { Tool } from '@anthropic-ai/sdk/resources'

// Tools that mutate real state and therefore require an explicit user
// approval before they run. This is the ONE gate — it sits in handleTool
// (the shared choke point every provider's tool loop calls through), so
// Groq/Ollama/Claude all get the same confirmation, exactly once.
const DESTRUCTIVE = new Set(['fs_write', 'execute_file'])

// Short, human-readable action labels for the ConfirmCard. describeTool()'s
// fs_ prefix fallback ("Accessing files") is written for the Activity log,
// not an approval prompt, so destructive tools get their own literal here.
const APPROVAL_ACTION_LABEL: Record<string, string> = {
  fs_write: 'Write file',
  execute_file: 'Run file',
}

function approvalDetail(input: Record<string, unknown>): string {
  return typeof input.path === 'string' && input.path ? input.path : summarizeArgs(input)
}

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
    ...capabilityToolDefs,
  ] as Tool[]
}

// Tools for Groq — still excludes execute_file as a capability choice (the
// destructive gate in handleTool would cover it now, but script execution is
// kept Claude-only). gmail_compose and gmail_browse are safe (UI-only).
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
    ...capabilityToolDefs,
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
  ctx?: { userText?: string; signal?: AbortSignal },
): Promise<string> {
  // Gmail compose guard — must be an explicit user request
  if (name === 'gmail_compose') {
    if (ctx?.userText && !isExplicitEmailComposeRequest(ctx.userText)) {
      return 'No composer opened — the user did not ask for a new email.'
    }
    input = { ...input, _suppressUi: false }
  }

  // Active log — a friendly line for the Activity pane plus a technical line
  // for the Console pane. This is the single source of "what Jarvis is doing";
  // raw tool names no longer leak into the chat transcript.
  const startedAt = Date.now()
  emitEvent({ type: 'activity', kind: 'action', text: describeTool(name, input), ts: startedAt })
  emitEvent({ type: 'activity', kind: 'console', text: name, detail: summarizeArgs(input), ts: startedAt })

  // The ONE destructive-tool gate — awaits the user's real answer in place
  // before dispatch. `setAwaitingApproval` tells handlePttStart (index.ts) not
  // to treat a PTT press as barge-in while this is pending — it's the answer
  // path instead. If the turn is cancelled/superseded while we're waiting,
  // `ctx.signal` aborts and awaitApproval resolves false.
  if (DESTRUCTIVE.has(name)) {
    const action = APPROVAL_ACTION_LABEL[name] ?? describeTool(name, input)
    const detail = approvalDetail(input)
    setAwaitingApproval(true)
    let approved = false
    try {
      approved = await awaitApproval(action, detail, { signal: ctx?.signal })
    } finally {
      setAwaitingApproval(false)
    }
    if (!approved) return 'User declined this action — do not retry it. Acknowledge and move on.'
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
  else if (name === 'request_capability') result = handleCapabilityTool(name, input)
  else {
    const msg = `Unknown tool: ${name}`
    console.error('[tools]', msg)
    emitEvent({ type: 'error', message: `Jarvis tried to call an unknown tool "${name}" — this is a bug.` })
    throw new Error(msg)
  }

  // Preference learning (fire-and-forget)
  try {
    if (name === 'app_launch') {
      insertUserEvent('tool_used', `app_launch:${String(input.app_name ?? input.name ?? '')}`)
    } else if (name === 'web_search') {
      insertUserEvent('tool_used', 'web_search')
      insertUserEvent('web_search', String(input.query ?? ''))
    } else {
      insertUserEvent('tool_used', name)
    }
  } catch { /* non-critical */ }

  emitEvent({ type: 'activity', kind: 'console', text: `${name} ✓`, detail: `${Date.now() - startedAt}ms`, ts: Date.now() })

  return result
}
