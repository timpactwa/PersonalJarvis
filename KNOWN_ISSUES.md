# Known Issues / Deferred Work

Items flagged during the 2026-07-01 systematic repair that were deliberately deferred or are pre-existing limitations. Each is safe to ship with; listed so nothing gets silently forgotten.

## Deferred by design (this repair)

- **Tap-to-toggle PTT + voice-activity auto-stop (VAD)** — the frontier-style "tap once, Jarvis detects when you stop talking" interaction. Base interaction remains hold-to-talk (Right Alt) with true barge-in. Design sketch exists in the repair plan (Checkpoint 7 follow-up territory).
- **Usage logging attributes all tokens of a tier-escalated turn to the final model** (`src/backend/index.ts` ~879). Cosmetic — per-model cost attribution is approximate when Haiku escalates to Fable mid-turn.
- **`fs_write` confirmation fires on every write** — could be relaxed to overwrite-only (new-file writes are low-risk).
- **Local Whisper transcription is not abortable mid-inference** — on barge-in the result is discarded after the fact instead (Groq Whisper aborts properly).

## Pre-existing environment limitations

- **better-sqlite3 tests fail under system Node** (Electron ABI mismatch, MODULE_VERSION 119 vs 127). Use `npm test` (runs vitest under Electron). Not a code bug.
- **Git operations hang in this OneDrive-synced folder** — avoid git; this repair was done without commits.
- **2 pre-existing typecheck errors in `src/backend/tools/googleClient.ts:68-69`** — googleapis pulls its own nested copy of `google-auth-library`, whose `OAuth2Client` type is nominally incompatible with the top-level one. Runtime is unaffected. Fix would be aligning the `google-auth-library` version with the one under `googleapis-common` (e.g. npm dedupe/override).
- **`jarvis_screenshot` vision requires Claude credentials** — on Groq/Ollama-only setups the tool returns a clear text refusal instead of describing the screen.

## Session pause point (2026-07-02 — user hit usage limit)

**Done and verified:** CP0 (quick wins), CP1 (turn manager + true barge-in, integration-reviewed), CP2 (speaking watchdogs), CP5.1 (fallback hotkey + live rebinding), CP3 (unified confirmation gate — implemented and green, code review still pending).

**Remaining work** (full resume state in `.superpowers/sdd/progress.md`):
1. CP3 code review (security-relevant: the gate for fs_write/execute_file)
2. CP4 single-turn screenshot (brief ready in session scratchpad; recreate from plan CP4 section if scratchpad is gone)
3. CP5.2 dead code removal (getToolsForAgent, elevenlabs.ts, diag block)
4. CP6 finalize this file + CLAUDE.md (turn-manager/barge-in, 4-byte audio frame header, gate location)
5. CP7 (optional) sentence-pipelined TTS for lower first-audio latency
6. Final whole-repair review + the manual barge-in smoke test (plan's CP1 smoke: interrupt Jarvis mid-speech and mid-thinking, 5× rapid presses)

**Discovered during repair:**
- Voice yes/no answers destructive-tool ConfirmCards, but plan-preview cards remain button-only.
- Two stacked destructive confirmations: voice answers the most recent one.
- A PTT press during a monitor-alert clip pauses it; its watchdog may briefly paint idle during the next turn's thinking (self-heals).
