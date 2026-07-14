import { emitEvent } from '../events'
import type { Tool } from '@anthropic-ai/sdk/resources'

export const capabilityToolDefs: Tool[] = [
  {
    name: 'request_capability',
    description: 'Flags a genuinely missing capability so Jarvis can offer to write the code to add it (the user is shown a prompt to confirm and refine). This is a LAST RESORT — call it only after you have mentally checked every existing tool and confirmed none can do what the user asked. Do NOT call it for things an existing tool already covers (launching apps, web search, email, files, Spotify, GitHub, settings, reminders, screenshots) or when a tool simply errored due to a missing prerequisite (handle that instead). Calling this does not perform the task itself.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'A short descriptive name for the missing capability, e.g. "screen brightness control", "PDF text extraction", "smart-home lights".',
        },
        description: {
          type: 'string',
          description: 'Concretely: what the user asked for, and why no current tool can do it. Be specific enough for an engineer to scope the work.',
        },
      },
      required: ['name', 'description'],
    },
  },
]

export function handleCapabilityTool(name: string, input: Record<string, unknown>): string {
  if (name === 'request_capability') {
    const capName = String(input.name ?? 'Unknown capability')
    const capDesc = String(input.description ?? '')
    emitEvent({ type: 'capability_missing', name: capName, description: capDesc })
    return `I've flagged this as a missing capability and asked the user if they'd like me to add it. The UI will show them a prompt to describe what they want.`
  }
  throw new Error(`Unknown capability tool: ${name}`)
}
