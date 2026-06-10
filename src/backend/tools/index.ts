import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return []
}

export async function handleTool(name: string, _input: Record<string, unknown>): Promise<string> {
  throw new Error(`Unknown tool: ${name}`)
}
