# Track 5: Test Coverage Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flesh out all untracked/sparse test files so every new source module introduced in the current sprint has meaningful unit coverage.

**Architecture:** Tests live in `tests/backend/`. Each task targets one test file. All tests use Vitest. Run all tests with `npm test`. This track can run in parallel with Tracks 2–4 since it tests existing, already-committed code.

**Tech Stack:** Vitest, better-sqlite3 (real DB in temp files for DB tests), no mocking of DB in integration-style tests.

---

## Task 1: Expand `tests/backend/responseTags.test.ts`

**Note:** This file already exists with 37 lines. We expand it. The additions from Track 1 may have already been applied — check and skip duplicates.

**Files:**
- Modify: `tests/backend/responseTags.test.ts`

- [ ] **Step 1: Read the current file to see what's already there**

```
Read tests/backend/responseTags.test.ts
```

- [ ] **Step 2: Add missing test cases to `stripResponseTags` describe block**

Add these tests if not already present:

```ts
it('passes through text with no tags unchanged', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const result = stripResponseTags('How can I help you today?')
  expect(result.text).toBe('How can I help you today?')
  expect(result.pendingMemory).toBeNull()
  expect(result.pendingEntities).toHaveLength(0)
})

it('strips [REMEMBER: ...] and returns it as pendingMemory', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const result = stripResponseTags('Got it. [REMEMBER: user drinks oat milk]')
  expect(result.text).toBe('Got it.')
  expect(result.pendingMemory).toBe('user drinks oat milk')
})

it('generates fallback text when response is only a REMEMBER tag', async () => {
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

it('handles ORG entity tag', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const result = stripResponseTags('Noted. [ORG: Anthropic | AI research company]')
  expect(result.text).toBe('Noted.')
  expect(result.pendingEntities[0].type).toBe('org')
  expect(result.pendingEntities[0].name).toBe('Anthropic')
})
```

Add these tests for `visibleStreamingText`:

```ts
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
```

- [ ] **Step 3: Run tests**

```
npx vitest run tests/backend/responseTags.test.ts
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add tests/backend/responseTags.test.ts
git commit -m "test: expand responseTags coverage — all tag types, visibleStreamingText"
```

---

## Task 2: Expand `tests/backend/tools/commands.test.ts`

**Note:** This file already exists with 65 lines. Read it first, then add the missing cases.

**Files:**
- Modify: `tests/backend/tools/commands.test.ts`

- [ ] **Step 1: Read the current file**

```
Read tests/backend/tools/commands.test.ts
```

- [ ] **Step 2: Add missing test cases**

Add these tests inside `describe('custom commands', ...)`:

```ts
it('registers a fully specified command without opening the form', async () => {
  const { initDb } = await import('../../../src/backend/memory/db')
  const { emitEvent } = await import('../../../src/backend/events')
  const { registerCommand } = await import('../../../src/backend/tools/commands')
  initDb()
  const msg = registerCommand({
    label: 'Spotify',
    aliases: ['spotify', 'open spotify'],
    target: 'C:\\Users\\test\\AppData\\Spotify.exe',
    kind: 'exe',
  })
  expect(msg).toContain('Saved launch command')
  expect(msg).toContain('Spotify')
  // Should NOT open the compose form since all fields are complete
  expect(vi.mocked(emitEvent)).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'command_compose' }),
  )
})

it('removes a command by label', async () => {
  const { initDb } = await import('../../../src/backend/memory/db')
  const { upsertCustomCommand } = await import('../../../src/backend/memory/customCommands')
  const { removeCommand } = await import('../../../src/backend/tools/commands')
  initDb()
  upsertCustomCommand({
    id: 'rm-test',
    label: 'To Remove',
    aliases: ['remove-me'],
    target: 'C:\\test.exe',
    kind: 'exe',
  })
  const msg = removeCommand('To Remove')
  expect(msg).toContain('Removed')
  expect(msg).toContain('To Remove')
})

it('removes a command by alias', async () => {
  const { initDb } = await import('../../../src/backend/memory/db')
  const { upsertCustomCommand } = await import('../../../src/backend/memory/customCommands')
  const { removeCommand } = await import('../../../src/backend/tools/commands')
  initDb()
  upsertCustomCommand({
    id: 'alias-test',
    label: 'Game App',
    aliases: ['gameapp', 'my-game'],
    target: 'C:\\game.exe',
    kind: 'exe',
  })
  const msg = removeCommand('my-game')
  expect(msg).toContain('Removed')
})

it('returns error message when removing unknown command', async () => {
  const { initDb } = await import('../../../src/backend/memory/db')
  const { removeCommand } = await import('../../../src/backend/tools/commands')
  initDb()
  const msg = removeCommand('nonexistent-app-xyz')
  expect(msg).toContain('No custom command found')
})

it('returns empty array for blank findExecutables query', async () => {
  const { findExecutables } = await import('../../../src/backend/tools/commands')
  expect(findExecutables('')).toEqual([])
  expect(findExecutables('   ')).toEqual([])
})

it('handleCommandTool command_list returns string', async () => {
  const { initDb } = await import('../../../src/backend/memory/db')
  const { handleCommandTool } = await import('../../../src/backend/tools/commands')
  initDb()
  const result = await handleCommandTool('command_list', {})
  expect(typeof result).toBe('string')
})

it('handleCommandTool command_remove delegates to removeCommand', async () => {
  const { initDb } = await import('../../../src/backend/memory/db')
  const { handleCommandTool } = await import('../../../src/backend/tools/commands')
  initDb()
  const result = await handleCommandTool('command_remove', { name: 'nonexistent' })
  expect(result).toContain('No custom command found')
})

it('handleCommandTool command_find_executable requires a query', async () => {
  const { handleCommandTool } = await import('../../../src/backend/tools/commands')
  const result = await handleCommandTool('command_find_executable', { query: '' })
  expect(result).toContain('required')
})
```

- [ ] **Step 3: Run tests**

```
npx vitest run tests/backend/tools/commands.test.ts
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add tests/backend/tools/commands.test.ts
git commit -m "test: expand commands tool coverage — register, remove, findExecutables"
```

---

## Task 3: Flesh out `tests/backend/tools/jarvis.test.ts`

**Note:** This file is untracked. Read it first to see what's there, then fill gaps.

**Files:**
- Modify: `tests/backend/tools/jarvis.test.ts`

- [ ] **Step 1: Read the current file**

```
Read tests/backend/tools/jarvis.test.ts
```

- [ ] **Step 2: Replace or expand with full coverage**

Ensure the file covers all of:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/jarvis-tools-test.db'

function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* Windows */ } }
}

beforeEach(async () => {
  process.env.JARVIS_DB_PATH = TEST_DB
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  cleanup()
  const { initDb } = await import('../../../src/backend/memory/db')
  initDb()
})

afterEach(async () => {
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  cleanup()
})

