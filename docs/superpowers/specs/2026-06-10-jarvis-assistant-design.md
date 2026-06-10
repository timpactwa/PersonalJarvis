# Jarvis Personal Assistant — Design Spec
**Date:** 2026-06-10
**Status:** Approved

---

## Overview

A fullscreen Electron desktop app that acts as a personal AI assistant with voice I/O, holographic UI, email/file/app control, and a subagent orchestration layer. Modeled on the MCU Jarvis aesthetic: dark background, flowing metallic triangle particles, futuristic hologram HUD.

---

## 1. Architecture

### Two-Process Model

**Electron Renderer (UI process)**
- React + HTML5 Canvas (2D)
- Renders particle ring, HUD overlays, subagent cards, transcript
- Communicates with backend exclusively via WebSocket
- Manages audio capture (push-to-talk) and audio playback (TTS)

**Node.js Backend (spawned by Electron on launch)**
- Intelligence layer — all model calls happen here
- Local **Ollama** (main loop), **Claude Agent SDK** (subagents), ElevenLabs TTS, Whisper STT, Gmail, file system, SQLite
- Subagent orchestration
- Streams events to renderer via WebSocket

### Hybrid LLM Routing (revised 2026-06-10)
- **Main conversational loop → local Ollama (`llama3.1:8b`)** — runs offline at **$0**, handles voice turns and tool-calling.
- **`spawn_agent` → Claude via the Agent SDK** — heavy, multi-step autonomous work runs on Claude, authenticated with the user's Pro subscription (`CLAUDE_CODE_OAUTH_TOKEN`).
- Ollama/local model calls are logged to SQLite at zero cost; only Claude subagent runs draw subscription credit.
- Ollama model + base URL are configurable via settings (`ollamaModel`, `ollamaBaseUrl`) or `OLLAMA_MODEL`/`OLLAMA_BASE_URL` env vars.
- _(Superseded: the original Claude Haiku/Fable routing heuristic — `selectModel` in `claude.ts` — is retained in the codebase but no longer drives the main loop.)_

---

## 2. UI & Visual Design

### Particle Ring
- Full dark background (`#060b14` or similar deep navy-black)
- Thin orbital ring of **tiny silver/white metallic triangular particles**
- Wide open center — ring diameter ~40% of screen width, particle zone ~8-12% thickness
- Particles drift naturally with soft physics (attraction to ring path, slight random velocity)
- Subtle shimmer/glint on each triangle (metallic sheen via Canvas rotation + opacity variation)

### Animation States
| State | Behavior |
|-------|----------|
| **Idle** | Slow drift, loose orbit, occasional shimmer |
| **Listening** | Ring tightens, particles pulse inward with voice waveform amplitude |
| **Thinking** | Ring rotates faster, particles scatter/orbit erratically, blue pulse glow |
| **Speaking** | Ring expands/contracts per word, particles flow outward in audio-amplitude waves |

### HUD Overlays
- **Top-left:** `JARVIS` wordmark + status (`ONLINE / LISTENING / THINKING / SPEAKING`)
- **Top-right:** Token count today + cost today
- **Bottom-center:** Last transcript line (user message or Jarvis response)
- Font: **Orbitron** or **Share Tech Mono** — futuristic monospace, hologram aesthetic
- All HUD elements use thin strokes, low opacity, blue-white color (`#7dd3fc` primary)

### Subagent Cards
- Slide up from bottom edge when agents are active
- Each card: agent name, task description, streaming current action, elapsed time
- **Expandable** → full action log
- **Closable** → confirmation step then terminates agent
- Multiple cards stack horizontally
- Visual style: frosted glass effect, thin hologram border, subtle glow

### Dashboard Panel
- Triggered by voice ("Jarvis, show dashboard") or clicking top-right HUD
- Slides in as a holographic overlay panel
- Contents: token usage graph (today/7d/30d), cost by model, conversation count, memory count, API status

---

## 3. Voice & Conversation Pipeline

### Push-to-Talk
1. User holds **Alt+Space** (global hotkey, configurable)
2. Electron captures mic audio → streams PCM to backend
3. Key release → backend sends audio to **Whisper** (`whisper.cpp` via Node subprocess, `base.en` model)
4. Transcript + conversation history → local **Ollama** model (with tool-calling)
5. Ollama response sent via WebSocket → UI updates transcript
6. Response text → **ElevenLabs API** (British male voice) → audio streamed to playback
7. Animation state events (`thinking`, `speaking`, `idle`) emitted over WebSocket throughout

