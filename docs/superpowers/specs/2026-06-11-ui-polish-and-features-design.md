# Jarvis UI Polish + Feature Sprint — Design Spec
**Date:** 2026-06-11
**Status:** Approved

---

## Overview

A focused sprint covering two bug fixes, a full UI overhaul, and three new features. The aesthetic direction is **light blue + white, simplistic yet techy** — clean and minimal with a technical edge, not the dark holographic style from the original spec.

All frontend work must use the **frontend-design skill**. Implementation must use **subagent-driven-development**.

---

## 1. Bug Fixes

### 1.1 Chat Scroll
**File:** `src/renderer/src/components/Transcript.tsx:44`

`pointerEvents: 'none'` on the transcript container prevents the user from scrolling or selecting text. Change to `pointerEvents: 'auto'` and add `cursor: 'default'`. The existing webkit mask fade-gradient at the top is unaffected.

### 1.2 Subagent Card UX
**File:** `src/renderer/src/components/AgentCards.tsx`

Three fixes:
1. **Expand affordance**: Replace the invisible "click anywhere on action text to toggle" with an explicit `▾ LOG` / `▴ LOG` pill button below the last action line.
2. **Done state**: When `status === 'done'`, show a green `● COMPLETE` badge, render the result text in a distinct box (slightly different background), and replace `✕` with a `DISMISS` pill button — so the result is never accidentally dismissed.
3. **Copy button**: When `status === 'done'`, show a `COPY` pill button next to `DISMISS` that copies `agent.result` to clipboard.

---

## 2. UI Overhaul

### 2.1 Typography
Replace all three font CSS variables with a single font:

```css
--font-hud:  'JetBrains Mono', monospace;
--font-data: 'JetBrains Mono', monospace;
--font-mono: 'JetBrains Mono', monospace;
```

Remove the Orbitron and Rajdhani `<link>` imports from `index.html`. Add the JetBrains Mono Google Fonts import:
```
https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap
```

One font throughout. Sizing and weight create hierarchy, not font family switches.

### 2.2 Buttons
All interactive buttons adopt a **pill style**:
- `border-radius: 20px`
- `background: rgba(3, 105, 161, 0.08)`
- `border: 1px solid rgba(3, 105, 161, 0.22)`
- `padding: 5px 14px`
- `font-family: var(--font-hud)`, `font-size: 10px`, `letter-spacing: 0.12em`
- Hover: `background: rgba(3, 105, 161, 0.15)`, `border-color: rgba(3, 105, 161, 0.45)`
- Transition: `background 0.15s, border-color 0.15s`

Applied to: DASHBOARD, TEXT (HUD), provider cycle, Settings SAVE, ConfirmCard buttons, AgentCard DISMISS/COPY/LOG, MemoryBrowser delete.

### 2.3 Settings Drawer
Replace the centered modal with a **right-edge drawer**:
- `position: absolute`, `top: 0`, `right: 0`, `height: 100vh`, `width: 340px`
- Slide animation: `transform: translateX(100%)` → `translateX(0)`, `transition: transform 0.25s ease`
- Frosted glass background: `rgba(255, 255, 255, 0.96)`, `backdropFilter: blur(20px)`
- Left border: `1px solid rgba(3, 105, 161, 0.15)`
- Backdrop overlay (left of drawer): semi-transparent, click to close

**Three labeled sections with dividers:**
- **VOICE**: Push-to-talk hotkey, ElevenLabs voice ID
- **AI MODEL**: LLM provider (select), Claude model preference (select), Ollama model (text), Ollama base URL (text)
- **MEMORY**: Short-term turns (number input)

Each section has a `10px` all-caps label, `1px` divider below, then its fields.

### 2.4 HUD Cleanup
- Status text gains a small colored dot prefix: `● ONLINE`, `● LISTENING` etc.
- JARVIS wordmark: increase to `15px` (from 13px)
- Token/cost line: keep layout, apply JetBrains Mono consistently
- All HUD buttons styled as pill buttons (per 2.2)

---

## 3. New Features

### 3.1 Memory Browser
**New component:** `src/renderer/src/components/MemoryBrowser.tsx`

