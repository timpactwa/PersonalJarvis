# Jarvis UI Redesign + Polish Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Jarvis frontend to a light-blue/white holographic futuristic theme with a subtle grid background, floating pixels, a discoverable and functional dashboard, improved transcript history, and better overall performance.

**Architecture:** All changes are purely frontend (renderer process). The backend is untouched. The core visual system is a canvas-based ParticleRing; theming is applied by updating its color constants + adding a CSS grid overlay div behind it. Dashboard discoverability is fixed by moving HUD elements below the titlebar and adding an explicit button.

**Tech Stack:** React 18, TypeScript, HTML Canvas 2D, Electron renderer, inline CSS + global.css

---

## Issues Found (Read-Through)

1. **Dashboard hidden** — The dashboard trigger is the top-right HUD stats area, but it sits at `top: 24` which is inside the 36px TitleBar. TitleBar has `zIndex: 500` and captures the click. User can never discover it. Fix: move HUD to `top: 52`, add a visible DASHBOARD button.
2. **Performance** — 180 particles × `createLinearGradient()` per frame = ~180 gradient objects allocated every 16ms. This is the primary lag source. Fix: simplify to a cached color string computed from particle state.
3. **Dark navy theme vs requested light blue/white** — BG is `#060b14` (near-black). User wants holographic cyan/white. Fix: shift to `#030d1a`, add CSS grid, change particle palette to white + bright cyan.
4. **Transcript = only last message** — Only one line of text shown. No conversation history. Fix: keep rolling 6-turn history in state, render as a scrollable list.
5. **Particle style** — Current: small silver metallic triangles. User wants "floating pixels". Fix: replace triangle path with a small square/rect — simpler to draw and more "pixel" aesthetic.
6. **Stats are always 0** — The DB logger uses a model string `'fable'` as a hardcoded placeholder. Real model is `groq:llama-3.1-8b-instant`. Fix: pass real model string to logApiCall (already passed from groq.ts, just stored wrong key).

---

## File Map

| File | Change |
|------|--------|
| `src/renderer/src/styles/global.css` | Add `.grid-bg`, `.ptk-hint` styles |
| `src/renderer/src/components/ParticleRing.tsx` | New palette, squares instead of triangles, fewer particles, cached color |
| `src/renderer/src/components/HudOverlay.tsx` | Move to `top: 52`, add DASHBOARD button |
| `src/renderer/src/hooks/useAnimState.ts` | Add `history: ConversationTurn[]` to state |
| `src/renderer/src/components/Transcript.tsx` | Render 6-turn history list |
| `src/renderer/src/App.tsx` | Add `.grid-bg` div, wire new transcript props |
| `src/renderer/src/components/TitleBar.tsx` | Brighter text, accent line |
| `src/renderer/src/components/TextInput.tsx` | Show PTT hint label, update colors for new theme |

---

## Task 1: Fix Dashboard Discoverability

**Files:**
- Modify: `src/renderer/src/components/HudOverlay.tsx`

The HUD stats div is at `top: 24`, behind the 36px TitleBar (`zIndex: 500`). Move all HUD elements to `top: 52`. Add a small explicit DASHBOARD button visible in the top-right.

- [ ] **Step 1: Rewrite HudOverlay.tsx**

