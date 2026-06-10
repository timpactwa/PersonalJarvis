# Jarvis Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the working Phase 1 Jarvis MVP with subagent orchestration, destructive-action confirmation (Gmail send/draft, file write/execute), a usage-graph dashboard, and a settings panel (hotkey, voice, model preference).

**Architecture:** Same two-process model (Electron renderer ↔ Node backend over WebSocket). Phase 2 adds a backend event-emitter shim so feature modules can push `BackendEvent`s without importing `index.ts` (avoids circular deps), a pending-confirmation registry for destructive actions, an autonomous agent runner that uses separate Claude sessions, and DB-backed settings. The renderer gains confirmation cards, agent cards, usage graphs, and a settings panel.

**Tech Stack:** Existing stack — Electron + electron-vite, React + TypeScript, `ws`, `@anthropic-ai/sdk`, `@xenova/transformers`, ElevenLabs REST, `googleapis` + `google-auth-library`, `better-sqlite3`, Vitest. **Added in the hybrid-LLM revision:** `@anthropic-ai/claude-agent-sdk` (Claude subagents) and a local **Ollama** runtime for the main loop.

---

## Progress (updated 2026-06-10, 4:24 PM)

Branch: `main`. Full suite green: **49 tests / 15 files**; `npm run build:backend` clean.

| Task | Status | Commit |
| --- | --- | --- |
| 17 — Shared types + event emitter shim | ✅ Done | `682606c`, `abcbb92` |
| 18 — Pending-confirmation registry | ✅ Done | `3f3bd12`, `7a86359` |
| 19 — Settings store (DB-backed) | ✅ Done | `ba76440`, `2dbc119` |
| 20 — Gmail send + draft (gated) | ✅ Done | `e4d8e60`, `2d7ef69` |
| 21 — File write + execute (execute gated) | ✅ Done | `c9e1dd1` |
| 22 — **Ollama local main-loop provider** (hybrid revision) | ✅ Done | `6fbf782` |
| 23 — **Switch pipeline to Ollama + zero-cost logging** (hybrid revision) | ✅ Done | `2930fd1` |
| 24 — **Claude subagents via Agent SDK** (replaces original raw-SDK Task 22) | ✅ Done | `3a94b58` |
| 25 — Backend wiring (confirm/agent/usage/settings/voice) | ⬜ Pending | — |
| 26 — Confirmation card UI + renderer state | ⬜ Pending | — |
| 27 — Subagent cards UI | ⬜ Pending | — |
| 28 — Usage graphs in dashboard | ⬜ Pending | — |
| 29 — Settings panel + hotkey re-registration | ⬜ Pending | — |
| 30 — Final verification | ⬜ Pending | — |

**Architecture decision (hybrid LLM):** main conversational loop runs on local **Ollama (`llama3.1:8b`)** at $0; `spawn_agent` delegates heavy multi-step work to **Claude via the Agent SDK** on the user's Pro subscription. See the "REVISION (2026-06-10): Hybrid LLM" section below for full task specs (supersedes the original Task 22).

**Live-run prerequisites (manual, not yet done):**
1. Install Ollama, then `ollama pull llama3.1:8b`.
2. `claude setup-token` → in `jarvis/.env.local`, **remove `ANTHROPIC_API_KEY`** (it shadows the subscription) and add `CLAUDE_CODE_OAUTH_TOKEN=<token>`. Optional: `OLLAMA_MODEL`, `OLLAMA_BASE_URL`.

---

## Conventions (read before starting)

- Backend tests are imported dynamically with `await import(...)` and run under `environment: 'node'` (see `vitest.config.ts`). Globals are OFF — always `import { describe, it, expect } from 'vitest'`.
- Test paths from `tests/backend/...` reach source via `../../../src/backend/...` (three levels up).
- Run a single test file with: `npx vitest run <path>`. Run all: `npx vitest run`.
- Backend is bundled separately; after backend changes verify with `npm run build:backend`. After renderer changes verify with `npm run build`.
- Commit after each task. Never use `git commit --amend` on already-good commits.

---

## File Map (new / modified in Phase 2)

```
src/backend/
├── events.ts            # NEW: module-level BackendEvent emitter shim
├── confirm.ts           # NEW: pending-confirmation registry
├── agents.ts            # NEW: subagent runner + spawn_agent tool
├── types.ts             # MOD: new BackendEvent/RendererEvent variants, Settings, AgentInfo, usage types
├── index.ts             # MOD: setEmitter, confirm_response/agent_close/get_*/set_settings handling, voice yes/no
├── claude.ts            # MOD: honor settings.modelPreference; exclude spawn loops
├── elevenlabs.ts        # MOD: read voiceId from settings
├── memory/
│   ├── db.ts            # MOD: export getDb; add getUsageDaily/getUsageByModel
│   └── settings.ts      # NEW: getSettings/setSettings
└── tools/
    ├── index.ts         # MOD: register execute + agent tools; getToolsForAgent()
    ├── gmail.ts         # MOD: send scope, sendEmail/createDraft, gmail_send/gmail_draft
    ├── filesystem.ts    # MOD: writeFile + fs_write
    └── execute.ts       # NEW: execute_file (confirmation-gated)

src/renderer/src/
├── components/
│   ├── ConfirmCard.tsx  # NEW
│   ├── AgentCards.tsx   # NEW
│   ├── UsageGraph.tsx   # NEW
│   ├── SettingsPanel.tsx# NEW
│   └── Dashboard.tsx    # MOD: embed UsageGraph + open settings
├── hooks/
│   └── useAnimState.ts  # MOD: confirm, agents, usage, settings, panels
└── App.tsx              # MOD: render ConfirmCard, AgentCards, SettingsPanel

src/main/index.ts        # MOD: ipc 'set-hotkey' re-registers globalShortcut
src/preload/index.ts     # MOD: expose setHotkey

tests/backend/
├── confirm.test.ts          # NEW
├── agents.test.ts           # NEW
├── memory/settings.test.ts  # NEW
├── memory/usage.test.ts     # NEW
└── tools/
    ├── gmail.test.ts        # MOD: assert send/draft defs
    ├── filesystem.test.ts   # MOD: assert write roundtrip
    └── execute.test.ts      # NEW
```

---

## Task 17: Shared types + backend event emitter shim

**Files:**
- Modify: `src/backend/types.ts`
- Create: `src/backend/events.ts`
- Test: `tests/backend/events.test.ts`

- [ ] **Step 1: Extend `src/backend/types.ts`**

Replace the entire file with:
```ts
// Events sent from backend → renderer
export type AnimState = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface Settings {
  hotkey: string
  voiceId: string
  modelPreference: 'auto' | 'fable' | 'haiku'
  shortTurns: number
}

export interface AgentInfo {
  id: string
  name: string
  task: string
  status: 'running' | 'done' | 'error'
  actions: string[]
  result?: string
  startedAt: number
}

export interface UsagePoint { date: string; tokens: number; cost: number }
export interface ModelUsage { model: string; tokens: number; cost: number }

export type BackendEvent =
  | { type: 'state'; state: AnimState }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; partial: boolean }
  | { type: 'stats'; tokensToday: number; costToday: number; model: string }
  | { type: 'audio'; data: Buffer }
  | { type: 'error'; message: string }
  | { type: 'dashboard_open' }
  | { type: 'confirm_request'; id: string; action: string; detail: string }
  | { type: 'confirm_resolved'; id: string; approved: boolean }
  | { type: 'agent_spawn'; id: string; name: string; task: string }
  | { type: 'agent_update'; id: string; action: string }
  | { type: 'agent_done'; id: string; result: string }
  | { type: 'agent_error'; id: string; message: string }
  | { type: 'usage'; daily: UsagePoint[]; byModel: ModelUsage[] }
  | { type: 'settings'; settings: Settings }

// Events sent from renderer → backend
export type RendererEvent =
  | { type: 'audio'; data: Buffer }
  | { type: 'command'; text: string }
  | { type: 'dashboard_open' }
  | { type: 'confirm_response'; id: string; approved: boolean }
  | { type: 'agent_close'; id: string }
  | { type: 'get_usage' }
  | { type: 'get_settings' }
  | { type: 'set_settings'; settings: Partial<Settings> }
```

- [ ] **Step 2: Create `src/backend/events.ts`**

```ts
import type { BackendEvent } from './types'

let emit: (event: BackendEvent) => void = () => {}

export function setEmitter(fn: (event: BackendEvent) => void): void {
  emit = fn
}

export function emitEvent(event: BackendEvent): void {
  emit(event)
}
```

- [ ] **Step 3: Write `tests/backend/events.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('events shim', () => {
  it('routes emitted events to the registered emitter', async () => {
    const { setEmitter, emitEvent } = await import('../../src/backend/events')
    const seen: unknown[] = []
    setEmitter(e => seen.push(e))
    emitEvent({ type: 'state', state: 'idle' })
    expect(seen).toEqual([{ type: 'state', state: 'idle' }])
  })

  it('is a no-op before an emitter is registered', async () => {
    const { emitEvent } = await import('../../src/backend/events')
    expect(() => emitEvent({ type: 'error', message: 'x' })).not.toThrow()
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/backend/events.test.ts`
Expected: PASS (2 tests). Note: the second test may observe the emitter set by the first within the same module instance — both assertions still hold because emit never throws.

- [ ] **Step 5: Wire `setEmitter` in `src/backend/index.ts`**

In `src/backend/index.ts`, add the import near the other imports:
```ts
import { setEmitter } from './events'
```
Then immediately after the `broadcast` function definition (after its closing `}`), add:
```ts
setEmitter(broadcast)
```

- [ ] **Step 6: Verify backend still builds**

