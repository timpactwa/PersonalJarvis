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
})
