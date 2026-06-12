# Quality, Agentic Intelligence & UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix backend quality issues, add tiered model routing with plan-preview confirmation, and fully rebuild the UI to feel premium and polished.

**Architecture:** Three tracks share a CSS token system and event type definitions. `BackendEvent` gains `spotify_now_playing`, `github_data`, and `plan_preview` types that bridge backend changes to rebuilt panels. `handleTool` gains a `ctx` parameter to centralize the gmail_compose guard. A new `planPreview.ts` module handles the confirm-before-execute flow for destructive multi-step chains.

**Tech Stack:** TypeScript, React 18, Electron 28, Anthropic SDK, WebSocket (ws), better-sqlite3, JetBrains Mono, CSS custom properties

**Test command:** `npm test` (not `npx vitest run` — Electron ABI requirement)

**⚠️ Task 6 (tiered Fable routing) requires user confirmation before the implementing subagent runs.**

---

## File Map

| File | Change |
|------|--------|
| `src/renderer/src/styles/global.css` | Overlay vars, keyframes, `.pill-btn` variants, `.ov-input` |
| `src/backend/types.ts` | Add `GithubRow`, `spotify_now_playing`, `github_data`, `plan_preview` BackendEvents; `plan_confirmed`, `plan_cancelled` RendererEvents |
| `src/backend/index.ts` | Remove `'open'` from routing keywords; handle `plan_confirmed`/`plan_cancelled`; raise history to 60 |
| `src/backend/tools/index.ts` | `handleTool(name, input, ctx?)` — centralise gmail guard; broadcast on unknown tool |
| `src/backend/claude.ts` | Remove local gmail guard; `MAX_STEPS` 6→12; `selectModel()` tiered routing; call `requestPlanPreview` before destructive tools |
| `src/backend/groq.ts` | Remove local gmail guard from `runToolCall`; `MAX_STEPS` 5→10 |
| `src/backend/tools/spotify.ts` | `currentTrack()` emits `spotify_now_playing` via `emitEvent` |
| `src/backend/tools/github.ts` | Each handler parses output into `GithubRow[]` and emits `github_data` |
| `src/backend/planPreview.ts` | New — `requestPlanPreview`, `resolvePlanPreview` |
| `src/backend/agents.ts` | Pass `topMems` context into agent prompt |
| `src/renderer/src/hooks/useAnimState.ts` | New state fields: `spotifyNowPlaying`, `githubData`, `planPreview`; new handlers; `closePlanPreview` |
| `src/renderer/src/App.tsx` | Render `PlanPreviewCard`; pass `githubData`/`spotifyNowPlaying` to panels |
| `src/renderer/src/components/SpotifyPanel.tsx` | Full rebuild — now-playing card, live data, premium UI |
| `src/renderer/src/components/GitHubPanel.tsx` | Full rebuild — inline data display, skeleton loader, premium UI |
| `src/renderer/src/components/HudOverlay.tsx` | Status dot pulse animation; `.pill-btn--icon`/`--active` classes |
| `src/renderer/src/components/PlanPreviewCard.tsx` | New — confirm before destructive multi-step |
| `src/renderer/src/components/Dashboard.tsx` | Overlay tokens + pill-btn consistency |
| `src/renderer/src/components/SettingsPanel.tsx` | Overlay tokens + `.ov-input` consistency |
| `src/renderer/src/components/MemoryBrowser.tsx` | Overlay tokens + pill-btn consistency |
| `src/renderer/src/components/ConfirmCard.tsx` | Overlay tokens + pill-btn consistency |
| `src/renderer/src/components/EmailComposer.tsx` | Overlay tokens + `.ov-input` consistency |
| `src/renderer/src/components/EmailViewer.tsx` | Overlay tokens + pill-btn consistency |
| `src/renderer/src/components/EventEditor.tsx` | Overlay tokens + `.ov-input` consistency |
| `src/renderer/src/components/CommandEditor.tsx` | Overlay tokens + `.ov-input` consistency |
| `src/renderer/src/components/ReportPanel.tsx` | Overlay tokens + pill-btn consistency |
| `src/renderer/src/components/AgentCards.tsx` | Overlay tokens + pill-btn consistency |

---

## Task 1: CSS Foundation

**Recommended model:** sonnet

**Files:**
- Modify: `src/renderer/src/styles/global.css`

- [ ] **Step 1: Add overlay design tokens to `:root`**

Open `src/renderer/src/styles/global.css`. After the existing `:root` block's closing `}`, add:

```css
/* ── Dark overlay system ──────────────────────────────── */
:root {
  --ov-bg:          rgba(4, 6, 14, 0.96);
  --ov-bg-raised:   rgba(10, 14, 28, 0.98);
  --ov-border:      rgba(14, 165, 233, 0.16);
  --ov-border-hot:  rgba(14, 165, 233, 0.50);
  --ov-accent:      #0ea5e9;
  --ov-accent-dim:  rgba(14, 165, 233, 0.14);
  --ov-accent-glow: rgba(14, 165, 233, 0.28);
  --ov-text:        rgba(255, 255, 255, 0.88);
  --ov-text-mid:    rgba(255, 255, 255, 0.50);
  --ov-text-dim:    rgba(255, 255, 255, 0.22);
  --ov-separator:   rgba(255, 255, 255, 0.07);
  --ov-radius:      14px;
  --ov-shadow:      0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(14,165,233,0.14);
}
```

- [ ] **Step 2: Add shared overlay keyframes**

Append after the new `:root` block:

```css
/* ── Overlay animations ───────────────────────────────── */

@keyframes overlayIn {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes overlayOut {
  from { opacity: 1; transform: scale(1);    }
  to   { opacity: 0; transform: scale(0.97); }
}
@keyframes drawerIn {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes drawerOut {
  from { transform: translateX(0);    opacity: 1; }
  to   { transform: translateX(100%); opacity: 0; }
}
@keyframes statusPulse {
  0%, 100% { opacity: 0.5; }
  50%       { opacity: 1;   }
}
@keyframes skeletonShimmer {
  0%   { background-position: -200px 0; }
  100% { background-position:  200px 0; }
}
```

- [ ] **Step 3: Add `.pill-btn` variants**

Find the existing `.pill-btn:disabled` rule and append after it:

```css
.pill-btn--sm {
  padding: 3px 10px;
  font-size: 9px;
}
.pill-btn--icon {
  padding: 5px 10px;
  min-width: 32px;
  text-align: center;
}
.pill-btn--active {
  background: var(--ov-accent-dim);
  border-color: var(--ov-border-hot);
  color: var(--ov-accent);
  box-shadow: 0 0 8px var(--ov-accent-glow);
}
.pill-btn--danger {
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}
.pill-btn--danger:hover {
  background: rgba(239, 68, 68, 0.1);
}
```

- [ ] **Step 4: Add `.ov-input` shared input style**

Append at end of file:

```css
/* ── Overlay input ────────────────────────────────────── */

.ov-input {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--ov-border);
  border-radius: 8px;
  color: var(--ov-text);
  font-family: var(--font-mono);
  font-size: 11px;
  outline: none;
  padding: 8px 12px;
  transition: border-color 0.15s;
  width: 100%;
}
.ov-input:focus        { border-color: var(--ov-border-hot); }
.ov-input::placeholder { color: var(--ov-text-dim); }

/* ── Skeleton loader ──────────────────────────────────── */

.skeleton-row {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.05) 75%);
  background-size: 400px 100%;
  animation: skeletonShimmer 1.4s ease-in-out infinite;
}
```