### Conversation Memory
- **Short-term:** Last 20 turns kept in context (configurable)
- **Long-term:** SQLite table of facts with embeddings (via `@xenova/transformers` — local, no API cost, `all-MiniLM-L6-v2` model)
  - On each turn: embed user message, retrieve top-3 relevant memories, inject into system prompt
  - The model decides when to persist new facts via a `[REMEMBER: ...]` tag
  - User can say "Jarvis, remember that..." to force a memory write

---

## 4. Tools & Capabilities

All tools are function-call tools registered in the backend (consumed by the local Ollama main loop).

| Tool | Description |
|------|-------------|
| `gmail_search` | Search Gmail threads by query |
| `gmail_read` | Read a specific thread/message |
| `gmail_send` | Send email — **requires verbal confirmation** |
| `gmail_draft` | Create a draft without sending |
| `fs_read` | Read file contents |
| `fs_write` | Write/create files |
| `fs_list` | List directory contents |
| `fs_search` | Search files by name or content |
| `app_launch` | Open installed Windows app by name |
| `execute_file` | Run a file/script — **requires verbal confirmation** |
| `spawn_agent` | Create a named subagent with a task description |
| `memory_write` | Persist a fact to long-term memory |
| `memory_search` | Semantic search over long-term memory |

### Security Boundaries
- `gmail_send` and `execute_file` always trigger a confirmation step before execution
- Jarvis speaks the confirmation: "Shall I send that?" / "Confirm you want me to run this file"
- No silent destructive actions

---

## 5. Subagent Orchestration

- Jarvis (the local Ollama main loop) can call `spawn_agent` to create named worker agents
- Each worker runs via the **Claude Agent SDK** (`query()`), a self-contained Claude session with its own autonomous tool loop (built-in `Read`/`Glob`/`Grep`/`WebSearch`/`WebFetch`), authenticated by the user's Pro subscription
- Backend streams worker actions to renderer via WebSocket → drives UI card updates
- Workers report back when done or blocked
- Primary Jarvis synthesizes results and responds to user

---

## 6. Data & Storage

All data stored locally in **SQLite** (`jarvis.db`):
- `conversations` — full message history with timestamps and token counts
- `api_calls` — every model/ElevenLabs call logged (model, tokens, cost, timestamp); local Ollama calls logged at $0
- `memories` — long-term facts with embeddings blob
- `settings` — user preferences (hotkey, voice ID, model preferences, etc.)

No cloud storage. No telemetry. Everything local.

---

## 7. Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron (latest stable) |
| UI framework | React + TypeScript |
| Canvas/particles | HTML5 Canvas (2D) |
| Backend runtime | Node.js (bundled with Electron) |
| Main LLM | Local **Ollama** (`llama3.1:8b`) via HTTP `/api/chat` |
| Subagents | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), Pro-subscription auth |
| STT | `whisper.cpp` via Node subprocess (`base.en` model) |
| TTS | ElevenLabs REST API (British male voice, free tier → paid) |
| Email | Gmail API via OAuth2 (existing MCP Gmail integration) |
| Database | SQLite via `better-sqlite3` |
| IPC | WebSocket (backend ↔ renderer) |
| Font | Orbitron (Google Fonts) |

---

## 8. MVP Scope

Phase 1 (MVP): ✅ complete
- [x] Electron app shell + Node.js backend with WebSocket
- [x] Particle ring UI (idle + listening + thinking + speaking states)
- [x] Push-to-talk → Whisper STT → LLM → ElevenLabs TTS full loop
- [x] Basic tool set: Gmail read/search, file system read/list, app launcher
- [x] HUD overlays + transcript display
- [x] SQLite logging + basic dashboard panel
- [x] Long-term memory (write + retrieval)

Phase 2: backend complete (Tasks 17–24); renderer/UI in progress (Tasks 25–30)
- [x] Hybrid LLM: local Ollama main loop + Claude Agent SDK subagents (backend)
- [x] Subagent orchestration (backend `agents.ts`) — [ ] card UI (Task 27)
- [x] Gmail send/draft with confirmation (backend)
- [x] File write + execute with confirmation (backend)
- [ ] Backend event wiring into renderer (Task 25)
- [ ] Confirmation card UI (Task 26)
- [ ] Full dashboard with usage graphs (Task 28)
- [ ] Settings panel (hotkey config, voice selection, Ollama model) (Task 29)