Run: `npm run build:backend`
Expected: "built in ..." with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/backend/types.ts src/backend/events.ts src/backend/index.ts tests/backend/events.test.ts
git commit -m "feat: phase2 shared types and backend event emitter shim"
```

---

## Task 18: Pending-confirmation registry

**Files:**
- Create: `src/backend/confirm.ts`
- Test: `tests/backend/confirm.test.ts`

- [ ] **Step 1: Write `tests/backend/confirm.test.ts`**

```ts
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
```

- [ ] **Step 2: Run tests — verify failure**

Run: `npx vitest run tests/backend/confirm.test.ts`
Expected: FAIL — "Cannot find module '../../src/backend/confirm'"

- [ ] **Step 3: Create `src/backend/confirm.ts`**

```ts
import { randomUUID } from 'crypto'

export interface PendingConfirmation {
  id: string
  action: string
  detail: string
  execute: () => Promise<string>
}

const pending = new Map<string, PendingConfirmation>()

export function requestConfirmation(
  action: string,
  detail: string,
  execute: () => Promise<string>,
): PendingConfirmation {
  const conf: PendingConfirmation = { id: randomUUID(), action, detail, execute }
  pending.set(conf.id, conf)
  return conf
}

export async function resolveConfirmation(id: string, approved: boolean): Promise<string | null> {
  const conf = pending.get(id)
  if (!conf) return null
  pending.delete(id)
  if (!approved) return null
  return conf.execute()
}

export function getLatestPending(): PendingConfirmation | null {
  let latest: PendingConfirmation | null = null
  for (const c of pending.values()) latest = c
  return latest
}

export function hasPending(): boolean {
  return pending.size > 0
}

export function clearPending(): void {
  pending.clear()
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/backend/confirm.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/confirm.ts tests/backend/confirm.test.ts
git commit -m "feat: pending-confirmation registry for destructive actions"
```

---

## Task 19: Settings store (DB-backed)

**Files:**
- Modify: `src/backend/memory/db.ts` (export `getDb`)
- Create: `src/backend/memory/settings.ts`
- Test: `tests/backend/memory/settings.test.ts`

- [ ] **Step 1: Export `getDb` from `src/backend/memory/db.ts`**

Change the `getDb` declaration from:
```ts
function getDb(): Database.Database {
  if (!db) db = new Database(DB_PATH)
  return db
}
```
to:
```ts
export function getDb(): Database.Database {
  if (!db) db = new Database(DB_PATH)
  return db
}
```

- [ ] **Step 2: Write `tests/backend/memory/settings.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/settings-test.db'

function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held briefly on Windows */ } }
}

describe('settings store', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb()
    cleanup()
  })

  it('returns defaults when nothing is stored', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { getSettings } = await import('../../../src/backend/memory/settings')
    initDb()
    const s = getSettings()
    expect(s.hotkey).toBe('Alt+Space')
    expect(s.modelPreference).toBe('auto')
    expect(s.shortTurns).toBe(20)
  })

  it('persists and merges partial updates', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setSettings, getSettings } = await import('../../../src/backend/memory/settings')
    initDb()
    setSettings({ hotkey: 'Control+Space', modelPreference: 'fable' })
    const s = getSettings()
    expect(s.hotkey).toBe('Control+Space')
    expect(s.modelPreference).toBe('fable')
    expect(s.shortTurns).toBe(20) // untouched default
  })

  it('coerces numeric shortTurns from stored string', async () => {
    const { initDb } = await import('../../../src/backend/memory/db')
    const { setSettings, getSettings } = await import('../../../src/backend/memory/settings')
    initDb()
    setSettings({ shortTurns: 8 })
    expect(getSettings().shortTurns).toBe(8)
  })
})
```

- [ ] **Step 3: Run tests — verify failure**

Run: `npx vitest run tests/backend/memory/settings.test.ts`
Expected: FAIL — module `settings` not found

- [ ] **Step 4: Create `src/backend/memory/settings.ts`**

```ts
import { getDb } from './db'
import type { Settings } from '../types'

const DEFAULTS: Settings = {
  hotkey: 'Alt+Space',
  voiceId: process.env.ELEVENLABS_VOICE_ID ?? 'pqHfZKP75CvOlQylNhV4',
  modelPreference: 'auto',
  shortTurns: 20,
}

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map(r => [r.key, r.value]))
  return {
    hotkey: map.get('hotkey') ?? DEFAULTS.hotkey,
    voiceId: map.get('voiceId') ?? DEFAULTS.voiceId,
    modelPreference: (map.get('modelPreference') as Settings['modelPreference']) ?? DEFAULTS.modelPreference,
    shortTurns: map.has('shortTurns') ? parseInt(map.get('shortTurns')!, 10) : DEFAULTS.shortTurns,
  }
}

export function setSettings(partial: Partial<Settings>): Settings {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) stmt.run(k, String(v))
  }
  return getSettings()
}
```

- [ ] **Step 5: Run tests — verify pass**

Run: `npx vitest run tests/backend/memory/settings.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/backend/memory/db.ts src/backend/memory/settings.ts tests/backend/memory/settings.test.ts
git commit -m "feat: db-backed settings store with defaults and partial merge"
```

---

## Task 20: Gmail send + draft (confirmation-gated)

**Files:**
- Modify: `src/backend/tools/gmail.ts`
- Modify: `tests/backend/tools/gmail.test.ts`

> **Note:** Adding send/compose scopes invalidates the existing `.gmail-token.json`. After this task, delete that file so the next Gmail call re-runs OAuth and grants the new scopes.

- [ ] **Step 1: Add send/compose scopes in `src/backend/tools/gmail.ts`**

Replace the `SCOPES` constant:
```ts
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
]
```

- [ ] **Step 2: Add raw-message builder + send/draft functions**

In `src/backend/tools/gmail.ts`, add these imports at the top (alongside existing imports):
```ts
import { requestConfirmation } from '../confirm'
import { emitEvent } from '../events'
```
Then add, after the existing `readEmail` function:
```ts
function buildRawMessage(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body,
  ]
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

async function sendEmailNow(to: string, subject: string, body: string): Promise<string> {
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: buildRawMessage(to, subject, body) } })
  return `Email sent to ${to}.`
}

export async function queueSendEmail(to: string, subject: string, body: string): Promise<string> {
  if (!to) throw new Error('Recipient (to) is required')
  const conf = requestConfirmation('Send email', `To: ${to}\nSubject: ${subject}`, () => sendEmailNow(to, subject, body))
  emitEvent({ type: 'confirm_request', id: conf.id, action: conf.action, detail: conf.detail })
  return `I've drafted an email to ${to} with subject "${subject}". Shall I send it?`
}

export async function createDraft(to: string, subject: string, body: string): Promise<string> {
  if (!to) throw new Error('Recipient (to) is required')
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: buildRawMessage(to, subject, body) } } })
  return `Draft saved for ${to}.`
}
```

- [ ] **Step 3: Add tool defs + dispatch**

In `src/backend/tools/gmail.ts`, append two entries to the `gmailToolDefs` array (after `gmail_read`):
```ts
  {
    name: 'gmail_send',
    description: 'Send an email. This is a destructive action: it will be queued for explicit user confirmation before sending.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_draft',
    description: 'Create a Gmail draft without sending it. Safe, non-destructive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
```
Then replace `handleGmailTool` with:
```ts
export async function handleGmailTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case 'gmail_search': return searchEmails(input.query, input.max_results)
    case 'gmail_read':   return readEmail(input.message_id)
    case 'gmail_send':   return queueSendEmail(input.to, input.subject, input.body)
    case 'gmail_draft':  return createDraft(input.to, input.subject, input.body)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
```

- [ ] **Step 4: Extend `tests/backend/tools/gmail.test.ts`**

Add these tests inside the existing `describe('gmail tools', ...)` block:
```ts
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
```

- [ ] **Step 5: Run tests — verify pass**

Run: `npx vitest run tests/backend/tools/gmail.test.ts`
Expected: PASS (existing 3 + 2 new = 5 tests). The `gmail_send` test never hits the network because the action is deferred into the registry.

- [ ] **Step 6: Commit**

```bash
git add src/backend/tools/gmail.ts tests/backend/tools/gmail.test.ts
git commit -m "feat: gmail send (confirmation-gated) and draft tools"
```

---

## Task 21: File write + execute (execute confirmation-gated)

**Files:**
- Modify: `src/backend/tools/filesystem.ts`
- Create: `src/backend/tools/execute.ts`
- Modify: `tests/backend/tools/filesystem.test.ts`
- Test: `tests/backend/tools/execute.test.ts`

- [ ] **Step 1: Add `writeFile` + `fs_write` to `src/backend/tools/filesystem.ts`**

Change the top import line from:
```ts
import { readFile as fsRead, readdir } from 'fs/promises'
```
to:
```ts
import { readFile as fsRead, readdir, writeFile as fsWrite } from 'fs/promises'
```
Add this function after `searchFiles`:
```ts
export async function writeFile(filePath: string, content: string): Promise<string> {
  const safe = assertSafePath(filePath)
  await fsWrite(safe, content, 'utf-8')
  return `Wrote ${content.length} characters to ${filePath}`
}
```
Append to `filesystemToolDefs` (after `fs_search`):
```ts
  {
    name: 'fs_write',
    description: 'Write text content to a file (creates or overwrites). Restricted to the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Text content to write' },
      },
      required: ['path', 'content'],
    },
  },
```
Add a `fs_write` case to `handleFilesystemTool` (before `default`):
```ts
    case 'fs_write':  return writeFile(input.path, input.content)
