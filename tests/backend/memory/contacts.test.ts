import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'

const TEST_DB = join(process.cwd(), 'tests', 'contacts-test.db')

beforeEach(async () => {
  mkdirSync(join(process.cwd(), 'tests'), { recursive: true })
  process.env.JARVIS_DB_PATH = TEST_DB
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  try { rmSync(TEST_DB) } catch { /* ignore */ }
})

afterEach(async () => {
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  delete process.env.JARVIS_DB_PATH
  try { rmSync(TEST_DB) } catch { /* ignore */ }
})

describe('contacts', () => {
  it('extractEmailFromText extracts email from text', async () => {
    const { extractEmailFromText } = await import('../../../src/backend/memory/contacts')
    expect(extractEmailFromText('Contact me at hello@example.com please')).toBe('hello@example.com')
  })

  it('extractEmailFromText returns null when no email present', async () => {
    const { extractEmailFromText } = await import('../../../src/backend/memory/contacts')
    expect(extractEmailFromText('No email address here')).toBeNull()
  })

  it('extractEmailFromText handles subdomain emails', async () => {
    const { extractEmailFromText } = await import('../../../src/backend/memory/contacts')
    expect(extractEmailFromText('Send to user@mail.company.org')).toBe('user@mail.company.org')
  })

  it('formatEntityContext omits email field when email is empty', async () => {
    const { formatEntityContext } = await import('../../../src/backend/memory/contacts')
    const line = formatEntityContext({
      id: 2,
      name: 'Alice',
      aliases: [],
      type: 'person',
      relationship: 'colleague',
      context: 'works at VT',
      email: '',
      updatedAt: Date.now(),
    })
    expect(line).not.toContain('email:')
    expect(line).toContain('Alice')
  })

  it('parseContactsFromUserMessage returns empty array for messages with no contact info', async () => {
    const { parseContactsFromUserMessage } = await import('../../../src/backend/memory/contacts')
    expect(parseContactsFromUserMessage('How is the weather today?')).toEqual([])
  })

  it('extractContactEmailHints finds email from recent assistant message', async () => {
    const { extractContactEmailHints } = await import('../../../src/backend/memory/contacts')
    const hint = extractContactEmailHints(
      "Jarvis, that's my mom's email. Remember it.",
      [{ role: 'assistant', content: 'Email sent to mtpactwa@gmail.com.' }],
    )
    expect(hint).toEqual({ contactRef: 'mom', email: 'mtpactwa@gmail.com' })
  })

  it('applyContactEmailHints persists email on mom contact', async () => {
    const { initDb, closeDb, getAllEntities } = await import('../../../src/backend/memory/db')
    const { applyContactEmailHints } = await import('../../../src/backend/memory/contacts')
    initDb()
    applyContactEmailHints(
      "that's my mom's email. remember it.",
      [{ role: 'assistant', content: 'Email sent to mtpactwa@gmail.com.' }],
    )
    const entities = getAllEntities()
    expect(entities.some(e => e.email === 'mtpactwa@gmail.com')).toBe(true)
    closeDb()
  })

  it('resolveContactEmail maps mom to stored address', async () => {
    const { initDb, closeDb, upsertEntity } = await import('../../../src/backend/memory/db')
    const { resolveContactEmail } = await import('../../../src/backend/memory/contacts')
    initDb()
    upsertEntity('Mom', 'person', 'mother of Tim', 'introduced to Jarvis', ['mom'], 'mtpactwa@gmail.com')
    expect(resolveContactEmail('mom')).toBe('mtpactwa@gmail.com')
    closeDb()
  })

  it('parseContactsFromUserMessage extracts Amanda and Bob', async () => {
    const { parseContactsFromUserMessage } = await import('../../../src/backend/memory/contacts')
    const msg = 'Ok remember these Amanda, is my twin sister, she goes to boston university. Her email is apactwa@gmail.com. My dad\'s name is Bob and his email is bpactwajr@gmail.com.'
    const contacts = parseContactsFromUserMessage(msg)
    expect(contacts.length).toBeGreaterThanOrEqual(2)
    expect(contacts.find(c => c.name === 'Amanda')?.email).toBe('apactwa@gmail.com')
    expect(contacts.find(c => c.name === 'Bob')?.email).toBe('bpactwajr@gmail.com')
  })

  it('formatEntityContext includes email prominently', async () => {
    const { formatEntityContext } = await import('../../../src/backend/memory/contacts')
    const line = formatEntityContext({
      id: 1,
      name: 'Mom',
      aliases: ['mom'],
      type: 'person',
      relationship: 'mother of Tim',
      context: 'introduced to Jarvis',
      email: 'mtpactwa@gmail.com',
      updatedAt: Date.now(),
    })
    expect(line).toContain('email: mtpactwa@gmail.com')
    expect(line).toContain('Mom')
  })
})