A right-edge drawer (same style as Settings, but accessible separately). Entry point: `MEMORIES` pill button added to the settings drawer header row, and voice trigger `show memories` maps to a new `toggle_memory_browser` backend event.

**Layout:**
- Header: `MEMORIES` label + close button
- Search bar (text input, filters in real-time by memory text)
- Scrollable list: each row shows `[timestamp] memory text` + a `✕` delete button (pill style)
- Empty state: `NO MEMORIES STORED` centered text

**Backend changes:**
- New WebSocket event `get_memories` → backend queries `memories` table, returns array of `{ id, text, createdAt }`
- New WebSocket event `delete_memory` `{ id }` → backend deletes row, emits confirmation

**State:** Add `memoriesOpen: boolean` and `memories: MemoryEntry[]` to `useAnimState`.

### 3.2 Better Agent Cards
Extends the bug fixes in §1.2 with two additions:

**Completion toast**: When any agent transitions to `status === 'done'`, emit a brief toast notification at the top-center of the screen: `Agent complete: {agent.name}`. Auto-dismisses after 4 seconds. Implemented in `useAnimState` — watch for status changes, push to a `toasts` array, expire via `setTimeout`.

**Full-log modal** (optional expansion of inline log): Clicking `▾ LOG` on a done card opens a centered modal with a fully scrollable action log — all entries, selectable text, close button. This is separate from the inline expand which stays for running agents.

**New component:** `src/renderer/src/components/AgentLogModal.tsx` — centered overlay, `max-height: 70vh`, scrollable log, close button.

### 3.3 Voice Waveform Visualizer
Wire real mic/speaker amplitude into the `ParticleRing` animation.

**Mic amplitude (listening state):**
- In `App.tsx`, when PTT starts (`onPttStart`), create a `MediaStream` from `getUserMedia` and attach an `AnalyserNode`
- Sample `getByteTimeDomainData` at ~30fps, compute RMS amplitude (0–1 float)
- Pass as `amplitude` prop to `ParticleRing`
- On PTT stop, detach and reset amplitude to 0

**TTS amplitude (speaking state):**
- In the `audio.play()` block in `App.tsx`, attach a Web Audio `AnalyserNode` to the `Audio` element via `createMediaElementSource`
- Same RMS sampling loop, same `amplitude` prop

**ParticleRing changes:**
- Accept `amplitude?: number` prop (default 0)
- In listening draw loop: multiply inward pulse magnitude by `0.3 + amplitude * 0.7` so silence = slow drift, loud speech = strong pulse
- In speaking draw loop: outward wave amplitude scaled the same way

No new files needed — changes are in `ParticleRing.tsx` and `App.tsx`.

---

## 4. Component Impact Summary

| File | Change |
|------|--------|
| `index.html` | Swap font imports (Orbitron/Rajdhani → JetBrains Mono) |
| `styles/global.css` | Update font vars, add pill button base style |
| `components/HudOverlay.tsx` | JetBrains Mono, pill buttons, dot status indicator |
| `components/SettingsPanel.tsx` | Replace centered modal with right-edge drawer |
| `components/Transcript.tsx` | Fix pointerEvents |
| `components/AgentCards.tsx` | Expand button, done state, dismiss/copy, toast trigger |
| `components/AgentLogModal.tsx` | New: full-log modal |
| `components/MemoryBrowser.tsx` | New: memory list drawer |
| `components/TextInput.tsx` | JetBrains Mono, pill submit button |
| `components/ConfirmCard.tsx` | Pill buttons |
| `hooks/useAnimState.ts` | Add memoriesOpen, memories, toasts state |
| `App.tsx` | Amplitude sampling, MemoryBrowser, toast render |
| `ParticleRing.tsx` | Accept + use amplitude prop |
| `src/backend/index.ts` | Handle get_memories, delete_memory events |
| `src/backend/types.ts` | Add MemoryEntry type, new event types |

---

## 5. Implementation Notes

- **Frontend-design skill** must be invoked for every frontend component created or significantly modified.
- **Subagent-driven-development** must be used for implementation — parallel subagents per independent component where possible.
- Backend changes (memory events) are a prerequisite for the MemoryBrowser subagent task.
- The font swap (`index.html` + `global.css`) should be the first task — it unblocks visual verification of all other changes.