```

- [ ] **Step 2: Add write-roundtrip test to `tests/backend/tools/filesystem.test.ts`**

Add inside the existing `describe('filesystem tools', ...)` block:
```ts
  it('writeFile creates a readable file', async () => {
    const { writeFile } = await import('../../../src/backend/tools/filesystem')
    const target = join(TMP, 'written.txt')
    await writeFile(target, 'persisted content')
    const back = await readFile(target)
    expect(back).toBe('persisted content')
  })

  it('writeFile rejects paths outside allowed roots', async () => {
    const { writeFile } = await import('../../../src/backend/tools/filesystem')
    await expect(writeFile('C:\\Windows\\jarvis-nope.txt', 'x')).rejects.toThrow()
  })
```

- [ ] **Step 3: Write `tests/backend/tools/execute.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('execute tool', () => {
  it('exports executeToolDefs and handleExecuteTool', async () => {
    const mod = await import('../../../src/backend/tools/execute')
    expect(Array.isArray(mod.executeToolDefs)).toBe(true)
    expect(typeof mod.handleExecuteTool).toBe('function')
    expect(mod.executeToolDefs.map(t => t.name)).toContain('execute_file')
  })

  it('execute_file queues a confirmation instead of running immediately', async () => {
    const { clearPending, hasPending } = await import('../../../src/backend/confirm')
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    clearPending()
    const home = process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users'
    const reply = await handleExecuteTool('execute_file', { path: `${home}\\demo.bat` })
    expect(reply.toLowerCase()).toContain('confirm')
    expect(hasPending()).toBe(true)
    clearPending()
  })

  it('execute_file rejects paths outside allowed roots', async () => {
    const { handleExecuteTool } = await import('../../../src/backend/tools/execute')
    await expect(handleExecuteTool('execute_file', { path: 'C:\\Windows\\System32\\evil.exe' })).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run tests — verify failure**

Run: `npx vitest run tests/backend/tools/execute.test.ts`
Expected: FAIL — module `execute` not found

- [ ] **Step 5: Create `src/backend/tools/execute.ts`**

```ts
import { exec } from 'child_process'
import { promisify } from 'util'
import { resolve } from 'path'
import { requestConfirmation } from '../confirm'
import { emitEvent } from '../events'

const execAsync = promisify(exec)

const ALLOWED_ROOTS = [resolve(process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users')]

function assertSafePath(filePath: string): string {
  const r = resolve(filePath)
  if (!ALLOWED_ROOTS.some(root => r.startsWith(root))) throw new Error(`Access denied: ${filePath}`)
  return r
}

async function runFileNow(safePath: string): Promise<string> {
  const { stdout, stderr } = await execAsync(`start "" "${safePath}"`, { shell: 'cmd.exe' })
  return (stdout || stderr || '').trim() || `Executed ${safePath}`
}

export async function queueExecute(filePath: string): Promise<string> {
  if (!filePath) throw new Error('File path is required')
  const safe = assertSafePath(filePath) // validate before queuing
  const conf = requestConfirmation('Run file', safe, () => runFileNow(safe))
  emitEvent({ type: 'confirm_request', id: conf.id, action: conf.action, detail: conf.detail })
  return `Ready to run ${filePath}. Please confirm you want me to execute it.`
}

export const executeToolDefs = [
  {
    name: 'execute_file',
    description: 'Run a file or script on the system. Destructive: queued for explicit user confirmation before running. Restricted to the user profile directory.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the file to execute' } },
      required: ['path'],
    },
  },
]

export async function handleExecuteTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'execute_file') return queueExecute(input.path)
  throw new Error(`Unknown tool: ${name}`)
}
```

- [ ] **Step 6: Run tests — verify pass**

Run: `npx vitest run tests/backend/tools/execute.test.ts tests/backend/tools/filesystem.test.ts`
Expected: PASS (execute: 3, filesystem: 6)

- [ ] **Step 7: Commit**

```bash
git add src/backend/tools/filesystem.ts src/backend/tools/execute.ts tests/backend/tools/filesystem.test.ts tests/backend/tools/execute.test.ts
git commit -m "feat: fs_write tool and execute_file (confirmation-gated)"
```

---

## Task 22: Subagent runner + spawn_agent tool

**Files:**
- Create: `src/backend/agents.ts`
- Modify: `src/backend/tools/index.ts`
- Test: `tests/backend/agents.test.ts`

- [ ] **Step 1: Write `tests/backend/agents.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('agents', () => {
  it('exports agentToolDefs with spawn_agent', async () => {
    const mod = await import('../../src/backend/agents')
    expect(mod.agentToolDefs.map(t => t.name)).toContain('spawn_agent')
  })

  it('spawnAgent registers an agent and returns an acknowledgement', async () => {
    const { spawnAgent, getAgents } = await import('../../src/backend/agents')
    const before = getAgents().length
    const reply = await spawnAgent('Researcher', 'Summarize the latest project notes')
    expect(reply.toLowerCase()).toContain('researcher')
    expect(getAgents().length).toBe(before + 1)
  })

  it('closeAgent removes an agent from the registry', async () => {
    const { spawnAgent, getAgents, closeAgent } = await import('../../src/backend/agents')
    await spawnAgent('Temp', 'do a thing')
    const agent = getAgents()[getAgents().length - 1]
    closeAgent(agent.id)
    expect(getAgents().some(a => a.id === agent.id)).toBe(false)
  })
})
```

> The Claude call inside `runAgent` runs detached (`void runAgent(...)`) and will fail fast without an API key, but the failure is caught and only sets `status='error'` — it never throws into `spawnAgent`, so the synchronous assertions above hold.

- [ ] **Step 2: Run tests — verify failure**

Run: `npx vitest run tests/backend/agents.test.ts`
Expected: FAIL — module `agents` not found

- [ ] **Step 3: Create `src/backend/agents.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { emitEvent } from './events'
import { getToolsForAgent, handleTool } from './tools/index'
import type { AgentInfo } from './types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const AGENT_SYSTEM = `You are a Jarvis worker agent. Complete the assigned task autonomously using the available tools. Be efficient and concise. When the task is complete, reply with a one or two sentence summary of what you accomplished.`

const MAX_STEPS = 5

const agents = new Map<string, AgentInfo>()

export function getAgents(): AgentInfo[] {
  return [...agents.values()]
}

export function closeAgent(id: string): void {
  agents.delete(id)
}

export async function spawnAgent(name: string, task: string): Promise<string> {
  const info: AgentInfo = {
    id: randomUUID(),
    name,
    task,
    status: 'running',
    actions: [],
    startedAt: Date.now(),
  }
  agents.set(info.id, info)
  emitEvent({ type: 'agent_spawn', id: info.id, name, task })
  void runAgent(info)
  return `Spawned agent "${name}" to handle: ${task}. It will report back when done.`
}

async function runAgent(info: AgentInfo): Promise<void> {
  try {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: info.task }]

    for (let step = 0; step < MAX_STEPS; step++) {
      const msg = await client.messages.create({
        model: 'claude-fable-5',
        max_tokens: 1024,
        system: AGENT_SYSTEM,
        messages,
        tools: getToolsForAgent(),
      })

      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
      if (text) {
        info.actions.push(text)
        emitEvent({ type: 'agent_update', id: info.id, action: text })
      }

      if (msg.stop_reason === 'tool_use') {
        const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUses.map(async (b) => {
            emitEvent({ type: 'agent_update', id: info.id, action: `Using ${b.name}` })
            try {
              const r = await handleTool(b.name, b.input as Record<string, unknown>)
              return { type: 'tool_result' as const, tool_use_id: b.id, content: r }
            } catch (e) {
              return { type: 'tool_result' as const, tool_use_id: b.id, content: `Error: ${String(e)}`, is_error: true }
            }
          }),
        )
        messages.push({ role: 'assistant', content: msg.content }, { role: 'user', content: results })
        continue
      }

      info.status = 'done'
      info.result = text || 'Task complete.'
      emitEvent({ type: 'agent_done', id: info.id, result: info.result })
      return
    }

    info.status = 'done'
    info.result = 'Reached step limit before completing.'
    emitEvent({ type: 'agent_done', id: info.id, result: info.result })
  } catch (e) {
    info.status = 'error'
    emitEvent({ type: 'agent_error', id: info.id, message: String(e) })
  }
}

export const agentToolDefs = [
  {
    name: 'spawn_agent',
    description: 'Spawn a named worker agent to autonomously handle a multi-step task (e.g. research, multi-file edits, batch email triage). Returns immediately; the agent reports back when finished.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short name for the agent (e.g. "Email Triage")' },
        task: { type: 'string', description: 'A clear, self-contained description of the task to accomplish' },
      },
      required: ['name', 'task'],
    },
  },
]

export async function handleAgentTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'spawn_agent') return spawnAgent(input.name, input.task)
  throw new Error(`Unknown tool: ${name}`)
}
```

- [ ] **Step 4: Update `src/backend/tools/index.ts`**

Replace the entire file with:
```ts
import { filesystemToolDefs, handleFilesystemTool } from './filesystem'
import { launcherToolDefs, handleLauncherTool } from './launcher'
import { gmailToolDefs, handleGmailTool } from './gmail'
import { executeToolDefs, handleExecuteTool } from './execute'
import { agentToolDefs, handleAgentTool } from '../agents'
import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...executeToolDefs,
    ...agentToolDefs,
  ] as Tool[]
}

// Worker agents get every tool EXCEPT spawn_agent (prevents recursive spawning).
export function getToolsForAgent(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...executeToolDefs,
  ] as Tool[]
}

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name.startsWith('fs_'))     return handleFilesystemTool(name, input as Record<string, string>)
  if (name === 'app_launch')      return handleLauncherTool(name, input as Record<string, string>)
  if (name.startsWith('gmail_'))  return handleGmailTool(name, input)
  if (name === 'execute_file')    return handleExecuteTool(name, input as Record<string, string>)
  if (name === 'spawn_agent')     return handleAgentTool(name, input as Record<string, string>)
  throw new Error(`Unknown tool: ${name}`)
}
```

> Note the dependency direction: `agents.ts` imports from `tools/index.ts` (for `getToolsForAgent`/`handleTool`) and `tools/index.ts` imports from `agents.ts` (for the tool defs). This cycle is safe because the imported symbols are only referenced inside functions called at runtime, not at module top-level.

- [ ] **Step 5: Run tests — verify pass**

Run: `npx vitest run tests/backend/agents.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Verify backend builds**

Run: `npm run build:backend`
Expected: built with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/backend/agents.ts src/backend/tools/index.ts tests/backend/agents.test.ts
git commit -m "feat: subagent runner with spawn_agent tool and streaming updates"
```

---

## Task 23: Backend wiring — confirmation resolution, agent close, usage, settings

**Files:**
- Modify: `src/backend/memory/db.ts` (usage queries)
- Modify: `src/backend/index.ts`
- Modify: `src/backend/claude.ts` (honor model preference)
- Modify: `src/backend/elevenlabs.ts` (voice from settings)
- Test: `tests/backend/memory/usage.test.ts`

- [ ] **Step 1: Add usage queries to `src/backend/memory/db.ts`**

Add after `getStatsToday`:
```ts
export function getUsageDaily(days: number): Array<{ date: string; tokens: number; cost: number }> {
  const since = Date.now() - days * 86_400_000
  return getDb().prepare(`
    SELECT date(timestamp / 1000, 'unixepoch', 'localtime') as date,
           COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
           COALESCE(SUM(cost_usd), 0) as cost
    FROM api_calls
    WHERE timestamp >= ?
    GROUP BY date
    ORDER BY date
  `).all(since) as Array<{ date: string; tokens: number; cost: number }>
}

export function getUsageByModel(days: number): Array<{ model: string; tokens: number; cost: number }> {
  const since = Date.now() - days * 86_400_000
  return getDb().prepare(`
    SELECT model,
           COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
           COALESCE(SUM(cost_usd), 0) as cost
    FROM api_calls
    WHERE timestamp >= ?
    GROUP BY model
    ORDER BY cost DESC
  `).all(since) as Array<{ model: string; tokens: number; cost: number }>
}
```

- [ ] **Step 2: Write `tests/backend/memory/usage.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/usage-test.db'
function cleanup(): void {
  if (existsSync(TEST_DB)) { try { unlinkSync(TEST_DB) } catch { /* held briefly */ } }
}

describe('usage aggregation', () => {
  beforeEach(async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
  })
  afterEach(async () => {
    const { closeDb } = await import('../../../src/backend/memory/db')
    closeDb(); cleanup()
  })

  it('aggregates daily usage and usage by model', async () => {
    const { initDb, logApiCall, getUsageDaily, getUsageByModel } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'claude-fable-5', inputTokens: 100, outputTokens: 100 })
    logApiCall({ model: 'claude-haiku-4-5-20251001', inputTokens: 50, outputTokens: 50 })
    const daily = getUsageDaily(7)
    expect(daily.length).toBeGreaterThanOrEqual(1)
    expect(daily.reduce((a, d) => a + d.tokens, 0)).toBe(300)
    const byModel = getUsageByModel(7)
    expect(byModel.map(m => m.model)).toContain('claude-fable-5')
    expect(byModel.map(m => m.model)).toContain('claude-haiku-4-5-20251001')
  })
})
```

- [ ] **Step 3: Run usage test — verify pass**

Run: `npx vitest run tests/backend/memory/usage.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Honor model preference in `src/backend/claude.ts`**

Add import at top:
```ts
import { getSettings } from './memory/settings'
```
Replace `selectModel` with:
```ts
export function selectModel(text: string): string {
  let pref: 'auto' | 'fable' | 'haiku' = 'auto'
  try { pref = getSettings().modelPreference } catch { /* db not ready in unit context */ }
  if (pref === 'fable') return 'claude-fable-5'
  if (pref === 'haiku') return 'claude-haiku-4-5-20251001'

  const lower = text.toLowerCase()
  const words = lower.trim().split(/\s+/)
  const hasToolKeyword = TOOL_KEYWORDS.some(kw => lower.includes(kw))
  if (words.length <= 15 && !hasToolKeyword) return 'claude-haiku-4-5-20251001'
  return 'claude-fable-5'
}
```

> The existing `claude.test.ts` calls `selectModel` without a DB. The `try/catch` makes `getSettings()` failures fall through to `'auto'`, preserving the original heuristic and keeping those tests green.

- [ ] **Step 5: Read voice from settings in `src/backend/elevenlabs.ts`**

Replace the top of `src/backend/elevenlabs.ts` (the `VOICE_ID` const) so the voice is resolved per-call from settings, falling back to env then the default. Replace lines 1–4 with:
```ts
import { getSettings } from './memory/settings'

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? ''
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? 'pqHfZKP75CvOlQylNhV4'

function resolveVoiceId(): string {
  try { return getSettings().voiceId || DEFAULT_VOICE_ID } catch { return DEFAULT_VOICE_ID }
}
```
Then inside `synthesize`, change the fetch URL to use `resolveVoiceId()`:
```ts
  const voiceId = resolveVoiceId()
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
```
(Remove the old `${VOICE_ID}` reference.)

- [ ] **Step 6: Add new renderer→backend handlers in `src/backend/index.ts`**

Add these imports alongside the existing imports:
```ts
import { resolveConfirmation } from './confirm'
import { closeAgent } from './agents'
import { getUsageDaily, getUsageByModel } from './memory/db'
import { getSettings, setSettings } from './memory/settings'
```
Then, inside `handleRendererEvent`, add these branches BEFORE the `eventHandlers.forEach(...)` line:
```ts
  if (event.type === 'confirm_response') {
    void (async () => {
      try {
        const result = await resolveConfirmation(event.id, event.approved)
        broadcast({ type: 'confirm_resolved', id: event.id, approved: event.approved })
        const msg = event.approved ? (result ?? 'Done.') : 'Cancelled.'
        broadcast({ type: 'transcript', role: 'assistant', text: msg, partial: false })
        broadcast({ type: 'state', state: 'speaking' })
        try { broadcast({ type: 'audio', data: await synthesize(msg) }) } catch { /* tts optional */ }
      } catch (err) {
        broadcast({ type: 'error', message: String(err) })
      } finally {
        setTimeout(() => broadcast({ type: 'state', state: 'idle' }), 3000)
      }
    })()
    return
  }
  if (event.type === 'agent_close') {
    closeAgent(event.id)
    return
  }
  if (event.type === 'get_usage') {
    broadcast({ type: 'usage', daily: getUsageDaily(30), byModel: getUsageByModel(30) })
    return
  }
  if (event.type === 'get_settings') {
    broadcast({ type: 'settings', settings: getSettings() })
    return
  }
  if (event.type === 'set_settings') {
    const updated = setSettings(event.settings)
    broadcast({ type: 'settings', settings: updated })
    return
  }
```

- [ ] **Step 7: Add voice yes/no confirmation in the pipeline (`src/backend/index.ts`)**

Add to the imports:
```ts
import { hasPending, getLatestPending, resolveConfirmation } from './confirm'
```
(If `resolveConfirmation` is already imported from Step 6, list it only once.)

In the audio pipeline handler, immediately AFTER the line that broadcasts the user transcript (`broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })`) and BEFORE the dashboard voice-command check, insert:
```ts
    // If a destructive action is awaiting confirmation, interpret this utterance as the answer.
    if (hasPending()) {
      const yes = /\b(yes|yeah|yep|confirm|confirmed|send it|do it|go ahead|affirmative|proceed)\b/i.test(userText)
      const no = /\b(no|nope|cancel|stop|don'?t|negative|abort)\b/i.test(userText)
      if (yes || no) {
        const conf = getLatestPending()!
        const result = await resolveConfirmation(conf.id, yes)
        broadcast({ type: 'confirm_resolved', id: conf.id, approved: yes })
        const reply = yes ? (result ?? 'Done.') : 'Cancelled.'
        broadcast({ type: 'transcript', role: 'assistant', text: reply, partial: false })
        broadcast({ type: 'state', state: 'speaking' })
        try { broadcast({ type: 'audio', data: await synthesize(reply) }) } catch { /* tts optional */ }
        setTimeout(() => broadcast({ type: 'state', state: 'idle' }), 3000)
        return
      }
    }
```

- [ ] **Step 8: Verify backend builds + full backend tests pass**

Run: `npm run build:backend && npx vitest run`
Expected: backend bundle builds; all backend tests pass (including unchanged `claude.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add src/backend/memory/db.ts src/backend/index.ts src/backend/claude.ts src/backend/elevenlabs.ts tests/backend/memory/usage.test.ts
git commit -m "feat: backend wiring for confirmations, agent close, usage queries, settings; voice yes/no"
```

---

## Task 24: Confirmation card UI + renderer state

**Files:**
- Modify: `src/renderer/src/hooks/useAnimState.ts`
- Create: `src/renderer/src/components/ConfirmCard.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Extend `JarvisState` in `src/renderer/src/hooks/useAnimState.ts`**

Replace the file with:
```ts
import { useState, useCallback } from 'react'
import type { AnimState, BackendEvent, AgentInfo, Settings, UsagePoint, ModelUsage } from '../../../backend/types'

export interface PendingConfirm {
  id: string
  action: string
  detail: string
}

export interface JarvisState {
  anim: AnimState
  tokensToday: number
  costToday: number
  model: string
  userText: string
  assistantText: string
  dashboardOpen: boolean
  settingsOpen: boolean
  confirm: PendingConfirm | null
  agents: AgentInfo[]
  usageDaily: UsagePoint[]
  usageByModel: ModelUsage[]
  settings: Settings | null
}

const initial: JarvisState = {
  anim: 'idle',
  tokensToday: 0,
  costToday: 0,
  model: 'fable',
  userText: '',
  assistantText: '',
  dashboardOpen: false,
  settingsOpen: false,
  confirm: null,
  agents: [],
  usageDaily: [],
  usageByModel: [],
  settings: null,
}

export function useAnimState(): {
  state: JarvisState
  handleEvent: (event: BackendEvent) => void
  toggleDashboard: () => void
  toggleSettings: () => void
} {
  const [state, setState] = useState<JarvisState>(initial)

  const handleEvent = useCallback((event: BackendEvent) => {
    setState(prev => {
      switch (event.type) {
        case 'state':
          return { ...prev, anim: event.state }
        case 'stats':
          return { ...prev, tokensToday: event.tokensToday, costToday: event.costToday, model: event.model }
        case 'transcript':
          if (event.role === 'user') return { ...prev, userText: event.text, assistantText: '' }
          return { ...prev, assistantText: event.text }
        case 'dashboard_open':
          return { ...prev, dashboardOpen: !prev.dashboardOpen }
        case 'confirm_request':
          return { ...prev, confirm: { id: event.id, action: event.action, detail: event.detail } }
        case 'confirm_resolved':
          return prev.confirm && prev.confirm.id === event.id ? { ...prev, confirm: null } : prev
        case 'agent_spawn':
          return { ...prev, agents: [...prev.agents, { id: event.id, name: event.name, task: event.task, status: 'running', actions: [], startedAt: Date.now() }] }
        case 'agent_update':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, actions: [...a.actions, event.action] } : a) }
        case 'agent_done':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, status: 'done', result: event.result } : a) }
        case 'agent_error':
          return { ...prev, agents: prev.agents.map(a => a.id === event.id ? { ...a, status: 'error', result: event.message } : a) }
        case 'usage':
          return { ...prev, usageDaily: event.daily, usageByModel: event.byModel }
        case 'settings':
          return { ...prev, settings: event.settings }
        default:
          return prev
      }
    })
  }, [])

  const toggleDashboard = useCallback(() => setState(prev => ({ ...prev, dashboardOpen: !prev.dashboardOpen })), [])
  const toggleSettings = useCallback(() => setState(prev => ({ ...prev, settingsOpen: !prev.settingsOpen })), [])

  return { state, handleEvent, toggleDashboard, toggleSettings }
}
```

- [ ] **Step 2: Create `src/renderer/src/components/ConfirmCard.tsx`**

```tsx
interface Props {
  action: string
  detail: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmCard({ action, detail, onConfirm, onCancel }: Props): JSX.Element {
  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute',
        bottom: 100,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 460,
        maxWidth: '70vw',
        background: 'rgba(6, 11, 20, 0.94)',
        border: '1px solid rgba(245, 158, 11, 0.5)',
        borderRadius: 8,
        padding: 20,
        fontFamily: '"Orbitron", monospace',
        color: '#fde68a',
        boxShadow: '0 0 32px rgba(245, 158, 11, 0.18)',
        backdropFilter: 'blur(12px)',
        zIndex: 120,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', marginBottom: 8 }}>
        CONFIRM · {action.toUpperCase()}
      </div>
      <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 12, color: '#e0f2fe', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
        {detail}
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btn('#94a3b8')}>CANCEL</button>
        <button onClick={onConfirm} style={btn('#f59e0b')}>CONFIRM</button>
      </div>
      <div style={{ marginTop: 10, fontSize: 9, color: '#7a6a3a', letterSpacing: '0.1em' }}>
        OR SAY “YES” / “CANCEL”
      </div>
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${color}`,
    color,
    cursor: 'pointer',
    fontFamily: '"Orbitron", monospace',
    fontSize: 11,
    letterSpacing: '0.1em',
    padding: '6px 16px',
    borderRadius: 4,
  }
}
```

- [ ] **Step 3: Render `ConfirmCard` in `src/renderer/src/App.tsx`**

Add the import:
```tsx
import { ConfirmCard } from './components/ConfirmCard'
```
In the returned JSX, add after `<Transcript ... />`:
```tsx
      {state.confirm && (
        <ConfirmCard
          action={state.confirm.action}
          detail={state.confirm.detail}
          onConfirm={() => send({ type: 'confirm_response', id: state.confirm!.id, approved: true })}
          onCancel={() => send({ type: 'confirm_response', id: state.confirm!.id, approved: false })}
        />
      )}
```

- [ ] **Step 4: Verify renderer builds**

Run: `npm run build`
Expected: renderer bundle builds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useAnimState.ts src/renderer/src/components/ConfirmCard.tsx src/renderer/src/App.tsx
git commit -m "feat: confirmation card UI and renderer phase2 state"
```

---

## Task 25: Subagent cards UI

**Files:**
- Create: `src/renderer/src/components/AgentCards.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create `src/renderer/src/components/AgentCards.tsx`**

```tsx
import { useState } from 'react'
import type { AgentInfo } from '../../../backend/types'

interface Props {
  agents: AgentInfo[]
  onClose: (id: string) => void
}

const STATUS_COLOR: Record<AgentInfo['status'], string> = {
  running: '#60a5fa',
  done: '#4ade80',
  error: '#f87171',
}

export function AgentCards({ agents, onClose }: Props): JSX.Element | null {
  if (agents.length === 0) return null
  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        display: 'flex',
        gap: 12,
        zIndex: 90,
        maxWidth: '70vw',
        overflowX: 'auto',
      }}
    >
      {agents.map(a => <AgentCard key={a.id} agent={a} onClose={onClose} />)}
    </div>
  )
}

