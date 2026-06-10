# Jarvis Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Electron desktop app where the user holds Alt+Space to speak, Whisper transcribes it, Claude responds with a routed model (Fable or Haiku), ElevenLabs speaks the reply in a British male voice, all wrapped in a holographic particle ring UI.

**Architecture:** Two Node.js processes — Electron main/renderer (UI) + a local Node.js backend server (intelligence). They communicate over a local WebSocket. The renderer handles Canvas particle animation and audio capture; the backend handles all API calls.

**Tech Stack:** Electron + electron-vite, React + TypeScript, HTML5 Canvas 2D, `ws` WebSocket, `@anthropic-ai/sdk`, `@xenova/transformers` (Whisper STT + embeddings), ElevenLabs REST API, `googleapis` OAuth2, `better-sqlite3`, Vitest

---

## File Map

```
jarvis/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── vitest.config.ts
├── src/
│   ├── main/
│   │   └── index.ts              # Main process: window, spawns backend, IPC bridges
│   ├── preload/
│   │   └── index.ts              # Exposes contextBridge APIs to renderer
│   ├── renderer/
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx           # Root: websocket provider + layout
│   │       ├── components/
│   │       │   ├── ParticleRing.tsx    # Canvas particle ring + animation states
│   │       │   ├── HudOverlay.tsx     # Corner HUD elements (status, tokens, cost)
│   │       │   ├── Transcript.tsx     # Bottom-center transcript line
│   │       │   └── Dashboard.tsx      # Expandable stats panel
│   │       ├── hooks/
│   │       │   ├── useWebSocket.ts    # WS connection + message dispatch
│   │       │   └── useAnimState.ts    # Animation state machine
│   │       └── styles/
│   │           └── global.css         # Orbitron font, dark base, no window chrome
│   └── backend/
│       ├── index.ts              # Express + WebSocket server entry
│       ├── types.ts              # Shared WS event types (renderer ↔ backend)
│       ├── claude.ts             # Anthropic SDK + model routing + streaming
│       ├── whisper.ts            # @xenova/transformers Whisper STT
│       ├── elevenlabs.ts         # ElevenLabs TTS REST client
│       ├── tools/
│       │   ├── index.ts          # Tool registry (Claude tool_use definitions)
│       │   ├── gmail.ts          # Gmail OAuth2 + search/read tools
│       │   ├── filesystem.ts     # fs_read, fs_list, fs_search tools
│       │   └── launcher.ts       # app_launch tool (Windows shell)
│       └── memory/
│           ├── db.ts             # SQLite schema + query helpers
│           ├── logger.ts         # API call logging to api_calls table
│           └── embeddings.ts     # @xenova/transformers embeddings + memory retrieval
├── tests/
│   └── backend/
│       ├── claude.test.ts
│       ├── tools/
│       │   ├── filesystem.test.ts
│       │   └── launcher.test.ts
│       └── memory/
│           ├── db.test.ts
│           └── embeddings.test.ts
└── resources/
    └── .gitkeep               # whisper/embedding models download here at runtime
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vitest.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/index.html`

- [ ] **Step 1: Scaffold with electron-vite**

```bash
npm create @quick-start/electron@latest jarvis -- --template react-ts
cd jarvis
npm install
```

- [ ] **Step 2: Install backend and shared dependencies**

```bash
npm install @anthropic-ai/sdk @xenova/transformers better-sqlite3 ws googleapis express
npm install -D vitest @types/better-sqlite3 @types/ws @types/express
```

- [ ] **Step 3: Add vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Replace src/renderer/index.html with frameless window markup**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jarvis</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Configure frameless fullscreen window in src/main/index.ts**

Replace the generated main/index.ts content:
```ts
import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  backendProcess?.kill()
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: Verify app launches**

```bash
npm run dev
```

Expected: Electron window opens (may be transparent/blank). No console errors.

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold electron-vite project with frameless window"
```

---

## Task 2: Backend WebSocket Server + Shared Event Types

**Files:**
- Create: `src/backend/types.ts`
- Create: `src/backend/index.ts`

- [ ] **Step 1: Write the shared event type test**

Create `tests/backend/types.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { BackendEvent, RendererEvent } from '../../src/backend/types'

describe('event types', () => {
  it('BackendEvent state event has correct shape', () => {
    const event: BackendEvent = { type: 'state', state: 'idle' }
    expect(event.type).toBe('state')
  })

  it('RendererEvent audio event has correct shape', () => {
    const event: RendererEvent = { type: 'audio', data: Buffer.from([]) }
    expect(event.type).toBe('audio')
  })
})
```

- [ ] **Step 2: Run test — verify it fails (types not defined)**

```bash
npx vitest run tests/backend/types.test.ts
```

Expected: FAIL — "Cannot find module '../../src/backend/types'"

- [ ] **Step 3: Create src/backend/types.ts**

```ts
// Events sent from backend → renderer
export type AnimState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type BackendEvent =
  | { type: 'state'; state: AnimState }
  | { type: 'transcript'; role: 'user' | 'assistant'; text: string; partial: boolean }
  | { type: 'stats'; tokensToday: number; costToday: number; model: string }
  | { type: 'audio'; data: Buffer }
  | { type: 'error'; message: string }
  | { type: 'dashboard_open' }

// Events sent from renderer → backend
export type RendererEvent =
  | { type: 'audio'; data: Buffer }         // WAV audio for STT
  | { type: 'command'; text: string }        // Typed command
  | { type: 'dashboard_open' }
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/backend/types.test.ts
```

Expected: PASS

- [ ] **Step 5: Create src/backend/index.ts**

```ts
import { WebSocketServer, WebSocket } from 'ws'
import express from 'express'
import { createServer } from 'http'
import type { BackendEvent, RendererEvent } from './types'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

const PORT = parseInt(process.env.JARVIS_PORT ?? '0', 10)

export let broadcast: (event: BackendEvent) => void = () => {}

wss.on('connection', (ws: WebSocket) => {
  console.log('[backend] renderer connected')

  broadcast = (event: BackendEvent) => {
    const msg = event.type === 'audio'
      ? event.data
      : JSON.stringify(event)
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  }

  ws.on('message', (raw) => {
    if (Buffer.isBuffer(raw)) {
      handleRendererEvent({ type: 'audio', data: raw })
    } else {
      try {
        handleRendererEvent(JSON.parse(raw.toString()) as RendererEvent)
      } catch {
        console.error('[backend] invalid message', raw)
      }
    }
  })

  ws.on('close', () => console.log('[backend] renderer disconnected'))

  // Send initial stats on connect
  broadcast({ type: 'state', state: 'idle' })
})

function handleRendererEvent(event: RendererEvent): void {
  // Handlers registered by feature modules
  eventHandlers.forEach(h => h(event))
}

export const eventHandlers: Array<(e: RendererEvent) => void> = []

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address() as { port: number }
  // Print port to stdout so Electron main process can discover it
  process.stdout.write(JSON.stringify({ type: 'ready', port: addr.port }) + '\n')
})
```

- [ ] **Step 6: Wire backend spawn into src/main/index.ts**

Add to `createWindow()` before `mainWindow.loadURL(...)`:
```ts
import { join } from 'path'

// Spawn backend as child process
backendProcess = spawn(
  process.execPath,
  [join(__dirname, '../../backend/index.js')],
  { env: { ...process.env, JARVIS_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] }
)

backendProcess.stdout?.on('data', (data: Buffer) => {
  try {
    const msg = JSON.parse(data.toString().trim())
    if (msg.type === 'ready') {
      process.env.JARVIS_BACKEND_PORT = String(msg.port)
      mainWindow?.webContents.send('backend-port', msg.port)
    }
  } catch { /* partial line */ }
})
```

