# Track 2: Visual Context Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add screenshot hotkey, drag-and-drop image zone, and a report renderer panel. All three share one vision pipeline: images route to Claude regardless of provider setting.

**Architecture:** New `tools/vision.ts` handles the `jarvis_screenshot` tool. `types.ts` gains `image_attach` RendererEvent and `report` BackendEvent. `claude.ts` accepts an optional `imageBase64` param and builds a vision content block. The report renderer is a new `ReportPanel.tsx` drawer that renders HTML/Markdown from a `[REPORT: ...]` response tag. The main process registers the screenshot hotkey via `desktopCapturer`.

**Tech Stack:** Electron `desktopCapturer`, Web Audio API, `marked` npm package (Markdown rendering), TypeScript, Vitest

**Prerequisites:** Track 1 must be merged first (clean tool dispatch foundation).

---

## Task 1: Update types for image and report events

**Files:**
- Modify: `src/backend/types.ts`

- [ ] **Step 1: Add new event types and settings fields**

In `src/backend/types.ts`, make these additions:

1. Add `screenshotHotkey` to `Settings`:

```ts
export interface Settings {
  hotkey: string
  voiceId: string
  llmProvider: LlmProvider
  modelPreference: 'auto' | 'fable' | 'haiku'
  shortTurns: number
  ollamaModel: string
  ollamaBaseUrl: string
  userProfile: string
  screenshotHotkey: string  // ← add this
}
```

2. Add `report` to `BackendEvent` union (after the `memories` entry):

```ts
| { type: 'report'; format: 'html' | 'md'; content: string }
```

3. Add `image_attach` to `RendererEvent` union (after `delete_memory`):

```ts
| { type: 'image_attach'; imageBase64: string; mimeType: string }
```

- [ ] **Step 2: Run tests to confirm types compile**

```
npm test
```

Expected: All tests PASS (type-only change, no logic change).

- [ ] **Step 3: Commit**

```
git add src/backend/types.ts
git commit -m "feat(types): add image_attach RendererEvent, report BackendEvent, screenshotHotkey setting"
```

---

## Task 2: Update settings defaults

**Files:**
- Modify: `src/backend/memory/settings.ts`

- [ ] **Step 1: Read the settings module**

Read `src/backend/memory/settings.ts` to find the defaults object.

- [ ] **Step 2: Add `screenshotHotkey` default**

In the defaults object (wherever the other hotkey default is), add:

```ts
screenshotHotkey: 'Alt+Shift+S',
```

Ensure the `Settings` type is satisfied — TypeScript will error if `screenshotHotkey` is missing from the defaults.

- [ ] **Step 3: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add src/backend/memory/settings.ts
git commit -m "feat: default screenshotHotkey setting (Alt+Shift+S)"
```

---

## Task 3: Update `claude.ts` to accept vision input

**Files:**
- Modify: `src/backend/claude.ts`

- [ ] **Step 1: Read claude.ts to understand the chat function signature**

Read `src/backend/claude.ts` (full file).

- [ ] **Step 2: Add `imageBase64` param to the `chat` function**

Find the `chat` function signature and add the optional parameter:

```ts
export async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
  imageBase64?: string,
): Promise<ChatResult> {
```

- [ ] **Step 3: Build the user message as a content array when image is present**

Inside `chat`, find where the messages array is built for the first user turn. Replace the plain string user message with a conditional:

```ts
const userContent: Anthropic.Messages.ContentBlockParam[] = imageBase64
  ? [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
      },
      { type: 'text', text: userText },
    ]
  : [{ type: 'text', text: userText }]
