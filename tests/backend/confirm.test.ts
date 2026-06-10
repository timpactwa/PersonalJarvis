import { describe, it, expect, beforeEach } from 'vitest'

describe('confirmation registry', () => {
  beforeEach(async () => {
    const { clearPending } = await import('../../src/backend/confirm')
    clearPending()
  })

  it('requestConfirmation stores a pending item and returns it', async () => {
    const { requestConfirmation, hasPending } = await import('../../src/backend/confirm')
    const conf = requestConfirmation('Send email', 'To: a@b.com', async () => 'sent')
    expect(typeof conf.id).toBe('string')
    expect(hasPending()).toBe(true)
  })

  it('resolveConfirmation(approved=true) runs execute and returns its result', async () => {
    const { requestConfirmation, resolveConfirmation, hasPending } = await import('../../src/backend/confirm')
    let ran = false
    const conf = requestConfirmation('Run file', 'C:/x.bat', async () => { ran = true; return 'ok' })
    const result = await resolveConfirmation(conf.id, true)
    expect(ran).toBe(true)
    expect(result).toBe('ok')
    expect(hasPending()).toBe(false)
  })

  it('resolveConfirmation(approved=false) does not run execute', async () => {
    const { requestConfirmation, resolveConfirmation } = await import('../../src/backend/confirm')
    let ran = false
    const conf = requestConfirmation('Run file', 'C:/x.bat', async () => { ran = true; return 'ok' })
    const result = await resolveConfirmation(conf.id, false)
    expect(ran).toBe(false)
    expect(result).toBeNull()
  })

  it('resolveConfirmation with unknown id returns null', async () => {
    const { resolveConfirmation } = await import('../../src/backend/confirm')
    expect(await resolveConfirmation('nope', true)).toBeNull()
  })

  it('getLatestPending returns the most recently requested item', async () => {
    const { requestConfirmation, getLatestPending } = await import('../../src/backend/confirm')
    requestConfirmation('A', 'a', async () => 'a')
    const second = requestConfirmation('B', 'b', async () => 'b')
    expect(getLatestPending()?.id).toBe(second.id)
  })
})
