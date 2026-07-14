import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setEmitter } from '../../src/backend/events'
import type { BackendEvent } from '../../src/backend/types'

let emitted: BackendEvent[] = []

beforeEach(async () => {
  emitted = []
  setEmitter((e) => emitted.push(e))
  const { clearPending } = await import('../../src/backend/confirm')
  clearPending()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('awaitApproval / resolveApproval', () => {
  it('emits confirm_request and resolves true on approve', async () => {
    const { awaitApproval, getLatestPending, resolveApproval } = await import('../../src/backend/confirm')
    const p = awaitApproval('Write file', 'C:/notes.txt')
    const pending = getLatestPending()
    expect(pending).not.toBeNull()
    expect(pending?.action).toBe('Write file')
    expect(pending?.detail).toBe('C:/notes.txt')
    expect(emitted).toContainEqual({ type: 'confirm_request', id: pending!.id, action: 'Write file', detail: 'C:/notes.txt' })

    expect(resolveApproval(pending!.id, true)).toBe(true)
    expect(await p).toBe(true)
  })

  it('resolves false on deny', async () => {
    const { awaitApproval, getLatestPending, resolveApproval } = await import('../../src/backend/confirm')
    const p = awaitApproval('Run file', 'C:/x.bat')
    const pending = getLatestPending()!
    expect(resolveApproval(pending.id, false)).toBe(true)
    expect(await p).toBe(false)
  })

  it('resolveApproval with an unknown id returns false', async () => {
    const { resolveApproval } = await import('../../src/backend/confirm')
    expect(resolveApproval('nope', true)).toBe(false)
  })

  it('resolves false on timeout', async () => {
    vi.useFakeTimers()
    const { awaitApproval } = await import('../../src/backend/confirm')
    const p = awaitApproval('Write file', 'x', { timeoutMs: 1000 })
    vi.advanceTimersByTime(1000)
    expect(await p).toBe(false)
  })

  it('resolves false when the signal aborts mid-wait', async () => {
    const { awaitApproval } = await import('../../src/backend/confirm')
    const controller = new AbortController()
    const p = awaitApproval('Write file', 'x', { signal: controller.signal })
    controller.abort()
    expect(await p).toBe(false)
  })

  it('resolves false immediately if the signal is already aborted', async () => {
    const { awaitApproval, hasPending } = await import('../../src/backend/confirm')
    const controller = new AbortController()
    controller.abort()
    const p = awaitApproval('Write file', 'x', { signal: controller.signal })
    expect(await p).toBe(false)
    expect(hasPending()).toBe(false)
  })

  it('getLatestPending returns the most recently requested item', async () => {
    const { awaitApproval, getLatestPending, resolveApproval } = await import('../../src/backend/confirm')
    const p1 = awaitApproval('A', 'a')
    // createdAt has ms resolution — force a real tick so ordering is unambiguous.
    await new Promise(r => setTimeout(r, 2))
    const p2 = awaitApproval('B', 'b')
    expect(getLatestPending()?.action).toBe('B')

    // Settle both so nothing dangles past the test.
    resolveApproval(getLatestPending()!.id, false)
    resolveApproval(getLatestPending()!.id, false)
    await Promise.all([p1, p2])
  })

  it('double-resolve is a no-op', async () => {
    const { awaitApproval, getLatestPending, resolveApproval } = await import('../../src/backend/confirm')
    const p = awaitApproval('Write file', 'x')
    const id = getLatestPending()!.id
    expect(resolveApproval(id, true)).toBe(true)
    expect(resolveApproval(id, false)).toBe(false) // already settled/removed
    expect(await p).toBe(true) // first resolution wins
  })

  it('emits confirm_resolved on every settle path (approve, deny, timeout, abort)', async () => {
    const { awaitApproval, getLatestPending, resolveApproval } = await import('../../src/backend/confirm')

    emitted = []
    const p1 = awaitApproval('A', 'a')
    resolveApproval(getLatestPending()!.id, true)
    await p1
    expect(emitted).toContainEqual({ type: 'confirm_resolved', id: expect.any(String), approved: true })

    emitted = []
    const p2 = awaitApproval('B', 'b')
    resolveApproval(getLatestPending()!.id, false)
    await p2
    expect(emitted).toContainEqual({ type: 'confirm_resolved', id: expect.any(String), approved: false })

    vi.useFakeTimers()
    emitted = []
    const p3 = awaitApproval('C', 'c', { timeoutMs: 500 })
    vi.advanceTimersByTime(500)
    await p3
    expect(emitted).toContainEqual({ type: 'confirm_resolved', id: expect.any(String), approved: false })
    vi.useRealTimers()

    emitted = []
    const controller = new AbortController()
    const p4 = awaitApproval('D', 'd', { signal: controller.signal })
    controller.abort()
    await p4
    expect(emitted).toContainEqual({ type: 'confirm_resolved', id: expect.any(String), approved: false })
  })
})

describe('hasPending / clearPending', () => {
  it('hasPending reflects the registry state', async () => {
    const { awaitApproval, hasPending, resolveApproval, getLatestPending } = await import('../../src/backend/confirm')
    expect(hasPending()).toBe(false)
    const p = awaitApproval('A', 'a')
    expect(hasPending()).toBe(true)
    resolveApproval(getLatestPending()!.id, true)
    await p
    expect(hasPending()).toBe(false)
  })

  it('clearPending drops pending entries without resolving them', async () => {
    const { awaitApproval, hasPending, clearPending } = await import('../../src/backend/confirm')
    void awaitApproval('A', 'a')
    expect(hasPending()).toBe(true)
    clearPending()
    expect(hasPending()).toBe(false)
  })
})

describe('classifyApprovalUtterance', () => {
  it('detects a clear yes', async () => {
    const { classifyApprovalUtterance } = await import('../../src/backend/confirm')
    expect(classifyApprovalUtterance('yes go ahead')).toBe('yes')
    expect(classifyApprovalUtterance('yeah do it')).toBe('yes')
    expect(classifyApprovalUtterance('confirmed')).toBe('yes')
  })

  it('detects a clear no', async () => {
    const { classifyApprovalUtterance } = await import('../../src/backend/confirm')
    expect(classifyApprovalUtterance('no cancel that')).toBe('no')
    expect(classifyApprovalUtterance("don't do that")).toBe('no')
  })

  it('returns null when neither yes nor no is present', async () => {
    const { classifyApprovalUtterance } = await import('../../src/backend/confirm')
    expect(classifyApprovalUtterance('what time is it')).toBeNull()
  })

  it('mixed yes/no text resolves to the documented "no" tie-break', async () => {
    const { classifyApprovalUtterance } = await import('../../src/backend/confirm')
    // Documented behavior (see confirm.ts): when an utterance matches BOTH
    // patterns, decline wins — a wrongly-declined action can be re-requested,
    // a wrongly-approved destructive one cannot be undone.
    expect(classifyApprovalUtterance('no wait yes')).toBe('no')
    expect(classifyApprovalUtterance('yes actually no, cancel')).toBe('no')
  })
})
