import { randomUUID } from 'crypto'
import { emitEvent } from './events'

export interface PendingApproval {
  id: string
  action: string
  detail: string
  createdAt: number
}

interface Entry extends PendingApproval {
  settle: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Entry>()

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * Registers a pending approval and emits `confirm_request` for the renderer's
 * ConfirmCard. This is the single approval primitive used by the shared
 * destructive-tool gate in tools/index.ts (handleTool) — it AWAITS the user's
 * answer in place, so the real yes/no result flows back to the model in the
 * same tool-loop turn, instead of the old "queue + fire a second unrelated
 * confirmation" split.
 *
 * Resolves:
 *   - true/false  when `resolveApproval(id, ...)` is called (renderer button
 *     click or a classified voice yes/no — see index.ts's processAudio /
 *     processUserText approval intercepts).
 *   - false       on timeout (default 120s, unref'd so it never keeps the
 *     process alive).
 *   - false       if `opts.signal` aborts — e.g. the turn that owns this tool
 *     call gets superseded/barged-in while the answer is still pending.
 *
 * Whichever path settles it, `confirm_resolved` is always emitted so the
 * renderer's ConfirmCard closes — there is no silent resolution path, and a
 * second settle attempt (double-resolve) is a safe no-op.
 */
export function awaitApproval(
  action: string,
  detail: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<boolean> {
  const id = randomUUID()
  const createdAt = Date.now()
  const signal = opts?.signal

  return new Promise<boolean>((resolvePromise) => {
    let onAbort: (() => void) | undefined

    const settle = (approved: boolean): void => {
      const entry = pending.get(id)
      if (!entry) return // already settled (double-resolve, or lost a race) — no-op
      pending.delete(id)
      clearTimeout(entry.timer)
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      emitEvent({ type: 'confirm_resolved', id, approved })
      resolvePromise(approved)
    }

    const timer = setTimeout(() => settle(false), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()

    pending.set(id, { id, action, detail, createdAt, settle, timer })

    if (signal) {
      if (signal.aborted) {
        settle(false)
        return
      }
      onAbort = () => settle(false)
      signal.addEventListener('abort', onAbort, { once: true })
    }

    emitEvent({ type: 'confirm_request', id, action, detail })
  })
}

/** Resolves a pending approval. Returns false if `id` is unknown or already settled. */
export function resolveApproval(id: string, approved: boolean): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  entry.settle(approved)
  return true
}

export function getLatestPending(): PendingApproval | null {
  let latest: Entry | null = null
  for (const e of pending.values()) {
    if (!latest || e.createdAt >= latest.createdAt) latest = e
  }
  return latest
}

export function hasPending(): boolean {
  return pending.size > 0
}

export function clearPending(): void {
  for (const e of pending.values()) clearTimeout(e.timer)
  pending.clear()
}

// Voice yes/no classification for answering a pending approval by speech.
// Regexes match those previously inline in index.ts's runConversation.
//
// Tie-break (documented behavior): if an utterance matches BOTH patterns
// (e.g. "no wait yes"), it resolves to 'no' — the no-check runs first. This
// fails closed: a wrongly-declined destructive action can always be
// re-requested, but a wrongly-approved one (fs_write overwriting a file,
// execute_file running a script) cannot be undone.
const YES_RE = /\b(yes|yeah|yep|confirm|confirmed|send it|do it|go ahead|affirmative|proceed)\b/i
const NO_RE = /\b(no|nope|cancel|stop|don'?t|negative|abort)\b/i

export function classifyApprovalUtterance(text: string): 'yes' | 'no' | null {
  if (NO_RE.test(text)) return 'no'
  if (YES_RE.test(text)) return 'yes'
  return null
}