function AgentCard({ agent, onClose }: { agent: AgentInfo; onClose: (id: string) => void }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const last = agent.actions[agent.actions.length - 1] ?? 'Starting…'
  return (
    <div
      style={{
        width: 260,
        flex: '0 0 auto',
        background: 'rgba(6, 11, 20, 0.92)',
        border: `1px solid ${STATUS_COLOR[agent.status]}55`,
        borderRadius: 8,
        padding: 14,
        fontFamily: '"Orbitron", monospace',
        color: '#7dd3fc',
        backdropFilter: 'blur(10px)',
        boxShadow: `0 0 20px ${STATUS_COLOR[agent.status]}22`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e0f2fe' }}>{agent.name}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: STATUS_COLOR[agent.status], letterSpacing: '0.1em' }}>
            {agent.status.toUpperCase()}
          </span>
          <button
            onClick={() => onClose(agent.id)}
            style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 12 }}
          >✕</button>
        </span>
      </div>
      <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 10, color: '#94a3b8', marginBottom: 8 }}>
        {agent.task}
      </div>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 11, color: '#7dd3fc', cursor: 'pointer' }}
      >
        {expanded
          ? agent.actions.map((act, i) => <div key={i} style={{ marginBottom: 4 }}>› {act}</div>)
          : <div>› {agent.result ?? last}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render `AgentCards` in `src/renderer/src/App.tsx`**

Add the import:
```tsx
import { AgentCards } from './components/AgentCards'
```
Add to the JSX (after the `ConfirmCard` block):
```tsx
      <AgentCards agents={state.agents} onClose={(id) => send({ type: 'agent_close', id })} />
```

- [ ] **Step 3: Verify renderer builds**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AgentCards.tsx src/renderer/src/App.tsx
git commit -m "feat: subagent cards with expandable action log and close"
```

---

## Task 26: Usage graphs in dashboard

**Files:**
- Create: `src/renderer/src/components/UsageGraph.tsx`
- Modify: `src/renderer/src/components/Dashboard.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create `src/renderer/src/components/UsageGraph.tsx`**

```tsx
import type { UsagePoint, ModelUsage } from '../../../backend/types'

interface Props {
  daily: UsagePoint[]
  byModel: ModelUsage[]
}

export function UsageGraph({ daily, byModel }: Props): JSX.Element {
  const maxTokens = Math.max(1, ...daily.map(d => d.tokens))
  const totalCost = byModel.reduce((a, m) => a + m.cost, 0)

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#7dd3fc', marginBottom: 10 }}>
        TOKENS · LAST {daily.length} DAY{daily.length === 1 ? '' : 'S'}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
        {daily.length === 0 && (
          <div style={{ fontSize: 10, color: '#4a6a8a', fontFamily: '"Share Tech Mono", monospace' }}>No usage recorded yet.</div>
        )}
        {daily.map(d => (
          <div key={d.date} title={`${d.date}: ${d.tokens.toLocaleString()} tokens`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{
              height: `${Math.round((d.tokens / maxTokens) * 100)}%`,
              minHeight: 2,
              background: 'linear-gradient(180deg, #7dd3fc, #3b82f6)',
              borderRadius: '2px 2px 0 0',
              boxShadow: '0 0 8px rgba(125,211,252,0.4)',
            }} />
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, letterSpacing: '0.12em', color: '#7dd3fc', margin: '18px 0 8px' }}>
        COST BY MODEL · 30D (${totalCost.toFixed(4)})
      </div>
      {byModel.map(m => {
        const pct = totalCost > 0 ? Math.round((m.cost / totalCost) * 100) : 0
        return (
          <div key={m.model} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', fontFamily: '"Share Tech Mono", monospace' }}>
              <span>{m.model}</span>
              <span>${m.cost.toFixed(4)} · {m.tokens.toLocaleString()} tok</span>
            </div>
            <div style={{ height: 6, background: 'rgba(125,211,252,0.08)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #7dd3fc, #a78bfa)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Embed graph + settings button in `src/renderer/src/components/Dashboard.tsx`**

Add the import at the top:
```tsx
import { UsageGraph } from './UsageGraph'
import type { UsagePoint, ModelUsage } from '../../../backend/types'
```
Extend the `Props` interface (add three fields):
```tsx
interface Props extends DashboardStats {
  open: boolean
  onClose: () => void
  daily: UsagePoint[]
  byModel: ModelUsage[]
  onOpenSettings: () => void
}
```
Update the function signature destructuring:
```tsx
export function Dashboard({ open, onClose, tokensToday, costToday, model, daily, byModel, onOpenSettings }: Props): JSX.Element | null {
```
Insert the graph just before the closing `JARVIS v1.0` footer `<div>` (i.e. after the STATUS row block):
```tsx
        <UsageGraph daily={daily} byModel={byModel} />

        <button
          onClick={onOpenSettings}
          className="no-drag"
          style={{
            marginTop: 18, width: '100%', background: 'none',
            border: '1px solid rgba(125,211,252,0.2)', color: '#7dd3fc',
            cursor: 'pointer', fontFamily: '"Orbitron", monospace', fontSize: 11,
            letterSpacing: '0.12em', padding: '8px 0', borderRadius: 4,
          }}
        >OPEN SETTINGS</button>
```

- [ ] **Step 3: Request usage when dashboard opens + pass new props (`src/renderer/src/App.tsx`)**

Add a `useEffect` import if not present (it is). Add this effect inside `App` (after the existing PTT effect):
```tsx
  useEffect(() => {
    if (state.dashboardOpen) send({ type: 'get_usage' })
  }, [state.dashboardOpen, send])
```
Update the `<Dashboard ... />` usage to pass the new props:
```tsx
      <Dashboard
        open={state.dashboardOpen}
        onClose={toggleDashboard}
        tokensToday={state.tokensToday}
        costToday={state.costToday}
        model={state.model}
        daily={state.usageDaily}
        byModel={state.usageByModel}
        onOpenSettings={() => { toggleDashboard(); toggleSettings() }}
      />
```
Ensure `toggleSettings` is destructured from `useAnimState`:
```tsx
  const { state, handleEvent, toggleDashboard, toggleSettings } = useAnimState()
```

- [ ] **Step 4: Verify renderer builds**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/UsageGraph.tsx src/renderer/src/components/Dashboard.tsx src/renderer/src/App.tsx
git commit -m "feat: dashboard usage graphs (daily tokens + cost by model)"
```

---

## Task 27: Settings panel + hotkey re-registration

**Files:**
- Create: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Expose `setHotkey` in `src/preload/index.ts`**

Replace the file with:
```ts
import { contextBridge, ipcRenderer } from 'electron'

let pttCallback: (() => void) | null = null
ipcRenderer.on('ptt-start', () => { pttCallback?.() })

contextBridge.exposeInMainWorld('jarvis', {
  onBackendPort: (cb: (port: number) => void) =>
    ipcRenderer.once('backend-port', (_e, port) => cb(port)),
  onPttStart: (cb: () => void) => { pttCallback = cb },
  setHotkey: (accelerator: string) => ipcRenderer.send('set-hotkey', accelerator),
})
```

- [ ] **Step 2: Handle `set-hotkey` in `src/main/index.ts`**

Add `ipcMain` to the electron import:
```ts
import { app, BrowserWindow, globalShortcut, utilityProcess, ipcMain } from 'electron'
```
Add a module-level helper and IPC handler. Replace the `globalShortcut.register('Alt+Space', ...)` block inside `app.whenReady()` with a call to a reusable function, and register the IPC handler. Specifically, inside `app.whenReady().then(() => { ... })`, replace:
```ts
  globalShortcut.register('Alt+Space', () => {
    mainWindow?.webContents.send('ptt-start')
  })
```
with:
```ts
  registerHotkey('Alt+Space')

  ipcMain.on('set-hotkey', (_e, accelerator: string) => {
    registerHotkey(accelerator)
  })
```
Then add this function at the bottom of the file (after `createWindow`):
```ts
function registerHotkey(accelerator: string): void {
  globalShortcut.unregisterAll()
  try {
    globalShortcut.register(accelerator, () => {
      mainWindow?.webContents.send('ptt-start')
    })
  } catch {
    // Invalid accelerator — fall back to default so PTT keeps working
    globalShortcut.register('Alt+Space', () => {
      mainWindow?.webContents.send('ptt-start')
    })
  }
}
```

- [ ] **Step 3: Create `src/renderer/src/components/SettingsPanel.tsx`**

```tsx
import { useState, useEffect } from 'react'
import type { Settings } from '../../../backend/types'

interface Props {
  open: boolean
  settings: Settings | null
  onClose: () => void
  onSave: (partial: Partial<Settings>) => void
  onHotkeyChange: (accelerator: string) => void
}

export function SettingsPanel({ open, settings, onClose, onSave, onHotkeyChange }: Props): JSX.Element | null {
  const [draft, setDraft] = useState<Settings | null>(settings)
  useEffect(() => { setDraft(settings) }, [settings])

  if (!open || !draft) return null

  const save = (): void => {
    onSave(draft)
    onHotkeyChange(draft.hotkey)
    onClose()
  }

  const panel: React.CSSProperties = {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    width: 460, background: 'rgba(6, 11, 20, 0.94)', border: '1px solid rgba(125,211,252,0.2)',
    borderRadius: 8, padding: 28, fontFamily: '"Orbitron", monospace', color: '#7dd3fc',
    backdropFilter: 'blur(12px)', zIndex: 130, boxShadow: '0 0 40px rgba(59,130,246,0.15)',
  }
  const label: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', display: 'block', marginBottom: 6, color: '#94a3b8' }
  const field: React.CSSProperties = {
    width: '100%', background: 'rgba(125,211,252,0.06)', border: '1px solid rgba(125,211,252,0.18)',
    borderRadius: 4, color: '#e0f2fe', padding: '8px 10px', fontFamily: '"Share Tech Mono", monospace',
    fontSize: 12, marginBottom: 16,
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 129 }} />
      <div style={panel} className="no-drag">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em' }}>SETTINGS</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <label style={label}>PUSH-TO-TALK HOTKEY</label>
        <input style={field} value={draft.hotkey} onChange={e => setDraft({ ...draft, hotkey: e.target.value })} placeholder="Alt+Space" />

        <label style={label}>ELEVENLABS VOICE ID</label>
        <input style={field} value={draft.voiceId} onChange={e => setDraft({ ...draft, voiceId: e.target.value })} />

        <label style={label}>MODEL PREFERENCE</label>
        <select
          style={field}
          value={draft.modelPreference}
          onChange={e => setDraft({ ...draft, modelPreference: e.target.value as Settings['modelPreference'] })}
        >
          <option value="auto">Auto (route by length/keywords)</option>
          <option value="fable">Always Fable</option>
          <option value="haiku">Always Haiku</option>
        </select>

        <label style={label}>SHORT-TERM MEMORY (TURNS)</label>
        <input
          style={field}
          type="number"
          min={2}
          max={50}
          value={draft.shortTurns}
          onChange={e => setDraft({ ...draft, shortTurns: parseInt(e.target.value || '20', 10) })}
        />

        <button
          onClick={save}
          style={{
            width: '100%', background: 'rgba(125,211,252,0.1)', border: '1px solid rgba(125,211,252,0.4)',
            color: '#e0f2fe', cursor: 'pointer', fontFamily: '"Orbitron", monospace', fontSize: 12,
            letterSpacing: '0.12em', padding: '10px 0', borderRadius: 4,
          }}
        >SAVE</button>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Wire `SettingsPanel` into `src/renderer/src/App.tsx`**

Add the import:
```tsx
import { SettingsPanel } from './components/SettingsPanel'
```
Add an effect to fetch settings when the panel opens (after the usage effect):
```tsx
  useEffect(() => {
    if (state.settingsOpen) send({ type: 'get_settings' })
  }, [state.settingsOpen, send])
```
Add to the JSX (after the `<Dashboard ... />` element):
```tsx
      <SettingsPanel
        open={state.settingsOpen}
        settings={state.settings}
        onClose={toggleSettings}
        onSave={(partial) => send({ type: 'set_settings', settings: partial })}
        onHotkeyChange={(accel) => (window as any).jarvis.setHotkey(accel)}
      />
```

- [ ] **Step 5: Verify full build**

Run: `npm run build`
Expected: main, preload, renderer, and backend all build with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx src/renderer/src/App.tsx src/preload/index.ts src/main/index.ts
git commit -m "feat: settings panel (hotkey, voice, model pref) with live hotkey re-registration"
```

---

## Task 28: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all backend tests pass (Phase 1 + new: events, confirm, settings, usage, agents, gmail send/draft, execute, filesystem write).

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: main, preload, renderer, backend all build cleanly.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
Verify:
1. Say "spawn an agent to list files in my documents" → an agent card slides in bottom-left, streams actions, then shows DONE.
2. Say "send an email to me@example.com saying hello" → an amber confirmation card appears and Jarvis asks to confirm; say "yes" → email sends (requires re-auth with new scopes; delete `.gmail-token.json` first).
3. Click the top-right HUD → dashboard shows token/cost graphs; click OPEN SETTINGS → change voice/model/hotkey → SAVE; confirm the new hotkey triggers PTT.

- [ ] **Step 4: Announce completion**

Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then follow superpowers:finishing-a-development-branch.

---

## Phase 2 Complete

After Task 28, Jarvis has:
- Subagent orchestration with live, expandable, closable cards
- Destructive-action confirmation (Gmail send, file execute) via UI buttons or voice "yes/cancel"; Gmail draft + file write as safe direct tools
- Dashboard with daily-token and cost-by-model graphs
- A settings panel for hotkey, voice, model preference, and short-term memory window, with live hotkey re-registration

---

## Self-Review

**Spec coverage (Phase 2 list from the design spec):**
- Subagent orchestration + card UI → Tasks 22, 25 ✔
- Gmail send/draft with confirmation → Task 20 (+ confirmation infra Task 18, UI Task 24) ✔
- File write + execute with confirmation → Task 21 ✔
- Full dashboard with usage graphs → Tasks 23 (queries), 26 (UI) ✔
- Settings panel (hotkey, voice, model preferences) → Tasks 19 (store), 27 (UI + apply) ✔
- Spec security boundary "gmail_send and execute_file always trigger a confirmation; Jarvis speaks the confirmation" → Tasks 20/21 queue + Task 23 voice yes/no + Task 24 card ✔
- Spec "memory_write / memory_search" tools: Phase 1 already implements memory via the `[REMEMBER: ...]` convention and embedding retrieval; not re-scoped here.

**Type consistency:** `BackendEvent`/`RendererEvent` variants defined in Task 17 are consumed unchanged in Tasks 23–27. `AgentInfo`, `Settings`, `UsagePoint`, `ModelUsage` are defined once (Task 17) and imported everywhere. Tool dispatch names (`gmail_send`, `gmail_draft`, `fs_write`, `execute_file`, `spawn_agent`) match between defs and `handleTool` (Tasks 20–22). `getToolsForAgent` excludes `spawn_agent` to prevent recursion.

**Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands with expected output.

---

# REVISION (2026-06-10): Hybrid LLM — Ollama main loop + Claude Agent SDK subagents

**Why:** To avoid metered Anthropic API costs, the everyday conversation loop runs on a **local Ollama model (`llama3.1:8b`)** at $0. Heavy, multi-step `spawn_agent` work runs on **Claude via the Agent SDK (`@anthropic-ai/claude-agent-sdk`)**, authenticated with the user's **Pro subscription** (`CLAUDE_CODE_OAUTH_TOKEN`, via `claude setup-token`) rather than an API key.

**Key architecture decision:** No unified provider interface is needed. The main loop is a self-contained Ollama module that mirrors the existing `chat()`/`ChatResult` contract (so `index.ts` barely changes). Claude subagents use the Agent SDK's `query()` async iterator, which manages its own tool loop internally. The two are independent.

**This revision supersedes the original Task 22.** Renumbering: original Tasks 23–28 shift by +2 (the two new Ollama tasks). The dependency chain becomes: Task 21 (unchanged) → Task 22 (Ollama provider) → Task 23 (switch main pipeline) → Task 24 (Claude Agent-SDK subagents, replaces old 22) → Tasks 25–30 (old 23–28, with tweaks noted).

**Prerequisites (manual, user-run, needed only for live testing — unit tests mock both):**
1. Install Ollama (`winget install Ollama.Ollama` or from ollama.com), then `ollama pull llama3.1:8b`.
2. `claude setup-token` → copy the token. In `jarvis/.env.local`, **remove `ANTHROPIC_API_KEY`** (it shadows the subscription) and add `CLAUDE_CODE_OAUTH_TOKEN=<token>`. Optionally add `OLLAMA_MODEL=llama3.1:8b` and `OLLAMA_BASE_URL=http://127.0.0.1:11434`.

**Settings additions (extend Task 17's `Settings` + Task 19's store DEFAULTS):**
- Add to `Settings`: `ollamaModel: string`, `ollamaBaseUrl: string`.
- DEFAULTS: `ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.1:8b'`, `ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'`. (`modelPreference` is retained but only affects nothing in the main loop now; leave it for future use.)

---

## Task 22 (REVISED): Ollama main-loop provider

**Files:**
- Create: `src/backend/ollama.ts`
- Test: `tests/backend/ollama.test.ts`

- [ ] **Step 1: Write `tests/backend/ollama.test.ts`** (mocks `global.fetch`; no network, no Ollama install needed)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { BackendEvent } from '../../src/backend/types'

function mockFetchSequence(responses: object[]): void {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => responses[Math.min(i++, responses.length - 1)],
    text: async () => '',
  })) as unknown as typeof fetch)
}

