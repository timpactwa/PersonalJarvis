import { describe, it, expect } from 'vitest'

describe('gmail tools', () => {
  it('exports gmailToolDefs', async () => {
    const mod = await import('../../../src/backend/tools/gmail')
    expect(Array.isArray(mod.gmailToolDefs)).toBe(true)
    expect(mod.gmailToolDefs.length).toBeGreaterThan(0)
  })

  it('tool defs have required fields', async () => {
    const { gmailToolDefs } = await import('../../../src/backend/tools/gmail')
    for (const tool of gmailToolDefs) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('input_schema')
    }
  })

  it('exposes gmail_search and gmail_read tools', async () => {
    const { gmailToolDefs } = await import('../../../src/backend/tools/gmail')
    const names = gmailToolDefs.map(t => t.name)
    expect(names).toContain('gmail_search')
    expect(names).toContain('gmail_read')
  })

  it('exposes gmail_send and gmail_draft tools', async () => {
    const { gmailToolDefs } = await import('../../../src/backend/tools/gmail')
    const names = gmailToolDefs.map(t => t.name)
    expect(names).toContain('gmail_send')
    expect(names).toContain('gmail_draft')
  })

  it('gmail_send queues a confirmation instead of sending immediately', async () => {
    const { clearPending, hasPending } = await import('../../../src/backend/confirm')
    const { handleGmailTool } = await import('../../../src/backend/tools/gmail')
    clearPending()
    const reply = await handleGmailTool('gmail_send', { to: 'a@b.com', subject: 'Hi', body: 'There' })
    expect(reply.toLowerCase()).toContain('shall i send')
    expect(hasPending()).toBe(true)
    clearPending()
  })
})
