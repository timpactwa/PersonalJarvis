# Proactive Monitors & PTT Interruption — Design Spec
**Date:** 2026-06-12  
**Status:** Approved for implementation

---

## Overview

Make Jarvis proactive: it watches five data sources in the background and speaks up when something worth noting happens, without being asked. All alerts queue when Jarvis is busy and drain at idle. When the user starts talking, any active TTS is killed immediately.

---

## Architecture

All monitors run inside the existing backend utilityProcess as independent `setInterval` loops. No new processes. A `MonitorRegistry` singleton manages lifecycle, the alert queue, and idle-drain delivery.

```
src/backend/monitors/
  index.ts       — MonitorRegistry: start/stop, enqueue, idle drain tick
  calendar.ts    — Google Calendar polling (5 min interval)
  email.ts       — Gmail new-mail polling (3 min interval)
  spotify.ts     — playback-end / device-change detection (10 s interval)
  system.ts      — battery level polling (60 s interval)
  custom.ts      — user reminders from SQLite (30 s tick)

tests/backend/monitors/
  queue.test.ts
  calendar.test.ts
  email.test.ts
  system.test.ts
  custom.test.ts
```

---

## MonitorRegistry (`monitors/index.ts`)

```typescript
interface Alert {
  id: string              // dedup key — same id is never queued twice per session
  text: string            // what Jarvis will speak
  priority: 'urgent' | 'normal'
  source: 'calendar' | 'email' | 'spotify' | 'system' | 'custom'
  expiresAt?: number      // epoch ms — drop if not delivered by this time
}
```

### Public API

```typescript
class MonitorRegistry {
  startAll(): void        // start all enabled monitors
  stopAll(): void         // stop all (on backend shutdown)
  setIdle(idle: boolean): void  // called by index.ts pipeline start/end
  setSpeakFn(fn: (text: string) => Promise<void>): void  // injected from index.ts to avoid circular import
  enqueue(alert: Alert): void   // called by individual monitors
}

export const monitors = new MonitorRegistry()
```

### Idle-drain tick

A 5-second `setInterval` inside the registry checks: if `isIdle && queue.length > 0`, pop the highest-priority non-expired alert and invoke the injected `speakFn(alert.text)`. `index.ts` calls `monitors.setSpeakFn(speakOrIdle)` after initialising both modules — this breaks the circular import that would otherwise exist between `monitors/index.ts` and `index.ts`. Speaks one alert per idle window; subsequent ones deliver after the next idle cycle (naturally throttled).

Urgent alerts sort ahead of normal ones. Expired alerts are silently dropped.

### Settings integration

Each monitor reads its toggle from `getSettings()` at startup:

| Setting key         | Default |
|---------------------|---------|
| `monitor_calendar`  | `true`  |
| `monitor_email`     | `true`  |
| `monitor_spotify`   | `true`  |
| `monitor_system`    | `true`  |
| `monitor_custom`    | `true`  |

`startAll()` skips any monitor whose toggle is `false`.

---

## Individual Monitors

### Calendar (`calendar.ts`)

- **Interval:** 5 minutes
- **Auth:** reuses `getAuthorizedClient()` from `tools/gmail.ts`
- **Query:** events with `timeMin = now`, `timeMax = now + 60min`
- **Alert windows:**
  - ≤ 15 min until start → priority `urgent`, text: `"You have [title] in [N] minutes."`
  - ≤ 30 min until start → priority `normal`, text: `"Heads up — [title] in about [N] minutes."`
- **Dedup ID:** `cal:${eventId}:${window}` — one alert per event per alert window (15-min and 30-min each fire once)
- **Rate limit:** same dedup ID never re-queued within the same session

### Email (`email.ts`)

- **Interval:** 3 minutes
- **Auth:** reuses `getAuthorizedClient()`
- **Query:** `is:unread newer_than:4m` (4-min window slightly larger than interval to avoid gaps)
- **Filters out:** promotional/social tabs (label: `-category:promotions -category:social`)
- **Alert:** priority `normal`, text: `"New email from [From name] — [Subject]."`
- **Dedup ID:** `email:${messageId}`
- **Rate limit:** max 3 email alerts per poll cycle — if >3 new emails, speak `"You have [N] new emails."`

### Spotify (`spotify.ts`)

- **Interval:** 10 seconds
- **Triggers:**
  1. Playback stopped (was playing, now paused/stopped for 2+ consecutive polls) → `"Music stopped. Want me to queue something?"` (priority `normal`)
  2. Device changed to a non-Computer type (TV/Firestick becoming active) → `"Spotify switched to [device name]."` (priority `normal`)