- [ ] **Step 5: Verify no regressions**

```
npm test
```
Expected: all tests pass (CSS changes don't affect tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles/global.css
git commit -m "style: overlay design system — vars, keyframes, pill-btn variants, ov-input"
```

---

## Task 2: New Event Types

**Recommended model:** haiku

**Files:**
- Modify: `src/backend/types.ts`

- [ ] **Step 1: Add `GithubRow` interface**

After `export interface MemoryEntry { ... }` (around line 36), insert:

```typescript
export interface GithubRow {
  title: string
  subtitle?: string
  meta?: string
  badge?: string
  badgeColor?: string
}
```

- [ ] **Step 2: Add new BackendEvents**

In the `BackendEvent` union (currently ends with `| { type: 'quiet_mode_changed'; enabled: boolean }`), append:

```typescript
  | { type: 'spotify_now_playing'; track?: string; artist?: string; isPlaying: boolean }
  | { type: 'github_data'; tab: 'STATUS' | 'PRs' | 'ISSUES' | 'COMMITS'; rows: GithubRow[] }
  | { type: 'plan_preview'; id: string; steps: string[] }
```

- [ ] **Step 3: Add new RendererEvents**

In the `RendererEvent` union (currently ends with `| { type: 'image_attach'; ... }`), append:

```typescript
  | { type: 'plan_confirmed'; id: string }
  | { type: 'plan_cancelled'; id: string }
```

- [ ] **Step 4: Run tests**

```
npm test
```
Expected: all pass (type-only changes).

- [ ] **Step 5: Commit**

```bash
git add src/backend/types.ts
git commit -m "feat(types): add spotify_now_playing, github_data, plan_preview events"
```

---

## Task 3: Backend Quality Fixes

**Recommended model:** sonnet

**Files:**
- Modify: `src/backend/index.ts`
- Modify: `src/backend/tools/index.ts`
- Modify: `src/backend/claude.ts`
- Modify: `src/backend/groq.ts`
- Test: `tests/backend/tools/index.test.ts` (may need to create)

- [ ] **Step 1: Write failing test for gmail guard centralisation**

Create or open `tests/backend/tools/index.test.ts`. Add:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all tool sub-handlers so handleTool doesn't hit real APIs
vi.mock('../../../src/backend/tools/filesystem', () => ({ filesystemToolDefs: [], handleFilesystemTool: vi.fn() }))
vi.mock('../../../src/backend/tools/launcher', () => ({ launcherToolDefs: [], handleLauncherTool: vi.fn() }))
vi.mock('../../../src/backend/tools/gmail', () => ({ gmailToolDefs: [], calendarToolDefs: [], handleGmailTool: vi.fn().mockResolvedValue('email sent') }))
vi.mock('../../../src/backend/tools/execute', () => ({ executeToolDefs: [], handleExecuteTool: vi.fn() }))
vi.mock('../../../src/backend/tools/vscode', () => ({ vscodeToolDefs: [], handleVSCodeTool: vi.fn() }))
vi.mock('../../../src/backend/agents', () => ({ agentToolDefs: [], handleAgentTool: vi.fn() }))
vi.mock('../../../src/backend/tools/search', () => ({ searchToolDefs: [], handleSearchTool: vi.fn() }))
vi.mock('../../../src/backend/tools/jarvis', () => ({ jarvisToolDefs: [], handleJarvisTool: vi.fn() }))
vi.mock('../../../src/backend/tools/commands', () => ({ commandToolDefs: [], handleCommandTool: vi.fn() }))
vi.mock('../../../src/backend/tools/vision', () => ({ visionToolDefs: [], handleVisionTool: vi.fn() }))
vi.mock('../../../src/backend/tools/github', () => ({ githubToolDefs: [], handleGithubTool: vi.fn() }))
vi.mock('../../../src/backend/tools/spotify', () => ({ spotifyToolDefs: [], handleSpotifyTool: vi.fn() }))
vi.mock('../../../src/backend/memory/db', () => ({ insertUserEvent: vi.fn() }))
vi.mock('../../../src/backend/events', () => ({ emitEvent: vi.fn() }))

import { handleTool } from '../../../src/backend/tools/index'

describe('handleTool', () => {
  it('blocks gmail_compose when userText is not an explicit compose request', async () => {
    const result = await handleTool('gmail_compose', {}, { userText: 'remind me to email bob later' })
    expect(result).toContain('No composer opened')
  })

  it('allows gmail_compose when userText is an explicit compose request', async () => {
    const result = await handleTool('gmail_compose', {}, { userText: 'send an email to bob' })
    expect(result).toBe('email sent')
  })

  it('throws on unknown tool name', async () => {
    await expect(handleTool('nonexistent_tool', {})).rejects.toThrow('Unknown tool: nonexistent_tool')
  })
})
```

- [ ] **Step 2: Run test — confirm it fails**

```
npm test tests/backend/tools/index.test.ts
```
Expected: FAIL — `handleTool` doesn't accept `ctx` yet and doesn't block gmail_compose.

- [ ] **Step 3: Update `handleTool` in `src/backend/tools/index.ts`**

Add import at top of file:
```typescript
import { isExplicitEmailComposeRequest } from '../toolGuards'
import { emitEvent } from '../events'
```

Change the function signature and add guards at the top of `handleTool`:

```typescript
export async function handleTool(
  name: string,
  input: Record<string, unknown>,
  ctx?: { userText?: string },
): Promise<string> {
  // Gmail compose guard — must be an explicit user request
  if (name === 'gmail_compose') {
    if (ctx?.userText && !isExplicitEmailComposeRequest(ctx.userText)) {
      return 'No composer opened — the user did not ask for a new email.'
    }
    input = { ...input, _suppressUi: false }
  }

  let result: string

  if (name.startsWith('fs_'))             result = await handleFilesystemTool(name, input as Record<string, string>)
  else if (name === 'app_launch')         result = await handleLauncherTool(name, input as Record<string, string>)
  else if (name.startsWith('gmail_'))     result = await handleGmailTool(name, input)
  else if (name.startsWith('calendar_'))  result = await handleGmailTool(name, input)
  else if (name === 'execute_file')       result = await handleExecuteTool(name, input as Record<string, string>)
  else if (name === 'vscode_open')        result = await handleVSCodeTool(name, input)
  else if (name === 'spawn_agent')        result = await handleAgentTool(name, input as Record<string, string>)
  else if (name.startsWith('web_'))       result = await handleSearchTool(name, input)
  else if (name === 'jarvis_screenshot')  result = await handleVisionTool(name, input)
  else if (name.startsWith('jarvis_'))    result = await handleJarvisTool(name, input)
  else if (name.startsWith('command_'))   result = await handleCommandTool(name, input)
  else if (name.startsWith('github_'))    result = await handleGithubTool(name, input)
  else if (name.startsWith('spotify_'))   result = await handleSpotifyTool(name, input)
  else {
    const msg = `Unknown tool: ${name}`
    console.error('[tools]', msg)
    emitEvent({ type: 'error', message: `Jarvis tried to call an unknown tool "${name}" — this is a bug.` })
    throw new Error(msg)
  }

  // Preference learning (fire-and-forget)
  try {
    if (name === 'app_launch') {
      insertUserEvent('tool_used', `app_launch:${String(input.name ?? '')}`)
    } else if (name === 'web_search') {
      insertUserEvent('tool_used', 'web_search')
      insertUserEvent('web_search', String(input.query ?? ''))
    } else {
      insertUserEvent('tool_used', name)
    }
  } catch { /* non-critical */ }

  return result
}
```

- [ ] **Step 4: Remove gmail guard from `src/backend/claude.ts`**

In `claude.ts`, find the `toolResults` mapping inside the `chat` loop (~line 194). Remove the early-return guard and simplify the input construction:

Old code (replace this block):
```typescript
const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
  toolBlocks.map(async (b) => {
    try {
      if (b.name === 'gmail_compose' && !isExplicitEmailComposeRequest(userText)) {
        return { type: 'tool_result' as const, tool_use_id: b.id, content: 'No composer opened — user did not ask for a new email.' }
      }
      const input = b.name === 'gmail_compose'
        ? { ...(b.input as Record<string, unknown>), _suppressUi: false }
        : b.input as Record<string, unknown>
      const result = await handleTool(b.name, input)
      return { type: 'tool_result' as const, tool_use_id: b.id, content: result }
    } catch (err) {
      return { type: 'tool_result' as const, tool_use_id: b.id, content: `Error: ${String(err)}`, is_error: true }
    }
  }),
)
```

New code:
```typescript
const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
  toolBlocks.map(async (b) => {
    try {
      const result = await handleTool(b.name, b.input as Record<string, unknown>, { userText })
      return { type: 'tool_result' as const, tool_use_id: b.id, content: result }
    } catch (err) {
      return { type: 'tool_result' as const, tool_use_id: b.id, content: `Error: ${String(err)}`, is_error: true }
    }
  }),
)
```

Also remove the `isExplicitEmailComposeRequest` import from `claude.ts` if it's no longer used elsewhere in that file.

- [ ] **Step 5: Remove gmail guard from `src/backend/groq.ts`**

Find `runToolCall` at the bottom of `groq.ts`. Replace it:

Old:
```typescript
async function runToolCall(name: string, args: Record<string, unknown>, userText: string): Promise<string> {
  if (name === 'gmail_compose' && !isExplicitEmailComposeRequest(userText)) {
    return 'No composer opened — the user did not ask for a new email.'
  }
  if (name === 'gmail_compose') {
    return handleTool(name, { ...args, _suppressUi: false })
  }
  return handleTool(name, args)
}
```

New:
```typescript
async function runToolCall(name: string, args: Record<string, unknown>, userText: string): Promise<string> {
  return handleTool(name, args, { userText })
}
```

Also remove `isExplicitEmailComposeRequest` import from `groq.ts` if no longer used.

- [ ] **Step 6: Remove `'open'` from `TOOL_KEYWORDS_ROUTE` in `src/backend/index.ts`**

Find TOOL_KEYWORDS_ROUTE (~line 46). Remove `'open'` from the array. The comment above it explains the rationale — keep it.

Before:
```typescript
const TOOL_KEYWORDS_ROUTE = [
  'email', 'gmail', 'calendar', 'file', 'folder', 'search', 'send', 'find',
  'launch', 'open', 'read', 'write', 'spotify', 'chrome', 'discord', 'vscode', 'rivals',
```

After:
```typescript
const TOOL_KEYWORDS_ROUTE = [
  'email', 'gmail', 'calendar', 'file', 'folder', 'search', 'send', 'find',
  'launch', 'read', 'write', 'spotify', 'chrome', 'discord', 'vscode', 'rivals',
```

- [ ] **Step 7: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/backend/index.ts src/backend/tools/index.ts src/backend/claude.ts src/backend/groq.ts tests/backend/tools/index.test.ts
git commit -m "refactor(backend): centralise gmail guard in handleTool, fix routing keyword, broadcast unknown tool errors"
```

---

## Task 4: Step Cap + Context Window

**Recommended model:** haiku

**Files:**
- Modify: `src/backend/claude.ts` (line ~103)
- Modify: `src/backend/groq.ts` (line ~88)
- Modify: `src/backend/index.ts` (line ~709)

- [ ] **Step 1: Raise MAX_STEPS in claude.ts**

Find `const MAX_STEPS = 6` and change to:
```typescript
const MAX_STEPS = 12
```

- [ ] **Step 2: Raise MAX_STEPS in groq.ts**

Find `const MAX_STEPS = 5` and change to:
```typescript
const MAX_STEPS = 10
```

- [ ] **Step 3: Raise conversation history window in index.ts**

Find `while (conversationHistory.length > 40)` (~line 709) and change to:
```typescript
while (conversationHistory.length > 60)
```

- [ ] **Step 4: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/backend/claude.ts src/backend/groq.ts src/backend/index.ts
git commit -m "feat(agentic): raise MAX_STEPS to 12/10, conversation history to 60 messages"
```

---

## Task 5: useAnimState — New State + Event Handlers

**Recommended model:** sonnet

**Files:**
- Modify: `src/renderer/src/hooks/useAnimState.ts`

- [ ] **Step 1: Add new fields to `JarvisState`**

In the `JarvisState` interface, after `quietMode: boolean`, append:

```typescript
  spotifyNowPlaying: { track?: string; artist?: string; isPlaying: boolean } | null
  githubData: { tab: 'STATUS' | 'PRs' | 'ISSUES' | 'COMMITS'; rows: import('../../../backend/types').GithubRow[] } | null
  planPreview: { id: string; steps: string[] } | null
```

- [ ] **Step 2: Add fields to `initial`**

In the `initial` object, after `quietMode: false`, append:

```typescript
  spotifyNowPlaying: null,
  githubData: null,
  planPreview: null,
```

- [ ] **Step 3: Handle new events in `handleEvent`**

In the `switch` inside `handleEvent`, before the `default` case, add:

```typescript
case 'spotify_now_playing':
  return { ...prev, spotifyNowPlaying: { track: event.track, artist: event.artist, isPlaying: event.isPlaying } }
case 'github_data':
  return { ...prev, githubData: { tab: event.tab, rows: event.rows } }
case 'plan_preview':
  return { ...prev, planPreview: { id: event.id, steps: event.steps } }
```

- [ ] **Step 4: Add `closePlanPreview` callback**

After `const toggleGithub = useCallback(...)`, add:

```typescript
const closePlanPreview = useCallback(() => setState(prev => ({ ...prev, planPreview: null })), [])
```

- [ ] **Step 5: Add to return value**

In the return object of `useAnimState`, add `closePlanPreview` to the destructured return.

- [ ] **Step 6: Update import in useAnimState**

The `GithubRow` type needs to be imported. Add it to the existing types import at the top:

```typescript
import type { AnimState, BackendEvent, AgentInfo, Settings, UsagePoint, ModelUsage, EmailDraft, EmailMessage, CalendarEventDraft, MemoryEntry, CustomCommandDraft, GithubRow } from '../../../backend/types'
```

- [ ] **Step 7: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/hooks/useAnimState.ts
git commit -m "feat(state): add spotifyNowPlaying, githubData, planPreview state + handlers"
```

---

## Task 6: Tiered Model Routing

**⚠️ REQUIRES USER CONFIRMATION BEFORE THIS TASK RUNS — uses Fable.**

**Recommended model:** fable

**Files:**
- Modify: `src/backend/claude.ts`

- [ ] **Step 1: Write failing test for new routing**

Create `tests/backend/claude.test.ts` (or add to existing if it exists):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../../../src/backend/memory/settings', () => ({
  getSettings: vi.fn().mockReturnValue({ modelPreference: 'auto' }),
}))
import { selectModel } from '../../../src/backend/claude'

describe('selectModel', () => {
  it('returns haiku for a short conversational message', () => {
    expect(selectModel('what time is it')).toBe('claude-haiku-4-5-20251001')
  })

  it('returns haiku for a simple single-tool request', () => {
    expect(selectModel('play some music')).toBe('claude-haiku-4-5-20251001')
  })

  it('returns sonnet for a multi-tool chain request', () => {
    expect(selectModel('search my emails and summarize the thread with Alice')).toBe('claude-sonnet-4-6')
  })

  it('returns fable for deep reasoning requests', () => {
    expect(selectModel('analyze my recent commits and write a PR description')).toBe('claude-fable-5')
  })

  it('returns fable for spawn_agent tasks', () => {
    expect(selectModel('research the latest news about TypeScript and summarize it for me')).toBe('claude-fable-5')
  })

  it('respects modelPreference override to fable', () => {
    const { getSettings } = require('../../../src/backend/memory/settings')
    getSettings.mockReturnValueOnce({ modelPreference: 'fable' })
    expect(selectModel('hi')).toBe('claude-fable-5')
  })

  it('respects modelPreference override to haiku', () => {
    const { getSettings } = require('../../../src/backend/memory/settings')
    getSettings.mockReturnValueOnce({ modelPreference: 'haiku' })
    expect(selectModel('analyze everything in depth')).toBe('claude-haiku-4-5-20251001')
  })
})
```

- [ ] **Step 2: Run test — confirm it fails**

```
npm test tests/backend/claude.test.ts
```
Expected: FAIL (selectModel returns wrong models).

- [ ] **Step 3: Replace `selectModel` in `src/backend/claude.ts`**

Replace the entire existing `TOOL_KEYWORDS` constant and `selectModel` function (lines ~12–33) with:

```typescript
const FAST_TOOLS = [
  'app_launch', 'app_', 'spotify_', 'fs_read', 'fs_list', 'calendar_list',
]

const DEEP_KEYWORDS = [
  'analyze', 'analyse', 'compare', 'summarize', 'summarise', 'research',
  'plan', 'write a', 'draft a', 'describe', 'explain in detail',
  'write my', 'generate a', 'create a report',
]

const CHAIN_KEYWORDS = [
  'and then', 'after that', 'and also', 'then email', 'then send',
  'search.*and', 'find.*and', 'get.*and',
]

export function selectModel(text: string): string {
  let pref: 'auto' | 'fable' | 'haiku' = 'auto'
  try { pref = getSettings().modelPreference } catch { /* db not ready */ }
  if (pref === 'fable') return 'claude-fable-5'
  if (pref === 'haiku') return 'claude-haiku-4-5-20251001'

  const lower = text.toLowerCase()
  const words = lower.trim().split(/\s+/)

  // Fable: deep reasoning / PR descriptions / complex multi-step
  const isDeep = DEEP_KEYWORDS.some(kw => lower.includes(kw))
  const isChained = CHAIN_KEYWORDS.some(pattern => new RegExp(pattern).test(lower))
  if (isDeep || isChained || words.length > 30) return 'claude-fable-5'

  // Haiku: short conversational or fast single-tool requests
  const isFastTool = FAST_TOOLS.some(prefix => lower.includes(prefix.replace('_', ' ').replace('_', '')))
  if (words.length <= 10 || (words.length <= 20 && isFastTool)) return 'claude-haiku-4-5-20251001'

  // Sonnet: everything else (email, GitHub, multi-tool, medium complexity)
  return 'claude-sonnet-4-6'
}
```

- [ ] **Step 4: Run tests**

```
npm test
```
Expected: all pass including the new routing tests.

- [ ] **Step 5: Commit**

```bash
git add src/backend/claude.ts tests/backend/claude.test.ts
git commit -m "feat(routing): tiered model selection — Haiku/Sonnet/Fable by request complexity"
```

---

## Task 7: Plan Preview System

**Recommended model:** sonnet

**Files:**
- Create: `src/backend/planPreview.ts`
- Modify: `src/backend/claude.ts`
- Modify: `src/backend/index.ts`
- Create: `src/renderer/src/components/PlanPreviewCard.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create `src/backend/planPreview.ts`**

```typescript
import { randomUUID } from 'crypto'
import { emitEvent } from './events'

const DESTRUCTIVE_TOOLS = new Set(['email_send', 'execute_file', 'fs_write', 'calendar_create'])

export function isDestructiveChain(toolNames: string[]): boolean {
  return toolNames.some(n => DESTRUCTIVE_TOOLS.has(n)) && toolNames.length > 1
}

let _pending: ((approved: boolean) => void) | null = null

export function requestPlanPreview(steps: string[]): Promise<boolean> {
  const id = randomUUID()
  emitEvent({ type: 'plan_preview', id, steps })
  return new Promise(resolve => {
    _pending = resolve
  })
}

export function resolvePlanPreview(approved: boolean): void {
  const resolve = _pending
  _pending = null
  resolve?.(approved)
}
```

- [ ] **Step 2: Wire plan preview into `src/backend/claude.ts`**

Add import at top of `claude.ts`:
```typescript
import { isDestructiveChain, requestPlanPreview } from './planPreview'
```

Inside the `chat` function's tool loop, after getting `toolBlocks` (and before running them), add the plan preview gate. Find this line:
```typescript
const toolLabel = toolBlocks.map(b => b.name.replace(/_/g, ' ')).join(', ')
```

Insert **before** it:
```typescript
// Plan preview gate for destructive multi-step chains
const toolNames = toolBlocks.map(b => b.name)
if (isDestructiveChain(toolNames)) {
  const steps = toolBlocks.map(b => {
    const verb = b.name.replace(/_/g, ' ')
    const detail = (b.input as Record<string, unknown>).to
      ?? (b.input as Record<string, unknown>).path
      ?? (b.input as Record<string, unknown>).query
      ?? ''
    return detail ? `${verb}: ${String(detail)}` : verb
  })
  const approved = await requestPlanPreview(steps)
  if (!approved) {
    fullText = 'Cancelled — I won\'t proceed with those steps.'
    break
  }
}
```

- [ ] **Step 3: Handle `plan_confirmed`/`plan_cancelled` in `src/backend/index.ts`**

Add import at top of index.ts (with other imports):
```typescript
import { resolvePlanPreview } from './planPreview'
```

In `handleRendererEvent`, before `eventHandlers.forEach(h => h(event))` at the end, add:

```typescript
if (event.type === 'plan_confirmed') {
  resolvePlanPreview(true)
  return
}
if (event.type === 'plan_cancelled') {
  resolvePlanPreview(false)
  return
}
```

- [ ] **Step 4: Create `src/renderer/src/components/PlanPreviewCard.tsx`**

```tsx
import type { RendererEvent } from '../../../backend/types'

interface Props {
  preview: { id: string; steps: string[] } | null
  onConfirm: () => void
  onCancel: () => void
}

export function PlanPreviewCard({ preview, onConfirm, onCancel }: Props): JSX.Element | null {
  if (!preview) return null

  return (
    <>
      <div
        className="no-drag"
        onClick={onCancel}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 199 }}
      />
      <div
        className="no-drag"
        style={{
          position: 'fixed',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 420,
          background: 'var(--ov-bg)',
          border: '1px solid var(--ov-border)',
          borderRadius: 'var(--ov-radius)',
          boxShadow: 'var(--ov-shadow)',
          padding: '16px 20px',
          zIndex: 200,
          fontFamily: 'var(--font-mono)',
          animation: 'overlayIn 0.2s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        <div style={{ color: 'var(--ov-accent)', fontSize: 11, letterSpacing: '0.12em', marginBottom: 10 }}>
          MULTI-STEP PLAN
        </div>
        <ol style={{ paddingLeft: 18, margin: '0 0 14px', color: 'var(--ov-text)', fontSize: 12, lineHeight: 1.7 }}>
          {preview.steps.map((step, i) => (
            <li key={i} style={{ color: i === 0 ? 'var(--ov-text)' : 'var(--ov-text-mid)' }}>{step}</li>
          ))}
        </ol>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="pill-btn pill-btn--danger pill-btn--sm">
            CANCEL
          </button>
          <button onClick={onConfirm} className="pill-btn pill-btn--active pill-btn--sm">
            PROCEED
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 5: Wire PlanPreviewCard into `src/renderer/src/App.tsx`**

Add import:
```typescript
import { PlanPreviewCard } from './components/PlanPreviewCard'
```

Update the destructure from `useAnimState` to include `closePlanPreview`:
```typescript
const { state, handleEvent, ..., closePlanPreview } = useAnimState()
```

After the `<ConfirmCard .../>` block (~line 264), add:
```tsx
<PlanPreviewCard
  preview={state.planPreview}
  onConfirm={() => {
    send({ type: 'plan_confirmed', id: state.planPreview!.id })
    closePlanPreview()
  }}
  onCancel={() => {
    send({ type: 'plan_cancelled', id: state.planPreview!.id })
    closePlanPreview()
  }}
/>
```

- [ ] **Step 6: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/backend/planPreview.ts src/backend/claude.ts src/backend/index.ts src/renderer/src/components/PlanPreviewCard.tsx src/renderer/src/App.tsx
git commit -m "feat(agentic): plan-preview confirmation gate for destructive multi-step chains"
```

---

## Task 8: spotify_now_playing Backend Event

**Recommended model:** sonnet

**Files:**
- Modify: `src/backend/tools/spotify.ts`

- [ ] **Step 1: Write test for spotify_now_playing emission**

Add to `tests/backend/tools/spotify.test.ts` (create if needed):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/backend/events', () => ({ emitEvent: vi.fn() }))
vi.mock('../../../src/backend/memory/settings', () => ({
  getSettings: vi.fn().mockReturnValue({
    spotifyAccessToken: 'fake-token',
    spotifyExpiresAt: Date.now() + 3600_000,
    spotifyRefreshToken: 'fake-refresh',
  }),
  setSettings: vi.fn(),
}))

import { emitEvent } from '../../../src/backend/events'
import { handleSpotifyTool } from '../../../src/backend/tools/spotify'

global.fetch = vi.fn()

describe('spotify_current', () => {
  it('emits spotify_now_playing with track data when music is playing', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        item: { name: 'Test Track', artists: [{ name: 'Artist' }], album: { name: 'Album' } },
        progress_ms: 30000, duration_ms: 200000, is_playing: true,
      }),
    })
    await handleSpotifyTool('spotify_current', {})
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spotify_now_playing',
      track: 'Test Track',
      artist: 'Artist',
      isPlaying: true,
    }))
  })

  it('emits spotify_now_playing with isPlaying false when nothing plays', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, status: 204 })
    await handleSpotifyTool('spotify_current', {})
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spotify_now_playing', isPlaying: false,
    }))
  })
})
```

- [ ] **Step 2: Run test — confirm it fails**

```
npm test tests/backend/tools/spotify.test.ts
```
Expected: FAIL (no `emitEvent` call currently).

- [ ] **Step 3: Add `emitEvent` import to `src/backend/tools/spotify.ts`**

Add at top:
```typescript
import { emitEvent } from '../events'
```

- [ ] **Step 4: Modify `currentTrack()` to emit `spotify_now_playing`**

Replace the existing `currentTrack` function:

```typescript
async function currentTrack(): Promise<string> {
  const res = await spotifyFetch('/me/player/currently-playing')
  if (res.status === 204) {
    emitEvent({ type: 'spotify_now_playing', isPlaying: false })
    return 'Nothing is playing right now.'
  }
  if (!res.ok) return `Spotify error: ${res.status}`

  const data = await res.json() as {
    item?: { name: string; artists: Array<{ name: string }>; album: { name: string } }
    progress_ms?: number
    duration_ms?: number
    is_playing?: boolean
  }

  if (!data.item) {
    emitEvent({ type: 'spotify_now_playing', isPlaying: false })
    return 'Nothing is playing right now.'
  }

  const track = data.item
  const artist = track.artists.map(a => a.name).join(', ')
  const progress = data.progress_ms ?? 0
  const duration = data.duration_ms ?? 1
  const pct = Math.round((progress / duration) * 100)
  const status = data.is_playing ? 'Playing' : 'Paused'

  emitEvent({
    type: 'spotify_now_playing',
    track: track.name,
    artist,
    isPlaying: !!data.is_playing,
  })

  return `${status}: "${track.name}" by ${artist} — ${track.album.name} (${pct}% through)`
}
```

- [ ] **Step 5: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/backend/tools/spotify.ts tests/backend/tools/spotify.test.ts
git commit -m "feat(spotify): emit spotify_now_playing event from currentTrack"
```

---

## Task 9: SpotifyPanel Full Rebuild

**Recommended model:** fable  
**Invoke `frontend-design` skill before writing any component code.**

**Files:**
- Modify: `src/renderer/src/components/SpotifyPanel.tsx`

- [ ] **Step 1: Invoke frontend-design skill**

Before writing code, invoke: `Skill({ skill: 'frontend-design:frontend-design', args: 'Spotify control panel modal — dark overlay, electric blue accent (#0ea5e9), now-playing card with track/artist, playback controls, search input, premium feel' })`

- [ ] **Step 2: Completely replace `SpotifyPanel.tsx`**

The new component receives `nowPlaying` prop from App.tsx. Replace the entire file:

```tsx
import { useState, useEffect } from 'react'
import type { RendererEvent } from '../../../backend/types'

interface NowPlaying {
  track?: string
  artist?: string
  isPlaying: boolean
}

interface SpotifyPanelProps {
  open: boolean
  onClose: () => void
  send: (e: RendererEvent) => void
  nowPlaying: NowPlaying | null
}

export function SpotifyPanel({ open, onClose, send, nowPlaying }: SpotifyPanelProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [inputFocused, setInputFocused] = useState(false)

  useEffect(() => {
    if (open) {
      // Fetch current track when panel opens
      send({ type: 'command', text: 'what is playing' })
    }
  }, [open, send])

  if (!open) return null

  const handleSearch = (): void => {
    const q = query.trim()
    if (!q) return
    send({ type: 'command', text: `play ${q}` })
    setQuery('')
  }

  const cmd = (text: string) => () => send({ type: 'command', text })

  return (
    <>
      {/* Scrim */}
      <div
        className="no-drag"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 199 }}
      />

      {/* Panel */}
      <div
        className="no-drag"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 460,
          background: 'var(--ov-bg)',
          borderRadius: 'var(--ov-radius)',
          border: '1px solid var(--ov-border)',
          boxShadow: 'var(--ov-shadow)',
          backdropFilter: 'blur(28px)',
          zIndex: 200,
          fontFamily: 'var(--font-mono)',
          animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          height: 52,
          borderBottom: '1px solid var(--ov-separator)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--ov-accent)', fontSize: 14 }}>♫</span>
            <span style={{ color: 'var(--ov-text)', fontSize: 11, letterSpacing: '0.2em', fontWeight: 600 }}>
              SPOTIFY
            </span>
          </div>
          <button
            onClick={onClose}
            className="pill-btn pill-btn--icon"
            style={{ padding: '4px 8px', fontSize: 12 }}
          >
            ✕
          </button>
        </div>

        {/* Now playing card */}
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{
            background: 'var(--ov-bg-raised)',
            border: '1px solid var(--ov-border)',
            borderRadius: 10,
            padding: 16,
            display: 'flex',
            gap: 14,
            alignItems: 'center',
          }}>
            {/* Album art placeholder */}
            <div style={{
              width: 52,
              height: 52,
              borderRadius: 6,
              background: 'linear-gradient(135deg, rgba(14,165,233,0.25), rgba(14,165,233,0.08))',
              border: '1px solid var(--ov-border)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              color: 'var(--ov-text-dim)',
            }}>
              ♫
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {nowPlaying?.track ? (
                <>
                  <div style={{
                    color: 'var(--ov-text)',
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {nowPlaying.track}
                  </div>
                  <div style={{
                    color: 'var(--ov-text-mid)',
                    fontSize: 11,
                    marginTop: 3,
                    letterSpacing: '0.04em',
                  }}>
                    {nowPlaying.artist}
                  </div>
                  {/* Progress bar */}
                  <div style={{
                    height: 2,
                    background: 'var(--ov-separator)',
                    borderRadius: 1,
                    marginTop: 10,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: nowPlaying.isPlaying ? '45%' : '0%',
                      background: 'var(--ov-accent)',
                      borderRadius: 1,
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--ov-text-dim)', fontSize: 12, letterSpacing: '0.06em' }}>
                  Nothing playing
                </div>
              )}
            </div>

            {/* Playing indicator */}
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: nowPlaying?.isPlaying ? 'var(--ov-accent)' : 'var(--ov-text-dim)',
              boxShadow: nowPlaying?.isPlaying ? '0 0 8px var(--ov-accent-glow)' : 'none',
              flexShrink: 0,
              animation: nowPlaying?.isPlaying ? 'statusPulse 2s ease-in-out infinite' : 'none',
            }} />
          </div>
        </div>

        {/* Controls */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          padding: '16px 20px',
        }}>
          <button onClick={cmd('previous track')} className="pill-btn pill-btn--icon" title="Previous">⏮</button>
          <button
            onClick={cmd(nowPlaying?.isPlaying ? 'pause music' : 'play music')}
            className={`pill-btn pill-btn--icon${nowPlaying?.isPlaying ? ' pill-btn--active' : ''}`}
            style={{ minWidth: 44 }}
            title={nowPlaying?.isPlaying ? 'Pause' : 'Play'}
          >
            {nowPlaying?.isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={cmd('next track')} className="pill-btn pill-btn--icon" title="Next">⏭</button>
          <div style={{ width: 1, height: 20, background: 'var(--ov-separator)', margin: '0 4px' }} />
          <button onClick={cmd('volume down')} className="pill-btn pill-btn--sm" title="Vol −">VOL −</button>
          <button onClick={cmd('volume up')} className="pill-btn pill-btn--sm" title="Vol +">VOL +</button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--ov-separator)', margin: '0 20px' }} />

        {/* Search */}
        <div style={{ padding: '14px 20px 16px', display: 'flex', gap: 8 }}>
          <input
            className="ov-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
            placeholder="Search music..."
          />
          <button onClick={handleSearch} className="pill-btn pill-btn--sm" style={{ whiteSpace: 'nowrap' }}>
            PLAY
          </button>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--ov-separator)',
          padding: '8px 20px',
          fontSize: 9,
          color: 'var(--ov-text-dim)',
          letterSpacing: '0.06em',
        }}>
          Say &apos;play jazz&apos; or &apos;pause&apos; to control playback
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Update App.tsx to pass `nowPlaying` prop**