afterEach(() => vi.unstubAllGlobals())

describe('ollama main-loop provider', () => {
  it('returns assistant text for a simple turn', async () => {
    mockFetchSequence([{ message: { role: 'assistant', content: 'Hello there.' }, prompt_eval_count: 10, eval_count: 5 }])
    const { chat } = await import('../../src/backend/ollama')
    const events: BackendEvent[] = []
    const result = await chat('hi', [], [], e => events.push(e))
    expect(result.text).toBe('Hello there.')
    expect(result.model).toContain('ollama:')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
  })

  it('executes a tool call then returns the follow-up answer', async () => {
    mockFetchSequence([
      { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'app_launch', arguments: { app_name: 'calculator' } } }] }, prompt_eval_count: 20, eval_count: 4 },
      { message: { role: 'assistant', content: 'Calculator is open.' }, prompt_eval_count: 8, eval_count: 6 },
    ])
    const { chat } = await import('../../src/backend/ollama')
    const result = await chat('open calculator', [], [], () => {})
    expect(result.text).toBe('Calculator is open.')
    // tokens accumulate across both turns
    expect(result.inputTokens).toBe(28)
    expect(result.outputTokens).toBe(10)
  })

  it('extracts a [REMEMBER: ...] instruction and strips it from the reply', async () => {
    mockFetchSequence([{ message: { role: 'assistant', content: 'Noted. [REMEMBER: user likes tea]' }, prompt_eval_count: 3, eval_count: 3 }])
    const { chat } = await import('../../src/backend/ollama')
    const result = await chat('remember I like tea', [], [], () => {})
    expect(result.pendingMemory).toBe('user likes tea')
    expect(result.text).not.toContain('REMEMBER')
  })
})
```

- [ ] **Step 2: Run test — verify FAIL** (`npx vitest run tests/backend/ollama.test.ts`) — module not found.

- [ ] **Step 3: Create `src/backend/ollama.ts`**

```ts
import type { BackendEvent } from './types'
import { getTools, handleTool } from './tools/index'
import { getSettings } from './memory/settings'

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant. Speak in a polished, concise British manner — helpful and confident without being verbose. Keep responses under 3 sentences unless detail is genuinely needed. When using tools, act without asking for permission unless the action is destructive (e.g. sending an email or running a file). If the user asks you to remember something durable about them, include a tag of the form [REMEMBER: the fact] at the end of your reply. Never say "Certainly!" or "Of course!" — just answer directly.`

export interface Message { role: 'user' | 'assistant'; content: string }

export interface ChatResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  pendingMemory: string | null
}

interface OllamaToolCall { function: { name: string; arguments: Record<string, unknown> | string } }
interface OllamaMsg { role: string; content: string; tool_calls?: OllamaToolCall[] }
interface OllamaResponse { message: OllamaMsg; prompt_eval_count?: number; eval_count?: number }

const MAX_STEPS = 5

function resolveConfig(): { model: string; baseUrl: string } {
  let model = process.env.OLLAMA_MODEL
  let baseUrl = process.env.OLLAMA_BASE_URL
  try {
    const s = getSettings()
    model = model ?? s.ollamaModel
    baseUrl = baseUrl ?? s.ollamaBaseUrl
  } catch { /* db not ready in unit context */ }
  return { model: model ?? 'llama3.1:8b', baseUrl: baseUrl ?? 'http://127.0.0.1:11434' }
}

function toOllamaTools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  return getTools().map(t => ({
    type: 'function',
    function: {
      name: (t as { name: string }).name,
      description: (t as { description?: string }).description ?? '',
      parameters: (t as { input_schema?: unknown }).input_schema ?? { type: 'object', properties: {} },
    },
  }))
}

function parseArgs(a: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (typeof a === 'string') { try { return JSON.parse(a) as Record<string, unknown> } catch { return {} } }
  return a ?? {}
}

export async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
): Promise<ChatResult> {
  const { model, baseUrl } = resolveConfig()
  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  const messages: OllamaMsg[] = [
    { role: 'system', content: SYSTEM_PROMPT + memoryContext },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  broadcast({ type: 'state', state: 'thinking' })

  const tools = toOllamaTools()
  let inputTokens = 0
  let outputTokens = 0
  let fullText = ''

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, stream: false }),
    })
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`)
    const data = await res.json() as OllamaResponse
    inputTokens += data.prompt_eval_count ?? 0
    outputTokens += data.eval_count ?? 0

    const msg = data.message
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
      for (const tc of msg.tool_calls) {
        let result: string
        try {
          result = await handleTool(tc.function.name, parseArgs(tc.function.arguments))
        } catch (err) {
          result = `Error: ${String(err)}`
        }
        messages.push({ role: 'tool', content: result })
      }
      continue
    }

    fullText = msg.content ?? ''
    break
  }

  broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })

  let pendingMemory: string | null = null
  const memMatch = fullText.match(/\[REMEMBER:\s*([^\]]+)\]/i)
  if (memMatch) {
    pendingMemory = memMatch[1].trim()
    fullText = fullText.replace(memMatch[0], '').trim()
    broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  }

  return { text: fullText, model: `ollama:${model}`, inputTokens, outputTokens, pendingMemory }
}
```

- [ ] **Step 4: Run test — verify PASS** (3 tests).

- [ ] **Step 5: Add `ollamaModel`/`ollamaBaseUrl` to settings.** In `src/backend/types.ts` add `ollamaModel: string` and `ollamaBaseUrl: string` to `Settings`. In `src/backend/memory/settings.ts` add to `DEFAULTS` (`ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.1:8b'`, `ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'`) and read them in `getSettings()` (`map.get('ollamaModel') ?? DEFAULTS.ollamaModel`, same for base url). Update `tests/backend/memory/settings.test.ts` "returns defaults" to also assert `s.ollamaModel === 'llama3.1:8b'`.

- [ ] **Step 6: Run full suite** (`npx vitest run`) — all pass.

- [ ] **Step 7: Commit**

```bash
git add src/backend/ollama.ts tests/backend/ollama.test.ts src/backend/types.ts src/backend/memory/settings.ts tests/backend/memory/settings.test.ts
git commit -m "feat: ollama local main-loop provider with tool-calling + ollama settings"
```

---

## Task 23 (NEW): Switch main pipeline to Ollama; zero-cost logging

**Files:**
- Modify: `src/backend/index.ts`
- Modify: `src/backend/memory/db.ts`
- Test: `tests/backend/memory/db.test.ts` (add ollama zero-cost case)

- [ ] **Step 1: Point the pipeline at Ollama.** In `src/backend/index.ts`, change `import { chat, type Message } from './claude'` to `import { chat, type Message } from './ollama'`. No other pipeline logic changes (the `ChatResult` shape is identical).

- [ ] **Step 2: Zero-cost for local models in `src/backend/memory/db.ts`.** In `logApiCall`, before the cost lookup, add: if the model starts with `ollama`, cost is 0. Replace the cost computation lines with:
```ts
  const costUsd = params.model.startsWith('ollama')
    ? 0
    : (() => {
        const cost = MODEL_COST[params.model] ?? MODEL_COST['claude-fable-5']
        return cost.input * params.inputTokens + cost.output * params.outputTokens
      })()