- [ ] **Step 7: Commit**

```bash
git add src/backend/types.ts src/backend/index.ts src/main/index.ts tests/backend/types.test.ts
git commit -m "feat: add backend websocket server and shared event types"
```

---

## Task 3: Renderer WebSocket Hook

**Files:**
- Create: `src/renderer/src/hooks/useWebSocket.ts`
- Create: `src/renderer/src/hooks/useAnimState.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Expose backend port via contextBridge in preload**

Replace `src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('jarvis', {
  onBackendPort: (cb: (port: number) => void) =>
    ipcRenderer.on('backend-port', (_e, port) => cb(port)),
})
```

- [ ] **Step 2: Create useWebSocket.ts**

Create `src/renderer/src/hooks/useWebSocket.ts`:
```ts
import { useEffect, useRef, useCallback } from 'react'
import type { BackendEvent, RendererEvent } from '../../../backend/types'

type Handler = (event: BackendEvent) => void

let ws: WebSocket | null = null
const handlers = new Set<Handler>()

export function useWebSocket(onEvent: Handler): {
  send: (event: RendererEvent) => void
  sendBinary: (data: ArrayBuffer) => void
} {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    const handler: Handler = (e) => cbRef.current(e)
    handlers.add(handler)

    if (!ws) {
      ;(window as any).jarvis.onBackendPort((port: number) => {
        ws = new WebSocket(`ws://127.0.0.1:${port}`)
        ws.binaryType = 'arraybuffer'

        ws.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer) {
            handlers.forEach(h => h({ type: 'audio', data: e.data as unknown as Buffer }))
          } else {
            try {
              const event = JSON.parse(e.data) as BackendEvent
              handlers.forEach(h => h(event))
            } catch { /* ignore */ }
          }
        }
      })
    }

    return () => { handlers.delete(handler) }
  }, [])

  const send = useCallback((event: RendererEvent) => {
    ws?.send(JSON.stringify(event))
  }, [])

  const sendBinary = useCallback((data: ArrayBuffer) => {
    ws?.send(data)
  }, [])

  return { send, sendBinary }
}
```

- [ ] **Step 3: Create useAnimState.ts**

Create `src/renderer/src/hooks/useAnimState.ts`:
```ts
import { useState, useCallback } from 'react'
import type { AnimState, BackendEvent } from '../../../backend/types'

export function useAnimState(): {
  state: AnimState
  handleEvent: (event: BackendEvent) => void
} {
  const [state, setState] = useState<AnimState>('idle')

  const handleEvent = useCallback((event: BackendEvent) => {
    if (event.type === 'state') setState(event.state)
  }, [])

  return { state, handleEvent }
}
```

- [ ] **Step 4: Wire into App.tsx**

Replace `src/renderer/src/App.tsx`:
```tsx
import { useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import type { BackendEvent } from '../../backend/types'

export default function App(): JSX.Element {
  const { state, handleEvent } = useAnimState()

  const onEvent = useCallback((event: BackendEvent) => {
    handleEvent(event)
  }, [handleEvent])

  useWebSocket(onEvent)

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#060b14', position: 'relative' }}>
      <div style={{ color: '#7dd3fc', fontFamily: 'Orbitron', position: 'absolute', top: 20, left: 20 }}>
        JARVIS — {state.toUpperCase()}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify app connects**

```bash
npm run dev
```

Expected: App launches, browser console shows no WebSocket errors, backend logs "renderer connected".

- [ ] **Step 6: Commit**

```bash
git add src/preload/index.ts src/renderer/src/hooks/ src/renderer/src/App.tsx
git commit -m "feat: renderer websocket hook with animation state machine"
```

---

## Task 4: Particle Ring Canvas

**Files:**
- Create: `src/renderer/src/components/ParticleRing.tsx`
- Create: `src/renderer/src/styles/global.css`
- Modify: `src/renderer/src/App.tsx`

> **Note:** This is a visual component — use the `frontend-design` skill when implementing for production-quality particle physics, metallic shimmer, and glow effects. The implementation below is the functional baseline.

- [ ] **Step 1: Create global.css**

Create `src/renderer/src/styles/global.css`:
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: transparent;
  overflow: hidden;
  user-select: none;
  -webkit-app-region: drag;
}

#root {
  width: 100vw;
  height: 100vh;
}

.no-drag { -webkit-app-region: no-drag; }
```

- [ ] **Step 2: Create ParticleRing.tsx**

Create `src/renderer/src/components/ParticleRing.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import type { AnimState } from '../../../backend/types'

interface Particle {
  angle: number       // current angle on ring (radians)
  radius: number      // distance from center (varies around ringRadius)
  speed: number       // angular velocity
  size: number        // triangle side length
  rotation: number    // triangle self-rotation
  rotSpeed: number    // triangle rotation speed
  opacity: number
  shimmer: number     // shimmer phase offset
}

interface Props {
  state: AnimState
}

const NUM_PARTICLES = 180
const BASE_RING_RADIUS_RATIO = 0.28   // fraction of min(w,h)
const RING_THICKNESS_RATIO = 0.06

function createParticles(): Particle[] {
  return Array.from({ length: NUM_PARTICLES }, (_, i) => ({
    angle: (i / NUM_PARTICLES) * Math.PI * 2 + (Math.random() - 0.5) * 0.3,
    radius: 0,
    speed: (0.0003 + Math.random() * 0.0004) * (Math.random() < 0.5 ? 1 : -1),
    size: 2 + Math.random() * 3,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.02,
    opacity: 0.4 + Math.random() * 0.6,
    shimmer: Math.random() * Math.PI * 2,
  }))
}

function drawTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number, opacity: number, shimmer: number, t: number): void {
  const shimmerVal = 0.7 + 0.3 * Math.sin(t * 0.002 + shimmer)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.globalAlpha = opacity * shimmerVal
  // Metallic silver/white gradient
  const grad = ctx.createLinearGradient(-size, -size, size, size)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.5, '#c8d8e8')
  grad.addColorStop(1, '#8ab0c8')
  ctx.fillStyle = grad
  ctx.shadowColor = 'rgba(200, 220, 255, 0.6)'
  ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size * 0.866, size * 0.5)
  ctx.lineTo(-size * 0.866, size * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function ParticleRing({ state }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>(createParticles())
  const rafRef = useRef<number>(0)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    const resize = (): void => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    let t = 0

    const animate = (): void => {
      const { width: w, height: h } = canvas
      const cx = w / 2
      const cy = h / 2
      const minDim = Math.min(w, h)
      const ringRadius = minDim * BASE_RING_RADIUS_RATIO
      const thickness = minDim * RING_THICKNESS_RATIO
      const currentState = stateRef.current

      ctx.clearRect(0, 0, w, h)

      // State-based parameters
      const speedMult = currentState === 'thinking' ? 3 : currentState === 'speaking' ? 1.5 : 1
      const radiusNoise = currentState === 'thinking' ? 1.5 : 1
      const ringPulse = currentState === 'listening'
        ? Math.sin(t * 0.05) * 8
        : currentState === 'speaking'
        ? Math.sin(t * 0.03) * 12
        : 0

      // Ambient glow ring
      if (currentState === 'thinking') {
        const grd = ctx.createRadialGradient(cx, cy, ringRadius - 20, cx, cy, ringRadius + 20)
        grd.addColorStop(0, 'rgba(59,130,246,0)')
        grd.addColorStop(0.5, 'rgba(59,130,246,0.08)')
        grd.addColorStop(1, 'rgba(59,130,246,0)')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, w, h)
      }

      particles.current.forEach((p) => {
        // Update position
        p.angle += p.speed * speedMult
        p.rotation += p.rotSpeed

        // Radius drifts around the ring
        const targetRadius = ringRadius + ringPulse + (Math.sin(p.shimmer + t * 0.001) * thickness * radiusNoise)
        p.radius += (targetRadius - p.radius) * 0.05

        const x = cx + Math.cos(p.angle) * p.radius
        const y = cy + Math.sin(p.angle) * p.radius

        drawTriangle(ctx, x, y, p.size, p.rotation, p.opacity, p.shimmer, t)
      })

      t++
      rafRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}
```

- [ ] **Step 3: Add ParticleRing to App.tsx**

```tsx
import { useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
import type { BackendEvent } from '../../backend/types'
import './styles/global.css'

export default function App(): JSX.Element {
  const { state, handleEvent } = useAnimState()

  const onEvent = useCallback((event: BackendEvent) => {
    handleEvent(event)
  }, [handleEvent])

  useWebSocket(onEvent)

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#060b14', position: 'relative' }}>
      <ParticleRing state={state} />
    </div>
  )
}
```

- [ ] **Step 4: Verify visually**

```bash
npm run dev
```

Expected: Electron window shows dark background with a ring of small silver/white triangles slowly orbiting. Console: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ParticleRing.tsx src/renderer/src/styles/global.css src/renderer/src/App.tsx
git commit -m "feat: particle ring canvas with idle/thinking/listening/speaking states"
```

---

## Task 5: HUD Overlays + Transcript

**Files:**
- Create: `src/renderer/src/components/HudOverlay.tsx`
- Create: `src/renderer/src/components/Transcript.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/hooks/useAnimState.ts`

- [ ] **Step 1: Extend useAnimState to track stats and transcript**

Replace `src/renderer/src/hooks/useAnimState.ts`:
```ts
import { useState, useCallback } from 'react'
import type { AnimState, BackendEvent } from '../../../backend/types'

export interface JarvisState {
  anim: AnimState
  tokensToday: number
  costToday: number
  model: string
  userText: string
  assistantText: string
}

const initial: JarvisState = {
  anim: 'idle',
  tokensToday: 0,
  costToday: 0,
  model: 'fable',
  userText: '',
  assistantText: '',
}

export function useAnimState(): {
  state: JarvisState
  handleEvent: (event: BackendEvent) => void
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
        default:
          return prev
      }
    })
  }, [])

  return { state, handleEvent }
}
```

- [ ] **Step 2: Create HudOverlay.tsx**

Create `src/renderer/src/components/HudOverlay.tsx`:
```tsx
import type { AnimState } from '../../../backend/types'

const STATUS_LABELS: Record<AnimState, string> = {
  idle: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'SPEAKING',
}

const STATUS_COLORS: Record<AnimState, string> = {
  idle: '#4ade80',
  listening: '#60a5fa',
  thinking: '#f59e0b',
  speaking: '#a78bfa',
}

interface Props {
  animState: AnimState
  tokensToday: number
  costToday: number
  model: string
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

export function HudOverlay({ animState, tokensToday, costToday, model }: Props): JSX.Element {
  return (
    <>
      {/* Top-left: identity + status */}
      <div style={{ ...hud, top: 24, left: 24 }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#e0f2fe' }}>JARVIS</div>
        <div style={line} />
        <div style={{ color: STATUS_COLORS[animState] }}>{STATUS_LABELS[animState]}</div>
      </div>

      {/* Top-right: stats */}
      <div style={{ ...hud, top: 24, right: 24, textAlign: 'right' }}>
        <div>{tokensToday.toLocaleString()} TOKENS</div>
        <div style={{ ...line, marginLeft: 'auto' }} />
        <div>${costToday.toFixed(4)} TODAY</div>
        <div style={{ color: '#94a3b8', marginTop: 2 }}>{model.toUpperCase()}</div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Create Transcript.tsx**

Create `src/renderer/src/components/Transcript.tsx`:
```tsx
interface Props {
  userText: string
  assistantText: string
}

export function Transcript({ userText, assistantText }: Props): JSX.Element {
  const text = assistantText || userText
  const prefix = assistantText ? '» ' : '> '

  return (
    <div style={{
      position: 'absolute',
      bottom: 40,
      left: '50%',
      transform: 'translateX(-50%)',
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '13px',
      color: assistantText ? '#7dd3fc' : '#94a3b8',
      letterSpacing: '0.05em',
      maxWidth: '60vw',
      textAlign: 'center',
      pointerEvents: 'none',
      textShadow: assistantText ? '0 0 12px rgba(125,211,252,0.4)' : 'none',
    }}>
      {text ? `${prefix}${text}` : ''}
    </div>
  )
}
```

- [ ] **Step 4: Update App.tsx to use all components**

```tsx
import { useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useAnimState } from './hooks/useAnimState'
import { ParticleRing } from './components/ParticleRing'
import { HudOverlay } from './components/HudOverlay'
import { Transcript } from './components/Transcript'
import type { BackendEvent } from '../../backend/types'
import './styles/global.css'

export default function App(): JSX.Element {
  const { state, handleEvent } = useAnimState()

  const onEvent = useCallback((event: BackendEvent) => {
    handleEvent(event)
  }, [handleEvent])

  useWebSocket(onEvent)

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#060b14', position: 'relative' }}>
      <ParticleRing state={state.anim} />
      <HudOverlay
        animState={state.anim}
        tokensToday={state.tokensToday}
        costToday={state.costToday}
        model={state.model}
      />
      <Transcript userText={state.userText} assistantText={state.assistantText} />
    </div>
  )
}
```

- [ ] **Step 5: Verify visually**

```bash
npm run dev
```

Expected: HUD corners show "JARVIS / ONLINE" top-left, "0 TOKENS / $0.0000 TODAY / FABLE" top-right. Transcript area at bottom center.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/HudOverlay.tsx src/renderer/src/components/Transcript.tsx src/renderer/src/hooks/useAnimState.ts src/renderer/src/App.tsx
git commit -m "feat: hud overlays and transcript display with orbitron/share-tech-mono fonts"
```

---

## Task 6: Push-to-Talk Audio Capture

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Register global hotkey in src/main/index.ts**

Add inside `app.whenReady().then(...)` after `createWindow()`:
```ts
globalShortcut.register('Alt+Space', () => {
  mainWindow?.webContents.send('ptt-start')
})

// We detect key-up via renderer keyup event instead
// (globalShortcut doesn't expose key-up on Windows)
```

- [ ] **Step 2: Expose PTT IPC in preload**

Update `src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('jarvis', {
  onBackendPort: (cb: (port: number) => void) =>
    ipcRenderer.on('backend-port', (_e, port) => cb(port)),
  onPttStart: (cb: () => void) =>
    ipcRenderer.on('ptt-start', () => cb()),
})
```

- [ ] **Step 3: Add audio capture hook to App.tsx**

First update the App.tsx `useWebSocket` call to capture `send` and `sendBinary` (replace the bare `useWebSocket(onEvent)` line from Task 3):
```tsx
const { send, sendBinary } = useWebSocket(onEvent)
```

