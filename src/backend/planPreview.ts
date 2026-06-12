import { emitEvent } from './events'

const DESTRUCTIVE_TOOLS = new Set(['email_send', 'execute_file', 'fs_write', 'calendar_create'])

export function isDestructiveChain(toolNames: string[]): boolean {
  return toolNames.some(n => DESTRUCTIVE_TOOLS.has(n))
}

type PlanResolver = (confirmed: boolean) => void
const pendingPlans = new Map<string, PlanResolver>()

export function requestPlanPreview(id: string, steps: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    pendingPlans.set(id, resolve)
    emitEvent({ type: 'plan_preview', id, steps })
  })
}

export function resolvePlanPreview(id: string, confirmed: boolean): void {
  const resolver = pendingPlans.get(id)
  if (resolver) {
    pendingPlans.delete(id)
    resolver(confirmed)
  }
}
