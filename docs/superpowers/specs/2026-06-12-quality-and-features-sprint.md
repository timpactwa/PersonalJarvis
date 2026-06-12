# Jarvis Quality + Feature Sprint — Design Spec
**Date:** 2026-06-12
**Status:** Approved

---

## Overview

A parallel sprint covering five independent workstreams:
1. **Pipeline + tool bug fixes** (prerequisite — merges first)
2. **Visual context layer** — screenshot, image drop, vision, report renderer
3. **GitHub integration** — PR/issue/commit tooling via `gh` CLI
4. **Spotify control** — playback and search via Spotify Web API
5. **Test coverage update** — unit tests for all new/untracked source files

Execution strategy: Track 1 merges first (unblocks clean tool dispatch for new tools). Tracks 2–5 run in parallel via subagent-driven-development.

All new tools follow the existing `tools/<name>.ts` module pattern and are registered in `tools/index.ts`. All tests run with Sonnet for cost efficiency.

---

## Track 1 — Pipeline & Tool Bug Fixes

### 1.1 Root cause: `spawn_agent` in Groq tool set

**File:** `src/backend/tools/index.ts`

`getToolsForGroq()` currently includes `agentToolDefs` (which contains `spawn_agent`). Groq cannot properly generate `spawn_agent` calls — it emits invalid XML function syntax, producing a 400 `tool_use_failed` error. This also causes `web_search` to appear broken: Groq selects `spawn_agent` over `web_search` for complex research queries and then fails.

**Fix:** Remove `agentToolDefs` from `getToolsForGroq()`. `spawn_agent` is a Claude-only tool — it calls the Claude Agent SDK, so it only makes sense in the Claude path.

```ts
// Before
export function getToolsForGroq(): Tool[] {
  return [
    ...filesystemToolDefs,
    ...launcherToolDefs,
    ...gmailToolDefs,
    ...calendarToolDefs,
    ...vscodeToolDefs,
    ...agentToolDefs,   // ← remove this line
    ...searchToolDefs,
    ...jarvisToolDefs,
    ...commandToolDefs,
  ] as Tool[]
}
```

Also remove the `spawn_agent` mention from the Groq system prompt capabilities list in `src/backend/groq.ts`.

### 1.2 `toolSession.ts` integration audit

`src/backend/toolSession.ts` manages compose-key suppression state (in-memory Sets for dismissed/completed compose flows). Verify:
- It is imported and called correctly in `src/backend/index.ts` wherever `gmail_compose` events are handled
- `clearComposeSuppression()` is called at session reset so stale keys don't persist across conversations
- Confirm `shouldSuppressComposeUI` is checked before emitting `command_compose` events

### 1.3 `responseTags.ts` integration audit

`src/backend/responseTags.ts` strips `[REMEMBER:]`, `[PERSON:]`, `[PLACE:]`, `[PROJECT:]`, `[ORG:]` tags from model output. Verify:
- `stripResponseTags` is called on all three provider paths (Groq, Claude, Ollama) before broadcasting transcript
- `visibleStreamingText` is used during streaming to prevent partial tags leaking to the renderer
- No edge case where an empty `text` result after stripping causes a blank transcript bubble

### 1.4 `toolGuards.ts` audit

`isExplicitEmailComposeRequest` guards against the model calling `gmail_compose` on past-tense email statements. Verify the regex correctly rejects:
- "I sent John an email about the meeting" → false
- "Can you send John an email?" → true
- "Remember that I emailed Sarah" → false

### 1.5 WebSocket reconnection

In `src/renderer/src/hooks/useWebSocket.ts`, verify:
- On backend restart (WebSocket close), the renderer attempts reconnection without duplicating event listeners
- Reconnect delay is reasonable (≤3s) so the app recovers quickly
- Backend `ready` signal re-sends the port on reconnect so the renderer doesn't need a full page reload

### 1.6 `BRAVE_SEARCH_API_KEY` diagnostic

If `BRAVE_SEARCH_API_KEY` is absent, `webSearch` currently returns a plain-English error string. Verify this string surfaces to the user clearly rather than being swallowed. If the key is missing, Jarvis should say it aloud rather than silently returning nothing.

---

## Track 2 — Visual Context Layer

### Overview

Single vision pipeline with three entry points. All routes send a base64 image + user text to Claude (Groq and Ollama have no vision). New module: `src/backend/tools/vision.ts`.

### 2.1 Screenshot hotkey

**Main process** (`src/main/index.ts`): register a new global hotkey (default `Alt+Shift+S`, configurable via settings `screenshotHotkey`). On fire:
1. Call `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })`
2. Take the primary screen thumbnail
3. Convert to base64 PNG
4. Send `{ type: 'screenshot', imageBase64: string }` to backend via IPC → WebSocket

**New tool:** `jarvis_screenshot` — voice-triggered capture. When the user says "Jarvis, look at my screen" or "what am I working on", the tool calls back to the main process via IPC to trigger the same `desktopCapturer` flow and injects the result into the current turn.