```

- [ ] **Step 3: Add a db test** in `tests/backend/memory/db.test.ts`:
```ts
  it('logs local ollama calls at zero cost', async () => {
    const { initDb, logApiCall, getStatsToday } = await import('../../../src/backend/memory/db')
    initDb()
    logApiCall({ model: 'ollama:llama3.1:8b', inputTokens: 500, outputTokens: 500 })
    const stats = getStatsToday()
    expect(stats.tokens).toBe(1000)
    expect(stats.cost).toBe(0)
  })
```

- [ ] **Step 4: Run full suite** — all pass.

- [ ] **Step 5: Commit**

```bash
git add src/backend/index.ts src/backend/memory/db.ts tests/backend/memory/db.test.ts
git commit -m "feat: route main loop through ollama; log local models at zero cost"
```

> Note: `src/backend/claude.ts` is now unused by the pipeline but is left in place (harmless). It may be removed in a later cleanup commit.

---

## Task 24 (REVISED — replaces original Task 22): Claude subagents via Agent SDK

**Files:**
- Create: `src/backend/agents.ts`
- Modify: `src/backend/tools/index.ts`
- Test: `tests/backend/agents.test.ts`
- Dependency: `npm install @anthropic-ai/claude-agent-sdk`

> **Auth:** The Agent SDK authenticates from the environment. With `CLAUDE_CODE_OAUTH_TOKEN` set and `ANTHROPIC_API_KEY` unset, calls bill the user's Pro subscription. The TypeScript SDK bundles its own Claude Code binary, so no separate install is required at runtime. The unit test mocks the SDK, so neither auth nor network is needed for tests.

- [ ] **Step 1: Install the Agent SDK**

```bash
npm install @anthropic-ai/claude-agent-sdk
```

- [ ] **Step 2: Write `tests/backend/agents.test.ts`** (mocks the SDK `query` as an async generator)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  // eslint-disable-next-line require-yield
  query: vi.fn(async function* () {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it.' }] } }
    yield { type: 'result', subtype: 'success', result: 'Listed 3 files.' }
  }),
}))

describe('agents (Agent SDK)', () => {
  beforeEach(async () => {
    const { _resetAgents } = await import('../../src/backend/agents')
    _resetAgents()
  })

  it('exports agentToolDefs with spawn_agent', async () => {
    const mod = await import('../../src/backend/agents')
    expect(mod.agentToolDefs.map(t => t.name)).toContain('spawn_agent')
  })

  it('spawnAgent registers an agent and returns an acknowledgement', async () => {
    const { spawnAgent, getAgents } = await import('../../src/backend/agents')
    const reply = await spawnAgent('Researcher', 'Summarize notes')
    expect(reply.toLowerCase()).toContain('researcher')
    expect(getAgents().length).toBe(1)
  })

  it('closeAgent removes an agent', async () => {
    const { spawnAgent, getAgents, closeAgent } = await import('../../src/backend/agents')
    await spawnAgent('Temp', 'task')
    const a = getAgents()[0]
    closeAgent(a.id)
    expect(getAgents().some(x => x.id === a.id)).toBe(false)
  })
})
```