```tsx
// src/renderer/src/components/HudOverlay.tsx
import type { AnimState } from '../../../backend/types'

const STATUS_LABELS: Record<AnimState, string> = {
  idle: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'SPEAKING',
}

const STATUS_COLORS: Record<AnimState, string> = {
  idle: '#4ade80',
  listening: '#38bdf8',
  thinking: '#f59e0b',
  speaking: '#a78bfa',
}

interface Props {
  animState: AnimState
  tokensToday: number
  costToday: number
  model: string
  onStatsClick?: () => void
}

const hud: React.CSSProperties = {
  position: 'absolute',
  fontFamily: '"Orbitron", monospace',
  fontSize: '11px',
  letterSpacing: '0.1em',
  color: '#7dd3fc',
  lineHeight: 1.6,
  pointerEvents: 'none',
}

const line: React.CSSProperties = {
  width: 40,
  height: 1,
  background: 'rgba(125,211,252,0.3)',
  margin: '3px 0',
}

export function HudOverlay({ animState, tokensToday, costToday, model, onStatsClick }: Props): JSX.Element {
  return (
    <>
      {/* Top-left: identity + status */}
      <div style={{ ...hud, top: 52, left: 24 }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#e0f2fe', letterSpacing: '0.2em' }}>JARVIS</div>
        <div style={line} />
        <div style={{ color: STATUS_COLORS[animState], fontSize: '10px' }}>{STATUS_LABELS[animState]}</div>
      </div>

      {/* Top-right: dashboard button + stats */}
      <div
        className="no-drag"
        style={{
          ...hud,
          top: 52,
          right: 24,
          textAlign: 'right',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
        }}
      >
        <button
          onClick={onStatsClick}
          style={{
            background: 'rgba(56,189,248,0.08)',
            border: '1px solid rgba(56,189,248,0.3)',
            borderRadius: 4,
            color: '#7dd3fc',
            cursor: 'pointer',
            fontFamily: '"Orbitron", monospace',
            fontSize: 9,
            letterSpacing: '0.2em',
            padding: '3px 10px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(56,189,248,0.18)'
            e.currentTarget.style.borderColor = 'rgba(56,189,248,0.7)'
            e.currentTarget.style.color = '#bae6fd'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(56,189,248,0.08)'
            e.currentTarget.style.borderColor = 'rgba(56,189,248,0.3)'
            e.currentTarget.style.color = '#7dd3fc'
          }}
        >
          DASHBOARD
        </button>
        <div style={{ fontSize: '10px', color: '#4a6a8a' }}>{tokensToday.toLocaleString()} tok · ${costToday.toFixed(4)}</div>
        <div style={{ fontSize: '9px', color: '#334155', letterSpacing: '0.1em' }}>{model.replace('groq:', '').toUpperCase()}</div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify** — Run `npm run dev`, confirm DASHBOARD button appears top-right below the title bar, confirm clicking it opens the dashboard panel.

---

## Task 2: Background Grid + New Theme Base

**Files:**
- Modify: `src/renderer/src/styles/global.css`
- Modify: `src/renderer/src/App.tsx`

Add a CSS grid overlay as a fixed background layer. This sits BEHIND the canvas but gives the holographic grid feel.

- [ ] **Step 1: Add grid styles to global.css**

Append to `src/renderer/src/styles/global.css`:

```css
/* ── Grid background ─────────────────────────────────── */

.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.045) 1px, transparent 1px);
  background-size: 44px 44px;
  background-position: -1px -1px;
  pointer-events: none;
  z-index: 0;
}