### 2.2 Image drop zone

**Renderer** (`src/renderer/src/App.tsx`): add a transparent full-window `dragover`/`drop` handler. On drop:
- Accept `image/*` files and `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp` by extension
- Read as base64 via `FileReader`
- Emit a `RendererEvent` of type `image_attach` with the base64 payload
- Show a brief HUD toast: `IMAGE ATTACHED`

Dropped images are queued and attached to the next PTT turn automatically, then cleared.

### 2.3 Backend vision routing

**`src/backend/index.ts`**: when a turn arrives with an `imageBase64` field:
- Always route to Claude regardless of `llmProvider` setting or `needsTool()` result
- Pass the image as a vision content block in the Claude messages array
- Log a note if provider was overridden: `[pipeline] vision turn → forced Claude`

**`src/backend/claude.ts`**: add `imageBase64?: string` parameter to `chat()`. When present, build the user message as a content array:
```ts
[
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
  { type: 'text', text: userText }
]
```

### 2.4 Report renderer panel

**New component:** `src/renderer/src/components/ReportPanel.tsx`

A collapsible bottom drawer. When an agent result or Jarvis response contains a fenced code block of type `html` or `markdown`, or a `[REPORT: ...]` tag (new response tag), the panel auto-opens and renders the content.

- HTML reports: rendered in a sandboxed `<iframe srcdoc=...>` with `sandbox="allow-scripts"` removed (static only)
- Markdown: rendered via `marked` (already a likely dep, or add it)
- Style: frosted glass panel, `height: 40vh`, slides up from bottom, close button (pill style matching the design system)
- Download button: saves rendered content as `.html` or `.md` file

**New response tag in `responseTags.ts`:** `[REPORT: html|<content>]` or `[REPORT: md|<content>]` — stripped from transcript, emitted as a `report` backend event to the renderer.

### 2.5 Settings addition

Add `screenshotHotkey` to `Settings` type and `jarvis_set_settings` tool. Default: `Alt+Shift+S`.

---

## Track 3 — GitHub Integration

### Overview

New module `src/backend/tools/github.ts`. Uses the `gh` CLI via `child_process.execFile` — `gh` is already present on developer machines and handles OAuth. Falls back to the GitHub REST API if `GITHUB_TOKEN` is set and `gh` is not available.

### Tool definitions

| Tool | Description |
|------|-------------|
| `github_pr_list` | List open PRs for current or specified repo. Params: `repo?`, `limit?` (default 10) |
| `github_pr_view` | Get details + diff summary for a specific PR. Params: `pr_number`, `repo?` |
| `github_issue_list` | List open issues, optionally filtered by label. Params: `repo?`, `label?`, `limit?` |
| `github_commit_log` | Recent commit log for current branch. Params: `repo?`, `limit?` (default 10) |
| `github_pr_describe` | Generate a PR title + body from recent commits and diff. Params: `repo?`, `base?` (default `main`) |
| `github_repo_status` | Current branch, uncommitted changes, ahead/behind upstream. Params: `repo?` |

### Implementation notes

- `gh` calls: `execFile('gh', [...args], { timeout: 15000 })` — no shell injection risk
- `github_pr_describe` pipes `gh pr diff` output to Claude (via `spawn_agent` or inline) to generate the description — never sent to Groq
- Working directory for `gh` calls: use `process.cwd()` unless `repo` param specifies a full path or `owner/repo` slug
- Error handling: if `gh` is not found or not authenticated, return a helpful message with the fix command

### Registration

Add to `getTools()`, `getToolsForGroq()` (read-only tools only: list/view/log/status), and `getToolsForAgent()`. Do NOT add `github_pr_describe` to Groq — it requires Claude for quality output.

---

## Track 4 — Spotify Control

### Overview

New module `src/backend/tools/spotify.ts`. Uses the Spotify Web API with an OAuth refresh-token flow. New env vars: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`.

One-time setup: `spotify_auth` tool opens the browser OAuth PKCE flow and saves the refresh token to settings. After that, all other tools work silently.

### Tool definitions

| Tool | Description |
|------|-------------|
| `spotify_auth` | Opens browser OAuth flow to connect Spotify. Run once. |
| `spotify_current` | What's playing right now (track, artist, album, progress) |
| `spotify_play` | Resume playback, or play a specific URI/query. Params: `query?`, `uri?` |
| `spotify_pause` | Pause playback |
| `spotify_next` | Skip to next track |
| `spotify_prev` | Previous track |
| `spotify_volume` | Set volume 0–100. Params: `volume` |
| `spotify_search` | Search tracks/albums/playlists. Params: `query`, `type?` (default `track`), `limit?` |
| `spotify_queue` | Add a track to the queue. Params: `query` or `uri` |

### Smart dispatch pattern

For natural-language requests like "play something for focusing":
1. `spotify_search` with a relevant query (e.g. "focus lofi beats")
2. `spotify_play` with the URI from the top result

The model handles this naturally via the tool loop — no special routing needed.

### Token refresh

On every API call: check if the access token has expired (store `expiresAt` in settings). If so, call `POST https://accounts.spotify.com/api/token` with the refresh token before proceeding. Refresh failure surfaces a clear message: "Spotify token expired — say 'connect Spotify' to re-authenticate."

