# Jarvis UI Polish + Feature Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **FRONTEND RULE:** Every task that creates or significantly modifies a renderer component MUST be implemented using the `frontend-design` skill. Tasks flagged **[frontend-design]** below require it.

**Goal:** Fix two UX bugs (chat scroll, subagent cards), overhaul the UI (single JetBrains Mono font, pill buttons, right-edge settings drawer, HUD cleanup), and add three features (memory browser, redesigned agent cards with completion toast + log modal, real voice-amplitude particle reaction).

**Architecture:** Pure additive changes to an existing Electron 3-process app. Renderer is React + a Canvas particle system; backend is a WebSocket server over SQLite. New WebSocket events (`get_memories`, `delete_memory`, `memories`) extend the existing typed `BackendEvent`/`RendererEvent` unions. Real audio amplitude is sampled renderer-side via Web Audio `AnalyserNode` and fed to the particle canvas through a ref.

**Tech Stack:** Electron 28, React 18 + TypeScript, HTML5 Canvas, `better-sqlite3`, `ws`, Vitest. Font: JetBrains Mono (Google Fonts).

**Backend rebuild reminder:** After editing any `src/backend/**` file, run `npm run build:backend` — the backend is not hot-reloaded.

**Verification note:** Most renderer changes are visual and verified by running `npm run dev` and observing the app. Logic with testable behavior (backend memory CRUD, the RMS amplitude helper) gets real Vitest tests. Run the full suite with `npx vitest run`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/renderer/index.html` | Font imports | Modify |
| `src/renderer/src/styles/global.css` | Font vars + shared `.pill-btn` style | Modify |
| `src/renderer/src/components/Transcript.tsx` | Chat scroll bug | Modify |
| `src/renderer/src/components/HudOverlay.tsx` | Pill buttons + dot status | Modify |
| `src/renderer/src/components/ConfirmCard.tsx` | Pill buttons + font | Modify |
| `src/renderer/src/components/TextInput.tsx` | Font + hint text | Modify |
| `src/renderer/src/components/SettingsPanel.tsx` | Right-edge drawer + MEMORIES button | Rewrite |
| `src/renderer/src/components/MemoryBrowser.tsx` | Memory list drawer | Create |
| `src/renderer/src/components/AgentCards.tsx` | Redesigned card (expand/done/copy/dismiss) | Rewrite |
| `src/renderer/src/components/AgentLogModal.tsx` | Full action-log modal | Create |
| `src/renderer/src/components/CompletionToast.tsx` | Agent-complete toast | Create |
| `src/renderer/src/components/ParticleRing.tsx` | `amplitude` prop drives wave magnitude | Modify |
| `src/renderer/src/hooks/useAnimState.ts` | `memoriesOpen`, `memories`, `toasts` state + handlers | Modify |
| `src/renderer/src/lib/rms.ts` | Pure RMS-from-bytes helper | Create |
| `src/renderer/src/App.tsx` | Wire amplitude sampling, MemoryBrowser, toasts | Modify |
| `src/backend/types.ts` | `MemoryEntry` type + 3 new event variants | Modify |
| `src/backend/memory/db.ts` | `deleteMemory()` + `id`/`timestamp` in `getAllMemories` | Modify |
| `src/backend/index.ts` | Handle `get_memories` / `delete_memory` | Modify |
| `tests/backend/memory/db.test.ts` | `deleteMemory` test | Modify |
| `tests/renderer/rms.test.ts` | RMS helper test | Create |

---

## Task 1: Typography swap to JetBrains Mono

**Files:**
- Modify: `src/renderer/index.html:8`
- Modify: `src/renderer/src/styles/global.css:14-16`

This is the first task because it unblocks visual verification of every later change.

- [ ] **Step 1: Replace the font `<link>` in index.html**

Replace line 8 (the Orbitron/Share Tech Mono/Rajdhani link) with:

```html
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Point all three font CSS variables at JetBrains Mono**

In `src/renderer/src/styles/global.css`, replace lines 14-16:

```css
  --font-hud:     'JetBrains Mono', monospace;
  --font-data:    'JetBrains Mono', monospace;
  --font-mono:    'JetBrains Mono', monospace;
```

- [ ] **Step 3: Add a shared pill-button style at the end of global.css**

Append to `src/renderer/src/styles/global.css`:

```css
/* ── Pill buttons ─────────────────────────────────────── */

.pill-btn {
  background: rgba(3, 105, 161, 0.08);
  border: 1px solid rgba(3, 105, 161, 0.22);
  border-radius: 20px;
  color: var(--accent);
  cursor: pointer;
  font-family: var(--font-hud);
  font-size: 10px;
  letter-spacing: 0.12em;
  padding: 5px 14px;
  transition: background 0.15s, border-color 0.15s;
}
.pill-btn:hover {
  background: rgba(3, 105, 161, 0.15);
  border-color: rgba(3, 105, 161, 0.45);
}
.pill-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`
Expected: App launches; all text renders in JetBrains Mono (the JARVIS wordmark and status now look like a clean monospace, not the angular Orbitron). No console font-load errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/src/styles/global.css
git commit -m "feat: switch UI to JetBrains Mono + add pill-button style"
```

---

## Task 2: Fix chat scroll

**Files:**
- Modify: `src/renderer/src/components/Transcript.tsx:43`

- [ ] **Step 1: Enable pointer events on the transcript container**

In `src/renderer/src/components/Transcript.tsx`, in the outer `<div>` style object (around lines 32-49), change:

```tsx
      pointerEvents: 'none',
