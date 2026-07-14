import { describe, it, expect, beforeEach } from 'vitest'
import {
  beginTurn,
  endTurn,
  cancelCurrent,
  currentTurnId,
  isCurrent,
  isTurnActive,
  onCancel,
  setAwaitingApproval,
  isAwaitingApproval,
  resetForTest,
  linkAbort,
} from '../../src/backend/turnManager'

describe('turnManager', () => {
  beforeEach(() => {
    resetForTest()
  })

  it('ids are monotonic starting at 1; currentTurnId is 0 when idle', () => {
    expect(currentTurnId()).toBe(0)
    const t1 = beginTurn()
    expect(t1.id).toBe(1)
    expect(currentTurnId()).toBe(1)
    endTurn(t1.id)
    const t2 = beginTurn()
    expect(t2.id).toBe(2)
  })

  it('beginTurn aborts the prior turn and fires cancel hooks with the OLD id', () => {
    const cancelled: number[] = []
    onCancel((id) => cancelled.push(id))
    const t1 = beginTurn()
    expect(t1.signal.aborted).toBe(false)
    const t2 = beginTurn()
    expect(t1.signal.aborted).toBe(true)
    expect(t2.signal.aborted).toBe(false)
    expect(cancelled).toEqual([1])
  })

  it('endTurn with a stale id is a no-op', () => {
    const t1 = beginTurn()
    endTurn(t1.id + 999)
    expect(isTurnActive()).toBe(true)
    expect(currentTurnId()).toBe(t1.id)
  })

  it('endTurn with the current id clears the turn', () => {
    const t1 = beginTurn()
    endTurn(t1.id)
    expect(isTurnActive()).toBe(false)
    expect(currentTurnId()).toBe(0)
  })

  it('cancelCurrent returns true, aborts, and fires hooks', () => {
    const cancelled: number[] = []
    onCancel((id) => cancelled.push(id))
    const t1 = beginTurn()
    const result = cancelCurrent('barge-in')
    expect(result).toBe(true)
    expect(t1.signal.aborted).toBe(true)
    expect(cancelled).toEqual([1])
    expect(isTurnActive()).toBe(false)
  })

  it('cancelCurrent returns false when idle', () => {
    expect(cancelCurrent('nothing to cancel')).toBe(false)
  })

  it('a hook that throws does not break other hooks', () => {
    const cancelled: number[] = []
    onCancel(() => {
      throw new Error('boom')
    })
    onCancel((id) => cancelled.push(id))
    beginTurn()
    expect(() => cancelCurrent('reason')).not.toThrow()
    expect(cancelled).toEqual([1])
  })

  it('isCurrent is true only for the live id', () => {
    const t1 = beginTurn()
    expect(isCurrent(t1.id)).toBe(true)
    expect(isCurrent(t1.id + 1)).toBe(false)
    endTurn(t1.id)
    expect(isCurrent(t1.id)).toBe(false)
  })

  describe('linkAbort', () => {
    it('aborting the source aborts the controller', () => {
      const source = new AbortController()
      const controller = new AbortController()
      linkAbort(source.signal, controller)
      expect(controller.signal.aborted).toBe(false)
      source.abort('source reason')
      expect(controller.signal.aborted).toBe(true)
      expect(controller.signal.reason).toBe('source reason')
    })

    it('unsubscribe prevents the controller from being aborted', () => {
      const source = new AbortController()
      const controller = new AbortController()
      const unsubscribe = linkAbort(source.signal, controller)
      unsubscribe()
      source.abort('source reason')
      expect(controller.signal.aborted).toBe(false)
    })

    it('already-aborted source aborts the controller immediately', () => {
      const source = new AbortController()
      source.abort('already gone')
      const controller = new AbortController()
      linkAbort(source.signal, controller)
      expect(controller.signal.aborted).toBe(true)
      expect(controller.signal.reason).toBe('already gone')
    })

    it('undefined source is a safe no-op', () => {
      const controller = new AbortController()
      const unsubscribe = linkAbort(undefined, controller)
      expect(() => unsubscribe()).not.toThrow()
      expect(controller.signal.aborted).toBe(false)
    })
  })

  it('awaitingApproval can be set and read', () => {
    expect(isAwaitingApproval()).toBe(false)
    setAwaitingApproval(true)
    expect(isAwaitingApproval()).toBe(true)
    setAwaitingApproval(false)
    expect(isAwaitingApproval()).toBe(false)
  })

  it('resetForTest clears everything', () => {
    const cancelled: number[] = []
    onCancel((id) => cancelled.push(id))
    const t1 = beginTurn()
    setAwaitingApproval(true)
    resetForTest()
    expect(t1.signal.aborted).toBe(true)
    expect(isTurnActive()).toBe(false)
    expect(currentTurnId()).toBe(0)
    expect(isAwaitingApproval()).toBe(false)
    // hooks cleared: cancelling after reset (a fresh begin/cancel) should not invoke the old hook
    beginTurn()
    cancelCurrent('after reset')
    expect(cancelled).toEqual([])
    // counter zeroed: next begin after reset starts at 1 again
    resetForTest()
    const t2 = beginTurn()
    expect(t2.id).toBe(1)
  })
})
