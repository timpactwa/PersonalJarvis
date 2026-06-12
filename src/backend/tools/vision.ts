import { emitEvent } from '../events'

export const visionToolDefs = [
  {
    name: 'jarvis_screenshot',
    description:
      'Capture a screenshot of the current screen and analyze it visually. Use when the user asks "what am I looking at?", "what\'s on my screen?", "explain this error", "describe what I\'m working on", or any question requiring visual context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'What to look for or ask about in the screenshot (default: "Describe what is on the screen")',
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
