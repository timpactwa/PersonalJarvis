# Jarvis — Quality, Agentic Intelligence & UI Overhaul
**Date:** 2026-06-12  
**Status:** Approved for implementation

---

## Overview

Three parallel tracks targeting code quality, smarter multi-step reasoning, and a premium UI redesign. The primary goal is to make Jarvis feel like a polished, production-grade desktop assistant — not a prototype.

---

## Track 1 — Quality & Bug Fixes

### 1.1 Routing keyword inconsistency
`index.ts` `TOOL_KEYWORDS_ROUTE` includes `'open'` but `claude.ts` explicitly excludes it (comment: "matches too broadly — e.g. 'open vs code' is conversational"). Remove `'open'` from `TOOL_KEYWORDS_ROUTE` in `index.ts`.

### 1.2 gmail_compose guard duplication
`isExplicitEmailComposeRequest` is checked independently in `claude.ts` and `groq.ts`. Move the guard into `handleTool` in `tools/index.ts` as the single enforcement point so callers cannot accidentally bypass it. Remove from both callers.

### 1.3 Unknown tool error surfacing
`handleTool` currently throws `Unknown tool: ${name}` with no UI feedback. Change to also broadcast an `error` BackendEvent so unknown-tool failures surface in the renderer rather than silently crashing the pipeline.

### 1.4 Button style duplication
`SpotifyPanel` and `GitHubPanel` each define a local `pillBtn` CSS-in-JS object, duplicating and diverging from the global `.pill-btn` class. Delete local defs. Add CSS variants `.pill-btn--sm`, `.pill-btn--icon`, `.pill-btn--active` to `global.css`. Track 3 UI rebuild uses these.

### 1.5 MAX_STEPS alignment
`groq.ts` caps at 5, `claude.ts` at 6. Both are raised in Track 2 — this closes the inconsistency.

### 1.6 Test coverage preservation
All Track 1 changes must keep the existing 276-test suite green. No new test files required for purely mechanical refactors.

---

## Track 2 — Agentic Intelligence

> ⚠️ **Fable routing changes require user confirmation before the implementing subagent runs.**

### 2.1 Tiered model routing (REQUIRES CONFIRMATION)

Replace the current binary Haiku/Sonnet split with three tiers:

| Tier | Model | Criteria |
|------|-------|----------|
| Fast | `claude-haiku-4-5-20251001` | Single tool calls: app_launch, spotify_*, fs_read, calendar_list, web_search alone, short conversational (≤15 words) |
| Smart | `claude-sonnet-4-6` | Multi-tool chains, email compose, GitHub tools, medium complexity |
| Deep | `claude-fable-5` | spawn_agent, github_pr_describe, requests containing "plan / analyze / compare / summarize / research / write" + substantive content, OR when the previous response already consumed ≥4 tool steps |

Detection lives in `selectModel()` in `claude.ts`. The `forceModel` override from callers remains respected.

### 2.2 Step cap increase
- `claude.ts`: `MAX_STEPS` 6 → 12
- `groq.ts`: `MAX_STEPS` 5 → 10

Prevents premature cutoff on legitimate multi-step chains (search → read → summarize → email).

### 2.3 Plan+confirm for destructive multi-step chains
Before executing any chain that includes `email_send`, `execute_file`, `fs_write`, or `calendar_create`, the backend emits a new `plan_preview` BackendEvent:

```typescript
{ type: 'plan_preview', steps: string[], id: string }
```

The renderer shows a slim card listing the steps and two buttons: **Proceed** / **Cancel**. On proceed, a `plan_confirmed` RendererEvent resumes execution. On cancel, a `plan_cancelled` event aborts.

Non-destructive chains (web_search → summarize, fs_read → explain) skip this and execute immediately.

### 2.4 Context window
Conversation history window: 40 messages → 60 messages (30 turns).

### 2.5 spawn_agent reliability
Audit `agents.ts` — verify spawn_agent actually works end-to-end, fix any silent failure modes, and ensure worker agents get the same memory context as the main pipeline.

