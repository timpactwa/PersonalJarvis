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

  it('exposes gmail_search and gmail_read tools for inline email queries', async () => {
    const { gmailToolDefs } = await import('../../../src/backend/tools/gmail')
    const names = gmailToolDefs.map(t => t.name)
    expect(names).toContain('gmail_search')
    expect(names).toContain('gmail_read')
  })

  it('exposes gmail_compose for authoring emails (replaces send/draft)', async () => {
    const { gmailToolDefs } = await import('../../../src/backend/tools/gmail')
    const names = gmailToolDefs.map(t => t.name)
    expect(names).toContain('gmail_compose')
  })

  it('exposes gmail_browse for viewing emails in the popup viewer', async () => {
    const { gmailToolDefs } = await import('../../../src/backend/tools/gmail')
    const names = gmailToolDefs.map(t => t.name)
    expect(names).toContain('gmail_browse')
  })

  it('gmail_compose triggers email_compose popup (does not send immediately)', async () => {
    const { emitEvent } = await import('../../../src/backend/events')
    const seen: unknown[] = []
    const { setEmitter } = await import('../../../src/backend/events')
    setEmitter(e => seen.push(e))

    const { handleGmailTool } = await import('../../../src/backend/tools/gmail')
    const reply = await handleGmailTool('gmail_compose', {
      to: 'a@b.com', subject: 'Hi', body: 'There',
    })
    expect(reply.toLowerCase()).toMatch(/composer|email|opened|popup/i)
    const composeEvent = seen.find((e: any) => e.type === 'email_compose')
    expect(composeEvent).toBeDefined()
  })

  it('exports calendarToolDefs with calendar_list and calendar_create', async () => {
    const { calendarToolDefs } = await import('../../../src/backend/tools/gmail')
    const names = calendarToolDefs.map(t => t.name)
    expect(names).toContain('calendar_list')
    expect(names).toContain('calendar_create')
  })

  it('handleGmailTool throws for unknown tool name', async () => {
    const { handleGmailTool } = await import('../../../src/backend/tools/gmail')
    await expect(handleGmailTool('gmail_send', {})).rejects.toThrow('Unknown tool')
  })
})
