# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # build backend then start Electron with Vite dev server
npm run build        # full production build (main + preload + renderer + backend)
npm run build:backend  # rebuild backend bundle only (dist-electron/backend/index.js)
npx electron-vite build  # rebuild main + preload + renderer only

npx vitest run                          # full test suite
npx vitest run tests/backend/foo.test.ts  # single test file
```

`npm run dev` runs `predev` first, which rebuilds the backend. After editing `src/backend/**`, run `npm run build:backend` — the backend is not hot-reloaded by electron-vite.

## Architecture

Three Electron processes:

**Main** (`src/main/index.ts`) — forks the backend as a `utilityProcess`, registers global hotkeys (Right Alt for PTT via `uiohook-napi`), and bridges IPC to/from the renderer. Reads backend stdout for the `{"type":"ready","port":N}` signal, then sends the port to the renderer via `backend-port` IPC. Re-sends on `did-finish-load` to avoid a startup race where the signal arrives before the preload runs.

**Backend** (`src/backend/index.ts`, built to `dist-electron/backend/index.js`) — all intelligence lives here. Runs a WebSocket server; the renderer connects on the port it received via IPC. Handles LLM routing, tool execution, SQLite memory, and STT/TTS.

**Renderer** (`src/renderer/src/`) — React app. Connects to backend via WebSocket (`useWebSocket.ts`). Sends user text/audio, receives typed events (`BackendEvent` in `types.ts`). All state is in `useAnimState.ts`.

### Backend LLM routing (`src/backend/index.ts`)

Tool-keyword requests → Groq (`groq.ts`). Conversational → Claude (`claude.ts`). Falls back to Groq on Claude 429, then Ollama as last resort. STT: Groq Whisper if `GROQ_API_KEY` set, else local Whisper.

### Key backend modules

| Module | Purpose |
|--------|---------|
| `memory/db.ts` | SQLite via `better-sqlite3`: api_calls, memories, entities, user_events, settings |
| `memory/embeddings.ts` | `@xenova/transformers` (lazy-loaded) for semantic memory |
| `memory/logger.ts` | Thin wrapper: `logApiCall` → db |
| `memory/settings.ts` | Typed settings read/write over db |
| `audioCapture.ts` | Persistent ffmpeg subprocess for PTT; `PcmRecorder` for pre-roll/cap |
| `tools/index.ts` | Tool dispatch: `getTools()`, `getToolsForGroq()`, `handleTool()` |
| `agents.ts` | Claude Agent SDK subagent orchestration |
| `confirm.ts` | Confirmation-gate for destructive tool calls |

### WebSocket event types

Defined in `src/backend/types.ts`. `BackendEvent` flows backend → renderer; `RendererEvent` flows renderer → backend. Audio is sent as raw binary (Float32 PCM). All other messages are JSON.

## Docs

Architecture decisions and phase plans are in `docs/superpowers/`. The design spec at `docs/superpowers/specs/2026-06-10-jarvis-assistant-design.md` covers the full UI/animation/HUD design and the hybrid LLM routing rationale.

## Environment

Needs a `.env.local` in the project root. Keys: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, optionally `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`.

`better-sqlite3` and `uiohook-napi` are native addons. The `.npmrc` configures them to build against Electron 28. If they crash on load after `npm install`, run `npm rebuild`.
