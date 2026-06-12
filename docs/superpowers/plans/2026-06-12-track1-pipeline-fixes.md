# Track 1: Pipeline & Tool Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the root-cause Groq 400 error (spawn_agent in Groq tool set), audit related pipeline wiring, and add regression tests.

**Architecture:** Single-file fix in `tools/index.ts` removes `agentToolDefs` from `getToolsForGroq()`. The Groq system prompt is updated to match. Regression tests lock in the correct tool sets for each provider path.

**Tech Stack:** TypeScript, Vitest, better-sqlite3

---

## Task 1: Remove `spawn_agent` from Groq tool set

**Files:**
- Modify: `src/backend/tools/index.ts`
- Modify: `src/backend/groq.ts`

- [ ] **Step 1: Write the failing regression test first**

In `tests/backend/tools/index.test.ts`, add inside the existing `describe('getToolsForGroq', ...)` block (after the existing two `it` tests):

```ts
it('does not include spawn_agent (causes Groq HTTP 400)', async () => {
  const { getToolsForGroq } = await import('../../../src/backend/tools/index')
  const names = getToolsForGroq().map(t => (t as any).name)
  expect(names).not.toContain('spawn_agent')
})
```

- [ ] **Step 2: Run the test to confirm it currently fails**

```
npx vitest run tests/backend/tools/index.test.ts
```

Expected: FAIL — `expect(received).not.toContain('spawn_agent')` fails because `spawn_agent` is currently included.

- [ ] **Step 3: Fix `getToolsForGroq` — remove `agentToolDefs`**

In `src/backend/tools/index.ts`, replace:

```ts
export function getToolsForGroq(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...calendarToolDefs,
    ...vscodeToolDefs,
    ...agentToolDefs,
    ...searchToolDefs,
    ...jarvisToolDefs,
    ...commandToolDefs,
  ] as Tool[]
}
```

with:

```ts
export function getToolsForGroq(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...calendarToolDefs,
    ...vscodeToolDefs,
    ...searchToolDefs,
    ...jarvisToolDefs,
    ...commandToolDefs,
  ] as Tool[]
}
```

- [ ] **Step 4: Remove `spawn_agent` from the Groq system prompt capabilities list**

In `src/backend/groq.ts`, find the `SYSTEM_PROMPT` constant and remove this line from the CAPABILITIES section:

```
• Multi-step research or complex tasks → spawn_agent
```

The resulting CAPABILITIES block should not reference `spawn_agent` at all. The rest of the prompt is unchanged.

- [ ] **Step 5: Run tests — confirm the regression test now passes**

