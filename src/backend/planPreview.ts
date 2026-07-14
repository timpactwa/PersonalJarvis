import { emitEvent } from './events'
import { setAwaitingApproval } from './turnManager'

type PlanResolver = (confirmed: boolean) => void
const pendingPlans = new Map<string, PlanResolver>()

// If the renderer never answers (modal dismissed, WS disconnect, app closed),
// the improvement agent would await this promise forever. Auto-cancel after a
// grace period so the agent can clean up instead of hanging.
const PLAN_PREVIEW_TIMEOUT_MS = 5 * 60 * 1000

export function requestPlanPreview(
  id: string,
  steps: string[],
  timeoutMs: number = PLAN_PREVIEW_TIMEOUT_MS,
): Promise<boolean> {
  // F1 fix: arm the same awaiting-approval flag the destructive-tool gate
  // uses, so a PTT press meant to answer this plan card (or any other
  // in-flight turn) doesn't get treated as a barge-in cancel while this is
  // pending. Cleared exactly once, whichever path settles the promise below.
  setAwaitingApproval(true)

  return new Promise((resolve) => {
    const settle = (confirmed: boolean): void => {
      setAwaitingApproval(false)
      resolve(confirmed)
    }

    const timer = setTimeout(() => {
      if (pendingPlans.delete(id)) settle(false)
    }, timeoutMs)
    // Don't let a pending preview keep the process alive on shutdown.
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()

    pendingPlans.set(id, (confirmed) => {
      clearTimeout(timer)
      settle(confirmed)
    })
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