```

to:

```tsx
      pointerEvents: 'auto',
      cursor: 'default',
```

- [ ] **Step 2: Verify visually**

Run: `npm run dev`, send several messages until the transcript overflows (>42vh).
Expected: Mouse wheel over the transcript scrolls it; text is selectable. The top fade-mask still applies.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Transcript.tsx
git commit -m "fix: allow scrolling and text selection in chat transcript"
```

---

## Task 3: HUD pill buttons + dot status indicator **[frontend-design]**

**Files:**
- Modify: `src/renderer/src/components/HudOverlay.tsx`

- [ ] **Step 1: Convert the DASHBOARD and TEXT buttons to pill style**

In `src/renderer/src/components/HudOverlay.tsx`, replace the inline-styled DASHBOARD `<button>` (lines 100-128) and TEXT `<button>` (lines 129-146) so each uses `className="pill-btn"` and only keeps state-specific overrides. The DASHBOARD button:

```tsx
          <button onClick={onStatsClick} className="pill-btn">
            DASHBOARD
          </button>
```

The TEXT button (keeps active-state emphasis):

```tsx
          <button
            onClick={onToggleText}
            title={textVisible ? 'Hide transcript' : 'Show transcript'}
            className="pill-btn"
            style={{
              background: textVisible ? 'rgba(3,105,161,0.18)' : 'rgba(3,105,161,0.04)',
              color: textVisible ? 'var(--accent)' : 'var(--text-dim)',
            }}
          >
            TEXT
          </button>
```

- [ ] **Step 2: Add a colored dot prefix to the status label**

Replace the status `<div>` (lines 73-82) so the status text is preceded by a `●` in the state color:

```tsx
        <div style={{
          fontFamily: 'var(--font-data)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.18em',
          color: STATUS_COLORS[animState],
          transition: 'color 0.4s',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ fontSize: 8 }}>●</span>
          {STATUS_LABELS[animState]}
        </div>
```

- [ ] **Step 3: Enlarge the JARVIS wordmark**

In the wordmark `<div>` (lines 58-66), change `fontSize: 13` to `fontSize: 15`.

- [ ] **Step 4: Verify visually**

Run: `npm run dev`
Expected: DASHBOARD/TEXT are rounded pills with readable text; a colored dot sits before ONLINE/LISTENING/etc.; JARVIS is slightly larger. Hover brightens the pills.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/HudOverlay.tsx
git commit -m "feat: pill HUD buttons and dot status indicator"
```

---

## Task 4: ConfirmCard + TextInput restyle **[frontend-design]**

**Files:**
- Modify: `src/renderer/src/components/ConfirmCard.tsx`
- Modify: `src/renderer/src/components/TextInput.tsx`

- [ ] **Step 1: Update ConfirmCard fonts and buttons**

In `src/renderer/src/components/ConfirmCard.tsx`:
- Change the card's `fontFamily: '"Orbitron", monospace'` (line 23) to `fontFamily: 'var(--font-hud)'`.
- Change the detail `<div>` `fontFamily: '"Share Tech Mono", monospace'` (line 33) to `fontFamily: 'var(--font-mono)'`.
- Replace the `btn()` helper (lines 47-59) with pill styling that keeps the per-button accent color:

```tsx
function btn(color: string): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${color}`,
    color,
    cursor: 'pointer',
    fontFamily: 'var(--font-hud)',
    fontSize: 11,
    letterSpacing: '0.1em',
    padding: '6px 18px',
    borderRadius: 20,
  }
}
```

- [ ] **Step 2: Update TextInput font references and hint**

In `src/renderer/src/components/TextInput.tsx`:
- The input already uses `var(--font-mono)` (line 64) — no change needed there.
- The hint `<div>` uses `var(--font-data)` (line 98) — no change needed (now JetBrains Mono).
- No structural change required; this step is a verification that no hardcoded `Orbitron`/`Share Tech Mono` strings remain. Search the file: if any literal font names exist, replace with the matching `var(--font-*)`. (As written, none do — this step then is a no-op confirmation.)

- [ ] **Step 3: Verify visually**

Run: `npm run dev`, trigger a confirmation (e.g. ask Jarvis to send an email).
Expected: CONFIRM/CANCEL render as pills; all confirm-card text is JetBrains Mono.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ConfirmCard.tsx src/renderer/src/components/TextInput.tsx
git commit -m "feat: pill buttons on confirm card, unify fonts"
```

---

## Task 5: Settings right-edge drawer **[frontend-design]**

**Files:**
- Rewrite: `src/renderer/src/components/SettingsPanel.tsx`

The panel keeps the same props (`open`, `settings`, `onClose`, `onSave`, `onHotkeyChange`) and adds one prop `onOpenMemories: () => void` so the drawer can launch the memory browser. App.tsx will pass it in Task 7.

- [ ] **Step 1: Rewrite SettingsPanel as a right-edge drawer with grouped sections**

Replace the entire contents of `src/renderer/src/components/SettingsPanel.tsx` with:

```tsx
import { useState, useEffect } from 'react'
import type { Settings } from '../../../backend/types'

interface Props {
  open: boolean
  settings: Settings | null
  onClose: () => void
  onSave: (partial: Partial<Settings>) => void
  onHotkeyChange: (accelerator: string) => void
  onOpenMemories: () => void
}

const DRAWER_W = 340