Then add mic capture refs and effect (after the `useWebSocket` line):
```tsx
import { useEffect, useRef } from 'react'

// Inside App component, add:
const mediaRecorderRef = useRef<MediaRecorder | null>(null)
const chunksRef = useRef<Blob[]>([])

useEffect(() => {
  let recording = false

  const startRecording = async (): Promise<void> => {
    if (recording) return
    recording = true
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    chunksRef.current = []
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      const buffer = await blob.arrayBuffer()
      sendBinary(buffer)
      stream.getTracks().forEach(t => t.stop())
      recording = false
    }
    recorder.start()
    mediaRecorderRef.current = recorder
    send({ type: 'command', text: '__ptt_start' })
  }

  const stopRecording = (): void => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  ;(window as any).jarvis.onPttStart(startRecording)

  // Alt+Space key-up stops recording
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && e.altKey) stopRecording()
  }
  window.addEventListener('keyup', onKeyUp)

  return () => window.removeEventListener('keyup', onKeyUp)
}, [send, sendBinary])
```

- [ ] **Step 4: Handle `__ptt_start` signal in backend to set listening state**

Add to `src/backend/index.ts` inside `handleRendererEvent`:
```ts
// Add at the top of the function:
if (event.type === 'command' && event.text === '__ptt_start') {
  broadcast({ type: 'state', state: 'listening' })
  return
}
```

- [ ] **Step 5: Verify manually**

```bash
npm run dev
```

Hold Alt+Space → particle ring should switch to listening state (tighter, pulsing). Release → ring returns to idle. Check browser console: no MediaRecorder errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/App.tsx src/backend/index.ts
git commit -m "feat: push-to-talk audio capture with listening animation state"
```

---

## Task 7: Whisper STT

**Files:**
- Create: `src/backend/whisper.ts`
- Modify: `src/backend/index.ts`

- [ ] **Step 1: Write Whisper STT test**

Create `tests/backend/whisper.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

// We test the module interface, not the actual model (which requires a download)
describe('whisper module', () => {
  it('transcribe returns a string', async () => {
    // Shallow test: module exports transcribe function
    const mod = await import('../../src/backend/whisper')
    expect(typeof mod.transcribe).toBe('function')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/whisper.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create src/backend/whisper.ts**

```ts
import { pipeline, Pipeline } from '@xenova/transformers'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

let transcriber: Pipeline | null = null

async function getTranscriber(): Promise<Pipeline> {
  if (!transcriber) {
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', {
      // Cache models in resources/
      cache_dir: join(process.cwd(), 'resources'),
    })
  }
  return transcriber
}

export async function transcribe(audioBuffer: Buffer): Promise<string> {
  const tmp = join(tmpdir(), `jarvis-${randomBytes(6).toString('hex')}.webm`)
  await writeFile(tmp, audioBuffer)

  try {
    const t = await getTranscriber()
    const result = await t(tmp, { language: 'english' })
    return (result as any).text?.trim() ?? ''
  } finally {
    await unlink(tmp).catch(() => {})
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/backend/whisper.test.ts
```

Expected: PASS

- [ ] **Step 5: Wire into backend — handle incoming audio buffer**

In `src/backend/index.ts`, add import and audio handler:
```ts
import { transcribe } from './whisper'

// Add handler in eventHandlers setup:
eventHandlers.push(async (event) => {
  if (event.type !== 'audio') return
  broadcast({ type: 'state', state: 'thinking' })
  try {
    const text = await transcribe(event.data)
    if (text) {
      broadcast({ type: 'transcript', role: 'user', text, partial: false })
      // TODO Task 9: pass to Claude
    }
  } catch (err) {
    broadcast({ type: 'error', message: String(err) })
  } finally {
    broadcast({ type: 'state', state: 'idle' })
  }
})
```

- [ ] **Step 6: Verify manually**

```bash
npm run dev
```

Hold Alt+Space, say "Hello Jarvis", release. Check backend console: should print transcribed text. App should switch idle→listening→thinking→idle. Note: First run downloads whisper-small.en model (~150MB) to `resources/`.

- [ ] **Step 7: Commit**

```bash
git add src/backend/whisper.ts tests/backend/whisper.test.ts src/backend/index.ts
git commit -m "feat: whisper stt via @xenova/transformers whisper-small.en model"
```

---

## Task 8: ElevenLabs TTS

**Files:**
- Create: `src/backend/elevenlabs.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write ElevenLabs test**

Create `tests/backend/elevenlabs.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('elevenlabs module', () => {
  it('exports synthesize function', async () => {
    const mod = await import('../../src/backend/elevenlabs')
    expect(typeof mod.synthesize).toBe('function')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/elevenlabs.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create src/backend/elevenlabs.ts**

```ts
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? ''
// Default: "Bill" voice — deep British male, close to MCU Jarvis
// Find your preferred voice ID at elevenlabs.io/voice-lab
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? 'pqHfZKP75CvOlQylNhV4'

export async function synthesize(text: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.4, similarity_boost: 0.85 },
    }),
  })

  if (!res.ok) throw new Error(`ElevenLabs error: ${res.status} ${await res.text()}`)

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/backend/elevenlabs.test.ts
```

Expected: PASS

- [ ] **Step 5: Add audio playback in renderer App.tsx**

Add to the `onEvent` handler in App.tsx:
```tsx
const onEvent = useCallback((event: BackendEvent) => {
  handleEvent(event)

  if (event.type === 'audio') {
    // Play TTS audio
    const blob = new Blob([event.data as unknown as ArrayBuffer], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => URL.revokeObjectURL(url)
    audio.play()
  }
}, [handleEvent])
```

- [ ] **Step 6: Create .env.local for API keys**

Create `.env.local` (add to .gitignore):
```
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=pqHfZKP75CvOlQylNhV4
ANTHROPIC_API_KEY=your_key_here
```

Add to `.gitignore`:
```
.env.local
resources/
```

- [ ] **Step 7: Load .env in backend index.ts**

Add at very top of `src/backend/index.ts`:
```ts
import { config } from 'dotenv'
config({ path: '.env.local' })
```

Also `npm install dotenv`.

- [ ] **Step 8: Commit**

```bash
git add src/backend/elevenlabs.ts tests/backend/elevenlabs.test.ts src/renderer/src/App.tsx .gitignore
git commit -m "feat: elevenlabs tts with audio streaming to renderer"
```

---

## Task 9: Claude Integration + Model Routing

**Files:**
- Create: `src/backend/claude.ts`
- Create: `src/backend/tools/index.ts`

- [ ] **Step 1: Write Claude routing test**

Create `tests/backend/claude.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { selectModel } from '../../src/backend/claude'

describe('selectModel', () => {
  it('routes short messages to haiku', () => {
    expect(selectModel('open vs code')).toBe('claude-haiku-4-5-20251001')
  })

  it('routes long messages to fable', () => {
    const long = 'Can you search my emails for the invoice from last month and summarize the total amount?'
    expect(selectModel(long)).toBe('claude-fable-5')
  })

  it('routes messages with tool keywords to fable', () => {
    expect(selectModel('email')).toBe('claude-fable-5')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/claude.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create src/backend/claude.ts**

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { BackendEvent } from './types'
import { getTools } from './tools/index'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOOL_KEYWORDS = ['email', 'file', 'open', 'search', 'send', 'find', 'launch', 'remember', 'read', 'write']

export function selectModel(text: string): string {
  const words = text.trim().split(/\s+/)
  const hasToolKeyword = TOOL_KEYWORDS.some(kw => text.toLowerCase().includes(kw))
  if (words.length <= 15 && !hasToolKeyword) return 'claude-haiku-4-5-20251001'
  return 'claude-fable-5'
}

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant. You speak in a polished, concise British manner — helpful and confident without being verbose. Keep responses under 3 sentences unless detail is genuinely needed. When using tools, act without asking for permission unless the action is destructive (sending email, running files).`

interface Message { role: 'user' | 'assistant'; content: string }

export async function chat(
  userText: string,
  history: Message[],
  memories: string[],
  broadcast: (e: BackendEvent) => void,
): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }> {
  const model = selectModel(userText)
  const memoryContext = memories.length > 0
    ? `\n\nRelevant context about the user:\n${memories.map(m => `- ${m}`).join('\n')}`
    : ''

  broadcast({ type: 'state', state: 'thinking' })

  const messages = [
    ...history,
    { role: 'user' as const, content: userText },
  ]

  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0

  const stream = client.messages.stream({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT + memoryContext,
    messages,
    tools: getTools(),
  })

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
      fullText += chunk.delta.text
      broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: true })
    }
    if (chunk.type === 'message_delta') {
      outputTokens = chunk.usage?.output_tokens ?? 0
    }
    if (chunk.type === 'message_start') {
      inputTokens = chunk.message.usage?.input_tokens ?? 0
    }
  }

  broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
  broadcast({ type: 'state', state: 'speaking' })

  return { text: fullText, model, inputTokens, outputTokens }
}
```

- [ ] **Step 4: Create src/backend/tools/index.ts (stub — tools added in Tasks 11-13)**

```ts
import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return []  // Tools registered in Tasks 11-13
}
```

- [ ] **Step 5: Run test — verify it passes**

```bash
npx vitest run tests/backend/claude.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/backend/claude.ts src/backend/tools/index.ts tests/backend/claude.test.ts
git commit -m "feat: claude integration with fable/haiku model routing and streaming"
```

---

## Task 10: Full Voice Loop Integration

**Files:**
- Modify: `src/backend/index.ts`

- [ ] **Step 1: Replace the audio handler stub with the full pipeline**

In `src/backend/index.ts`, replace the audio handler added in Task 7 with:
```ts
import { transcribe } from './whisper'
import { chat } from './claude'
import { synthesize } from './elevenlabs'
import { logApiCall } from './memory/logger'

const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []

eventHandlers.push(async (event) => {
  if (event.type !== 'audio') return

  broadcast({ type: 'state', state: 'thinking' })

  try {
    // 1. Transcribe
    const userText = await transcribe(event.data)
    if (!userText) { broadcast({ type: 'state', state: 'idle' }); return }

    broadcast({ type: 'transcript', role: 'user', text: userText, partial: false })

    // 2. Chat with Claude
    const { text, model, inputTokens, outputTokens } = await chat(
      userText,
      conversationHistory,
      [],  // memories — wired in Task 15
      broadcast,
    )

    // 3. Update history
    conversationHistory.push({ role: 'user', content: userText })
    conversationHistory.push({ role: 'assistant', content: text })
    if (conversationHistory.length > 40) conversationHistory.splice(0, 2)

    // 4. Log API call
    await logApiCall({ model, inputTokens, outputTokens })

    // 5. Synthesize speech
    const audioBuffer = await synthesize(text)
    broadcast({ type: 'audio', data: audioBuffer })
    broadcast({ type: 'state', state: 'speaking' })

    // 6. Emit updated stats
    const stats = await getStatsToday()
    broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model })

  } catch (err) {
    console.error('[pipeline]', err)
    broadcast({ type: 'error', message: String(err) })
  } finally {
    setTimeout(() => broadcast({ type: 'state', state: 'idle' }), 4000)
  }
})