```

Then pass `userContent` as the `content` field for the user message instead of the plain string.

Note: `Anthropic.Messages.ContentBlockParam` is the correct SDK type. If the existing code passes `string` directly, change it to use `userContent`. The SDK accepts both `string` and `ContentBlockParam[]` for `content`.

- [ ] **Step 4: Log when vision mode is active**

After the `imageBase64` conditional, add:

```ts
if (imageBase64) {
  console.error('[claude] vision turn — image attached')
}
```

- [ ] **Step 5: Run tests**

```
npm test
```

Expected: All tests PASS (existing tests pass `undefined` for the new param implicitly).

- [ ] **Step 6: Commit**

```
git add src/backend/claude.ts
git commit -m "feat(claude): accept optional imageBase64 for vision turns"
```

---

## Task 4: Create `tools/vision.ts`

**Files:**
- Create: `src/backend/tools/vision.ts`

- [ ] **Step 1: Create the vision tool module**

Create `src/backend/tools/vision.ts`:

```ts
import { emitEvent } from '../events'

export const visionToolDefs = [
  {
    name: 'jarvis_screenshot',
    description:
      'Capture a screenshot of the current screen and analyze it visually. Use when the user asks "what am I looking at?", "what\'s on my screen?", "explain this error", "describe what I\'m working on", or any question requiring visual context. This triggers a screenshot and routes the next response through Claude vision.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description: 'What to look for or ask about in the screenshot (default: "Describe what is on the screen")',
        },
      },
      required: [],
    },
  },
]

export async function handleVisionTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name !== 'jarvis_screenshot') throw new Error(`Unknown vision tool: ${name}`)

  const prompt = String(input.prompt ?? 'Describe what is on the screen')
  emitEvent({ type: 'screenshot_request', prompt })
  return `Screenshot requested. Analyzing screen with prompt: "${prompt}"`
}
```

Also add `screenshot_request` to `BackendEvent` in `types.ts`:

```ts
| { type: 'screenshot_request'; prompt: string }
```

- [ ] **Step 2: Register in `tools/index.ts`**

In `src/backend/tools/index.ts`:

Add import at the top:
```ts
import { visionToolDefs, handleVisionTool } from './vision'
```

Add to `getTools()`:
```ts
...visionToolDefs,
```

Add to `getToolsForGroq()`:
```ts
...visionToolDefs,
```

Add to `getToolsForAgent()`:
```ts
...visionToolDefs,
```

Add to `handleTool` dispatch:
```ts
else if (name.startsWith('jarvis_screenshot')) result = await handleVisionTool(name, input)
```

(Place this before the `jarvis_` catch-all if `jarvis_screenshot` uses the `jarvis_` prefix — or use `name === 'jarvis_screenshot'` for precision.)

Also update the `jarvis_` prefix handler to not accidentally catch `jarvis_screenshot` — replace:

```ts
else if (name.startsWith('jarvis_'))    result = await handleJarvisTool(name, input)
```

with:

```ts
else if (name === 'jarvis_screenshot')  result = await handleVisionTool(name, input)
else if (name.startsWith('jarvis_'))    result = await handleJarvisTool(name, input)
```

- [ ] **Step 3: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add src/backend/tools/vision.ts src/backend/tools/index.ts src/backend/types.ts
git commit -m "feat: jarvis_screenshot tool — triggers screen capture via IPC"
```

---

## Task 5: Add `[REPORT:]` tag to `responseTags.ts`

**Files:**
- Modify: `src/backend/responseTags.ts`

- [ ] **Step 1: Add REPORT tag parsing**

In `src/backend/responseTags.ts`, add:

```ts
const REPORT_TAG_RE = /\[REPORT:\s*(html|md)\|([^\]]+)\]/i
```

Update `TAG_START_RE` to include `REPORT`:

```ts
const TAG_START_RE = /\[(PERSON|PLACE|PROJECT|ORG|REMEMBER|REPORT):/i
```

Update the return type of `stripResponseTags` to include the report fields:

```ts
export function stripResponseTags(raw: string): {
  text: string
  pendingMemory: string | null
  pendingEntities: PendingEntity[]
  pendingReport: { format: 'html' | 'md'; content: string } | null
}
```

