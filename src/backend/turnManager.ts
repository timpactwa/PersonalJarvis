// Single source of truth for "whose turn is it". Every voice/text turn gets a
// monotonic id + AbortController; a new turn (or a barge-in) cancels the
// previous one; downstream pipeline stages check/thread the signal; stale
// broadcasts get dropped via isCurrent/currentTurnId. Pure module — no
// imports from index.ts or other app modules — so it is trivially testable.

export interface Turn { readonly id: number; readonly signal: AbortSignal }

let counter = 0
let current: { id: number; controller: AbortController } | null = null
let awaitingApproval = false
const cancelHooks: Array<(id: number) => void> = []

export function beginTurn(): Turn {
  if (current) cancelCurrent('superseded')
  counter += 1
  const controller = new AbortController()
  current = { id: counter, controller }
  return { id: counter, signal: controller.signal }
}

export function endTurn(id: number): void {
  if (current && current.id === id) current = null
}

export function cancelCurrent(reason: string): boolean {
  if (!current) return false
  const { id, controller } = current
  current = null
  controller.abort(new DOMException(reason, 'AbortError'))
  for (const hook of cancelHooks) {
    try {
      hook(id)
    } catch {
      // cancel hooks must never break cancellation
    }
  }
  return true
}

export function currentTurnId(): number {
  return current ? current.id : 0
}

export function isCurrent(id: number): boolean {
  return current !== null && current.id === id
}

export function isTurnActive(): boolean {
  return current !== null
}

export function onCancel(hook: (id: number) => void): void {
  cancelHooks.push(hook)
}

export function setAwaitingApproval(v: boolean): void {
  awaitingApproval = v
}

export function isAwaitingApproval(): boolean {
  return awaitingApproval
}

export function resetForTest(): void {
  if (current) current.controller.abort(new DOMException('reset', 'AbortError'))
  current = null
  counter = 0
  cancelHooks.length = 0
  awaitingApproval = false
}

// Node 18 / Electron 28 has no AbortSignal.any — this is the manual
// equivalent for linking a single upstream signal to a downstream controller.
export function linkAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => {}
  }
  const onAbort = (): void => {
    controller.abort(signal.reason)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}