### Settings addition

Add `spotifyClientId`, `spotifyClientSecret`, `spotifyRefreshToken`, `spotifyAccessToken`, `spotifyExpiresAt` to the settings schema (access token stored encrypted at rest — use `SPOTIFY_` env vars as the source of truth for client ID/secret, persisted token in db settings).

---

## Track 5 — Test Coverage

All tests run via `npx vitest run` with Sonnet (default model, cost-efficient). Targets are the untracked test files that exist but need fleshing out, plus new regression tests for Track 1 fixes.

### 5.1 `tests/backend/responseTags.test.ts`

- `stripResponseTags` with no tags → passthrough
- `[REMEMBER: fact]` stripped, returned as `pendingMemory`
- `[PERSON: Bob | father | email: bob@example.com]` parsed correctly
- `[PLACE: Library | study spot]` parsed correctly
- Multiple entity tags in one response
- Empty text after stripping → fallback text generated
- `visibleStreamingText` cuts at first tag start

### 5.2 `tests/backend/tools/commands.test.ts`

- `registerCommand` with full fields → saves and returns confirmation
- `registerCommand` with missing fields → emits `command_compose` event
- `removeCommand` by label → success
- `removeCommand` by alias → success
- `removeCommand` unknown name → error message
- `findExecutables` with empty query → empty array

### 5.3 `tests/backend/tools/jarvis.test.ts`

- `getJarvisSettings` returns formatted settings string
- `setJarvisSettings` with valid `llmProvider` → updates and returns
- `setJarvisSettings` with invalid provider → throws
- `setJarvisSettings` with empty input → throws
- `getJarvisUsage` with default days → includes expected sections
- `getJarvisUsage` with `days=1` → clamps correctly

### 5.4 `tests/backend/memory/contacts.test.ts`

- Insert entity → retrievable by name
- Insert duplicate name → upserts (not duplicates)
- Search by alias
- Delete entity → gone
- `formatEntityContext` includes email when present

### 5.5 Track 1 regression tests

**`tests/backend/groq.test.ts`** — add:
- `getToolsForGroq()` does NOT contain `spawn_agent`
- `parseFailedToolGeneration` correctly parses known Groq XML failure format
- `parseFailedToolGeneration` returns null for unrecognized format

**`tests/backend/tools/index.test.ts`** — add:
- `getToolsForGroq()` tool name list matches expected set (snapshot test)
- `getToolsForAgent()` does NOT contain `spawn_agent`

---

## Execution Plan

```
Day 1: Track 1 (pipeline fixes) — merge to main before starting any other track
        ↓
Day 2+: Tracks 2, 3, 4, 5 in parallel (subagent-driven-development)
```

Track 1 is the hard prerequisite: the `spawn_agent` fix unblocks search, and the clean dispatch loop is the foundation new tools build on.

Tracks 2–4 are independent of each other but all depend on Track 1 being merged. Track 5 can run in parallel with 2–4 (it tests existing code, not new features).

---

## Files Created / Modified

| File | Change |
|------|--------|
| `src/backend/tools/index.ts` | Remove `agentToolDefs` from `getToolsForGroq()`; add github + spotify tools |
| `src/backend/tools/github.ts` | New: GitHub tool module |
| `src/backend/tools/spotify.ts` | New: Spotify tool module |
| `src/backend/tools/vision.ts` | New: vision pipeline helpers |
| `src/backend/groq.ts` | Remove `spawn_agent` from system prompt capabilities list |
| `src/backend/claude.ts` | Add `imageBase64?` param, build vision content blocks |
| `src/backend/index.ts` | Route vision turns to Claude; wire toolSession/responseTags; handle `image_attach` event |
| `src/backend/responseTags.ts` | Add `[REPORT:]` tag parsing |
| `src/backend/types.ts` | Add `image_attach` RendererEvent; `report` BackendEvent; settings additions |
| `src/main/index.ts` | Register screenshot hotkey; handle `jarvis_screenshot` IPC |
| `src/renderer/src/App.tsx` | Add drag-drop image handler; attach image to next PTT turn |
| `src/renderer/src/components/ReportPanel.tsx` | New: report renderer drawer |
| `src/renderer/src/hooks/useAnimState.ts` | Add `reportContent`, `imageAttached` state |
| `tests/backend/responseTags.test.ts` | Flesh out |
| `tests/backend/tools/commands.test.ts` | Flesh out |
| `tests/backend/tools/jarvis.test.ts` | Flesh out |
| `tests/backend/memory/contacts.test.ts` | Flesh out |
| `tests/backend/groq.test.ts` | Add regression tests |
| `tests/backend/tools/index.test.ts` | Add regression tests |