- [ ] **Step 3: Run test — verify FAIL** — module not found.

- [ ] **Step 4: Create `src/backend/agents.ts`**

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'crypto'
import { emitEvent } from './events'
import type { AgentInfo } from './types'

// Built-in Agent SDK tools the worker may use autonomously (read-only + web).
const AGENT_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
const MAX_TURNS = 12

const agents = new Map<string, AgentInfo>()

export function getAgents(): AgentInfo[] {
  return [...agents.values()]
}

export function closeAgent(id: string): void {
  agents.delete(id)
}

/** Test-only helper to clear state between cases. */
export function _resetAgents(): void {
  agents.clear()
}

function extractText(message: unknown): string {
  const m = message as { message?: { content?: Array<{ type?: string; text?: string }> } }
  const blocks = m.message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks.filter(b => b.type === 'text' && b.text).map(b => b.text as string).join('').trim()
}

export async function spawnAgent(name: string, task: string): Promise<string> {
  const info: AgentInfo = {
    id: randomUUID(),
    name,
    task,
    status: 'running',
    actions: [],
    startedAt: Date.now(),
  }
  agents.set(info.id, info)
  emitEvent({ type: 'agent_spawn', id: info.id, name, task })
  void runAgent(info)
  return `Spawned agent "${name}" to handle: ${task}. It will report back when done.`
}

