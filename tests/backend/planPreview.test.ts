import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/backend/events', () => ({ emitEvent: vi.fn() }))

import { isDestructiveChain, requestPlanPreview, resolvePlanPreview } from '../../src/backend/planPreview'

describe('isDestructiveChain', () => {
  it('returns true when chain includes email_send', () => {
    expect(isDestructiveChain(['web_search', 'email_send'])).toBe(true)
  })
  it('returns true when chain includes fs_write', () => {
    expect(isDestructiveChain(['fs_read', 'fs_write'])).toBe(true)
  })
  it('returns false for non-destructive chains', () => {
    expect(isDestructiveChain(['web_search', 'web_read', 'fs_read'])).toBe(false)
  })
  it('returns false for empty chain', () => {
    expect(isDestructiveChain([])).toBe(false)
  })
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
})