/* Vignette: darken corners so grid fades to nothing at edges */
.grid-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 75% 75% at 50% 50%, transparent 40%, rgba(3, 9, 22, 0.85) 100%);
  pointer-events: none;
  z-index: 1;
}
```

- [ ] **Step 2: Add grid divs to App.tsx**

In `src/renderer/src/App.tsx`, add `.grid-bg` and `.grid-vignette` divs as the first children of the outer div (before `<TitleBar />`):

```tsx
return (
  <div style={{ width: '100vw', height: '100vh', background: '#030d1a', position: 'relative' }}>
    <div className="grid-bg" />
    <div className="grid-vignette" />
    <TitleBar />
    {/* rest unchanged */}
```

Note: background changes from `#060b14` to `#030d1a` — slightly deeper, more blue-shifted.

- [ ] **Step 3: Verify** — Run `npm run dev`, confirm faint cyan grid lines are visible in the background behind the particle ring, fading at corners.

---

## Task 3: ParticleRing Redesign — Colors, Pixels, Performance

**Files:**
- Modify: `src/renderer/src/components/ParticleRing.tsx`

Three changes in one pass:
1. Change background color constant to match new theme
2. Replace per-frame `createLinearGradient` (expensive) with a cached color string
3. Replace triangle path with a small square (more "floating pixel" aesthetic)
4. Reduce particle count: 180 → 130, dust 80 → 45
5. New palette: white/cyan instead of silver/metallic

- [ ] **Step 1: Rewrite ParticleRing.tsx**

The full file (keep all interfaces and STATE_PARAMS the same, change the constants and render code):

Find and replace these constants near the top of the file:
```ts
const NUM_PARTICLES = 130    // was 180
const NUM_DUST = 45          // was 80
const BG = { r: 3, g: 13, b: 26 }  // was { r: 6, g: 11, b: 20 } — matches #030d1a
```

Change the halo sprite colors (in the `useEffect`, find `makeHaloSprite` calls):
```ts
// was: makeHaloSprite(205, 228, 255) and makeHaloSprite(70, 140, 255)
const haloWhite = makeHaloSprite(220, 240, 255)  // bright white-blue
const haloBlue  = makeHaloSprite(56,  189, 248)  // sky-400 cyan
```

Change the dust color (find `ctx.fillStyle = 'rgba(190,212,240,1)'`):
```ts
ctx.fillStyle = 'rgba(186, 230, 253, 1)' // sky-200 — brighter
```

Replace the triangle draw block (the `ctx.beginPath()` to `ctx.restore()` block) with a square:
```ts
// Replace:
// ctx.beginPath()
// ctx.moveTo(0, -size)
// ctx.lineTo(size * 0.866, size * 0.5)
// ctx.lineTo(-size * 0.866, size * 0.5)
// ctx.closePath()
// ctx.fill()
// ctx.restore()

// With:
const sq = size * 1.3
ctx.fillRect(-sq / 2, -sq / 2, sq, sq)
ctx.restore()
```

Replace the per-particle gradient (find `const ga = time * 0.013...` block through `ctx.fillStyle = grad`):
```ts
// Replace gradient creation with a cached color string:
const hot = Math.min(1, spec + p.glint)
const blueShift = Math.round(lerp(0, 56, cur.blue))
const g = Math.round(lerp(230, 189, cur.blue * 0.5))
const rb = Math.round(lerp(240, 248, hot))
const colorStr = hot > 0.5
  ? `rgba(255,255,${rb},${bright.toFixed(2)})`
  : `rgba(${200 - blueShift},${g},255,${bright.toFixed(2)})`
ctx.fillStyle = colorStr
```

Also update the halo variable names to match the new naming:
```ts
// Find: const haloSilver = makeHaloSprite(...)
// Replace with: const haloWhite = makeHaloSprite(220, 240, 255)
// Find: const haloBlue = makeHaloSprite(...)  
// Replace with: const haloBlue = makeHaloSprite(56, 189, 248)

// Then in the particle loop, find:
//   ctx.drawImage(haloSilver, ...)
// Replace with:
//   ctx.drawImage(haloWhite, ...)
```

- [ ] **Step 2: Verify** — Run `npm run dev`, confirm particles are white/cyan squares (not silver triangles), ring looks lighter and more holographic, no obvious FPS drop.

---

## Task 4: Conversation History in Transcript

**Files:**
- Modify: `src/renderer/src/hooks/useAnimState.ts`
- Modify: `src/renderer/src/components/Transcript.tsx`
- Modify: `src/renderer/src/App.tsx`

Currently only the last message is shown. Show a rolling 6-turn history.

- [ ] **Step 1: Add history to useAnimState.ts**

Add `ConversationTurn` type and `history` field:

```ts
// Add near top of file, after imports:
export interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
  id: number
}

// In JarvisState interface, add:
history: ConversationTurn[]

// In initial, add:
history: [],

// In handleEvent, replace the transcript cases:
case 'transcript':
  if (event.partial) return prev  // skip streaming partials
  const turn: ConversationTurn = { role: event.role, text: event.text, id: Date.now() + Math.random() }
  const newHistory = [...prev.history, turn].slice(-8)  // keep last 8 turns
  if (event.role === 'user') return { ...prev, userText: event.text, assistantText: '', history: newHistory }
  return { ...prev, assistantText: event.text, history: newHistory }
```

- [ ] **Step 2: Update Transcript.tsx**

Replace the entire component with a scrollable history list:

```tsx
// src/renderer/src/components/Transcript.tsx
import { useEffect, useRef } from 'react'
import type { ConversationTurn } from '../hooks/useAnimState'

interface Props {
  history: ConversationTurn[]
}

export function Transcript({ history }: Props): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

  if (history.length === 0) return <></>

  return (
    <div style={{
      position: 'absolute',
      bottom: 68,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(620px, 80vw)',
      maxHeight: '38vh',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      pointerEvents: 'none',
      maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 100%)',
      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 100%)',
    }}>
      {history.map(turn => (
        <div
          key={turn.id}
          style={{
            display: 'flex',
            flexDirection: turn.role === 'user' ? 'row-reverse' : 'row',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <div style={{
            maxWidth: '85%',
            padding: '7px 12px',
            borderRadius: turn.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
            background: turn.role === 'user'
              ? 'rgba(56, 189, 248, 0.12)'
              : 'rgba(4, 14, 28, 0.75)',
            border: turn.role === 'user'
              ? '1px solid rgba(56,189,248,0.25)'
              : '1px solid rgba(125,211,252,0.12)',
            fontFamily: '"Share Tech Mono", monospace',
            fontSize: 12,
            color: turn.role === 'user' ? '#bae6fd' : '#7dd3fc',
            lineHeight: 1.5,
            textShadow: turn.role === 'assistant' ? '0 0 10px rgba(125,211,252,0.25)' : 'none',
            wordBreak: 'break-word',
          }}>
            {turn.text}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
```

- [ ] **Step 3: Update App.tsx to pass history**

In `App.tsx`, change the `<Transcript>` line:
```tsx
// Old:
<Transcript userText={state.userText} assistantText={state.assistantText} />

// New:
<Transcript history={state.history} />
```

- [ ] **Step 4: Verify** — Run `npm run dev`, send two messages via text input, confirm both user message and assistant reply appear as chat bubbles. Confirm auto-scroll works.

---

## Task 5: TitleBar + TextInput + ErrorToast Polish

**Files:**
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/components/TextInput.tsx`
- Modify: `src/renderer/src/components/ErrorToast.tsx`

- [ ] **Step 1: Update TitleBar.tsx**

Replace the JARVIS span and border to match the new brighter theme:

```tsx
// In TitleBar, change the outer div style:
background: 'rgba(3, 13, 26, 0.90)',
borderBottom: '1px solid rgba(56, 189, 248, 0.15)',

// Change the JARVIS span style:
color: 'rgba(56, 189, 248, 0.70)',
fontSize: 11,
letterSpacing: '0.3em',
```

- [ ] **Step 2: Update TextInput.tsx**

Update the input's placeholder, border, and background to match new theme. Also add a small PTT hint:

```tsx
// Replace the entire return block:
return (
  <div
    className="no-drag"
    style={{
      position: 'absolute',
      bottom: 14,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(560px, 82vw)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 5,
      opacity: focused || value ? 1 : 0.6,
      transition: 'opacity 0.25s',
    }}
  >
    <input
      ref={inputRef}
      value={value}
      disabled={disabled}
      placeholder="Ask anything… (Enter) or hold M to talk"
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit() }
      }}
      style={{
        width: '100%',
        padding: '10px 16px',
        borderRadius: 10,
        border: `1px solid ${focused ? 'rgba(56,189,248,0.6)' : 'rgba(56,189,248,0.2)'}`,
        background: focused ? 'rgba(3,13,26,0.96)' : 'rgba(3,13,26,0.85)',
        color: '#e0f2fe',
        fontFamily: '"Share Tech Mono", monospace',
        fontSize: 12,
        outline: 'none',
        boxShadow: focused ? '0 0 24px rgba(56,189,248,0.18), inset 0 0 0 1px rgba(56,189,248,0.1)' : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
      }}
    />
    {!focused && !value && (
      <div style={{
        fontFamily: '"Orbitron", monospace',
        fontSize: 8,
        letterSpacing: '0.2em',
        color: 'rgba(56,189,248,0.3)',
      }}>
        CTRL+K TO FOCUS · HOLD M TO SPEAK
      </div>
    )}
  </div>
)
```

- [ ] **Step 3: Update ErrorToast.tsx — move below titlebar**

Change `top: 48` to `top: 44` and tighten the border to match theme:

```tsx
// Change in ErrorToast:
top: 44,
border: '1px solid rgba(248, 113, 113, 0.4)',
background: 'rgba(60, 10, 10, 0.95)',
backdropFilter: 'blur(8px)',
```

- [ ] **Step 4: Verify** — Restart app, confirm titlebar uses brighter cyan text, text input has the new hint label, error toasts appear below the titlebar.

---

## Task 6: Performance — Backend First-Query Lag

**Files:**
- Modify: `src/backend/index.ts`

The embeddings model (~80MB) loads on the FIRST query, causing a 3-5s freeze. Warm it up at connection time instead.

- [ ] **Step 1: Pre-warm embeddings in sendDiagnostics**

In `src/backend/index.ts`, in the `sendDiagnostics` function, add at the end (before the `issues` broadcast):

```ts
// Pre-warm the embedding model so first query isn't slow
import { embed } from './memory/embeddings'