async function runAgent(info: AgentInfo): Promise<void> {
  try {
    for await (const message of query({
      prompt: info.task,
      options: { allowedTools: AGENT_TOOLS, permissionMode: 'bypassPermissions', maxTurns: MAX_TURNS },
    })) {
      const m = message as { type?: string; result?: unknown }
      if (m.type === 'assistant') {
        const text = extractText(message)
        if (text) {
          info.actions.push(text)
          emitEvent({ type: 'agent_update', id: info.id, action: text })
        }
      } else if (m.type === 'result') {
        info.status = 'done'
        info.result = String(m.result ?? 'Task complete.')
        emitEvent({ type: 'agent_done', id: info.id, result: info.result })
        return
      }
    }
    if (info.status === 'running') {
      info.status = 'done'
      info.result = info.actions[info.actions.length - 1] ?? 'Task complete.'
      emitEvent({ type: 'agent_done', id: info.id, result: info.result })
    }
  } catch (e) {
    info.status = 'error'
    emitEvent({ type: 'agent_error', id: info.id, message: String(e) })
  }
}

export const agentToolDefs = [
  {
    name: 'spawn_agent',
    description: 'Spawn a named Claude worker agent to autonomously handle a multi-step task (research, web lookups, reading/searching files). Returns immediately; the agent reports back when finished. Use for tasks that need several steps or web access.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Short name for the agent (e.g. "Research")' },
        task: { type: 'string', description: 'A clear, self-contained description of the task' },
      },
      required: ['name', 'task'],
    },
  },
]

export async function handleAgentTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'spawn_agent') return spawnAgent(input.name, input.task)
  throw new Error(`Unknown tool: ${name}`)
}
```

- [ ] **Step 5: Register in `src/backend/tools/index.ts`** — same as the original plan's Task 22 Step 4 (`getTools` includes `agentToolDefs`; `getToolsForAgent` excludes them; `handleTool` routes `spawn_agent` → `handleAgentTool`). The Ollama main loop calls `spawn_agent` like any other tool.

- [ ] **Step 6: Run test — verify PASS** (3 tests). Then full suite + `npm run build:backend`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/backend/agents.ts src/backend/tools/index.ts tests/backend/agents.test.ts
git commit -m "feat: claude subagents via agent sdk (subscription auth) with streaming updates"
```

---

## Tasks 25–30 (were 23–28): unchanged except these tweaks

- **Backend wiring (old Task 23 → now 25):** identical, but the `selectModel`/model-preference import is no longer used by the main loop; keep the confirmation, agent-close, usage, settings, and voice-yes/no wiring exactly as written. Stats `model` field will now read like `ollama:llama3.1:8b` for normal turns.
- **Confirmation card, agent cards, usage graphs (old 24–26 → 26–28):** unchanged. Agent cards now display Claude-worker progress streamed from the Agent SDK.
- **Settings panel (old 27 → 29):** add two fields — **Ollama model** and **Ollama base URL** — bound to `settings.ollamaModel`/`settings.ollamaBaseUrl`. The "model preference" control can be relabeled "Subagent model" or hidden; keep the hotkey/voice controls.
- **Final verification (old 28 → 30):** the manual smoke test now requires Ollama running (`ollama serve` + model pulled) and `CLAUDE_CODE_OAUTH_TOKEN` set with `ANTHROPIC_API_KEY` unset. Voice loop should work fully offline on Ollama; saying "spawn an agent to research X" should trigger a Claude worker.

## Revised Self-Review
- **Cost goal:** main loop = local Ollama ($0); only `spawn_agent` invokes Claude (subscription credits). ✔
- **Type consistency:** `ChatResult`/`Message` in `ollama.ts` match the shapes `index.ts` already consumes; `AgentInfo` unchanged from Task 17. ✔
- **Auth correctness:** Agent SDK reads `CLAUDE_CODE_OAUTH_TOKEN`; plan explicitly requires unsetting `ANTHROPIC_API_KEY`. ✔
- **Testability without installs:** Ollama tests mock `fetch`; agent tests mock the SDK module. ✔