```
npx vitest run tests/backend/tools/index.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Run the full test suite to check for regressions**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```
git add src/backend/tools/index.ts src/backend/groq.ts tests/backend/tools/index.test.ts
git commit -m "fix: remove spawn_agent from Groq tool set — causes HTTP 400 on complex queries"
```

---

## Task 2: Audit `toolSession.ts` integration

**Files:**
- Read: `src/backend/index.ts` (already read — no changes needed per review)

- [ ] **Step 1: Verify `clearComposeSuppression` is called on session boundaries**

Read `src/backend/toolSession.ts` and `src/backend/index.ts`. Confirm:

1. `markComposeDismissed` is called in `handleRendererEvent` for `email_compose_dismissed` ✓ (line 341)
2. `markComposeCompleted` is called in `handleRendererEvent` for `email_send` and `email_draft_save` ✓ (lines 374, 390)
3. `clearComposeSuppression` — check if it needs to be called on WebSocket reconnect

`clearComposeSuppression` is not currently called on reconnect. Add it to the `wss.on('connection', ...)` handler so stale compose state doesn't bleed across renderer reloads.

In `src/backend/index.ts`, in the `wss.on('connection', (ws: WebSocket) => {` handler, add after `_activeWs = ws`:

```ts
// Clear in-memory compose state on new renderer connection so
// dismissed/completed state from a previous session doesn't suppress new flows.
import { clearComposeSuppression } from './toolSession'
```

Add the import at the top of the file (with the other toolSession import on line 157):

```ts
import { markComposeCompleted, markComposeDismissed, clearComposeSuppression } from './toolSession'
```

Then in `wss.on('connection', ...)`, add as the first line of the handler body:

```ts
clearComposeSuppression()
```

- [ ] **Step 2: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```
git add src/backend/index.ts
git commit -m "fix: clear compose suppression state on renderer reconnect"
```

---

## Task 3: Audit `responseTags.ts` double-strip and `[REPORT:]` readiness

**Files:**
- Read: `src/backend/index.ts` (lines 668–731 — the `runConversation` function)

- [ ] **Step 1: Verify the double-strip is harmless**

In `runConversation` (index.ts line 668), `chat()` returns `{ text, pendingMemory, pendingEntities }` where `text` has already been stripped by the provider (Groq calls `stripResponseTags` at groq.ts:309, Claude strips via `visibleStreamingText` during streaming). Then line 675 calls `stripResponseTags(text)` again.

This is **harmless** — re-stripping already-stripped text returns the same text with empty pendingEntities. The guard at line 696 (`pendingEntities.length > 0 ? pendingEntities : cleaned.pendingEntities`) means the provider's entities are used first. No fix needed.

Document this with a brief comment at line 675:

```ts
// Re-strip handles cases where the provider returned raw text without pre-stripping
// (e.g. Ollama). For Groq/Claude this is a no-op since they strip before returning.
const cleaned = stripResponseTags(text)
```

- [ ] **Step 2: Add a test for `stripResponseTags` passthrough on already-clean text**

In `tests/backend/responseTags.test.ts`, add inside `describe('stripResponseTags', ...)`:

```ts
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

it('visibleStreamingText cuts at the first tag start', async () => {
  const { visibleStreamingText } = await import('../../src/backend/responseTags')
  expect(visibleStreamingText('Hello there. [PERSON: Bob')).toBe('Hello there.')
  expect(visibleStreamingText('No tags here')).toBe('No tags here')
})

it('generates fallback text when only a REMEMBER tag is present', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const result = stripResponseTags('[REMEMBER: user drinks coffee]')
  expect(result.text).toBe('Noted.')
  expect(result.pendingMemory).toBe('user drinks coffee')
})
```

- [ ] **Step 3: Run tests**

```
npx vitest run tests/backend/responseTags.test.ts
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add src/backend/index.ts tests/backend/responseTags.test.ts
git commit -m "test: expand responseTags coverage; comment double-strip pattern"
```

---

## Task 4: Audit `toolGuards.ts` and add edge-case tests

**Files:**
- Modify: `tests/backend/responseTags.test.ts` (toolGuards describe block)

- [ ] **Step 1: Expand the existing `toolGuards` test block**

In `tests/backend/responseTags.test.ts`, replace the existing `describe('toolGuards', ...)` block with:

```ts
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
    expect(isExplicitEmailComposeRequest('write an email about the project')).toBe(true)
  })

  it('returns false for remember/save email address statements', async () => {
    const { isExplicitEmailComposeRequest } = await import('../../src/backend/toolGuards')
    expect(isExplicitEmailComposeRequest('remember Amanda, her email is a@test.com')).toBe(false)
    expect(isExplicitEmailComposeRequest('save this email address: test@test.com')).toBe(false)
    expect(isExplicitEmailComposeRequest('note that my mom emails are at mom@gmail.com')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests**

```
npx vitest run tests/backend/responseTags.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```
git add tests/backend/responseTags.test.ts
git commit -m "test: expand toolGuards edge-case coverage"
```

---

## Task 5: Audit WebSocket reconnection in renderer

**Files:**
- Read: `src/renderer/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Read the WebSocket hook**

```
Read src/renderer/src/hooks/useWebSocket.ts
```

Check for:
1. Does `close` event trigger a reconnect attempt?
2. Are event listeners added inside `useEffect` with a cleanup return that removes them? (Prevents duplicate listeners on re-render)
3. Is there a guard to prevent connecting twice if `connected` is already true?

- [ ] **Step 2: Fix duplicate listener risk if present**

If the hook adds listeners without cleanup (e.g. no `return () => ws.removeEventListener(...)` or no `ws.close()` in the effect cleanup), add proper cleanup:

```ts
useEffect(() => {
  // ... setup ws and add listeners ...
  return () => {
    ws.close()
  }
}, [port]) // port comes from the backend-ready IPC signal
```

If the hook is already correct (has cleanup), skip this step and note "WebSocket hook looks clean — no changes needed."

- [ ] **Step 3: Rebuild backend and smoke-test**

```
npm run build:backend
npm run dev
```

Manually test:
1. App starts → Jarvis responds to "hello" ✓
2. Say "search for today's weather" → web_search runs (not a 400 error) ✓
3. Say "do deep research on AI news" → routes to Claude spawn_agent, not Groq ✓

- [ ] **Step 4: Commit any fixes found**

```
git add src/renderer/src/hooks/useWebSocket.ts
git commit -m "fix: WebSocket reconnect cleanup" # only if changes were needed
```

---

## Task 6: Add `getToolsForGroq` spawn_agent exclusion to groq.test.ts

**Files:**
- Modify: `tests/backend/groq.test.ts`

- [ ] **Step 1: Add the regression test**

Add a new `describe` block at the bottom of `tests/backend/groq.test.ts`:

```ts
describe('tool set safety', () => {
  it('getToolsForGroq does not include spawn_agent', async () => {
    // Re-import without the mock override used in the chat tests above
    vi.unmock('../../src/backend/tools/index')
    // Use the index.test.ts mock pattern instead — just check the real function
    // by importing through the actual module with all sub-deps mocked
    const { getToolsForGroq } = await import('../../src/backend/tools/index')
    const names = getToolsForGroq().map((t: any) => t.name)
    expect(names).not.toContain('spawn_agent')
  })
})
```

Note: because `groq.test.ts` mocks `../../src/backend/tools/index` at the module level (line 4–7), this test imports the real module via `vi.unmock`. If this causes import issues in the test runner due to module isolation, move this test to `tests/backend/tools/index.test.ts` instead (it already covers `getToolsForGroq` there).

- [ ] **Step 2: Run the full test suite**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 3: Final commit**

```
git add tests/backend/groq.test.ts
git commit -m "test: regression test — spawn_agent excluded from Groq tool set"
```