---

## Track 3 — Premium UI Overhaul

### 3.1 Dark overlay design system

New CSS custom properties added to `global.css` under `:root`:

```css
/* Dark overlay system — used by all modals/panels */
--ov-bg:          rgba(4, 6, 14, 0.96);
--ov-bg-raised:   rgba(8, 12, 24, 0.98);
--ov-border:      rgba(14, 165, 233, 0.16);
--ov-border-hot:  rgba(14, 165, 233, 0.50);
--ov-accent:      #0ea5e9;           /* lighter blue — readable on dark */
--ov-accent-dim:  rgba(14, 165, 233, 0.14);
--ov-accent-glow: rgba(14, 165, 233, 0.25);
--ov-text:        rgba(255, 255, 255, 0.88);
--ov-text-mid:    rgba(255, 255, 255, 0.50);
--ov-text-dim:    rgba(255, 255, 255, 0.22);
--ov-separator:   rgba(255, 255, 255, 0.07);
--ov-radius:      14px;
--ov-shadow:      0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(14,165,233,0.14);
```

Shared keyframes added to `global.css`:
```css
@keyframes overlayIn  { from { opacity:0; transform: translateY(10px) scale(0.98); } to { opacity:1; transform: translateY(0) scale(1); } }
@keyframes overlayOut { from { opacity:1; transform: scale(1);    } to { opacity:0; transform: scale(0.97); } }
@keyframes drawerIn   { from { transform: translateX(100%); }    to { transform: translateX(0); } }
@keyframes drawerOut  { from { transform: translateX(0); }       to { transform: translateX(100%); } }
```

All modal enter animations: `overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards`.
All modal exit animations: `overlayOut 0.15s ease-in forwards` (requires React exit animation or CSS class toggle).

### 3.2 Button system

Global `.pill-btn` stays as base. Add variants:

```css
.pill-btn--sm      { padding: 3px 10px; font-size: 9px; }
.pill-btn--icon    { padding: 5px 10px; min-width: 32px; }
.pill-btn--active  { background: var(--ov-accent-dim); border-color: var(--ov-border-hot); color: var(--ov-accent); box-shadow: 0 0 8px var(--ov-accent-glow); }
.pill-btn--danger  { border-color: rgba(239,68,68,0.4); color: #ef4444; }
.pill-btn--danger:hover { background: rgba(239,68,68,0.1); }
```

All overlay buttons must use these classes — no inline `style` for color or background on buttons.

### 3.3 SpotifyPanel — full rebuild

**New BackendEvent:**
```typescript
{ type: 'spotify_now_playing', track?: string; artist?: string; isPlaying: boolean }
```
Backend change: `handleSpotifyTool` for `spotify_current` emits `spotify_now_playing` via `broadcast()` in addition to returning text. SpotifyPanel listens for this event via `useAnimState` and renders structured data — no transcript parsing required. Panel triggers `spotify_current` on open by sending a command.

**Layout:** Centered modal, 460px wide. Uses `--ov-*` tokens.

**Sections (top to bottom):**
1. **Header**: `♫ SPOTIFY` label left, `✕` close button right
2. **Now-playing card**: Populated by `spotify_now_playing` event. Shows track name (16px, white), artist (12px, dim), and a thin accent-colored progress line. Album art: placeholder gradient block if unavailable. Graceful idle state: "Nothing playing" in dim text.
3. **Controls row**: Five icon buttons in a centered row — ⏮ ⏸/▶ ⏭ + Vol− Vol+ — using `.pill-btn--icon`. Icon size: 14px. Active play/pause button gets `.pill-btn--active` glow.
4. **Divider**
5. **Search row**: Input + `▶ PLAY` button. Input uses overlay input style (defined in 3.6).
6. **Footer hint**: dim text, 9px

**State machine:** `idle | loading | playing | error`. Components render accordingly.

### 3.4 GitHubPanel — full rebuild

**Layout:** Right drawer, 440px wide. Uses `--ov-*` tokens.