export function SettingsPanel({ open, settings, onClose, onSave, onHotkeyChange, onOpenMemories }: Props): JSX.Element | null {
  const [draft, setDraft] = useState<Settings | null>(settings)
  useEffect(() => { setDraft(settings) }, [settings])

  if (!draft) return null

  const save = (): void => {
    onSave(draft)
    onHotkeyChange(draft.hotkey)
    onClose()
  }

  const label: React.CSSProperties = { fontSize: 10, letterSpacing: '0.12em', display: 'block', marginBottom: 6, color: 'var(--text-mid)' }
  const field: React.CSSProperties = {
    width: '100%', background: 'rgba(3,105,161,0.05)', border: '1px solid rgba(3,105,161,0.18)',
    borderRadius: 6, color: '#0a2540', padding: '8px 10px', fontFamily: 'var(--font-mono)',
    fontSize: 12, marginBottom: 16, outline: 'none',
  }
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--accent)',
    marginTop: 8, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(3,105,161,0.15)',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(200,220,240,0.25)', backdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s', zIndex: 129,
        }}
      />
      {/* Drawer */}
      <div
        className="no-drag"
        style={{
          position: 'absolute', top: 0, right: 0, height: '100vh', width: DRAWER_W,
          background: 'rgba(255,255,255,0.96)', borderLeft: '1px solid rgba(3,105,161,0.15)',
          backdropFilter: 'blur(20px)', boxShadow: '-8px 0 40px rgba(3,80,140,0.12)',
          padding: 24, zIndex: 130, overflowY: 'auto',
          fontFamily: 'var(--font-hud)', color: 'var(--text)',
          transform: open ? 'translateX(0)' : `translateX(${DRAWER_W}px)`,
          transition: 'transform 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em' }}>SETTINGS</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <div style={sectionLabel}>VOICE</div>
        <label style={label}>PUSH-TO-TALK HOTKEY</label>
        <input style={field} value={draft.hotkey} onChange={e => setDraft({ ...draft, hotkey: e.target.value })} placeholder="Alt+Space" />
        <label style={label}>ELEVENLABS VOICE ID</label>
        <input style={field} value={draft.voiceId} onChange={e => setDraft({ ...draft, voiceId: e.target.value })} />

        <div style={sectionLabel}>AI MODEL</div>
        <label style={label}>LLM PROVIDER</label>
        <select style={field} value={draft.llmProvider ?? 'auto'} onChange={e => setDraft({ ...draft, llmProvider: e.target.value as Settings['llmProvider'] })}>
          <option value="auto">Auto (smart routing)</option>
          <option value="claude">Claude only</option>
          <option value="groq">Groq only</option>
          <option value="ollama">Ollama only (local)</option>
        </select>
        <label style={label}>CLAUDE MODEL (when using Claude)</label>
        <select style={field} value={draft.modelPreference} onChange={e => setDraft({ ...draft, modelPreference: e.target.value as Settings['modelPreference'] })}>
          <option value="auto">Auto (route by length/keywords)</option>
          <option value="fable">Always Fable</option>
          <option value="haiku">Always Haiku</option>
        </select>
        <label style={label}>OLLAMA MODEL</label>
        <input style={field} value={draft.ollamaModel} onChange={e => setDraft({ ...draft, ollamaModel: e.target.value })} placeholder="llama3.1:8b" />
        <label style={label}>OLLAMA BASE URL</label>
        <input style={field} value={draft.ollamaBaseUrl} onChange={e => setDraft({ ...draft, ollamaBaseUrl: e.target.value })} placeholder="http://127.0.0.1:11434" />

        <div style={sectionLabel}>MEMORY</div>
        <label style={label}>SHORT-TERM MEMORY (TURNS)</label>
        <input style={field} type="number" min={2} max={50} value={draft.shortTurns}
          onChange={e => setDraft({ ...draft, shortTurns: parseInt(e.target.value || '20', 10) })} />
        <button className="pill-btn" style={{ width: '100%', marginBottom: 20 }} onClick={onOpenMemories}>
          BROWSE STORED MEMORIES
        </button>

        <button className="pill-btn" style={{ width: '100%', padding: '10px 0', fontSize: 12 }} onClick={save}>
          SAVE
        </button>
      </div>
    </>
  )
}
```

Note: the drawer is always mounted (so it can animate); it returns `null` only when `draft` is null. The `open` flag drives the slide transform.

- [ ] **Step 2: Verify visually**

Run: `npm run dev`, open Settings.
Expected: Panel slides in from the right edge with three labeled sections (VOICE, AI MODEL, MEMORY); SAVE and BROWSE STORED MEMORIES are full-width pills; clicking the backdrop slides it out. (BROWSE button is wired in Task 7 — clicking it may do nothing yet; that's expected until App.tsx passes `onOpenMemories`.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx
git commit -m "feat: settings as right-edge drawer with grouped sections"
```

---

## Task 6: Backend memory events (types + db + handlers)

**Files:**
- Modify: `src/backend/types.ts`
- Modify: `src/backend/memory/db.ts`
- Modify: `src/backend/index.ts`
- Test: `tests/backend/memory/db.test.ts`

- [ ] **Step 1: Add the MemoryEntry type and event variants**

In `src/backend/types.ts`, after the `ModelUsage` interface (line 27), add:

```ts
export interface MemoryEntry { id: number; text: string; createdAt: number }
```

In the `BackendEvent` union (after line 72, the `toggle_text` variant), add:

```ts
  | { type: 'memories'; memories: MemoryEntry[] }
```