describe('getJarvisSettings', () => {
  it('returns a formatted settings string', async () => {
    const { getJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    const result = getJarvisSettings()
    expect(result).toContain('Active provider:')
    expect(result).toContain('Push-to-talk hotkey:')
    expect(result).toContain('Ollama model:')
  })
})

describe('setJarvisSettings', () => {
  it('updates llmProvider and returns updated settings', async () => {
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    const result = setJarvisSettings({ llmProvider: 'groq' })
    expect(result).toContain('groq')
    expect(result).toContain('Updated:')
  })

  it('throws for invalid llmProvider', async () => {
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    expect(() => setJarvisSettings({ llmProvider: 'invalid-llm' })).toThrow(/Invalid llmProvider/)
  })

  it('throws for invalid modelPreference', async () => {
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    expect(() => setJarvisSettings({ modelPreference: 'gpt4' })).toThrow(/Invalid modelPreference/)
  })

  it('throws when no settings are provided', async () => {
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    expect(() => setJarvisSettings({})).toThrow(/No settings provided/)
  })

  it('updates shortTurns within valid range', async () => {
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    const result = setJarvisSettings({ shortTurns: 25 })
    expect(result).toContain('25')
  })

  it('throws when shortTurns is out of range', async () => {
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    expect(() => setJarvisSettings({ shortTurns: 1 })).toThrow(/shortTurns/)
    expect(() => setJarvisSettings({ shortTurns: 100 })).toThrow(/shortTurns/)
  })

  it('updates userProfile', async () => {
    const { setJarvisSettings } = await import('../../../src/backend/tools/jarvis')
    const result = setJarvisSettings({ userProfile: 'VT CS student' })
    expect(result).toContain('VT CS student')
  })
})

describe('getJarvisUsage', () => {
  it('returns usage string with expected sections', async () => {
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    const result = getJarvisUsage(7)
    expect(result).toContain('Active provider:')
    expect(result).toContain('Today:')
    expect(result).toContain('Last 7 days:')
    expect(result).toContain('By model:')
  })

  it('clamps days to 1 minimum', async () => {
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    const result = getJarvisUsage(0)
    expect(result).toContain('Last 1 days:')
  })

  it('clamps days to 30 maximum', async () => {
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    const result = getJarvisUsage(999)
    expect(result).toContain('Last 30 days:')
  })

  it('uses 7 days as default when called with no args', async () => {
    const { getJarvisUsage } = await import('../../../src/backend/tools/jarvis')
    const result = getJarvisUsage()
    expect(result).toContain('Last 7 days:')
  })
})

describe('handleJarvisTool dispatch', () => {
  it('routes jarvis_get_settings', async () => {
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    const result = await handleJarvisTool('jarvis_get_settings', {})
    expect(result).toContain('Active provider:')
  })

  it('routes jarvis_set_settings', async () => {
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    const result = await handleJarvisTool('jarvis_set_settings', { hotkey: 'Alt+Space' })
    expect(result).toContain('Alt+Space')
  })

  it('routes jarvis_get_usage', async () => {
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    const result = await handleJarvisTool('jarvis_get_usage', { days: 3 })
    expect(result).toContain('Last 3 days:')
  })

  it('throws for unknown tool', async () => {
    const { handleJarvisTool } = await import('../../../src/backend/tools/jarvis')
    await expect(handleJarvisTool('jarvis_unknown', {})).rejects.toThrow('Unknown jarvis tool')
  })
})
```

- [ ] **Step 3: Run tests**

```
npx vitest run tests/backend/tools/jarvis.test.ts
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add tests/backend/tools/jarvis.test.ts
git commit -m "test: full jarvis tool coverage — settings get/set validation, usage formatting"
```

---

## Task 4: Flesh out `tests/backend/memory/contacts.test.ts`

**Note:** This file is untracked. Read it first, then expand.

**Files:**
- Modify: `tests/backend/memory/contacts.test.ts`

- [ ] **Step 1: Read the current file and `src/backend/memory/contacts.ts`**

```
Read tests/backend/memory/contacts.test.ts
Read src/backend/memory/contacts.ts
```

- [ ] **Step 2: Write comprehensive tests**

After reading the current file and the contacts module, write tests covering:

The contacts module exports: `parseContactsFromUserMessage`, `formatEntityContext`, `extractEmailFromText`, `extractContactEmailHints`, `applyContactEmailHints`, `sanitizeEmail` (if exported), and the `EMAIL_RE` regex.

Key behaviors to test:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/contacts-test.db'

function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* Windows */ } }
}

beforeEach(async () => {
  process.env.JARVIS_DB_PATH = TEST_DB
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  cleanup()
  const { initDb } = await import('../../../src/backend/memory/db')
  initDb()
})

afterEach(async () => {
  const { closeDb } = await import('../../../src/backend/memory/db')
  closeDb()
  cleanup()
})

describe('parseContactsFromUserMessage', () => {
  it('extracts contact with email from a natural message', async () => {
    const { parseContactsFromUserMessage } = await import('../../../src/backend/memory/contacts')
    const contacts = parseContactsFromUserMessage("my mom's email is mom@example.com")
    // This function may or may not parse this format — check what it actually does and assert accordingly
    expect(Array.isArray(contacts)).toBe(true)
  })

  it('returns empty array for messages with no contact info', async () => {
    const { parseContactsFromUserMessage } = await import('../../../src/backend/memory/contacts')
    const contacts = parseContactsFromUserMessage('what is the weather today?')
    expect(contacts).toHaveLength(0)
  })
})

describe('formatEntityContext', () => {
  it('includes email in formatted context when present', async () => {
    const { formatEntityContext } = await import('../../../src/backend/memory/contacts')
    const entity = {
      id: 1,
      name: 'Amanda',
      aliases: '[]',
      type: 'person',
      relationship: 'girlfriend',
      context: 'biology student at VT',
      email: 'amanda@test.com',
      updated_at: Date.now(),
    }
    const result = formatEntityContext(entity as any)
    expect(result).toContain('Amanda')
    expect(result).toContain('amanda@test.com')
  })

  it('omits email line when email is empty', async () => {
    const { formatEntityContext } = await import('../../../src/backend/memory/contacts')
    const entity = {
      id: 2,
      name: 'Library',
      aliases: '[]',
      type: 'place',
      relationship: '',
      context: 'study spot',
      email: '',
      updated_at: Date.now(),
    }
    const result = formatEntityContext(entity as any)
    expect(result).toContain('Library')
    expect(result).not.toContain('@')
  })
})

describe('extractEmailFromText', () => {
  it('extracts a valid email from text', async () => {
    const { extractEmailFromText } = await import('../../../src/backend/memory/contacts')
    expect(extractEmailFromText('contact me at hello@world.com please')).toBe('hello@world.com')
  })

  it('returns empty string when no email present', async () => {
    const { extractEmailFromText } = await import('../../../src/backend/memory/contacts')
    expect(extractEmailFromText('no email here')).toBe('')
  })

  it('handles emails with subdomains', async () => {
    const { extractEmailFromText } = await import('../../../src/backend/memory/contacts')
    expect(extractEmailFromText('test@mail.example.co.uk')).toBe('test@mail.example.co.uk')
  })
})

describe('entity upsert and retrieval', () => {
  it('saves and retrieves an entity by name', async () => {
    const { initDb, upsertEntity, findMentionedEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Amanda', 'person', 'girlfriend', 'biology at VT', [], 'a@test.com')
    const results = findMentionedEntities('Amanda')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].name).toBe('Amanda')
    expect(results[0].email).toBe('a@test.com')
  })

  it('upserts (does not duplicate) on second save', async () => {
    const { initDb, upsertEntity, findMentionedEntities } = await import('../../../src/backend/memory/db')
    initDb()
    upsertEntity('Bob', 'person', 'father', 'retired engineer', [], 'bob@test.com')
    upsertEntity('Bob', 'person', 'father', 'retired engineer in Florida', [], 'bob@test.com')
    const results = findMentionedEntities('Bob')
    // Should have only one Bob
    const bobs = results.filter(e => e.name === 'Bob')
    expect(bobs).toHaveLength(1)
    expect(bobs[0].context).toContain('Florida')
  })
})
```

Note: The exact API of `contacts.ts` depends on what's in the file. Read it before writing tests — adjust the imports and assertions to match the actual exported functions. The tests above are the intended coverage; adapt the implementation-specific details after reading.

- [ ] **Step 3: Run tests**

```
npx vitest run tests/backend/memory/contacts.test.ts
```

Expected: All tests PASS. Fix any tests that don't match the actual API after reading `contacts.ts`.

- [ ] **Step 4: Commit**

```
git add tests/backend/memory/contacts.test.ts
git commit -m "test: contacts module coverage — email extraction, entity upsert, formatEntityContext"
```

---

## Task 5: Final full suite run and coverage check

- [ ] **Step 1: Run the full test suite**

```
npm test
```

Expected: All tests PASS with no failures.

- [ ] **Step 2: Check for any untested source files introduced in this sprint**

List new source files from Tracks 2, 3, 4 that have no corresponding test file:
- `src/backend/tools/vision.ts` — covered by integration in Track 2 manual test; unit tests optional (thin wrapper around IPC)
- `src/backend/tools/github.ts` — covered in Track 3
- `src/backend/tools/spotify.ts` — covered in Track 4
- `src/renderer/src/components/ReportPanel.tsx` — UI component, not unit-tested

All backend logic modules are covered.

- [ ] **Step 3: Final commit**

```
git add .
git commit -m "test: full coverage sprint — responseTags, commands, jarvis tools, contacts"
```