- **Dedup ID:** `spotify:stopped:${trackId}`, `spotify:device:${deviceId}`
- **Does NOT alert on every track change** — that would be noisy

### System (`system.ts`)

- **Interval:** 60 seconds
- **Battery:** uses `systeminformation` npm package (`si.battery()`)
  - Below 20%, not charging → `"Battery at [N]%, you might want to plug in."` (priority `normal`)
  - Below 10%, not charging → `"Battery critically low at [N]%."` (priority `urgent`)
  - Dedup ID resets when charger is connected (re-alerts on next discharge)
- **Dedup ID:** `system:battery:20` / `system:battery:10` — cleared on charge event

### Custom (`custom.ts`)

- **Interval:** 30 seconds
- **Storage:** new `reminders` table in SQLite:
  ```sql
  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    fire_at INTEGER NOT NULL,   -- epoch ms
    fired INTEGER DEFAULT 0
  )
  ```
- **Delivery:** any unfired reminder where `fire_at <= now` → enqueue with priority `normal`, mark `fired = 1`
- **Created by:** new tool `jarvis_remind` (see below)

#### `jarvis_remind` tool

Added to `tools/jarvis.ts`:

```typescript
{
  name: 'jarvis_remind',
  description: 'Set a reminder that Jarvis will speak at a future time.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What to say when the reminder fires' },
      fire_at: { type: 'string', description: 'ISO 8601 datetime or relative ("in 30 minutes", "at 5pm")' },
    },
    required: ['text', 'fire_at'],
  },
}
```

Handler parses `fire_at` (absolute ISO or relative string via a lightweight parser), writes to `reminders` table, returns confirmation text.

---

## PTT Interruption (`renderer/src/App.tsx`)

When the `ptt-start` IPC event fires, before starting the recorder:

```typescript
// Kill active TTS immediately so Jarvis stops talking
if (audioRef.current) {
  audioRef.current.pause()
  audioRef.current.currentTime = 0
}
window.speechSynthesis.cancel()
```

Also: if a `speak_text` utterance is in-flight (Web Speech API tier-3), `speechSynthesis.cancel()` terminates it. The `utterance.onerror` handler already resets state to idle, so no extra cleanup needed.

Backend-side: when a new `text` or `audio` RendererEvent arrives, `index.ts` should call `monitors.setIdle(false)` immediately (it likely already does via the pipeline start path — confirm during implementation).

---

## Settings Panel

`SettingsPanel.tsx` gets a new **Monitors** section (collapsed by default) with a toggle per monitor. Each toggle calls `setSetting(key, value)` via the existing settings IPC channel. Monitor starts/stops respond dynamically — `MonitorRegistry.startAll()` / `stopAll()` are called on settings change via a new `monitors_updated` RendererEvent.

---

## Integration Points

| Backend file          | Change                                                        |
|-----------------------|---------------------------------------------------------------|
| `index.ts`            | Import `monitors`; call `monitors.startAll()` on WS ready; `monitors.setIdle(true/false)` at pipeline start/end |
| `memory/db.ts`        | Add `reminders` table migration                               |
| `memory/settings.ts`  | Add 5 new monitor toggle settings with defaults               |
| `tools/jarvis.ts`     | Add `jarvis_remind` tool def + handler                        |
| `tools/index.ts`      | Route `jarvis_remind` to new handler                          |
| `renderer/App.tsx`    | PTT interruption (2 lines before recorder start)              |
| `renderer/SettingsPanel.tsx` | Monitors section with 5 toggles                        |

---

## Testing Plan

- **`queue.test.ts`**: enqueue deduplication, expiry drop, urgent-first ordering, idle drain (mock `speakOrIdle`)
- **`calendar.test.ts`**: alert window logic (15/30min), dedup per window, no-auth graceful skip
- **`email.test.ts`**: new mail detection, >3-mail rollup, promo filter
- **`system.test.ts`**: battery threshold alerts, dedup reset on charge
- **`custom.test.ts`**: reminder fire logic, ISO and relative time parsing
- **Renderer**: PTT handler stops audio and cancels speech synthesis (mock `audioRef`, `speechSynthesis`)

All new tests must keep the existing 300-test suite green.

---

## Out of Scope

- Push notifications to phone / OS notification center — voice-only for now
- "Smart" alert suppression based on user schedule / do-not-disturb hours — future iteration
- Streaming alert content (e.g., reading full email body) — summary only