In `App.tsx`, find the `<SpotifyPanel .../>` line and update:

```tsx
<SpotifyPanel
  open={state.spotifyOpen}
  onClose={toggleSpotify}
  send={send}
  nowPlaying={state.spotifyNowPlaying}
/>
```

- [ ] **Step 4: Verify app builds**

```
npm run build:backend
```
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SpotifyPanel.tsx src/renderer/src/App.tsx
git commit -m "feat(ui): SpotifyPanel full rebuild — live now-playing card, overlay design system"
```

---

## Task 10: github_data Backend Event

**Recommended model:** sonnet

**Files:**
- Modify: `src/backend/tools/github.ts`

- [ ] **Step 1: Write test for github_data emission**

Create or add to `tests/backend/tools/github.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/backend/events', () => ({ emitEvent: vi.fn() }))
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], opts: unknown, cb: Function) => {
    const out = JSON.stringify([
      { number: 1, title: 'Fix bug', author: { login: 'alice' }, state: 'OPEN', updatedAt: '2026-01-01T00:00:00Z', isDraft: false },
    ])
    cb(null, { stdout: out }, '')
  }),
}))

import { emitEvent } from '../../../src/backend/events'
import { handleGithubTool } from '../../../src/backend/tools/github'

describe('github_pr_list', () => {
  it('emits github_data with parsed rows', async () => {
    await handleGithubTool('github_pr_list', {})
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'github_data',
      tab: 'PRs',
      rows: expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining('#1') }),
      ]),
    }))
  })
})
```

- [ ] **Step 2: Run test — confirm it fails**

```
npm test tests/backend/tools/github.test.ts
```
Expected: FAIL (no `emitEvent` calls yet).

- [ ] **Step 3: Add `emitEvent` import to `src/backend/tools/github.ts`**

Add at top:
```typescript
import { emitEvent } from '../events'
import type { GithubRow } from '../types'
```

- [ ] **Step 4: Add emit to `prList`**

Modify `prList` to emit after formatting. Find the return statement in prList's try block and replace:

```typescript
    if (prs.length === 0) return 'No open pull requests.'
    const rows: GithubRow[] = prs.map(pr => ({
      title: `#${pr.number}${pr.isDraft ? ' [DRAFT]' : ''} ${pr.title}`,
      subtitle: `@${pr.author.login}`,
      meta: new Date(pr.updatedAt).toLocaleDateString(),
      badge: pr.isDraft ? 'DRAFT' : 'OPEN',
      badgeColor: pr.isDraft ? '#6b7280' : '#22c55e',
    }))
    emitEvent({ type: 'github_data', tab: 'PRs', rows })
    return rows.map(r => `${r.title}\n  by ${r.subtitle} · ${r.meta}`).join('\n\n')
