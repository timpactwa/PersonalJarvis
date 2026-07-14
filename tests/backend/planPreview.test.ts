import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('../../src/backend/events', () => ({ emitEvent: vi.fn() }))

import { requestPlanPreview, resolvePlanPreview } from '../../src/backend/planPreview'
import { isAwaitingApproval, resetForTest } from '../../src/backend/turnManager'

beforeEach(() => {
  resetForTest()
})

afterEach(() => {
  vi.useRealTimers()
  resetForTest()
})

describe('requestPlanPreview + resolvePlanPreview', () => {
  it('resolves true when confirmed', async () => {
    const promise = requestPlanPreview('test-1', ['step 1', 'step 2'])
    resolvePlanPreview('test-1', true)
    expect(await promise).toBe(true)
  })
  it('resolves false when cancelled', async () => {
    const promise = requestPlanPreview('test-2', ['step 1'])
    resolvePlanPreview('test-2', false)
    expect(await promise).toBe(false)
  })
  it('does nothing for unknown id', () => {
    expect(() => resolvePlanPreview('nonexistent', true)).not.toThrow()
  })

  it('auto-cancels (resolves false) after the timeout if never answered', async () => {
    vi.useFakeTimers()
    const promise = requestPlanPreview('timeout-1', ['step 1'], 1_000)
    vi.advanceTimersByTime(1_000)
    expect(await promise).toBe(false)
    // A late answer after timeout is a harmless no-op.
    expect(() => resolvePlanPreview('timeout-1', true)).not.toThrow()
  })

  it('a confirm before the timeout cancels the timer (no double-resolve)', async () => {
    vi.useFakeTimers()
    const promise = requestPlanPreview('timeout-2', ['step 1'], 1_000)
    resolvePlanPreview('timeout-2', true)
    expect(await promise).toBe(true)
    // Advancing past the original timeout must not flip or re-resolve the result.
    vi.advanceTimersByTime(5_000)
    expect(await promise).toBe(true)
  })

  // F1 fix: a plan-preview wait must arm the same awaiting-approval flag the
  // destructive-tool gate uses, so a PTT press meant to answer the plan card
  // isn't treated as a barge-in cancel of the turn that's waiting on it.
  it('arms isAwaitingApproval while the plan preview is pending, and clears it on confirm', async () => {
    expect(isAwaitingApproval()).toBe(false)
    const promise = requestPlanPreview('await-1', ['step 1'])
    expect(isAwaitingApproval()).toBe(true)
    resolvePlanPreview('await-1', true)
    await promise
    expect(isAwaitingApproval()).toBe(false)
  })

  it('clears isAwaitingApproval on cancel', async () => {
    const promise = requestPlanPreview('await-2', ['step 1'])
    expect(isAwaitingApproval()).toBe(true)
    resolvePlanPreview('await-2', false)
    await promise
    expect(isAwaitingApproval()).toBe(false)
  })

  it('clears isAwaitingApproval on timeout', async () => {
    vi.useFakeTimers()
    const promise = requestPlanPreview('await-3', ['step 1'], 1_000)
    expect(isAwaitingApproval()).toBe(true)
    vi.advanceTimersByTime(1_000)
    await promise
    expect(isAwaitingApproval()).toBe(false)
  })
})