Inside `stripResponseTags`, add report extraction after the REMEMBER block:

```ts
let pendingReport: { format: 'html' | 'md'; content: string } | null = null
const reportMatch = text.match(REPORT_TAG_RE)
if (reportMatch) {
  pendingReport = {
    format: reportMatch[1].toLowerCase() as 'html' | 'md',
    content: reportMatch[2].trim(),
  }
  text = text.replace(reportMatch[0], '').trim()
}
```

Return `pendingReport` in the return object:

```ts
return { text, pendingMemory, pendingEntities, pendingReport }
```

- [ ] **Step 2: Update callers of `stripResponseTags` in `index.ts`**

In `src/backend/index.ts`, find the two calls to `stripResponseTags` (groq.ts has one, index.ts has one). The `groq.ts` and `claude.ts` calls return `ChatResult` which doesn't currently include `pendingReport` — those callers are in the provider files and only destructure `{ text, pendingMemory, pendingEntities }`. They don't need changes since they don't emit report events.

In `index.ts` `runConversation`, the call at line 675 is:
```ts
const cleaned = stripResponseTags(text)
```

Update to handle reports:

```ts
const cleaned = stripResponseTags(text)
if (cleaned.pendingReport) {
  broadcast({ type: 'report', format: cleaned.pendingReport.format, content: cleaned.pendingReport.content })
}
```

- [ ] **Step 3: Add tests for `[REPORT:]` tag**

In `tests/backend/responseTags.test.ts`, add inside `describe('stripResponseTags', ...)`:

```ts
it('strips [REPORT: html|...] and returns pendingReport', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const content = '<h1>Summary</h1><p>Today news.</p>'
  const result = stripResponseTags(`Here is your report. [REPORT: html|${content}]`)
  expect(result.text).toBe('Here is your report.')
  expect(result.pendingReport).not.toBeNull()
  expect(result.pendingReport!.format).toBe('html')
  expect(result.pendingReport!.content).toBe(content)
})

it('strips [REPORT: md|...] tag', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const result = stripResponseTags('[REPORT: md|# Headline\n- bullet]')
  expect(result.pendingReport!.format).toBe('md')
  expect(result.text).toBe('Noted.')
})

it('returns null pendingReport when no REPORT tag', async () => {
  const { stripResponseTags } = await import('../../src/backend/responseTags')
  const result = stripResponseTags('Hello.')
  expect(result.pendingReport).toBeNull()
})
```

- [ ] **Step 4: Run tests**

```
npx vitest run tests/backend/responseTags.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
git add src/backend/responseTags.ts src/backend/index.ts tests/backend/responseTags.test.ts
git commit -m "feat: [REPORT:] response tag — emits report event to renderer"
```

---

## Task 6: Handle `image_attach` and vision routing in `index.ts`

**Files:**
- Modify: `src/backend/index.ts`

- [ ] **Step 1: Add `imageBase64` to the pending state and conversation pipeline**

In `src/backend/index.ts`:

1. Add a module-level variable to hold the pending attached image:

```ts
let pendingImage: { imageBase64: string; mimeType: string } | null = null
```

2. In `handleRendererEvent`, add a handler for `image_attach` (add after the `delete_memory` handler):

```ts
if (event.type === 'image_attach') {
  pendingImage = { imageBase64: event.imageBase64, mimeType: event.mimeType }
  broadcast({ type: 'transcript', role: 'assistant', text: 'Image attached — ask me anything about it.', partial: false })
  return
}
```

3. In `runConversation`, consume `pendingImage` before calling `chat()`:

```ts
const attachedImage = pendingImage
pendingImage = null  // consume immediately

// Vision turns always route to Claude (Groq/Ollama have no vision)
const useVision = !!attachedImage?.imageBase64
if (useVision) {
  console.error('[pipeline] vision turn — forced Claude')
}
```

4. Pass `attachedImage?.imageBase64` to the Claude path. Update the `chat()` call:

In the `chat` function (index.ts line ~97 equivalent), the `claudeWithGroqFallback` helper calls `chatClaude`. Update `runConversation` to bypass the normal routing when vision is present:

Find the `const { text, model, inputTokens, outputTokens, pendingMemory, pendingEntities } = await chat(...)` call and replace with:

```ts
const chatFn = useVision && isChatAvailable()
  ? (t: string, h: Message[], m: string[], b: typeof broadcast) =>
      chatClaude(t, h, m, b, attachedImage!.imageBase64)
  : (t: string, h: Message[], m: string[], b: typeof broadcast) => chat(t, h, m, b)

const { text, model, inputTokens, outputTokens, pendingMemory, pendingEntities } = await chatFn(
  userText, conversationHistory, topMems, broadcast,
)
```

Note: `chatClaude` is imported as `chat as chatClaude` from `./claude` — its new signature is `chat(userText, history, memories, broadcast, imageBase64?)`.

- [ ] **Step 2: Handle `screenshot_request` backend event in the main process**

This step is implemented in Task 7 (main process). The backend emits `screenshot_request`; the main process captures the screenshot and sends it back as `image_attach`.

- [ ] **Step 3: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add src/backend/index.ts
git commit -m "feat(backend): image_attach event handling and vision routing to Claude"
```

---

## Task 7: Register screenshot hotkey in main process

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Read the main process file**

Read `src/main/index.ts` to understand the existing hotkey registration pattern (Right Alt is registered for PTT).

- [ ] **Step 2: Register the screenshot hotkey and implement capture**

In `src/main/index.ts`, after the existing PTT hotkey registration, add:

```ts
import { desktopCapturer } from 'electron'

// Register screenshot hotkey
const screenshotHotkey = 'Alt+Shift+S' // TODO: read from settings via IPC when settings are loaded

globalShortcut.register(screenshotHotkey, async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    })
    const primary = sources[0]
    if (!primary) return
    const png = primary.thumbnail.toPNG()
    const imageBase64 = png.toString('base64')
    // Send to renderer → renderer forwards to backend as image_attach
    mainWindow?.webContents.send('screenshot-captured', { imageBase64, mimeType: 'image/png' })
    console.log('[main] screenshot captured:', png.length, 'bytes')
  } catch (err) {
    console.error('[main] screenshot error:', err)
  }
})
```

The renderer will receive `screenshot-captured` via IPC and forward it to the backend WebSocket as `image_attach`.

- [ ] **Step 3: Expose `screenshot-captured` in preload**

Read `src/preload/index.ts`. Add the IPC listener bridge:

```ts
contextBridge.exposeInMainWorld('jarvis', {
  // ... existing exposed APIs ...
  onScreenshotCaptured: (cb: (data: { imageBase64: string; mimeType: string }) => void) =>
    ipcRenderer.on('screenshot-captured', (_e, data) => cb(data)),
})
```

- [ ] **Step 4: Run build to verify compilation**

```
npm run build:backend
npx electron-vite build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```
git add src/main/index.ts src/preload/index.ts
git commit -m "feat(main): screenshot hotkey (Alt+Shift+S) via desktopCapturer"
```

---

## Task 8: Add drag-and-drop image zone to renderer

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/hooks/useAnimState.ts`

- [ ] **Step 1: Add `imageAttached` state to `useAnimState`**

In `src/renderer/src/hooks/useAnimState.ts`, add to `JarvisState`:

```ts
imageAttached: boolean
reportContent: { format: 'html' | 'md'; content: string } | null
```

Add to `initial`:

```ts
imageAttached: false,
reportContent: null,
```

In `handleEvent`, add cases:

```ts
case 'report':
  return { ...prev, reportContent: { format: event.format, content: event.content } }