```

- [ ] **Step 5: Add emit to `issueList`**

Same pattern. Find the issues formatter and replace the return:
```typescript
    if (issues.length === 0) return 'No open issues.'
    const rows: GithubRow[] = issues.map(i => {
      const labels = i.labels.map(l => l.name).join(', ')
      return {
        title: `#${i.number} ${i.title}`,
        subtitle: `@${i.author.login}`,
        meta: labels || undefined,
        badge: 'OPEN',
        badgeColor: '#f59e0b',
      }
    })
    emitEvent({ type: 'github_data', tab: 'ISSUES', rows })
    return rows.map(r => `${r.title}\n  by ${r.subtitle}${r.meta ? ` · [${r.meta}]` : ''}`).join('\n\n')
```

- [ ] **Step 6: Add emit to `commitLog`**

After `commitLog` gets its output string, parse into rows and emit. Modify `commitLog` to add at the end:

```typescript
async function commitLog(repo?: string, limit = 10): Promise<string> {
  // ... existing code to get `out` ...
  const lines = out.split('\n').filter(Boolean)
  const rows: GithubRow[] = lines.map(line => ({
    title: line.slice(8).trim(),
    subtitle: line.slice(0, 7),
  }))
  if (rows.length > 0) emitEvent({ type: 'github_data', tab: 'COMMITS', rows })
  return out
}
```

- [ ] **Step 7: Add emit to `repoStatus`**

After building the status string in `repoStatus`, add:
```typescript
  const rows: GithubRow[] = [
    { title: `Branch: ${branch}`, subtitle: syncStatus },
    { title: status ? 'Uncommitted changes' : 'Working tree clean', subtitle: status || '' },
  ]
  emitEvent({ type: 'github_data', tab: 'STATUS', rows })
  return [/* existing return */].join('\n')
