# Debug: App Stuck on "Connecting to Backend"

## Symptom
Electron app opens but the renderer shows "⟳ connecting to backend..." permanently.
The user cannot type or interact with the agent at all.

## Architecture Recap
- **Main** (`src/main/index.ts`): Forks the backend via `utilityProcess.fork()`, reads a ready signal, then sends the port to the renderer via IPC (`backend-port` channel).
- **Backend** (`src/backend/index.ts`): Runs a WebSocket server on a random port (JARVIS_PORT=0). On `server.listen`, writes `{"type":"ready","port":N}` to stdout AND (after our fix attempt) calls `process.parentPort.postMessage({type:'ready', port:N})`.
- **Preload** (`src/preload/index.ts`): Listens for `ipcRenderer.on('backend-port', ...)`, caches the port, exposes `window.jarvis.onBackendPort(cb)`.
- **Renderer** (`src/renderer/src/hooks/useWebSocket.ts`): Calls `window.jarvis.onBackendPort(cb)` on mount → `connect(port)` → WebSocket to `ws://127.0.0.1:{port}`.

## Evidence Collected

### Terminal output (from `npm run dev`)
```
[main] uiohook-napi loaded — hold-to-talk available
[main] uiohook started — hold Right Alt to talk, release to stop (Escape cancels)
[main] loading renderer from DEV SERVER: http://localhost:5173
[renderer:0] [vite] connecting...
[renderer:0] [vite] connected.
[renderer:1] %cDownload the React DevTools...
[renderer:2] %cElectron Security Warning...
```
**Key observations:**
- `bash-stderr` was completely EMPTY — no `[backend]` prefixed lines at all.
- No `[main] backend ready on port` log.
- No `[renderer:N] [ws] connecting to backend on port` log.
- This means `connect(port)` was NEVER called in the renderer.

### Backend standalone test
Running `node dist-electron/backend/index.js` directly works perfectly:
```
[db] SQLite ready at .../jarvis.db
[backend] WARNING: no parentPort — PTT capture disabled (standalone mode)
[backend] listening on port 54336
[backend] native mic capture: available
{"type":"ready","port":54336}
```

### Git diff (what was already changed before we started)
`src/main/index.ts` had a pending uncommitted change adding:
1. `savedBackendPort` variable
2. `did-finish-load` handler that re-sends the port if already known
3. `savedBackendPort = msg.port` in the stdout handler

This was a race condition fix — cache clearing delays `loadURL` by 200–500ms, so the backend's ready signal can arrive before the preload has run.

## Our Fix Attempt

### Hypothesis
`backendProcess.stdout` is `null` in Electron 28 on Windows. The `?.` optional chaining silently skips the listener. `savedBackendPort` is never set. `did-finish-load` fires but sends nothing.

### Changes made

**`src/backend/index.ts`** — added parentPort signal alongside stdout:
```js
process.stdout.write(JSON.stringify({ type: 'ready', port: addr.port }) + '\n')
// Also signal via parentPort — stdio pipes are unreliable in Electron utilityProcess on Windows
if (process.parentPort) {
  process.parentPort.postMessage({ type: 'ready', port: addr.port })
}
```

**`src/main/index.ts`** — added `backendProcess.on('message', ...)` as primary receiver, kept stdout as fallback:
```js
// Primary: parentPort IPC
backendProcess.on('message', (msg) => {
  if (msg.type === 'ready' && msg.port) {
    console.log('[main] backend ready on port (ipc)', msg.port)
    savedBackendPort = msg.port
    sendToRenderer('backend-port', msg.port)
  }
})
backendProcess.on('exit', (code) => {
  console.error('[main] backend exited with code', code)
})
// Fallback: stdout pipe (may be null on Windows)
backendProcess.stdout?.on('data', ...)
```

### Result
**Still not working.** The app is still stuck on "connecting to backend" after rebuilding the backend and restarting.

## What We Still Don't Know
1. Does `backendProcess.on('message', ...)` actually fire? Is the backend even starting as a utility process?
2. Does `backendProcess.on('exit', ...)` fire (indicating a crash)?
3. Is the `did-finish-load` event firing at all?
4. Is `sendToRenderer('backend-port', ...)` being called? Is `wc.send()` succeeding?
5. Is the preload actually receiving the IPC message?
6. Is `window.jarvis.onBackendPort` being called in the renderer?

## Useful Diagnostic Steps Not Yet Taken
- Add `console.log('[main] backend process spawned, stdout null?', backendProcess.stdout === null)` right after fork
- Add `console.log('[main] did-finish-load fired, savedBackendPort=', savedBackendPort)` in the did-finish-load handler
- Add `console.log('[main] sendToRenderer backend-port called with', port)` inside sendToRenderer when channel === 'backend-port'
- Add renderer-side logging: `console.log('[preload] backend-port received', port)` in the ipcRenderer.on handler
- Add `console.log('[ws] onBackendPort called, cachedPort=', cachedPort)` in preload's onBackendPort
- Open DevTools on the Electron window to see renderer console directly

## Environment
- Windows 11 Home 10.0.26200
- Electron 28.3.3
- Node/npm via electron-vite
- Backend is a CommonJS SSR bundle: `dist-electron/backend/index.js` (87 kB)
- Native addons: `better-sqlite3`, `uiohook-napi`
- `.env.local` in project root with API keys

## File Locations
- Main: `src/main/index.ts` → built to `dist-electron/main/index.js`
- Backend: `src/backend/index.ts` → built to `dist-electron/backend/index.js` (run `npm run build:backend` after changes)
- Preload: `src/preload/index.ts` → built to `dist-electron/preload/index.js`
- Renderer WebSocket: `src/renderer/src/hooks/useWebSocket.ts`
- Renderer app: `src/renderer/src/App.tsx` (shows "connecting to backend" when `!connected`)