```

Add `clearReport` to the returned actions:

```ts
const clearReport = useCallback(() => {
  setState(prev => ({ ...prev, reportContent: null }))
}, [])
```

Return `clearReport` from `useAnimState`.

- [ ] **Step 2: Update `App.tsx` to handle screenshot IPC and drag-and-drop**

In `src/renderer/src/App.tsx`:

1. Add state for pending image:

```ts
const [pendingImage, setPendingImage] = useState<string | null>(null)
```

2. Add `useEffect` for screenshot IPC:

```ts
useEffect(() => {
  ;(window as any).jarvis.onScreenshotCaptured?.((data: { imageBase64: string; mimeType: string }) => {
    send({ type: 'image_attach', imageBase64: data.imageBase64, mimeType: data.mimeType })
    setPendingImage(data.imageBase64)
  })
}, [send])
```

3. Add drag-and-drop handlers on the root `<div>`:

```tsx
const handleDragOver = (e: React.DragEvent) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

const handleDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault()
  const file = e.dataTransfer.files[0]
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = reader.result as string
    // result is "data:image/png;base64,<data>" — extract the base64 part
    const base64 = result.split(',')[1]
    if (!base64) return
    send({ type: 'image_attach', imageBase64: base64, mimeType: file.type })
    setPendingImage(base64)
  }
  reader.readAsDataURL(file)
}, [send])
```

4. Add `onDragOver` and `onDrop` to the root div:

```tsx
<div
  style={{ width: '100vw', height: '100vh', background: '#ddefff', position: 'relative' }}
  onDragOver={handleDragOver}
  onDrop={handleDrop}
>
```

5. Show a brief image-attached indicator in the HUD (pass `imageAttached` state to `HudOverlay` or use a toast). The simplest approach: call `handleEvent` with a toast-like broadcast after setting the image:

After calling `send(image_attach)`:
```ts
// Show a brief "IMAGE ATTACHED" indicator by injecting a fake assistant transcript
// The backend will confirm via its own transcript event
```

(The backend already broadcasts `'Image attached — ask me anything about it.'` — no extra renderer logic needed.)

- [ ] **Step 3: Import `ReportPanel` (created in Task 9) and render it**

Add to the JSX, after `<MemoryBrowser ...>`:

```tsx
<ReportPanel
  content={state.reportContent}
  onClose={clearReport}
/>
```

Import at the top:

```ts
import { ReportPanel } from './components/ReportPanel'
```

(Implement `ReportPanel` in Task 9.)

- [ ] **Step 4: Run tests**

```
npm test
```

Expected: All tests PASS (renderer changes are not unit-tested here).

- [ ] **Step 5: Commit**

```
git add src/renderer/src/App.tsx src/renderer/src/hooks/useAnimState.ts
git commit -m "feat(renderer): drag-drop image zone + screenshot IPC handler + report state"
```

---

## Task 9: Create `ReportPanel.tsx`

**Files:**
- Create: `src/renderer/src/components/ReportPanel.tsx`

- [ ] **Step 1: Install `marked` for Markdown rendering**

```
npm install marked
npm install --save-dev @types/marked
```

- [ ] **Step 2: Create the ReportPanel component**

Create `src/renderer/src/components/ReportPanel.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { marked } from 'marked'

interface ReportContent {
  format: 'html' | 'md'
  content: string
}

interface ReportPanelProps {
  content: ReportContent | null
  onClose: () => void
}