```

- [ ] **Step 8: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/backend/tools/github.ts tests/backend/tools/github.test.ts
git commit -m "feat(github): emit github_data structured rows for inline panel display"
```

---

## Task 11: GitHubPanel Full Rebuild

**Recommended model:** fable  
**Invoke `frontend-design` skill before writing any component code.**

**Files:**
- Modify: `src/renderer/src/components/GitHubPanel.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Invoke frontend-design skill**

Invoke: `Skill({ skill: 'frontend-design:frontend-design', args: 'GitHub panel right drawer — dark overlay, electric blue accent (#0ea5e9), tabs for STATUS/PRs/ISSUES/COMMITS, card rows for inline data, skeleton loader, premium terminal feel' })`

- [ ] **Step 2: Completely replace `GitHubPanel.tsx`**

The component now receives `githubData` from App.tsx. Replace the entire file:

```tsx
import { useEffect } from 'react'
import type { GithubRow, RendererEvent } from '../../../backend/types'

type Tab = 'STATUS' | 'PRs' | 'ISSUES' | 'COMMITS'

interface GithubData {
  tab: Tab
  rows: GithubRow[]
}

interface GitHubPanelProps {
  open: boolean
  onClose: () => void
  send: (e: RendererEvent) => void
  githubData: GithubData | null
}