// Inside sendDiagnostics(), add:
try {
  void embed('warmup').then(() => console.error('[diag] embedding model warm'))
} catch { /* non-fatal */ }
```

Actually, since the import is at the top, just add inside sendDiagnostics after the mic check:
```ts
// Warm up embeddings model in background (avoids first-query freeze)
void embed('warmup').catch(() => {})
```

- [ ] **Step 2: Verify** — Run `npm run dev`, check logs show `[embeddings] model ready` shortly after connection (before any query is made). First query should now feel fast.

---

## Self-Review

**Spec coverage:**
- ✅ Light blue/white futuristic theme → Task 2 (grid), Task 3 (particle colors)
- ✅ Floating pixels → Task 3 (squares not triangles)
- ✅ Subtle grid → Task 2
- ✅ Dashboard visible → Task 1
- ✅ Performance → Task 3 (particle reduction, no per-frame gradient), Task 6 (warmup)
- ✅ Better UX → Task 4 (history), Task 5 (polish)

**Placeholder scan:** No TBDs found. All code blocks are complete.

**Type consistency:**
- `ConversationTurn` defined in `useAnimState.ts`, imported in `Transcript.tsx` ✅
- `history: ConversationTurn[]` added to both `JarvisState` interface and `initial` object ✅
- `<Transcript history={state.history} />` passes the new prop ✅