**New BackendEvent:**
```typescript
{ type: 'github_data', tab: 'STATUS' | 'PRs' | 'ISSUES' | 'COMMITS', rows: GithubRow[] }
interface GithubRow { title: string; subtitle?: string; meta?: string; badge?: string; badgeColor?: string }
```

Backend change: `handleGithubTool` parses the CLI output and emits `github_data` via `broadcast()` in addition to returning the text result. The panel listens for this event and renders the rows.

**Sections:**
1. **Header**: `⬡ GITHUB` label left, refresh + close right
2. **Tab bar**: STATUS / PRs / ISSUES / COMMITS — clean underline tabs
3. **Content area**: 
   - Loading: skeleton rows (animated opacity pulse)
   - Data: card rows — title bold, subtitle dim, meta right-aligned, optional badge
   - Empty: dim centered text
4. **Footer**: branch/connection info, 10px dim

### 3.5 HudOverlay — refinements

- Status dot (●) gets `statusPulse` keyframe animation while `animState === 'thinking'`
- Buttons (♫, GH, 🔇) use `.pill-btn--icon` + `.pill-btn--active` when panel is open, no more inline color overrides
- Token/cost display gets a subtle right-align monospace refinement

### 3.6 Shared overlay input style

Add to `global.css`:
```css
.ov-input {
  background: rgba(0,0,0,0.35);
  border: 1px solid var(--ov-border);
  border-radius: 8px;
  color: var(--ov-text);
  font-family: var(--font-mono);
  font-size: 11px;
  outline: none;
  padding: 8px 12px;
  transition: border-color 0.15s;
}
.ov-input:focus { border-color: var(--ov-border-hot); }
.ov-input::placeholder { color: var(--ov-text-dim); }
```

All modal inputs use `.ov-input`. No more inline input styles.

### 3.7 Existing modal consistency pass

Apply `--ov-*` tokens and `.pill-btn` / `.ov-input` classes to:
- `Dashboard.tsx` — header, button row, stats layout
- `SettingsPanel.tsx` — form fields, section headers, save button
- `MemoryBrowser.tsx` — list rows, delete buttons
- `ConfirmCard.tsx` — action/cancel buttons, layout
- `EmailComposer.tsx` — input fields, send/draft buttons
- `EmailViewer.tsx` — email list, reply button
- `EventEditor.tsx` — form fields, create button
- `CommandEditor.tsx` — form fields, save button
- `ReportPanel.tsx` — header, close button
- `AgentCards.tsx` — card layout, close button

Each modal gets the `overlayIn` entrance animation. No full redesign of layout — just token/class consistency and animation.

---

## Data Flow Changes

### github_data event
```
User clicks tab in GitHubPanel
  → send({ type: 'command', text: TAB_CMDS[tab] })
  → backend processes via github tool
  → handleGithubTool parses output → broadcast({ type: 'github_data', tab, rows })
  → GitHubPanel receives event via useAnimState → renders rows
```

### plan_preview event
```
claude.ts detects destructive tool in upcoming chain
  → broadcast({ type: 'plan_preview', steps, id })
  → renderer shows PlanPreviewCard (new component, rendered in App.tsx alongside ConfirmCard)
  → user clicks Proceed → send({ type: 'plan_confirmed', id })
  → backend resumes tool execution
```

`PlanPreviewCard` receives `planPreview: { steps: string[]; id: string } | null` from `useAnimState`. Rendered in `App.tsx` below `ConfirmCard`.

---

## Implementation Order

1. **Track 1** (no model changes, pure cleanup) — parallel-safe with Track 3 renderer work
2. **Track 2** (backend only, Fable routing requires confirmation gate) — run after user approves
3. **Track 3** (renderer + two backend events) — Track 3 backend events (github_data, plan_preview) unblock full panel functionality

---

## Non-Goals

- No new tool categories in this sprint
- No Electron window chrome changes
- No mobile/responsive considerations
- No new onboarding flows
