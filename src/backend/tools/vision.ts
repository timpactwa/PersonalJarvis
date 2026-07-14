import { emitEvent } from '../events'

export const visionToolDefs = [
  {
    name: 'jarvis_screenshot',
    description:
      'Captures a screenshot of the user\'s current screen and analyzes it visually with a vision model. Use whenever answering needs to SEE what is on screen, e.g. "what am I looking at?", "what\'s on my screen?", "explain this error", "what does this say?", "describe what I\'m working on". Do NOT use for questions about files on disk (use fs_read) or general web facts (use web_search).',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'The question or instruction to apply to the captured screen, e.g. "what error is shown?" or "summarize this page". Defaults to "Describe what is on the screen" if omitted.',
        },
      },
      required: [],
    },
  },
]

export async function handleVisionTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name !== 'jarvis_screenshot') throw new Error(`Unknown vision tool: ${name}`)
  const prompt = String(input.prompt ?? 'Describe what is on the screen')
  emitEvent({ type: 'screenshot_request', prompt })
  return `Screenshot requested. Analyzing screen with prompt: "${prompt}"`
}
