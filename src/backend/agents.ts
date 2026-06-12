import { randomUUID } from 'crypto'
import { emitEvent } from './events'
import type { AgentInfo } from './types'

const dynamicImport = new Function('specifier', 'return import(specifier)')

// Built-in Agent SDK tools the worker may use autonomously (read-only + web).
const AGENT_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
const MAX_TURNS = 12

const agents = new Map<string, AgentInfo>()

export function getAgents(): AgentInfo[] {
  return [...agents.values()]
}

export function closeAgent(id: string): void {
  agents.delete(id)
}

/** Test-only helper to clear state between cases. */
export function _resetAgents(): void {
  agents.clear()
}

function extractText(message: unknown): string {
  const m = message as { message?: { content?: Array<{ type?: string; text?: string }> } }
  const blocks = m.message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks.filter(b => b.type === 'text' && b.text).map(b => b.text as string).join('').trim()
}

const WORKER_SYSTEM_PROMPT =
  'You are a focused worker agent spawned by Jarvis, a personal desktop assistant. ' +
  'Complete the assigned task autonomously using the read-only and web tools available to you, ' +
  'then return a concise, useful summary of what you found or did. ' +
  'Do not ask clarifying questions — make reasonable assumptions and proceed.'

export async function spawnAgent(name: string, task: string, context?: string): Promise<string> {
  const info: AgentInfo = {
    id: randomUUID(),
    name,
    task,
    status: 'running',
    actions: [],
    startedAt: Date.now(),
  }
  agents.set(info.id, info)
  emitEvent({ type: 'agent_spawn', id: info.id, name, task })
  void runAgent(info, context)
  return `Spawned agent "${name}" to handle: ${task}. It will report back when done.`
}

async function runAgent(info: AgentInfo, context?: string): Promise<void> {
  const prompt = context && context.trim()
    ? `Relevant context from the user and their memory:\n${context.trim()}\n\nTask:\n${info.task}`
    : info.task
  try {
    console.log(`[agent ${info.name}] starting:`, info.task)
    const { query } = await dynamicImport('@anthropic-ai/claude-agent-sdk')
    for await (const message of query({
      prompt,
      options: {
        allowedTools: AGENT_TOOLS,
        permissionMode: 'bypassPermissions',
        maxTurns: MAX_TURNS,
        customSystemPrompt: WORKER_SYSTEM_PROMPT,
      },
    })) {
      const m = message as { type?: string; result?: unknown }
      if (m.type === 'assistant') {
        const text = extractText(message)
        if (text) {
          info.actions.push(text)
          emitEvent({ type: 'agent_update', id: info.id, action: text })
        }
      } else if (m.type === 'result') {
        info.status = 'done'
        info.result = String(m.result ?? 'Task complete.')
        console.log(`[agent ${info.name}] done:`, info.result.slice(0, 200))
        emitEvent({ type: 'agent_done', id: info.id, result: info.result })
        return
      }
    }
    if (info.status === 'running') {
      info.status = 'done'
      info.result = info.actions[info.actions.length - 1] ?? 'Task complete.'
      console.log(`[agent ${info.name}] finished (no result message):`, info.result.slice(0, 200))
      emitEvent({ type: 'agent_done', id: info.id, result: info.result })
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    info.status = 'error'
    info.result = `Agent failed: ${message}`
    console.error(`[agent ${info.name}] error:`, message)
    emitEvent({ type: 'agent_error', id: info.id, message })
  }
}

export const agentToolDefs = [
  {
    name: 'spawn_agent',
    description: 'Spawn a named Claude worker agent to autonomously handle a multi-step task (research, web lookups, reading/searching files). Returns immediately; the agent reports back when finished. Use for tasks that need several steps or web access.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short name for the agent (e.g. "Research")' },
        task: { type: 'string', description: 'A clear, self-contained description of the task' },
        context: { type: 'string', description: 'Optional relevant background from the conversation or user memory to give the agent (names, preferences, prior findings)' },
      },
      required: ['name', 'task'],
    },
  },
]

export async function handleAgentTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'spawn_agent') return spawnAgent(input.name, input.task, input.context)
  throw new Error(`Unknown tool: ${name}`)
}