In the `RendererEvent` union (after line 86, the `event_create` variant), add:

```ts
  | { type: 'get_memories' }
  | { type: 'delete_memory'; id: number }
```

- [ ] **Step 2: Write the failing test for deleteMemory and id/createdAt fields**

In `tests/backend/memory/db.test.ts`, add inside the first `describe('database', ...)` block (after the existing "can insert and retrieve a memory" test, around line 39):

```ts
  it('returns id and timestamp from getAllMemories', async () => {
    const { initDb, insertMemory, getAllMemories } = await import('../../../src/backend/memory/db')
    initDb()
    insertMemory('Likes espresso', new Float32Array([0.1, 0.2, 0.3]))
    const rows = getAllMemories()
    expect(rows[0].id).toBeGreaterThan(0)
    expect(rows[0].timestamp).toBeGreaterThan(0)
  })

  it('deleteMemory removes a memory by id', async () => {
    const { initDb, insertMemory, getAllMemories, deleteMemory } = await import('../../../src/backend/memory/db')
    initDb()
    insertMemory('First fact', new Float32Array([0.1, 0.2, 0.3]))
    insertMemory('Second fact', new Float32Array([0.4, 0.5, 0.6]))
    const before = getAllMemories()
    expect(before).toHaveLength(2)
    deleteMemory(before[0].id)
    const after = getAllMemories()
    expect(after).toHaveLength(1)
    expect(after[0].text).toBe('Second fact')
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/backend/memory/db.test.ts`
Expected: FAIL — `deleteMemory` is not exported, and `rows[0].timestamp` is undefined.

- [ ] **Step 4: Add `timestamp` to getAllMemories and a `deleteMemory` function**

In `src/backend/memory/db.ts`, replace `getAllMemories` (lines 257-265) with a version that also selects `timestamp`:

```ts
export function getAllMemories(): Array<{ id: number; text: string; timestamp: number; embedding: Float32Array }> {
  if (!dbAvailable) return []
  const rows = getDb().prepare('SELECT id, text, timestamp, embedding FROM memories ORDER BY timestamp DESC').all() as Array<{ id: number; text: string; timestamp: number; embedding: Buffer }>
  return rows.map(r => ({
    id: r.id,
    text: r.text,
    timestamp: r.timestamp,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4),
  }))
}

export function deleteMemory(id: number): void {
  if (!dbAvailable) return
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
}
```

Note: the existing semantic-search consumer at `index.ts:555` only reads `.text` and `.embedding`, so adding `timestamp` and reordering by time is safe.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/backend/memory/db.test.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 6: Handle the new events in the backend dispatcher**

In `src/backend/index.ts`, update the import on line 140 to add `deleteMemory`:

```ts
import { initDb, closeDb, isDbAvailable, getDbError, getUsageDaily, getUsageByModel, getAllMemories, insertMemory, deleteMemory } from './memory/db'
```

In `handleRendererEvent`, before the final `eventHandlers.forEach(...)` line (line 397), add:

```ts
  if (event.type === 'get_memories') {
    try {
      const mems = getAllMemories().map(m => ({ id: m.id, text: m.text, createdAt: m.timestamp }))
      broadcast({ type: 'memories', memories: mems })
    } catch (err) {
      broadcast({ type: 'error', message: String(err) })
    }
    return
  }
  if (event.type === 'delete_memory') {
    try {
      deleteMemory(event.id)
      const mems = getAllMemories().map(m => ({ id: m.id, text: m.text, createdAt: m.timestamp }))
      broadcast({ type: 'memories', memories: mems })
    } catch (err) {
      broadcast({ type: 'error', message: String(err) })
    }
    return
  }
```

- [ ] **Step 7: Rebuild the backend and run the full suite**

Run: `npm run build:backend && npx vitest run`
Expected: Backend bundle rebuilds; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/backend/types.ts src/backend/memory/db.ts src/backend/index.ts tests/backend/memory/db.test.ts
git commit -m "feat: backend get_memories/delete_memory events"
```

---

## Task 7: Memory browser drawer + state wiring **[frontend-design]**

**Files:**
- Create: `src/renderer/src/components/MemoryBrowser.tsx`
- Modify: `src/renderer/src/hooks/useAnimState.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add memoriesOpen + memories to state**

In `src/renderer/src/hooks/useAnimState.ts`:

Add the import at the top (extend line 2) so `MemoryEntry` is available:

```ts
import type { AnimState, BackendEvent, AgentInfo, Settings, UsagePoint, ModelUsage, EmailDraft, EmailMessage, CalendarEventDraft, MemoryEntry } from '../../../backend/types'
```

Add two fields to the `JarvisState` interface (after `textVisible: boolean`, line 36):

```ts
  memoriesOpen: boolean
  memories: MemoryEntry[]
```

Add their initial values to `initial` (after `textVisible: true`, line 59):

```ts
  memoriesOpen: false,
  memories: [],
```

Handle the `memories` event — in the `switch` inside `handleEvent`, before `default:` (line 117), add:

```ts
        case 'memories':
          return { ...prev, memories: event.memories }
```

Add a toggle handler near the other `useCallback`s (after `toggleTextVisible`, line 130):

```ts
  const toggleMemories = useCallback(() => setState(prev => ({ ...prev, memoriesOpen: !prev.memoriesOpen })), [])
```

Add `toggleMemories` to the returned object literal (line 132).