const TAB_CMDS: Record<Tab, string> = {
  STATUS:  'show git repo status',
  PRs:     'list open pull requests',
  ISSUES:  'list open github issues',
  COMMITS: 'show recent git commits',
}

const TABS: Tab[] = ['STATUS', 'PRs', 'ISSUES', 'COMMITS']

export function GitHubPanel({ open, onClose, send, githubData }: GitHubPanelProps): JSX.Element | null {
  useEffect(() => {
    if (open) send({ type: 'command', text: TAB_CMDS['STATUS'] })
  }, [open, send])

  if (!open) return null

  const activeTab = githubData?.tab ?? 'STATUS'

  const loadTab = (tab: Tab): void => {
    send({ type: 'command', text: TAB_CMDS[tab] })
  }

  return (
    <>
      {/* Scrim */}
      <div
        className="no-drag"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 199 }}
      />

      {/* Drawer */}
      <div
        className="no-drag"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 440,
          background: 'var(--ov-bg)',
          backdropFilter: 'blur(28px)',
          borderLeft: '1px solid var(--ov-border)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 200,
          fontFamily: 'var(--font-mono)',
          animation: 'drawerIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{
          height: 52,
          borderBottom: '1px solid var(--ov-separator)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--ov-accent)', fontSize: 14 }}>⬡</span>
            <span style={{ color: 'var(--ov-text)', fontSize: 11, letterSpacing: '0.2em', fontWeight: 600 }}>
              GITHUB
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => loadTab(activeTab)}
              className="pill-btn pill-btn--icon"
              title="Refresh"
            >
              ↺
            </button>
            <button onClick={onClose} className="pill-btn pill-btn--icon">✕</button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--ov-separator)',
          flexShrink: 0,
        }}>
          {TABS.map(tab => {
            const isActive = tab === activeTab
            return (
              <button
                key={tab}
                onClick={() => loadTab(tab)}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--ov-accent)' : '2px solid transparent',
                  color: isActive ? 'var(--ov-accent)' : 'var(--ov-text-dim)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.14em',
                  padding: '10px 4px 8px',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {tab}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {!githubData ? (
            // Skeleton loader
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[80, 65, 72, 55].map((w, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="skeleton-row" style={{ width: `${w}%` }} />
                  <div className="skeleton-row" style={{ width: `${w * 0.6}%`, opacity: 0.5 }} />
                </div>
              ))}
            </div>
          ) : githubData.rows.length === 0 ? (
            <div style={{ color: 'var(--ov-text-dim)', fontSize: 12, letterSpacing: '0.06em', paddingTop: 8 }}>
              Nothing found
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {githubData.rows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--ov-bg-raised)',
                    border: '1px solid var(--ov-border)',
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: 'var(--ov-text)',
                      fontSize: 12,
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {row.title}
                    </div>
                    {(row.subtitle || row.meta) && (
                      <div style={{ color: 'var(--ov-text-dim)', fontSize: 10, marginTop: 3, letterSpacing: '0.04em' }}>
                        {row.subtitle}{row.subtitle && row.meta ? ' · ' : ''}{row.meta}
                      </div>
                    )}
                  </div>
                  {row.badge && (
                    <span style={{
                      fontSize: 8,
                      letterSpacing: '0.1em',
                      color: row.badgeColor ?? 'var(--ov-text-mid)',
                      border: `1px solid ${row.badgeColor ?? 'var(--ov-border)'}`,
                      borderRadius: 4,
                      padding: '2px 6px',
                      flexShrink: 0,
                      opacity: 0.85,
                    }}>
                      {row.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          height: 36,
          borderTop: '1px solid var(--ov-separator)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          flexShrink: 0,
        }}>
          <span style={{ color: 'var(--ov-text-dim)', fontSize: 9, letterSpacing: '0.08em' }}>
            via gh CLI · say &apos;show my PRs&apos; anytime
          </span>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Update App.tsx to pass `githubData` prop**

Find `<GitHubPanel .../>` and update:

```tsx
<GitHubPanel
  open={state.githubOpen}
  onClose={toggleGithub}
  send={send}
  githubData={state.githubData}
/>
```

- [ ] **Step 4: Build check**

```
npm run build:backend
```
Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/GitHubPanel.tsx src/renderer/src/App.tsx
git commit -m "feat(ui): GitHubPanel full rebuild — inline data cards, skeleton loader, overlay design system"
```

---

## Task 12: HudOverlay Refinements

**Recommended model:** sonnet

**Files:**
- Modify: `src/renderer/src/components/HudOverlay.tsx`

- [ ] **Step 1: Add `statusPulse` animation to thinking dot**

Find the status dot `<span style={{ fontSize: 8 }}>●</span>` and replace with:

```tsx
<span style={{
  fontSize: 8,
  animation: animState === 'thinking' ? 'statusPulse 1.2s ease-in-out infinite' : 'none',
}}>●</span>
```

- [ ] **Step 2: Replace inline button style overrides with CSS classes**

Find the four HUD buttons (TEXT, ♫, GH, 🔇). Replace their inline `style` overrides with `className` additions:

```tsx
<button
  onClick={onToggleText}
  title={textVisible ? 'Hide transcript' : 'Show transcript'}
  className={`pill-btn pill-btn--icon${textVisible ? ' pill-btn--active' : ''}`}
>
  TEXT
</button>
<button
  onClick={onToggleSpotify}
  title="Spotify"
  className={`pill-btn pill-btn--icon${spotifyOpen ? ' pill-btn--active' : ''}`}
>
  ♫
</button>
<button
  onClick={onToggleGithub}
  title="GitHub"
  className={`pill-btn pill-btn--icon${githubOpen ? ' pill-btn--active' : ''}`}
>
  GH
</button>
<button
  onClick={onToggleQuietMode}
  title={quietMode ? 'Quiet mode on — click to disable' : 'Enable quiet mode'}
  className={`pill-btn pill-btn--icon${quietMode ? ' pill-btn--active' : ''}`}
>
  {quietMode ? '🔇' : '🔊'}
</button>
```

- [ ] **Step 3: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/HudOverlay.tsx
git commit -m "style(hud): status pulse animation, consistent pill-btn--active classes"
```

---

## Task 13: Modal Consistency Pass + spawn_agent Audit

**Recommended model:** opus (modals) / sonnet (agents audit)  
**Invoke `frontend-design` skill before touching each modal.**

**Files:**
- Modify: `src/renderer/src/components/Dashboard.tsx`
- Modify: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/components/MemoryBrowser.tsx`
- Modify: `src/renderer/src/components/ConfirmCard.tsx`
- Modify: `src/renderer/src/components/EmailComposer.tsx`
- Modify: `src/renderer/src/components/EmailViewer.tsx`
- Modify: `src/renderer/src/components/EventEditor.tsx`
- Modify: `src/renderer/src/components/CommandEditor.tsx`
- Modify: `src/renderer/src/components/ReportPanel.tsx`
- Modify: `src/renderer/src/components/AgentCards.tsx`
- Modify: `src/backend/agents.ts`

- [ ] **Step 1: Invoke frontend-design skill**

Invoke: `Skill({ skill: 'frontend-design:frontend-design', args: 'Consistency pass across all modals/panels in a desktop AI assistant app — apply --ov-* CSS vars, .ov-input class, .pill-btn variants, overlayIn entrance animation, uniform 52px headers, consistent spacing, premium dark overlay feel' })`

- [ ] **Step 2: Apply overlay tokens to each modal**

For each of the 10 modal components listed, make these consistent changes:

**Pattern to apply to every modal's root container:**
```tsx
background: 'var(--ov-bg)',
border: '1px solid var(--ov-border)',
borderRadius: 'var(--ov-radius)',
boxShadow: 'var(--ov-shadow)',
backdropFilter: 'blur(28px)',
animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
fontFamily: 'var(--font-mono)',
```

**Pattern for every modal header:**
```tsx
height: 52,
borderBottom: '1px solid var(--ov-separator)',
display: 'flex', alignItems: 'center', justifyContent: 'space-between',
padding: '0 20px',
color: 'var(--ov-text)',
fontSize: 11, letterSpacing: '0.2em', fontWeight: 600,
```

**Pattern for every close button:**
```tsx
className="pill-btn pill-btn--icon"
```

**Pattern for every input field:**
```tsx
className="ov-input"
// remove all inline background/border/color/font styles
```

**Pattern for every primary action button:**
```tsx
className="pill-btn pill-btn--active"
```

**Pattern for every secondary/cancel button:**
```tsx
className="pill-btn"
```

**Pattern for every danger button:**
```tsx
className="pill-btn pill-btn--danger"
```

- [ ] **Step 3: Audit and fix spawn_agent in `src/backend/agents.ts`**

The current `runAgent` function doesn't pass memory context to the agent. Modify `spawnAgent` signature to accept optional context and pass it:

```typescript
export async function spawnAgent(name: string, task: string, context?: string): Promise<string> {
  const info: AgentInfo = { ... }
  agents.set(info.id, info)
  emitEvent({ type: 'agent_spawn', id: info.id, name, task })
  void runAgent(info, context)
  return `Spawned agent "${name}" to handle: ${task}. It will report back when done.`
}

async function runAgent(info: AgentInfo, context?: string): Promise<void> {
  try {
    const { query } = await dynamicImport('@anthropic-ai/claude-agent-sdk')
    const prompt = context
      ? `Context about the user:\n${context}\n\nTask: ${info.task}`
      : info.task
    for await (const message of query({
      prompt,
      options: { allowedTools: AGENT_TOOLS, permissionMode: 'bypassPermissions', maxTurns: MAX_TURNS },
    })) {
```

Update `handleAgentTool` in `tools/index.ts` to pass context — this requires the `ctx` already added in Task 3. Pass context via `input.context` if provided by the LLM.

- [ ] **Step 4: Run tests**

```
npm test
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Dashboard.tsx src/renderer/src/components/SettingsPanel.tsx src/renderer/src/components/MemoryBrowser.tsx src/renderer/src/components/ConfirmCard.tsx src/renderer/src/components/EmailComposer.tsx src/renderer/src/components/EmailViewer.tsx src/renderer/src/components/EventEditor.tsx src/renderer/src/components/CommandEditor.tsx src/renderer/src/components/ReportPanel.tsx src/renderer/src/components/AgentCards.tsx src/backend/agents.ts
git commit -m "style(ui): overlay token consistency pass across all modals + spawn_agent context fix"
```

---

## Self-Review

**Spec coverage check:**
- ✅ 1.1 `'open'` removed from TOOL_KEYWORDS_ROUTE → Task 3
- ✅ 1.2 gmail_compose guard centralised in handleTool → Task 3
- ✅ 1.3 Unknown tool broadcast → Task 3
- ✅ 1.4 Button style duplication removed (handled in Task 9/11 rebuilds + Task 13 consistency pass) → Tasks 9, 11, 13
- ✅ 1.5 MAX_STEPS alignment → Task 4
- ✅ 2.1 Tiered model routing → Task 6
- ✅ 2.2 Step cap increase → Task 4
- ✅ 2.3 Plan preview → Task 7
- ✅ 2.4 Context window → Task 4
- ✅ 2.5 spawn_agent audit → Task 13
- ✅ 3.1 Overlay design system → Task 1
- ✅ 3.2 Button system → Task 1
- ✅ 3.3 SpotifyPanel live now-playing → Tasks 8, 9
- ✅ 3.4 GitHubPanel inline data → Tasks 10, 11
- ✅ 3.5 HudOverlay refinements → Task 12
- ✅ 3.6 `.ov-input` → Task 1
- ✅ 3.7 Existing modal consistency → Task 13
- ✅ `spotify_now_playing` BackendEvent → Task 2 (types) + Task 8 (backend) + Task 5 (state)
- ✅ `github_data` BackendEvent → Task 2 (types) + Task 10 (backend) + Task 5 (state)
- ✅ `plan_preview` / `plan_confirmed` / `plan_cancelled` → Task 2 (types) + Task 7 (impl) + Task 5 (state)
- ✅ PlanPreviewCard component → Task 7
- ✅ GithubRow interface → Task 2