export function ReportPanel({ content, onClose }: ReportPanelProps): JSX.Element | null {
  if (!content) return null

  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (content.format === 'html' && iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(`<!DOCTYPE html><html><head><style>
          body { font-family: 'JetBrains Mono', monospace; font-size: 13px; padding: 16px; color: #1e3a5f; background: #f0f7ff; }
          h1,h2,h3 { color: #0369a1; }
          pre { background: rgba(3,105,161,0.06); padding: 8px; border-radius: 4px; overflow: auto; }
        </style></head><body>${content.content}</body></html>`)
        doc.close()
      }
    }
  }, [content])

  const mdHtml = content.format === 'md' ? marked.parse(content.content) as string : ''

  const downloadContent = (): void => {
    const ext = content.format === 'html' ? 'html' : 'md'
    const blob = new Blob([content.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jarvis-report.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '42vh',
      background: 'rgba(240, 247, 255, 0.97)',
      backdropFilter: 'blur(20px)',
      borderTop: '1px solid rgba(3, 105, 161, 0.2)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 60,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(3, 105, 161, 0.12)',
      }}>
        <span style={{ fontFamily: 'var(--font-hud)', fontSize: '10px', letterSpacing: '0.12em', color: '#0369a1' }}>
          REPORT
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={downloadContent} style={pillBtn}>DOWNLOAD</button>
          <button onClick={onClose} style={pillBtn}>CLOSE</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {content.format === 'html' ? (
          <iframe
            ref={iframeRef}
            sandbox=""
            style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
            title="Jarvis report"
          />
        ) : (
          <div
            style={{
              height: '100%',
              overflow: 'auto',
              padding: '12px 16px',
              fontFamily: 'var(--font-hud)',
              fontSize: '12px',
              color: '#1e3a5f',
            }}
            dangerouslySetInnerHTML={{ __html: mdHtml }}
          />
        )}
      </div>
    </div>
  )
}

const pillBtn: React.CSSProperties = {
  borderRadius: 20,
  background: 'rgba(3, 105, 161, 0.08)',
  border: '1px solid rgba(3, 105, 161, 0.22)',
  padding: '5px 14px',
  fontFamily: 'var(--font-hud)',
  fontSize: '10px',
  letterSpacing: '0.12em',
  cursor: 'pointer',
  color: '#0369a1',
}
```

- [ ] **Step 3: Build and visually verify**

```
npm run build:backend
npm run dev
```

Test: drag an image file onto the Jarvis window → backend logs "Image attached" → say "describe this image" → Claude responds visually.

Test: say "give me an HTML report on my usage" (or any request that returns `[REPORT: html|...]` content) → ReportPanel slides up.

- [ ] **Step 4: Commit**

```
git add src/renderer/src/components/ReportPanel.tsx package.json package-lock.json
git commit -m "feat(ui): ReportPanel drawer — renders HTML/Markdown reports from agent output"
```

---

## Task 10: Update `jarvis_set_settings` to handle `screenshotHotkey`

**Files:**
- Modify: `src/backend/tools/jarvis.ts`

- [ ] **Step 1: Add `screenshotHotkey` to the tool definition**

In `src/backend/tools/jarvis.ts`, in the `jarvis_set_settings` input_schema properties, add:

```ts
screenshotHotkey: {
  type: 'string',
  description: 'Global hotkey for triggering a screenshot, e.g. Alt+Shift+S.',
},
```

- [ ] **Step 2: Add validation in `validatePartial`**

In the `validatePartial` function, add:

```ts
if (input.screenshotHotkey !== undefined) {
  partial.screenshotHotkey = String(input.screenshotHotkey).trim()
}
```

- [ ] **Step 3: Emit `hotkey_changed`-style event for the screenshot hotkey**

In `setJarvisSettings`, after the existing `partial.hotkey` check, add:

```ts
if (partial.screenshotHotkey) {
  emitEvent({ type: 'screenshot_hotkey_changed', hotkey: updated.screenshotHotkey })
}
```

Add `screenshot_hotkey_changed` to `BackendEvent` in types.ts:

```ts
| { type: 'screenshot_hotkey_changed'; hotkey: string }
```

Handle it in main process to re-register the globalShortcut (read `src/main/index.ts` to find the IPC bridge and add handling there).

- [ ] **Step 4: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```
git add src/backend/tools/jarvis.ts src/backend/types.ts
git commit -m "feat: screenshotHotkey configurable via jarvis_set_settings"
```