**Fix the stale return-type annotation:** The current explicit return type (lines 62-68) declares only 5 of the 12 handlers actually returned — it builds today only because Vite/esbuild transpiles without type-checking. Remove the explicit return-type annotation entirely so TypeScript infers the full, correct shape. Change the signature from:

```ts
export function useAnimState(): {
  state: JarvisState
  handleEvent: (event: BackendEvent) => void
  toggleDashboard: () => void
  toggleSettings: () => void
  clearError: () => void
} {
```

to:

```ts
export function useAnimState() {
```

This exposes `toggleMemories` (and every other returned handler) to consumers with no further annotation upkeep.

- [ ] **Step 2: Create the MemoryBrowser component**

Create `src/renderer/src/components/MemoryBrowser.tsx`:

```tsx
import { useState } from 'react'
import type { MemoryEntry } from '../../../backend/types'

interface Props {
  open: boolean
  memories: MemoryEntry[]
  onClose: () => void
  onDelete: (id: number) => void
}

const DRAWER_W = 360

export function MemoryBrowser({ open, memories, onClose, onDelete }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? memories.filter(m => m.text.toLowerCase().includes(query.toLowerCase()))
    : memories

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, background: 'rgba(200,220,240,0.25)', backdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.25s', zIndex: 131,
        }}
      />
      <div
        className="no-drag"
        style={{
          position: 'absolute', top: 0, right: 0, height: '100vh', width: DRAWER_W,
          background: 'rgba(255,255,255,0.96)', borderLeft: '1px solid rgba(3,105,161,0.15)',
          backdropFilter: 'blur(20px)', boxShadow: '-8px 0 40px rgba(3,80,140,0.12)',
          padding: 24, zIndex: 132, overflowY: 'auto', fontFamily: 'var(--font-hud)', color: 'var(--text)',
          transform: open ? 'translateX(0)' : `translateX(${DRAWER_W}px)`, transition: 'transform 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.18em' }}>MEMORIES</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="search memories…"
          style={{
            width: '100%', background: 'rgba(3,105,161,0.05)', border: '1px solid rgba(3,105,161,0.18)',
            borderRadius: 6, color: '#0a2540', padding: '8px 10px', fontFamily: 'var(--font-mono)',
            fontSize: 12, marginBottom: 16, outline: 'none',
          }}
        />

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.15em', marginTop: 40 }}>
            {memories.length === 0 ? 'NO MEMORIES STORED' : 'NO MATCHES'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(m => (
              <div key={m.id} style={{
                background: 'rgba(3,105,161,0.04)', border: '1px solid rgba(3,105,161,0.12)',
                borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: '#1a4060', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {m.text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>
                    {new Date(m.createdAt).toLocaleDateString()}
                  </span>
                  <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => onDelete(m.id)}>
                    DELETE
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Wire MemoryBrowser into App.tsx**

In `src/renderer/src/App.tsx`:

Add the import (after the SettingsPanel import, line 13):

```tsx
import { MemoryBrowser } from './components/MemoryBrowser'
```

Destructure `toggleMemories` from `useAnimState()` (line 22) — add it to the destructuring list.

After the existing settings effect (lines 72-74), add an effect to fetch memories when the browser opens:

```tsx
  useEffect(() => {
    if (state.memoriesOpen) send({ type: 'get_memories' })
  }, [state.memoriesOpen, send])
```

Pass `onOpenMemories` to `<SettingsPanel>` (in the JSX around line 174) — add the prop:

```tsx
        onOpenMemories={() => { toggleSettings(); toggleMemories() }}
```

Render the MemoryBrowser before the closing `</div>` (after `<SettingsPanel ... />`, line 180):

```tsx
      <MemoryBrowser
        open={state.memoriesOpen}
        memories={state.memories}
        onClose={toggleMemories}
        onDelete={(id) => send({ type: 'delete_memory', id })}
      />
```

- [ ] **Step 4: Verify visually**

Run: `npm run build:backend && npm run dev`. Open Settings → BROWSE STORED MEMORIES.
Expected: Settings drawer closes, Memories drawer slides in showing stored memories (or NO MEMORIES STORED). Typing in search filters live. DELETE removes a memory and the list refreshes. (To seed a memory, tell Jarvis "remember that I like espresso" first.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MemoryBrowser.tsx src/renderer/src/hooks/useAnimState.ts src/renderer/src/App.tsx
git commit -m "feat: memory browser drawer with live search and delete"
```

---

## Task 8: Redesigned agent cards **[frontend-design]**

**Files:**
- Rewrite: `src/renderer/src/components/AgentCards.tsx`

- [ ] **Step 1: Rewrite AgentCards with explicit expand button, done state, copy + dismiss**

Replace the entire contents of `src/renderer/src/components/AgentCards.tsx` with:

```tsx
import { useState } from 'react'
import type { AgentInfo } from '../../../backend/types'

interface Props {
  agents: AgentInfo[]
  onClose: (id: string) => void
}

const STATUS_COLOR: Record<AgentInfo['status'], string> = {
  running: '#0369a1',
  done: '#16a34a',
  error: '#dc2626',
}

export function AgentCards({ agents, onClose }: Props): JSX.Element | null {
  if (agents.length === 0) return null
  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 12,
        zIndex: 90, maxWidth: '70vw', overflowX: 'auto',
      }}
    >
      {agents.map(a => <AgentCard key={a.id} agent={a} onClose={onClose} />)}
    </div>
  )
}

function AgentCard({ agent, onClose }: { agent: AgentInfo; onClose: (id: string) => void }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const last = agent.actions[agent.actions.length - 1] ?? 'Starting…'
  const color = STATUS_COLOR[agent.status]
  const done = agent.status === 'done'

  const copy = (): void => {
    if (agent.result) {
      void navigator.clipboard.writeText(agent.result)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div style={{
      width: 280, flex: '0 0 auto', background: 'rgba(255,255,255,0.9)',
      border: `1px solid ${color}55`, borderRadius: 10, padding: 14,
      fontFamily: 'var(--font-hud)', color: 'var(--accent)',
      backdropFilter: 'blur(10px)', boxShadow: '0 4px 16px rgba(3,80,140,0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0a2540' }}>{agent.name}</span>
        <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 8, color }}>●</span>
          <span style={{ fontSize: 9, color, letterSpacing: '0.1em' }}>{agent.status.toUpperCase()}</span>
        </span>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mid)', marginBottom: 10 }}>
        {agent.task}
      </div>

      {done && agent.result && (
        <div style={{
          background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 6,
          padding: 8, marginBottom: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#14532d',
          maxHeight: 120, overflowY: 'auto', wordBreak: 'break-word',
        }}>
          {agent.result}
        </div>
      )}

      {!done && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 10 }}>
          {expanded
            ? agent.actions.map((act, i) => <div key={i} style={{ marginBottom: 4 }}>› {act}</div>)
            : <div>› {last}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {!done && agent.actions.length > 1 && (
          <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => setExpanded(e => !e)}>
            {expanded ? '▴ LOG' : '▾ LOG'}
          </button>
        )}
        {done && agent.result && (
          <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={copy}>
            {copied ? 'COPIED' : 'COPY'}
          </button>
        )}
        <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => onClose(agent.id)}>
          {done ? 'DISMISS' : '✕'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify visually**

Run: `npm run dev`, ask Jarvis to spawn a subagent (e.g. "research X and report back").
Expected: Running card shows a pulsing-color status dot, last action, a `▾ LOG` pill (once >1 action) that expands inline, and an `✕` pill. On completion: green `● DONE`, the result in a green box, `COPY` (→ COPIED) and `DISMISS` pills. DISMISS removes the card.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AgentCards.tsx
git commit -m "feat: redesign agent cards with explicit log toggle, done state, copy/dismiss"
```

---

## Task 9: Full action-log modal **[frontend-design]**

**Files:**
- Create: `src/renderer/src/components/AgentLogModal.tsx`
- Modify: `src/renderer/src/components/AgentCards.tsx`

This gives done agents a way to review the complete action log (the inline log is hidden once done).

- [ ] **Step 1: Create AgentLogModal**

Create `src/renderer/src/components/AgentLogModal.tsx`:

```tsx
import type { AgentInfo } from '../../../backend/types'

interface Props {
  agent: AgentInfo
  onClose: () => void
}

export function AgentLogModal({ agent, onClose }: Props): JSX.Element {
  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(200,220,240,0.3)', backdropFilter: 'blur(3px)', zIndex: 139 }} />
      <div
        className="no-drag"
        style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(560px, 84vw)', maxHeight: '70vh', overflowY: 'auto',
          background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(3,105,161,0.18)', borderRadius: 12,
          padding: 24, zIndex: 140, fontFamily: 'var(--font-hud)', color: 'var(--text)',
          backdropFilter: 'blur(20px)', boxShadow: '0 8px 40px rgba(3,80,140,0.16)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em' }}>{agent.name} · LOG</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: '#1a4060', lineHeight: 1.6 }}>
          {agent.actions.length === 0
            ? <div style={{ color: 'var(--text-dim)' }}>No actions recorded.</div>
            : agent.actions.map((act, i) => <div key={i} style={{ marginBottom: 6 }}>› {act}</div>)}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Open the modal from a done card's LOG button**

In `src/renderer/src/components/AgentCards.tsx`:

Add the import at the top:

```tsx
import { AgentLogModal } from './AgentLogModal'
```

Add a `logOpen` state inside `AgentCard` (next to `expanded`):

```tsx
  const [logOpen, setLogOpen] = useState(false)