// Stub until Task 14
async function getStatsToday(): Promise<{ tokens: number; cost: number }> {
  return { tokens: 0, cost: 0 }
}
```

- [ ] **Step 2: End-to-end manual test**

```bash
npm run dev
```

1. Hold Alt+Space
2. Say: "What is two plus two?"
3. Release
4. Expected flow: listening → thinking → speaking states, transcript appears, Jarvis voice responds "Four." or similar

- [ ] **Step 3: Commit**

```bash
git add src/backend/index.ts
git commit -m "feat: complete voice loop stt→claude→tts pipeline"
```

---

## Task 11: SQLite Schema + API Logging

**Files:**
- Create: `src/backend/memory/db.ts`
- Create: `src/backend/memory/logger.ts`
- Modify: `src/backend/index.ts`

- [ ] **Step 1: Write DB test**

Create `tests/backend/memory/db.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = 'tests/test.db'

describe('database', () => {
  afterEach(() => { if (existsSync(TEST_DB)) unlinkSync(TEST_DB) })

  it('initializes schema without error', async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { initDb } = await import('../../src/backend/memory/db')
    expect(() => initDb()).not.toThrow()
  })

  it('can insert and retrieve a memory', async () => {
    process.env.JARVIS_DB_PATH = TEST_DB
    const { initDb, insertMemory, getAllMemories } = await import('../../src/backend/memory/db')
    initDb()
    insertMemory('User prefers morning meetings', new Float32Array(3))
    const rows = getAllMemories()
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('User prefers morning meetings')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/memory/db.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create src/backend/memory/db.ts**

```ts
import Database from 'better-sqlite3'
import { join } from 'path'

const DB_PATH = process.env.JARVIS_DB_PATH ?? join(process.cwd(), 'jarvis.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) db = new Database(DB_PATH)
  return db
}

export function initDb(): void {
  const d = getDb()
  d.exec(`
    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

const MODEL_COST: Record<string, { input: number; output: number }> = {
  'claude-fable-5':           { input: 0.000003,  output: 0.000015 },
  'claude-haiku-4-5-20251001':{ input: 0.0000008, output: 0.000001 },
}

export function logApiCall(params: { model: string; inputTokens: number; outputTokens: number }): void {
  const cost = (MODEL_COST[params.model] ?? MODEL_COST['claude-fable-5'])
  const costUsd = cost.input * params.inputTokens + cost.output * params.outputTokens
  getDb().prepare(`
    INSERT INTO api_calls (timestamp, model, input_tokens, output_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?)
  `).run(Date.now(), params.model, params.inputTokens, params.outputTokens, costUsd)
}

export function getStatsToday(): { tokens: number; cost: number } {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const row = getDb().prepare(`
    SELECT
      SUM(input_tokens + output_tokens) as tokens,
      SUM(cost_usd) as cost
    FROM api_calls
    WHERE timestamp >= ?
  `).get(midnight.getTime()) as { tokens: number | null; cost: number | null }
  return { tokens: row.tokens ?? 0, cost: row.cost ?? 0 }
}

export function insertMemory(text: string, embedding: Float32Array): void {
  getDb().prepare(`
    INSERT INTO memories (timestamp, text, embedding) VALUES (?, ?, ?)
  `).run(Date.now(), text, Buffer.from(embedding.buffer))
}

export function getAllMemories(): Array<{ id: number; text: string; embedding: Float32Array }> {
  const rows = getDb().prepare('SELECT id, text, embedding FROM memories').all() as Array<{ id: number; text: string; embedding: Buffer }>
  return rows.map(r => ({
    id: r.id,
    text: r.text,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.length / 4),
  }))
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/backend/memory/db.test.ts
```

Expected: PASS

- [ ] **Step 5: Create src/backend/memory/logger.ts**

```ts
import { logApiCall as dbLog, getStatsToday as dbStats } from './db'

export async function logApiCall(params: { model: string; inputTokens: number; outputTokens: number }): Promise<void> {
  dbLog(params)
}

export function getStatsToday(): { tokens: number; cost: number } {
  return dbStats()
}
```

- [ ] **Step 6: Wire real stats into backend index.ts**

Replace the `getStatsToday` stub in `src/backend/index.ts`:
```ts
import { initDb } from './memory/db'
import { logApiCall, getStatsToday } from './memory/logger'

// Call initDb() before starting the server — add at bottom of file before server.listen:
initDb()
```

Also replace `async function getStatsToday()...` stub with:
```ts
// (delete the stub, import is already above)
```

And in the pipeline handler, replace `await logApiCall(...)` with the real import.

- [ ] **Step 7: Commit**

```bash
git add src/backend/memory/db.ts src/backend/memory/logger.ts tests/backend/memory/db.test.ts src/backend/index.ts
git commit -m "feat: sqlite schema with api call logging and daily stats"
```

---

## Task 12: Memory System (Embeddings + Retrieval)

**Files:**
- Create: `src/backend/memory/embeddings.ts`
- Modify: `src/backend/index.ts`

- [ ] **Step 1: Write embeddings test**

Create `tests/backend/memory/embeddings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('embeddings module', () => {
  it('exports embed and findTopK functions', async () => {
    const mod = await import('../../src/backend/memory/embeddings')
    expect(typeof mod.embed).toBe('function')
    expect(typeof mod.findTopK).toBe('function')
  })

  it('findTopK returns empty array when no memories', async () => {
    const { findTopK } = await import('../../src/backend/memory/embeddings')
    const queryVec = new Float32Array(384).fill(0.1)
    const result = findTopK(queryVec, [], 3)
    expect(result).toEqual([])
  })

  it('findTopK returns top K by cosine similarity', async () => {
    const { findTopK } = await import('../../src/backend/memory/embeddings')
    const memories = [
      { id: 1, text: 'a', embedding: new Float32Array(4).fill(1) },
      { id: 2, text: 'b', embedding: new Float32Array(4).fill(0) },
      { id: 3, text: 'c', embedding: new Float32Array([1, 0, 0, 0]) },
    ]
    const query = new Float32Array(4).fill(1)
    const result = findTopK(query, memories, 1)
    expect(result[0].text).toBe('a')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/memory/embeddings.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create src/backend/memory/embeddings.ts**

```ts
import { pipeline, Pipeline } from '@xenova/transformers'
import { join } from 'path'

let embedder: Pipeline | null = null

async function getEmbedder(): Promise<Pipeline> {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      cache_dir: join(process.cwd(), 'resources'),
    })
  }
  return embedder
}

export async function embed(text: string): Promise<Float32Array> {
  const model = await getEmbedder()
  const output = await model(text, { pooling: 'mean', normalize: true })
  return output.data as Float32Array
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

export function findTopK(
  query: Float32Array,
  memories: Array<{ id: number; text: string; embedding: Float32Array }>,
  k: number,
): Array<{ id: number; text: string; score: number }> {
  return memories
    .map(m => ({ id: m.id, text: m.text, score: cosineSimilarity(query, m.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/backend/memory/embeddings.test.ts
```

Expected: PASS

- [ ] **Step 5: Wire memory retrieval into the voice pipeline**

In `src/backend/index.ts`, update the audio handler to inject memories:
```ts
import { embed, findTopK } from './memory/embeddings'
import { getAllMemories, insertMemory } from './memory/db'

// Inside the pipeline handler, replace `[]  // memories` with:
const queryVec = await embed(userText)
const allMems = getAllMemories()
const topMems = findTopK(queryVec, allMems, 3).map(m => m.text)

const { text, model, inputTokens, outputTokens } = await chat(
  userText,
  conversationHistory,
  topMems,
  broadcast,
)
```

- [ ] **Step 6: Add memory_write tool handling**

In `src/backend/index.ts`, add a handler that listens for Claude tool calls (extend `chat` in claude.ts later — for now add a `REMEMBER:` prefix convention):

In `src/backend/claude.ts`, after assembling `fullText`, add:
```ts
// Simple memory extraction: if response contains [REMEMBER: fact], save it
const memMatch = fullText.match(/\[REMEMBER:\s*([^\]]+)\]/i)
if (memMatch) {
  // Exported so backend can call it
  pendingMemory = memMatch[1].trim()
  fullText = fullText.replace(memMatch[0], '').trim()
}

export let pendingMemory: string | null = null
```

In `src/backend/index.ts`, after getting the response:
```ts
import { pendingMemory } from './claude'

if (pendingMemory) {
  const vec = await embed(pendingMemory)
  insertMemory(pendingMemory, vec)
  ;(require('./claude') as any).pendingMemory = null
}
```

- [ ] **Step 7: Commit**

```bash
git add src/backend/memory/embeddings.ts tests/backend/memory/embeddings.test.ts src/backend/index.ts src/backend/claude.ts
git commit -m "feat: memory system with all-MiniLM-L6-v2 embeddings and cosine retrieval"
```

---

## Task 13: File System Tools

**Files:**
- Create: `src/backend/tools/filesystem.ts`
- Modify: `src/backend/tools/index.ts`

- [ ] **Step 1: Write filesystem tool tests**

Create `tests/backend/tools/filesystem.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFile, listDir, searchFiles } from '../../src/backend/tools/filesystem'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const TMP = 'tests/tmp-fs'

describe('filesystem tools', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'hello.txt'), 'Hello Jarvis')
    writeFileSync(join(TMP, 'notes.txt'), 'Meeting notes')
  })

  afterEach(() => rmSync(TMP, { recursive: true, force: true }))

  it('readFile returns file contents', async () => {
    const result = await readFile(join(TMP, 'hello.txt'))
    expect(result).toBe('Hello Jarvis')
  })

  it('listDir returns file names', async () => {
    const result = await listDir(TMP)
    expect(result).toContain('hello.txt')
    expect(result).toContain('notes.txt')
  })

  it('searchFiles finds files by name pattern', async () => {
    const result = await searchFiles(TMP, 'notes')
    expect(result.some(f => f.includes('notes.txt'))).toBe(true)
  })

  it('readFile throws on path traversal', async () => {
    await expect(readFile('../../../etc/passwd')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/tools/filesystem.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create src/backend/tools/filesystem.ts**

```ts
import { readFile as fsRead, readdir } from 'fs/promises'
import { resolve, join, relative } from 'path'
import { glob } from 'fs'
import { promisify } from 'util'

const globAsync = promisify(glob)

// Allowed roots — prevents path traversal outside user dirs
const ALLOWED_ROOTS = [
  resolve(process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users'),
]

function assertSafePath(filePath: string): string {
  const resolved = resolve(filePath)
  const allowed = ALLOWED_ROOTS.some(root => resolved.startsWith(root))
  if (!allowed) throw new Error(`Access denied: ${filePath}`)
  return resolved
}

export async function readFile(filePath: string): Promise<string> {
  const safe = assertSafePath(filePath)
  const content = await fsRead(safe, 'utf-8')
  return content.slice(0, 50_000)  // cap at 50KB
}

export async function listDir(dirPath: string): Promise<string[]> {
  const safe = assertSafePath(dirPath)
  return readdir(safe)
}

export async function searchFiles(basePath: string, query: string): Promise<string[]> {
  const safe = assertSafePath(basePath)
  const pattern = `**/*${query}*`
  const matches = await globAsync(pattern, { cwd: safe, absolute: true, ignore: ['**/node_modules/**'] }) as string[]
  return matches.slice(0, 20)
}

export const filesystemToolDefs = [
  {
    name: 'fs_read',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to the file' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_list',
    description: 'List files in a directory',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Absolute path to directory' } },
      required: ['path'],
    },
  },
  {
    name: 'fs_search',
    description: 'Search for files by name within a directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        base_path: { type: 'string', description: 'Directory to search in' },
        query: { type: 'string', description: 'Filename pattern to search for' },
      },
      required: ['base_path', 'query'],
    },
  },
]

export async function handleFilesystemTool(name: string, input: Record<string, string>): Promise<string> {
  switch (name) {
    case 'fs_read':   return readFile(input.path)
    case 'fs_list':   return JSON.stringify(await listDir(input.path))
    case 'fs_search': return JSON.stringify(await searchFiles(input.base_path, input.query))
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/backend/tools/filesystem.test.ts
```

Expected: PASS

- [ ] **Step 5: Register in src/backend/tools/index.ts**

```ts
import { filesystemToolDefs } from './filesystem'
import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return [...filesystemToolDefs] as Tool[]
}
```

- [ ] **Step 6: Commit**

```bash
git add src/backend/tools/filesystem.ts src/backend/tools/index.ts tests/backend/tools/filesystem.test.ts
git commit -m "feat: filesystem tools (read/list/search) with path traversal protection"
```

---

## Task 14: App Launcher Tool (Windows)

**Files:**
- Create: `src/backend/tools/launcher.ts`
- Modify: `src/backend/tools/index.ts`

- [ ] **Step 1: Write launcher test**

Create `tests/backend/tools/launcher.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

describe('launcher tool', () => {
  it('exports launchApp and launcherToolDef', async () => {
    const mod = await import('../../src/backend/tools/launcher')
    expect(typeof mod.launchApp).toBe('function')
    expect(Array.isArray(mod.launcherToolDefs)).toBe(true)
  })

  it('rejects empty app name', async () => {
    const { launchApp } = await import('../../src/backend/tools/launcher')
    await expect(launchApp('')).rejects.toThrow()
  })

  it('rejects app name with shell metacharacters', async () => {
    const { launchApp } = await import('../../src/backend/tools/launcher')
    await expect(launchApp('notepad; del C:\\')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/tools/launcher.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create src/backend/tools/launcher.ts**

```ts
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Only allow alphanumeric + spaces + dots + hyphens in app names
const SAFE_NAME_RE = /^[a-zA-Z0-9 .\-_]+$/

// Common Windows app aliases
const APP_ALIASES: Record<string, string> = {
  'vs code': 'code',
  'vscode': 'code',
  'visual studio code': 'code',
  'notepad': 'notepad',
  'chrome': 'chrome',
  'google chrome': 'chrome',
  'spotify': 'spotify',
  'explorer': 'explorer',
  'file explorer': 'explorer',
  'terminal': 'wt',
  'windows terminal': 'wt',
  'powershell': 'powershell',
}

export async function launchApp(appName: string): Promise<string> {
  if (!appName) throw new Error('App name is required')
  const normalized = appName.toLowerCase().trim()
  const resolved = APP_ALIASES[normalized] ?? normalized

  if (!SAFE_NAME_RE.test(resolved)) {
    throw new Error(`Invalid app name: "${appName}"`)
  }

  await execAsync(`start "" "${resolved}"`, { shell: 'cmd.exe' })
  return `Launched ${appName}`
}

export const launcherToolDefs = [
  {
    name: 'app_launch',
    description: 'Launch a Windows application by name',
    input_schema: {
      type: 'object' as const,
      properties: {
        app_name: { type: 'string', description: 'Application name (e.g., "VS Code", "Chrome", "Spotify")' },
      },
      required: ['app_name'],
    },
  },
]

export async function handleLauncherTool(name: string, input: Record<string, string>): Promise<string> {
  if (name === 'app_launch') return launchApp(input.app_name)
  throw new Error(`Unknown tool: ${name}`)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/backend/tools/launcher.test.ts
```

Expected: PASS

- [ ] **Step 5: Register in tools/index.ts**

```ts
import { filesystemToolDefs, handleFilesystemTool } from './filesystem'
import { launcherToolDefs, handleLauncherTool } from './launcher'
import type { Tool } from '@anthropic-ai/sdk/resources'

export function getTools(): Tool[] {
  return [...filesystemToolDefs, ...launcherToolDefs] as Tool[]
}

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name.startsWith('fs_')) return handleFilesystemTool(name, input as Record<string, string>)
  if (name === 'app_launch') return handleLauncherTool(name, input as Record<string, string>)
  throw new Error(`Unknown tool: ${name}`)
}
```

- [ ] **Step 6: Wire tool execution into claude.ts**

In `src/backend/claude.ts`, update `chat` to handle tool_use blocks:
```ts
import { handleTool } from './tools/index'

// Inside the stream loop, after handling text_delta, add:
if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
  // Tool call started — collect input
}

// After stream ends, check if final message has tool_use:
const finalMsg = await stream.finalMessage()
if (finalMsg.stop_reason === 'tool_use') {
  const toolResults = await Promise.all(
    finalMsg.content
      .filter(b => b.type === 'tool_use')
      .map(async (b: any) => ({
        type: 'tool_result' as const,
        tool_use_id: b.id,
        content: await handleTool(b.name, b.input).catch(e => `Error: ${e.message}`),
      }))
  )
  // Re-run with tool results
  const followUp = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT + memoryContext,
    messages: [...messages, { role: 'assistant', content: finalMsg.content }, { role: 'user', content: toolResults }],
  })
  fullText = followUp.content.filter(b => b.type === 'text').map((b: any) => b.text).join('')
  outputTokens += followUp.usage.output_tokens
  broadcast({ type: 'transcript', role: 'assistant', text: fullText, partial: false })
}
```

- [ ] **Step 7: Commit**

```bash
git add src/backend/tools/launcher.ts src/backend/tools/index.ts tests/backend/tools/launcher.test.ts src/backend/claude.ts
git commit -m "feat: app launcher tool with shell injection protection + tool execution in claude"
```

---

## Task 15: Gmail Tools (Read + Search)

**Files:**
- Create: `src/backend/tools/gmail.ts`
- Modify: `src/backend/tools/index.ts`

- [ ] **Step 1: Write Gmail tool test**

Create `tests/backend/tools/gmail.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('gmail tools', () => {
  it('exports gmailToolDefs', async () => {
    const mod = await import('../../src/backend/tools/gmail')
    expect(Array.isArray(mod.gmailToolDefs)).toBe(true)
    expect(mod.gmailToolDefs.length).toBeGreaterThan(0)
  })

  it('tool defs have required fields', async () => {
    const { gmailToolDefs } = await import('../../src/backend/tools/gmail')
    for (const tool of gmailToolDefs) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('input_schema')
    }
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx vitest run tests/backend/tools/gmail.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create src/backend/tools/gmail.ts**

```ts
import { google, gmail_v1 } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createServer } from 'http'

const TOKEN_PATH = join(process.cwd(), '.gmail-token.json')
const CREDS_PATH = join(process.cwd(), '.gmail-credentials.json')

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

function getOAuth2Client(): OAuth2Client {
  if (!existsSync(CREDS_PATH)) {
    throw new Error('Gmail credentials not found. Add .gmail-credentials.json (from Google Cloud Console).')
  }
  const creds = JSON.parse(readFileSync(CREDS_PATH, 'utf-8'))
  const { client_id, client_secret, redirect_uris } = creds.installed ?? creds.web
  return new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3456')
}

async function getAuthorizedClient(): Promise<OAuth2Client> {
  const auth = getOAuth2Client()

  if (existsSync(TOKEN_PATH)) {
    auth.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')))
    return auth
  }

  // OAuth2 flow
  const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES })
  console.log('[gmail] Opening browser for OAuth:', authUrl)

  const code = await new Promise<string>((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:3456')
      const code = url.searchParams.get('code')
      if (code) { res.end('Authorized! You can close this tab.'); server.close(); resolve(code) }
      else res.end('Error')
    }).listen(3456)
    require('child_process').exec(`start "${authUrl}"`)
  })

  const { tokens } = await auth.getToken(code)
  auth.setCredentials(tokens)
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens))
  return auth
}

export async function searchEmails(query: string, maxResults = 5): Promise<string> {
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults })
  if (!list.data.messages?.length) return 'No messages found.'

  const msgs = await Promise.all(
    list.data.messages.slice(0, maxResults).map(m =>
      gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'] })
    )
  )

  return msgs.map(m => {
    const headers = m.data.payload?.headers ?? []
    const get = (name: string) => headers.find(h => h.name === name)?.value ?? ''
    return `Subject: ${get('Subject')}\nFrom: ${get('From')}\nDate: ${get('Date')}\nID: ${m.data.id}`
  }).join('\n---\n')
}

export async function readEmail(messageId: string): Promise<string> {
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
  const parts = msg.data.payload?.parts ?? []
  const textPart = parts.find(p => p.mimeType === 'text/plain')
  const body = textPart?.body?.data
    ? Buffer.from(textPart.body.data, 'base64').toString('utf-8')
    : '(no plain text body)'

  return body.slice(0, 5000)
}

export const gmailToolDefs = [
  {
    name: 'gmail_search',
    description: 'Search Gmail messages. Returns subject, sender, date, and message ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "from:boss@company.com", "is:unread")' },
        max_results: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'Read the full body of a Gmail message by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID from gmail_search results' },
      },
      required: ['message_id'],
    },
  },
]

export async function handleGmailTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case 'gmail_search': return searchEmails(input.query, input.max_results)
    case 'gmail_read':   return readEmail(input.message_id)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx vitest run tests/backend/tools/gmail.test.ts
```

Expected: PASS

- [ ] **Step 5: Register in tools/index.ts**

```ts
import { gmailToolDefs, handleGmailTool } from './gmail'

export function getTools(): Tool[] {
  return [...filesystemToolDefs, ...launcherToolDefs, ...gmailToolDefs] as Tool[]
}

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name.startsWith('fs_'))     return handleFilesystemTool(name, input as Record<string, string>)
  if (name === 'app_launch')      return handleLauncherTool(name, input as Record<string, string>)
  if (name.startsWith('gmail_'))  return handleGmailTool(name, input)
  throw new Error(`Unknown tool: ${name}`)
}
```

- [ ] **Step 6: Add .gmail-credentials.json to .gitignore**

```
.gmail-credentials.json
.gmail-token.json
```

- [ ] **Step 7: Commit**

```bash
git add src/backend/tools/gmail.ts src/backend/tools/index.ts tests/backend/tools/gmail.test.ts .gitignore
git commit -m "feat: gmail read/search tools with oauth2 flow"
```

---

## Task 16: Dashboard Panel UI

**Files:**
- Create: `src/renderer/src/components/Dashboard.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/hooks/useAnimState.ts`

- [ ] **Step 1: Add dashboard state to useAnimState.ts**

Add to the `JarvisState` interface and initial state:
```ts
dashboardOpen: boolean
```

Add to `handleEvent`:
```ts
case 'dashboard_open':
  return { ...prev, dashboardOpen: !prev.dashboardOpen }
```

Add to `initial`:
```ts
dashboardOpen: false,
```

- [ ] **Step 2: Create Dashboard.tsx**

Create `src/renderer/src/components/Dashboard.tsx`:
```tsx
interface DashboardStats {
  tokensToday: number
  costToday: number
  model: string
}

interface Props extends DashboardStats {
  open: boolean
  onClose: () => void
}

export function Dashboard({ open, onClose, tokensToday, costToday, model }: Props): JSX.Element | null {
  if (!open) return null

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '480px',
    background: 'rgba(6, 11, 20, 0.92)',
    border: '1px solid rgba(125, 211, 252, 0.2)',
    borderRadius: '8px',
    padding: '32px',
    fontFamily: '"Orbitron", monospace',
    color: '#7dd3fc',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 0 40px rgba(59, 130, 246, 0.15)',
    zIndex: 100,
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid rgba(125, 211, 252, 0.08)',
    fontSize: '12px',
    letterSpacing: '0.08em',
  }

  const val: React.CSSProperties = {
    color: '#e0f2fe',
    fontSize: '14px',
    fontWeight: 700,
  }

  return (
    <div style={panelStyle} className="no-drag">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.12em' }}>DASHBOARD</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: '16px' }}
        >✕</button>
      </div>

      <div style={row}>
        <span>TOKENS TODAY</span>
        <span style={val}>{tokensToday.toLocaleString()}</span>
      </div>
      <div style={row}>
        <span>COST TODAY</span>
        <span style={val}>${costToday.toFixed(4)}</span>
      </div>
      <div style={row}>
        <span>ACTIVE MODEL</span>
        <span style={val}>{model.toUpperCase()}</span>
      </div>
      <div style={{ ...row, borderBottom: 'none' }}>
        <span>STATUS</span>
        <span style={{ ...val, color: '#4ade80' }}>OPERATIONAL</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire Dashboard into App.tsx**

```tsx
import { Dashboard } from './components/Dashboard'

// Inside App, add:
const { send } = useWebSocket(onEvent)

const toggleDashboard = (): void => send({ type: 'dashboard_open' })

// In return JSX, add after Transcript:
<Dashboard
  open={state.dashboardOpen}
  onClose={toggleDashboard}
  tokensToday={state.tokensToday}
  costToday={state.costToday}
  model={state.model}
/>
```

- [ ] **Step 4: Handle dashboard_open in backend to reflect state**

In `src/backend/index.ts`, inside `handleRendererEvent`:
```ts
if (event.type === 'dashboard_open') {
  broadcast({ type: 'state', state: 'idle' })
  // Just echo back — renderer manages open/closed state locally
  return
}
```

- [ ] **Step 5: Add voice trigger**

In `src/backend/index.ts`, check for dashboard voice command:
```ts
// Inside the pipeline handler, after transcribing:
if (userText.toLowerCase().includes('show dashboard') || userText.toLowerCase().includes('open dashboard')) {
  broadcast({ type: 'stats', tokensToday: stats.tokens, costToday: stats.cost, model: 'fable' })
  broadcast({ type: 'dashboard_open' })
  return
}
```

- [ ] **Step 6: Verify visually**

```bash
npm run dev
```

Expected: Saying "Show dashboard" or clicking the top-right token HUD opens a holographic panel with today's stats. Clicking ✕ closes it.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/Dashboard.tsx src/renderer/src/App.tsx src/renderer/src/hooks/useAnimState.ts src/backend/index.ts
git commit -m "feat: dashboard panel with token usage and cost stats"
```

---

## Phase 1 Complete

After Task 16, you have a working Jarvis MVP:
- Electron desktop app with frameless holographic UI
- Silver/white metallic triangle particle ring with 4 animation states
- Push-to-talk (Alt+Space) → Whisper STT → Claude (Fable/Haiku routing) → ElevenLabs TTS
- Gmail read/search, file system browse, Windows app launcher
- Long-term memory with semantic retrieval
- Dashboard with token/cost tracking

**Phase 2 plan** (subagent cards, Gmail send, file write/execute, settings panel) to be written separately.
