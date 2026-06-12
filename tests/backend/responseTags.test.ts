import { describe, it, expect } from 'vitest'

describe('stripResponseTags', () => {
  it('strips a lone PERSON tag and returns natural text', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags('[PERSON: Bob | father | email: bpactwajr@gmail.com]')
    expect(result.text).toBe("I'll remember Bob (bpactwajr@gmail.com).")
    expect(result.pendingEntities[0].name).toBe('Bob')
    expect(result.pendingEntities[0].email).toBe('bpactwajr@gmail.com')
  })

  it('keeps spoken text before tags', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags('Understood. [PERSON: Bob | father | email: bpactwajr@gmail.com]')
    expect(result.text).toBe('Understood.')
  })

  it('handles multiple person tags', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags(
      '[PERSON: Amanda | sister | email: a@test.com] [PERSON: Bob | father | email: b@test.com]',
    )
    expect(result.text).toContain('Amanda')
    expect(result.text).toContain('Bob')
    expect(result.pendingEntities).toHaveLength(2)
  })

  it('passes through text with no tags unchanged', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags('Hello, how can I help you?')
    expect(result.text).toBe('Hello, how can I help you?')
    expect(result.pendingMemory).toBeNull()
    expect(result.pendingEntities).toHaveLength(0)
  })

  it('strips [REMEMBER: ...] and returns it as pendingMemory', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags('Got it. [REMEMBER: user prefers dark mode]')
    expect(result.text).toBe('Got it.')
    expect(result.pendingMemory).toBe('user prefers dark mode')
  })

  it('generates fallback text when only a REMEMBER tag is present', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags('[REMEMBER: favourite editor is VS Code]')
    expect(result.text).toBe('Noted.')
    expect(result.pendingMemory).toBe('favourite editor is VS Code')
  })

  it('generates fallback for lone PLACE tag', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags('[PLACE: The Lyric | coffee shop in Blacksburg]')
    expect(result.text).not.toBe('')
    expect(result.pendingEntities[0].type).toBe('place')
    expect(result.pendingEntities[0].name).toBe('The Lyric')
  })

  it('generates fallback for multiple entity tags', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const result = stripResponseTags('[PERSON: Alice | friend] [PERSON: Bob | colleague]')
    expect(result.text).toContain('Alice')
    expect(result.text).toContain('Bob')
    expect(result.pendingEntities).toHaveLength(2)
  })

  it('strips [REPORT: html|...] and returns pendingReport', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    const content = '<h1>Summary</h1>'
    const result = stripResponseTags(`Here is your report. [REPORT: html|${content}]`)
    expect(result.text).toBe('Here is your report.')
    expect(result.pendingReport?.format).toBe('html')
    expect(result.pendingReport?.content).toBe(content)
  })

  it('returns null pendingReport when no REPORT tag', async () => {
    const { stripResponseTags } = await import('../../src/backend/responseTags')
    expect(stripResponseTags('Hello.').pendingReport).toBeNull()
  })
})

describe('visibleStreamingText', () => {
  it('returns full text when no tag is present', async () => {
    const { visibleStreamingText } = await import('../../src/backend/responseTags')
    expect(visibleStreamingText('Hello there, how can I help?')).toBe('Hello there, how can I help?')
  })

  it('cuts at the start of a PERSON tag mid-stream', async () => {
    const { visibleStreamingText } = await import('../../src/backend/responseTags')
    expect(visibleStreamingText('Of course. [PERSON: Bob')).toBe('Of course.')
  })

  it('cuts at the start of a REMEMBER tag', async () => {
    const { visibleStreamingText } = await import('../../src/backend/responseTags')
    expect(visibleStreamingText('Understood. [REMEMBER: user li')).toBe('Understood.')
  })

  it('returns empty string when text starts with a tag', async () => {
    const { visibleStreamingText } = await import('../../src/backend/responseTags')
    expect(visibleStreamingText('[PERSON: Amanda')).toBe('')
  })
})

describe('toolGuards', () => {
  it('returns false for past-tense email statements', async () => {
    const { isExplicitEmailComposeRequest } = await import('../../src/backend/toolGuards')
    expect(isExplicitEmailComposeRequest('I dropped an email to my dad.')).toBe(false)
    expect(isExplicitEmailComposeRequest('I sent an email to Sarah about the meeting.')).toBe(false)
    expect(isExplicitEmailComposeRequest('I already emailed him.')).toBe(false)
  })

  it('returns true for explicit compose/send requests', async () => {
    const { isExplicitEmailComposeRequest } = await import('../../src/backend/toolGuards')
    expect(isExplicitEmailComposeRequest('Jarvis send an email to mom')).toBe(true)
    expect(isExplicitEmailComposeRequest('draft an email to my professor')).toBe(true)
    expect(isExplicitEmailComposeRequest('compose a mail to john@test.com')).toBe(true)
  })

  it('returns false for remember/save email address statements', async () => {
    const { isExplicitEmailComposeRequest } = await import('../../src/backend/toolGuards')
    expect(isExplicitEmailComposeRequest('remember Amanda, her email is a@test.com')).toBe(false)
    expect(isExplicitEmailComposeRequest('save this email address: test@test.com')).toBe(false)
  })
})