```

In the button row, add a `LOG` pill for done agents (before the COPY button), and render the modal. Add this `LOG` button inside the `done && ...` area — replace the `{done && agent.result && (` COPY block with a fragment that includes both a LOG button and the COPY button:

```tsx
        {done && (
          <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={() => setLogOpen(true)}>
            ▾ LOG
          </button>
        )}
        {done && agent.result && (
          <button className="pill-btn" style={{ fontSize: 9, padding: '3px 10px' }} onClick={copy}>
            {copied ? 'COPIED' : 'COPY'}
          </button>
        )}
```

At the end of the card's outer `<div>` (just before its closing `</div>`), render the modal:

```tsx
      {logOpen && <AgentLogModal agent={agent} onClose={() => setLogOpen(false)} />}
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`, spawn a subagent and wait for it to finish.
Expected: The done card shows a `▾ LOG` pill; clicking it opens a centered modal with the full scrollable action log; clicking the backdrop or ✕ closes it.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AgentLogModal.tsx src/renderer/src/components/AgentCards.tsx
git commit -m "feat: full action-log modal for completed agents"
```

---

## Task 10: Agent completion toast **[frontend-design]**

**Files:**
- Create: `src/renderer/src/components/CompletionToast.tsx`
- Modify: `src/renderer/src/hooks/useAnimState.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add a toasts array + push/expire logic in useAnimState**

In `src/renderer/src/hooks/useAnimState.ts`:

Add a `Toast` interface near `ConversationTurn` (after line 14):

```ts
export interface Toast { id: number; text: string }
```

Add to `JarvisState` (after the `memories` field added in Task 7):

```ts
  toasts: Toast[]
```

Add to `initial`:

```ts
  toasts: [],
```

In the `agent_done` case (currently line 101-102), also push a toast. Replace that case with:

```ts
        case 'agent_done': {
          const agent = prev.agents.find(a => a.id === event.id)
          const toast: Toast = { id: Date.now() + Math.random(), text: `Agent complete: ${agent?.name ?? 'subagent'}` }
          return {
            ...prev,
            agents: prev.agents.map(a => a.id === event.id ? { ...a, status: 'done', result: event.result } : a),
            toasts: [...prev.toasts, toast],
          }
        }
```

Add a `dismissToast` handler (near the other callbacks):

```ts
  const dismissToast = useCallback((id: number) => setState(prev => ({ ...prev, toasts: prev.toasts.filter(t => t.id !== id) })), [])
```

Add `dismissToast` to the returned object literal. (No type-annotation change needed — Task 7 removed the explicit return type, so the inferred shape picks this up automatically.)

- [ ] **Step 2: Create the CompletionToast component**

Create `src/renderer/src/components/CompletionToast.tsx`:

```tsx
import { useEffect } from 'react'
import type { Toast } from '../hooks/useAnimState'

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function CompletionToast({ toasts, onDismiss }: Props): JSX.Element | null {
  useEffect(() => {
    const timers = toasts.map(t => setTimeout(() => onDismiss(t.id), 4000))
    return () => { timers.forEach(clearTimeout) }
  }, [toasts, onDismiss])

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'absolute', top: 88, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200, alignItems: 'center',
    }}>
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className="bubble-in no-drag"
          style={{
            background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.35)', borderRadius: 20,
            padding: '6px 16px', fontFamily: 'var(--font-hud)', fontSize: 10, letterSpacing: '0.1em',
            color: '#14532d', cursor: 'pointer', backdropFilter: 'blur(8px)',
            boxShadow: '0 2px 12px rgba(22,163,74,0.15)',
          }}
        >
          ● {t.text}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Render CompletionToast in App.tsx**

In `src/renderer/src/App.tsx`:

Add the import (after the CompletionToast-adjacent imports, e.g. after MemoryBrowser import):

```tsx
import { CompletionToast } from './components/CompletionToast'
```

Destructure `dismissToast` from `useAnimState()`.

Render near the top of the returned JSX (after `<ErrorToast ... />`, line 97):

```tsx
      <CompletionToast toasts={state.toasts} onDismiss={dismissToast} />
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`, spawn a subagent and wait for completion.
Expected: A green pill toast slides in at top-center ("Agent complete: {name}"), auto-dismisses after 4s, and dismisses immediately on click.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CompletionToast.tsx src/renderer/src/hooks/useAnimState.ts src/renderer/src/App.tsx
git commit -m "feat: agent completion toast notifications"
```

---

## Task 11: Voice waveform — real amplitude drives the particle ring

**Files:**
- Create: `src/renderer/src/lib/rms.ts`
- Create: `tests/renderer/rms.test.ts`
- Modify: `src/renderer/src/components/ParticleRing.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing test for the RMS helper**

Create `tests/renderer/rms.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rmsFromBytes } from '../../src/renderer/src/lib/rms'

describe('rmsFromBytes', () => {
  it('returns 0 for perfect silence (all 128)', () => {
    const bytes = new Uint8Array(64).fill(128)
    expect(rmsFromBytes(bytes)).toBeCloseTo(0, 5)
  })

  it('returns ~1 for full-scale square wave (alternating 0 and 255)', () => {
    const bytes = new Uint8Array(64)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 2 === 0 ? 255 : 0
    expect(rmsFromBytes(bytes)).toBeGreaterThan(0.95)
  })

  it('clamps output to the 0..1 range', () => {
    const bytes = new Uint8Array(8).fill(0)
    const v = rmsFromBytes(bytes)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/renderer/rms.test.ts`
Expected: FAIL — module `src/renderer/src/lib/rms.ts` does not exist.

- [ ] **Step 3: Create the RMS helper**

Create `src/renderer/src/lib/rms.ts`:

```ts
/**
 * Compute a normalized 0..1 loudness value from a byte time-domain buffer
 * (as produced by AnalyserNode.getByteTimeDomainData, where 128 = silence).
 */
export function rmsFromBytes(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  let sum = 0
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128 // -1..1
    sum += v * v
  }
  const rms = Math.sqrt(sum / bytes.length)
  return Math.max(0, Math.min(1, rms))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/renderer/rms.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add an `amplitude` prop to ParticleRing**

In `src/renderer/src/components/ParticleRing.tsx`:

Extend the `Props` interface (lines 133-135):

```tsx
interface Props {
  state: AnimState
  amplitude?: number
}
```

Add an amplitude ref alongside `stateRef` (after line 140):

```tsx
export function ParticleRing({ state, amplitude = 0 }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<AnimState>(state)
  stateRef.current = state
  const ampRef = useRef<number>(amplitude)
  ampRef.current = amplitude
```

In the animate loop, scale the listening and speaking wave magnitudes by amplitude. Replace the `listenPull` line (line 268) and `speakPush` line (line 272) with amplitude-scaled versions:

```tsx
        // amp: 0 → slow ambient pulse (0.3), 1 → full reactive pulse (1.0)
        const amp = 0.3 + ampRef.current * 0.7
        const listenPull = -(lw > 0 ? lw * lw : 0) * thickness * 1.05 * cur.listenWave * amp
```

```tsx
        const speakPush = (sw > 0 ? sw : sw * 0.3) * thickness * 1.1 * cur.speakWave * amp
```

(The `amp` const is computed once per particle from `ampRef.current`; declare it just before `listenPull`.)

- [ ] **Step 6: Sample mic + TTS amplitude in App.tsx**

In `src/renderer/src/App.tsx`:

Add the import:

```tsx
import { rmsFromBytes } from './lib/rms'
```

Add amplitude state near the other `useState` hooks (after line 50):

```tsx
  const [amplitude, setAmplitude] = useState(0)
```

Add a mic-sampling effect that runs on PTT. Replace the existing PTT effect (lines 55-62) with one that also drives an analyser:

```tsx
  useEffect(() => {
    let ctx: AudioContext | null = null
    let raf = 0
    let stream: MediaStream | null = null

    const startMeter = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser)
        const buf = new Uint8Array(analyser.fftSize)
        const tick = (): void => {
          analyser.getByteTimeDomainData(buf)
          setAmplitude(rmsFromBytes(buf))
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (err) {
        console.error('[meter] mic meter error:', err)
      }
    }

    const stopMeter = (): void => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
      void ctx?.close()
      ctx = null; stream = null
      setAmplitude(0)
    }

    ;(window as any).jarvis.onPttStart(() => { void startMeter() })
    ;(window as any).jarvis.onPttStop(() => { stopMeter() })

    return () => { stopMeter() }
  }, [])
```

For TTS amplitude, hook the analyser to the playback `Audio` in the `onEvent` audio block. Replace the audio-playback block (lines 27-43) with one that meters playback:

```tsx
    if (event.type === 'audio') {
      const audioData = event.data as unknown as ArrayBuffer
      const blob = new Blob([audioData], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      handleEvent({ type: 'state', state: 'speaking' })

      let ctx: AudioContext | null = null
      let raf = 0
      try {
        ctx = new AudioContext()
        const src = ctx.createMediaElementSource(audio)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser)
        analyser.connect(ctx.destination)
        const buf = new Uint8Array(analyser.fftSize)
        const tick = (): void => {
          analyser.getByteTimeDomainData(buf)
          setAmplitude(rmsFromBytes(buf))
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (err) {
        console.error('[meter] tts meter error:', err)
      }

      const cleanup = (): void => {
        cancelAnimationFrame(raf)
        void ctx?.close()
        setAmplitude(0)
      }
      audio.onended = () => {
        URL.revokeObjectURL(url)
        cleanup()
        handleEvent({ type: 'state', state: 'idle' })
      }
      audio.play().catch(err => {
        console.error('[audio] playback error:', err)
        cleanup()
        handleEvent({ type: 'state', state: 'idle' })
      })
    }
```

Pass `amplitude` to `<ParticleRing>` (line 82):

```tsx
      <ParticleRing state={state.anim} amplitude={amplitude} />
```

- [ ] **Step 7: Run the full suite + verify visually**

Run: `npx vitest run`
Expected: All tests pass.

Run: `npm run dev`. Hold the PTT key and speak; then let Jarvis respond.
Expected: While speaking into the mic, the ring's inward pulse tracks your voice volume (silent = gentle drift, loud = strong pulse). During Jarvis's TTS reply, the outward wave tracks the speech audio.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lib/rms.ts tests/renderer/rms.test.ts src/renderer/src/components/ParticleRing.tsx src/renderer/src/App.tsx
git commit -m "feat: real mic/TTS amplitude drives particle ring reaction"
```

---

## Self-Review Notes

**Spec coverage:**
- §1.1 chat scroll → Task 2 ✓
- §1.2 subagent card UX (expand button, done state, copy/dismiss) → Task 8 ✓
- §2.1 typography → Task 1 ✓
- §2.2 pill buttons → Tasks 1 (base style) + 3, 4, 5, 7, 8 (applied) ✓
- §2.3 settings drawer → Task 5 ✓
- §2.4 HUD cleanup (dot status, wordmark) → Task 3 ✓
- §3.1 memory browser → Tasks 6 (backend) + 7 (frontend) ✓
- §3.2 better agent cards + toast + log modal → Tasks 8, 9, 10 ✓
- §3.3 voice waveform → Task 11 ✓

**Type consistency:** `MemoryEntry { id, text, createdAt }` defined in Task 6 (types.ts), consumed in Tasks 6 (backend maps `timestamp`→`createdAt`), 7 (MemoryBrowser), and useAnimState. `Toast { id, text }` defined in useAnimState (Task 10), consumed by CompletionToast. `deleteMemory(id: number)` consistent across db.ts, index.ts, and the `delete_memory` event. `rmsFromBytes(bytes: Uint8Array): number` consistent across rms.ts, test, and App.tsx.

**Known implementation caveat (flag for executor):** In Task 11, `createMediaElementSource` must be created from a fresh `AudioContext` per playback (done here) — reusing one context across plays throws "HTMLMediaElement already connected". The per-event `ctx` closure handles this.

**Placeholder scan:** No TBD/TODO/"handle errors appropriately" — all steps contain concrete code.
