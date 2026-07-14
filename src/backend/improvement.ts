import { randomUUID } from 'crypto'
import { emitEvent } from './events'
import { requestPlanPreview } from './planPreview'
import { describeAgentMessage } from './tools/describe'

const dynamicImport = new Function('specifier', 'return import(specifier)')

const PROJECT_ROOT = process.cwd()

const PHASE1_SYSTEM_PROMPT = `You are an expert software engineer analyzing the Jarvis desktop AI assistant codebase at ${PROJECT_ROOT}.

Your task is to plan how to add a new capability. Explore the codebase thoroughly, then output ONLY a JSON object (no other text) with this exact structure:
{
  "summary": "One sentence describing what you will implement",
  "steps": [
    "Step 1: ...",
    "Step 2: ...",
    "Step 3: ..."
  ]
}

Include 3-8 concrete steps. Each step should describe a specific file change or action. Do not include implementation code in the steps — just describe what needs to change.`

const PHASE2_SYSTEM_PROMPT = (planSummary: string, planSteps: string[], backendPort: number): string =>
  `You are an expert software engineer implementing a new capability for the Jarvis desktop AI assistant at ${PROJECT_ROOT}.

APPROVED PLAN:
Summary: ${planSummary}
Steps:
${planSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

IMPORTANT RULES:
1. Implement the plan exactly as described
2. Read files before editing them
3. Follow existing code patterns and TypeScript conventions
4. If you need to ask the user a question, run this curl command and wait for the response:
   curl -s -X POST http://127.0.0.1:${backendPort}/api/improvement/ask -H "Content-Type: application/json" -d "{\\"question\\": \\"YOUR QUESTION HERE\\"}"
   The response will be the user's spoken answer.
5. After all changes, run: npm run build:backend
6. If build fails, fix the TypeScript errors and rebuild

Make all the changes. Complete the implementation.`

export async function runImprovementAgent(
  prompt: string,
  backendPort: number,
): Promise<void> {
  const agentId = randomUUID()

  try {
    emitEvent({ type: 'improvement_started' })
    // Make the agent visible immediately — the planning phase below can run for
    // many turns, and without this the UI shows nothing until the plan preview.
    emitEvent({ type: 'agent_spawn', id: agentId, name: 'Improvement Agent', task: prompt })
    emitEvent({ type: 'agent_update', id: agentId, action: 'Exploring the codebase to plan the change…' })
    console.log('[improvement] starting phase 1 (planning)...')

    // Phase 1: Read-only, generate plan
    const { query } = await dynamicImport('@anthropic-ai/claude-agent-sdk')

    let phase1Output = ''
    for await (const message of query({
      prompt: `Analyze the Jarvis codebase and create a plan to add this capability:\n\n${prompt}`,
      options: {
        allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
        permissionMode: 'bypassPermissions',
        maxTurns: 20,
        customSystemPrompt: PHASE1_SYSTEM_PROMPT,
      },
    })) {
      // Stream the agent's tool calls (Reading/Finding/…) live. Skip text blocks
      // here — Phase 1's only narration is the raw JSON plan, surfaced separately.
      for (const action of describeAgentMessage(message, { includeText: false })) {
        emitEvent({ type: 'agent_update', id: agentId, action })
      }
      const m = message as { type?: string; result?: unknown; message?: { content?: Array<{ type?: string; text?: string }> } }
      if (m.type === 'result') {
        phase1Output = String(m.result ?? '')
      } else if (m.type === 'assistant') {
        const blocks = m.message?.content
        if (Array.isArray(blocks)) {
          const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
          if (text) phase1Output = text
        }
      }
    }

    // Extract JSON plan from output
    let planSummary = 'Implement the requested capability'
    let planSteps: string[] = ['Analyze codebase', 'Implement changes', 'Verify build']

    try {
      // Find JSON in output (agent may wrap it in markdown)
      const jsonMatch = phase1Output.match(/\{[\s\S]*"steps"[\s\S]*\}/m)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; steps?: string[] }
        if (parsed.summary) planSummary = parsed.summary
        if (Array.isArray(parsed.steps) && parsed.steps.length > 0) planSteps = parsed.steps
      }
    } catch {
      console.error('[improvement] could not parse phase 1 JSON, using defaults')
    }

    console.log('[improvement] phase 1 complete, emitting plan_preview')
    emitEvent({ type: 'agent_update', id: agentId, action: `Planned: ${planSummary}` })
    const planId = randomUUID()

    // requestPlanPreview emits the plan_preview event and resolves when the user
    // confirms (true) or cancels (false) via plan_confirmed/plan_cancelled.
    const approved = await requestPlanPreview(planId, [planSummary, ...planSteps])
    if (!approved) {
      console.log('[improvement] plan cancelled by user')
      // Resolve the agent card too, or it stays "running" forever.
      emitEvent({ type: 'agent_error', id: agentId, message: 'Plan cancelled by user.' })
      emitEvent({ type: 'improvement_error', message: 'Plan cancelled.' })
      return
    }

    console.log('[improvement] plan approved, starting phase 2 (execution)...')
    emitEvent({ type: 'agent_update', id: agentId, action: 'Plan approved — implementing…' })

    // Phase 2: Write tools enabled
    for await (const message of query({
      prompt: `Implement this capability for Jarvis:\n\n${prompt}\n\nThe user has approved the following plan:\n${planSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      options: {
        allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
        permissionMode: 'bypassPermissions',
        maxTurns: 40,
        customSystemPrompt: PHASE2_SYSTEM_PROMPT(planSummary, planSteps, backendPort),
      },
    })) {
      // Stream both narration and tool calls (Editing/Running/…) so the user can
      // watch the implementation happen, not just read a final summary.
      for (const action of describeAgentMessage(message)) {
        emitEvent({ type: 'agent_update', id: agentId, action })
      }
      const m = message as { type?: string; result?: unknown }
      if (m.type === 'result') {
        const result = String(m.result ?? 'Implementation complete.')
        emitEvent({ type: 'agent_done', id: agentId, result })
        break
      }
    }

    console.log('[improvement] phase 2 complete')
    emitEvent({ type: 'improvement_done' })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[improvement] error:', message)
    emitEvent({ type: 'agent_error', id: agentId, message })
    emitEvent({ type: 'improvement_error', message })
  }
}
