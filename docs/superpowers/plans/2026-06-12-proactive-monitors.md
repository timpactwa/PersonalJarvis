# Proactive Monitors & PTT Interruption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five background monitors (calendar, email, Spotify, system, custom reminders) that queue alerts and speak when Jarvis is idle, plus kill active TTS the moment the user starts talking.

**Architecture:** All monitors run as `setInterval` loops inside the existing backend utilityProcess. A `MonitorRegistry` singleton manages the alert queue, deduplication, and 8-second idle-drain tick. Each monitor is a standalone function receiving `enqueue`/`register` callbacks — no circular imports. Backend `index.ts` wires everything together after the WebSocket server starts.

**Tech Stack:** TypeScript, `better-sqlite3` (reminders table), `googleapis` (calendar + email), `systeminformation` npm (battery), existing Spotify token from settings, React for SettingsPanel toggles.

---

## File Map

**New:**
```
src/backend/monitors/index.ts       — MonitorRegistry class + Alert type + monitors singleton
src/backend/monitors/custom.ts      — User reminders (reads SQLite reminders table)
src/backend/monitors/calendar.ts    — Google Calendar polling
src/backend/monitors/email.ts       — Gmail new-mail polling
src/backend/monitors/spotify.ts     — Spotify playback-end / device-change detection
src/backend/monitors/system.ts      — Battery level polling
tests/backend/monitors/queue.test.ts
tests/backend/monitors/custom.test.ts
tests/backend/monitors/calendar.test.ts
tests/backend/monitors/email.test.ts
tests/backend/monitors/system.test.ts
```

**Modified:**
```
src/backend/types.ts                — Add 5 monitor toggle fields to Settings
src/backend/memory/db.ts            — Add reminders table migration
src/backend/memory/settings.ts      — Add 5 monitor defaults + read them in getSettings()
src/backend/tools/gmail.ts          — Export getAuthorizedClient()
src/backend/tools/jarvis.ts         — Add jarvis_remind tool def + handler
src/backend/tools/index.ts          — Route jarvis_remind
src/backend/index.ts                — Import monitors; wire startAll + setIdle hooks
src/renderer/src/App.tsx            — audioRef + kill TTS on PTT start
src/renderer/src/components/SettingsPanel.tsx — Add Monitors section
```

---

## Task 1: Foundation — Settings types, DB migration

**Files:**
- Modify: `src/backend/types.ts`
- Modify: `src/backend/memory/settings.ts`
- Modify: `src/backend/memory/db.ts`

- [ ] **Step 1: Add monitor toggles to the Settings interface in `types.ts`**

Find the `Settings` interface (around line 7) and add five boolean fields before the closing brace:

```typescript
  /** Proactive monitor toggles */
  monitorCalendar: boolean
  monitorEmail: boolean
  monitorSpotify: boolean
  monitorSystem: boolean
  monitorCustom: boolean
```

- [ ] **Step 2: Add defaults in `settings.ts`**

In `DEFAULTS` (after `quietMode`):
```typescript
  monitorCalendar: true,
  monitorEmail: true,
  monitorSpotify: true,
  monitorSystem: true,
  monitorCustom: true,
```

In the `return` block of `getSettings()`, after the `quietMode` line:
```typescript
    monitorCalendar: map.has('monitorCalendar') ? map.get('monitorCalendar') === 'true' : DEFAULTS.monitorCalendar,
    monitorEmail:    map.has('monitorEmail')    ? map.get('monitorEmail')    === 'true' : DEFAULTS.monitorEmail,
    monitorSpotify:  map.has('monitorSpotify')  ? map.get('monitorSpotify')  === 'true' : DEFAULTS.monitorSpotify,
    monitorSystem:   map.has('monitorSystem')   ? map.get('monitorSystem')   === 'true' : DEFAULTS.monitorSystem,
    monitorCustom:   map.has('monitorCustom')   ? map.get('monitorCustom')   === 'true' : DEFAULTS.monitorCustom,
```

- [ ] **Step 3: Add `reminders` table migration in `db.ts`**

Inside the `db.exec(`` ... ``)` template literal in `initDb()`, after the `custom_commands` table block and before the closing backtick:

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  fired INTEGER DEFAULT 0
);
```

- [ ] **Step 4: Add reminder DB helpers at the bottom of `db.ts`**

```typescript
export interface Reminder {
  id: string
  text: string
  fireAt: number
  fired: boolean
}

export function insertReminder(id: string, text: string, fireAt: number): void {
  if (!dbAvailable) return
  getDb().prepare(
    'INSERT INTO reminders (id, text, fire_at, fired) VALUES (?, ?, ?, 0)',
  ).run(id, text, fireAt)
}

export function getDueReminders(): Reminder[] {
  if (!dbAvailable) return []
  const now = Date.now()
  return (getDb().prepare(
    'SELECT id, text, fire_at as fireAt, fired FROM reminders WHERE fired = 0 AND fire_at <= ?',
  ).all(now) as Array<{ id: string; text: string; fireAt: number; fired: number }>)
    .map(r => ({ ...r, fired: r.fired === 1 }))
}

export function markReminderFired(id: string): void {
  if (!dbAvailable) return
  getDb().prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(id)
}
```

- [ ] **Step 5: Build and verify types compile**

```bash
npm run build:backend
```

Expected: `dist-electron/backend/index.js` rebuilt with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/backend/types.ts src/backend/memory/settings.ts src/backend/memory/db.ts
git commit -m "feat(monitors): Settings monitor toggles + reminders DB table"
```

---

## Task 2: MonitorRegistry core

**Files:**
- Create: `src/backend/monitors/index.ts`
- Create: `tests/backend/monitors/queue.test.ts`

- [ ] **Step 1: Write the failing queue tests**

Create `tests/backend/monitors/queue.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MonitorRegistry, type Alert } from '../../../src/backend/monitors/index'

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return { id: 'test-1', text: 'Hello', priority: 'normal', source: 'custom', ...overrides }
}

describe('MonitorRegistry queue', () => {
  let reg: MonitorRegistry

  beforeEach(() => {
    reg = new MonitorRegistry()
  })

  it('deduplicates by id', () => {
    reg.enqueue(makeAlert({ id: 'a', text: 'first' }))
    reg.enqueue(makeAlert({ id: 'a', text: 'second' }))
    expect(reg.queueLength()).toBe(1)
  })

  it('puts urgent alerts before normal', () => {
    reg.enqueue(makeAlert({ id: 'b', priority: 'normal', text: 'normal' }))
    reg.enqueue(makeAlert({ id: 'c', priority: 'urgent', text: 'urgent' }))
    expect(reg.peekNext()?.text).toBe('urgent')
  })

  it('drops expired alerts during drain', async () => {
    const speak = vi.fn().mockResolvedValue(undefined)
    reg.setSpeakFn(speak)
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'd', expiresAt: Date.now() - 1 }))
    await reg.drainOnce()
    expect(speak).not.toHaveBeenCalled()
  })

  it('calls speakFn when idle and queue has items', async () => {
    const speak = vi.fn().mockResolvedValue(undefined)
    reg.setSpeakFn(speak)
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'e', text: 'alert text' }))
    await reg.drainOnce()
    expect(speak).toHaveBeenCalledWith('alert text')
    expect(reg.queueLength()).toBe(0)
  })

  it('does not speak when not idle', async () => {
    const speak = vi.fn().mockResolvedValue(undefined)
    reg.setSpeakFn(speak)
    reg.setIdle(false)
    reg.enqueue(makeAlert({ id: 'f' }))
    await reg.drainOnce()
    expect(speak).not.toHaveBeenCalled()
  })

  it('does not speak when speakFn not set', async () => {
    reg.setIdle(true)
    reg.enqueue(makeAlert({ id: 'g' }))
    await reg.drainOnce() // should not throw
    expect(reg.queueLength()).toBe(1) // still in queue
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/backend/monitors/queue.test.ts
```

Expected: FAIL — "Cannot find module '../../../src/backend/monitors/index'"

- [ ] **Step 3: Implement `MonitorRegistry`**

Create `src/backend/monitors/index.ts`:

```typescript
export interface Alert {
  id: string
  text: string
  priority: 'urgent' | 'normal'
  source: 'calendar' | 'email' | 'spotify' | 'system' | 'custom'
  expiresAt?: number
}

type SpeakFn = (text: string) => Promise<void>
type StopFn = () => void
export type EnqueueFn = (alert: Alert) => void
export type RegisterFn = (stop: StopFn) => void
export type MonitorStarter = (enqueue: EnqueueFn, register: RegisterFn) => void

export class MonitorRegistry {
  private queue: Alert[] = []
  private seen = new Set<string>()
  private idle = true
  private speakFn: SpeakFn | null = null
  private stopFns: StopFn[] = []
  private starters: MonitorStarter[] = []
  private drainTimer: ReturnType<typeof setInterval> | null = null

  setSpeakFn(fn: SpeakFn): void { this.speakFn = fn }

  setIdle(idle: boolean): void { this.idle = idle }

  addMonitor(starter: MonitorStarter): void { this.starters.push(starter) }

  registerMonitor(stop: StopFn): void { this.stopFns.push(stop) }

  enqueue(alert: Alert): void {
    if (this.seen.has(alert.id)) return
    this.seen.add(alert.id)
    this.queue.push(alert)
    this.queue.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'urgent' ? -1 : 1))
  }

  queueLength(): number { return this.queue.length }

  peekNext(): Alert | undefined { return this.queue[0] }

  startAll(): void {
    const enqueue: EnqueueFn = (a) => this.enqueue(a)
    const register: RegisterFn = (stop) => this.registerMonitor(stop)
    for (const starter of this.starters) {
      try { starter(enqueue, register) } catch (err) {
        console.error('[monitors] failed to start monitor:', err)
      }
    }
    this.drainTimer = setInterval(() => { void this.drainOnce() }, 8_000)
  }

  stopAll(): void {
    for (const stop of this.stopFns) { try { stop() } catch { /* ignore */ } }
    this.stopFns = []
    if (this.drainTimer) { clearInterval(this.drainTimer); this.drainTimer = null }
  }

  async drainOnce(): Promise<void> {
    if (!this.idle || !this.speakFn || this.queue.length === 0) return
    const now = Date.now()
    this.queue = this.queue.filter(a => !a.expiresAt || a.expiresAt > now)
    if (this.queue.length === 0) return
    const alert = this.queue.shift()!
    try { await this.speakFn!(alert.text) } catch (err) {
      console.error('[monitors] drain speak error:', err)
    }
  }
}

export const monitors = new MonitorRegistry()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/backend/monitors/queue.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/monitors/index.ts tests/backend/monitors/queue.test.ts
git commit -m "feat(monitors): MonitorRegistry — alert queue, dedup, idle drain"
```

---

## Task 3: Custom monitor + `jarvis_remind` tool

**Files:**
- Create: `src/backend/monitors/custom.ts`
- Modify: `src/backend/tools/jarvis.ts`
- Modify: `src/backend/tools/index.ts`
- Create: `tests/backend/monitors/custom.test.ts`

- [ ] **Step 1: Write failing tests for custom monitor**

Create `tests/backend/monitors/custom.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseFireAt, createRemindAlertText } from '../../../src/backend/monitors/custom'

describe('parseFireAt', () => {
  it('parses ISO 8601', () => {
    const ts = Date.now() + 60_000
    const iso = new Date(ts).toISOString()
    expect(parseFireAt(iso)).toBeCloseTo(ts, -2)
  })

  it('parses "in N minutes"', () => {
    const before = Date.now()
    const result = parseFireAt('in 30 minutes')
    expect(result).toBeGreaterThanOrEqual(before + 29 * 60_000)
    expect(result).toBeLessThanOrEqual(before + 31 * 60_000)
  })

  it('parses "in N hours"', () => {
    const before = Date.now()
    const result = parseFireAt('in 2 hours')
    expect(result).toBeGreaterThanOrEqual(before + 2 * 3_600_000 - 1000)
    expect(result).toBeLessThanOrEqual(before + 2 * 3_600_000 + 1000)
  })

  it('parses "at 5pm"', () => {
    const result = parseFireAt('at 5pm')
    const d = new Date(result)
    expect(d.getHours()).toBe(17)
    expect(d.getMinutes()).toBe(0)
  })

  it('parses "at 2:30pm"', () => {
    const result = parseFireAt('at 2:30pm')
    const d = new Date(result)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(30)
  })

  it('throws on unparseable input', () => {
    expect(() => parseFireAt('next tuesday sometime')).toThrow()
  })
})

describe('createRemindAlertText', () => {
  it('returns the reminder text as-is', () => {
    expect(createRemindAlertText('take a break')).toBe('take a break')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/backend/monitors/custom.test.ts
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/backend/monitors/custom.ts`**

```typescript
import { randomUUID } from 'crypto'
import { getDueReminders, markReminderFired, insertReminder } from '../memory/db'
import type { EnqueueFn, RegisterFn } from './index'
import { getSettings } from '../memory/settings'

export function parseFireAt(input: string): number {
  // ISO 8601
  const iso = Date.parse(input)
  if (!isNaN(iso)) return iso

  // "in N minutes/hours/seconds"
  const rel = input.match(/in\s+(\d+)\s+(second|minute|hour)s?/i)
  if (rel) {
    const n = parseInt(rel[1], 10)
    const unit = rel[2].toLowerCase()
    const ms = unit === 'second' ? 1_000 : unit === 'minute' ? 60_000 : 3_600_000
    return Date.now() + n * ms
  }

  // "at H:MMam/pm" or "at Hpm"
  const at = input.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (at) {
    let h = parseInt(at[1], 10)
    const m = parseInt(at[2] ?? '0', 10)
    const meridiem = at[3].toLowerCase()
    if (meridiem === 'pm' && h < 12) h += 12
    if (meridiem === 'am' && h === 12) h = 0
    const d = new Date()
    d.setHours(h, m, 0, 0)
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1)
    return d.getTime()
  }

  throw new Error(`Cannot parse time "${input}". Try "in 30 minutes", "at 5pm", or ISO format like "2026-06-12T17:00:00".`)
}

export function createRemindAlertText(text: string): string {
  return text
}

export function createReminder(text: string, fireAt: number): { id: string; fireAt: number } {
  const id = `remind:${randomUUID()}`
  insertReminder(id, text, fireAt)
  return { id, fireAt }
}

export function startCustomMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  const settings = getSettings()
  if (!settings.monitorCustom) return

  const tick = (): void => {
    try {
      const due = getDueReminders()
      for (const r of due) {
        markReminderFired(r.id)
        enqueue({ id: r.id, text: r.text, priority: 'normal', source: 'custom' })
      }
    } catch (err) {
      console.error('[monitor:custom] error:', err)
    }
  }

  const timer = setInterval(tick, 30_000)
  register(() => clearInterval(timer))
  tick() // check immediately on start
}
```

- [ ] **Step 4: Run custom tests to verify they pass**

```bash
npm test tests/backend/monitors/custom.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Add `jarvis_remind` tool def to `src/backend/tools/jarvis.ts`**

In `jarvisToolDefs` array, add after the `jarvis_get_usage` entry:

```typescript
  {
    name: 'jarvis_remind',
    description:
      'Set a reminder that Jarvis will speak aloud at a future time. Use when the user says "remind me", "set a reminder", "tell me at X", or "in N minutes tell me Y". The text parameter is what Jarvis will say when the reminder fires.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text:    { type: 'string', description: 'What Jarvis will say when the reminder fires (e.g. "take a break")' },
        fire_at: { type: 'string', description: 'When to fire: ISO 8601 ("2026-06-12T17:00:00"), relative ("in 30 minutes", "in 2 hours"), or time-of-day ("at 5pm", "at 2:30pm")' },
      },
      required: ['text', 'fire_at'],
    },
  },
```

- [ ] **Step 6: Add `setReminder` handler to `tools/jarvis.ts`**

Add import at top of the file:
```typescript
import { createReminder, parseFireAt } from '../monitors/custom'
```

Add `setReminder` function before `handleJarvisTool`:
```typescript
export function setReminder(input: Record<string, unknown>): string {
  const text = String(input.text ?? '').trim()
  const fireAtStr = String(input.fire_at ?? '').trim()
  if (!text) throw new Error('Reminder text is required.')
  if (!fireAtStr) throw new Error('fire_at is required.')

  const fireAt = parseFireAt(fireAtStr)
  const { id } = createReminder(text, fireAt)
  const when = new Date(fireAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  console.error(`[jarvis] reminder set: "${text}" at ${when} (id: ${id})`)
  return `Got it — I'll remind you at ${when}.`
}
```

Add `case 'jarvis_remind'` to `handleJarvisTool`:
```typescript
    case 'jarvis_remind':
      return setReminder(input)
```

- [ ] **Step 7: Confirm no change needed in `src/backend/tools/index.ts`**

`handleTool` at line 97 already has:
```typescript
else if (name.startsWith('jarvis_'))    result = await handleJarvisTool(name, input)
```
Since `jarvis_remind` starts with `jarvis_` and is not `jarvis_screenshot` (which is caught earlier on line 96), it is already routed to `handleJarvisTool` without any change. No edit required.

- [ ] **Step 8: Build to confirm no errors**

```bash
npm run build:backend
```

Expected: clean build.

- [ ] **Step 9: Commit**

```bash
git add src/backend/monitors/custom.ts src/backend/tools/jarvis.ts src/backend/tools/index.ts tests/backend/monitors/custom.test.ts
git commit -m "feat(monitors): custom reminder monitor + jarvis_remind tool"
```

---

## Task 4: Calendar monitor

**Files:**
- Modify: `src/backend/tools/gmail.ts` (export `getAuthorizedClient`)
- Create: `src/backend/monitors/calendar.ts`
- Create: `tests/backend/monitors/calendar.test.ts`

- [ ] **Step 1: Export `getAuthorizedClient` from `gmail.ts`**

Change the function declaration at line 31 from:
```typescript
async function getAuthorizedClient(): Promise<OAuth2Client> {
```
to:
```typescript
export async function getAuthorizedClient(): Promise<OAuth2Client> {
```

- [ ] **Step 2: Write failing calendar monitor tests**

Create `tests/backend/monitors/calendar.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildCalendarAlerts } from '../../../src/backend/monitors/calendar'

interface FakeEvent {
  id: string
  summary: string
  start: { dateTime?: string; date?: string }
}

function makeEvent(id: string, summary: string, minutesFromNow: number): FakeEvent {
  return {
    id,
    summary,
    start: { dateTime: new Date(Date.now() + minutesFromNow * 60_000).toISOString() },
  }
}

describe('buildCalendarAlerts', () => {
  it('emits urgent alert for event ≤ 15 min away', () => {
    const alerts = buildCalendarAlerts([makeEvent('e1', 'Team Standup', 10)], new Set())
    expect(alerts).toHaveLength(1)
    expect(alerts[0].priority).toBe('urgent')
    expect(alerts[0].text).toMatch(/Team Standup/)
    expect(alerts[0].id).toBe('cal:e1:15')
  })

  it('emits normal alert for event ≤ 30 min away (and > 15)', () => {
    const alerts = buildCalendarAlerts([makeEvent('e2', 'Lunch', 25)], new Set())
    expect(alerts).toHaveLength(1)
    expect(alerts[0].priority).toBe('normal')
    expect(alerts[0].id).toBe('cal:e2:30')
  })

  it('emits no alert for event > 30 min away', () => {
    const alerts = buildCalendarAlerts([makeEvent('e3', 'Future', 45)], new Set())
    expect(alerts).toHaveLength(0)
  })

  it('deduplicates — skips already-seen alert IDs', () => {
    const seen = new Set(['cal:e4:15'])
    const alerts = buildCalendarAlerts([makeEvent('e4', 'Meeting', 5)], seen)
    expect(alerts).toHaveLength(0)
  })

  it('can emit both 30-min and 15-min alerts for same event', () => {
    // Event at 12 min → only 15-min window fires
    const seen = new Set<string>()
    const alerts1 = buildCalendarAlerts([makeEvent('e5', 'Demo', 12)], seen)
    expect(alerts1[0].id).toBe('cal:e5:15')
    seen.add('cal:e5:15')

    // Same event at 28 min (from a previous poll) — 30-min window fires
    const seen2 = new Set<string>()
    const alerts2 = buildCalendarAlerts([makeEvent('e5b', 'Demo', 28)], seen2)
    expect(alerts2[0].id).toBe('cal:e5b:30')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test tests/backend/monitors/calendar.test.ts
```

Expected: FAIL — cannot find module.

- [ ] **Step 4: Create `src/backend/monitors/calendar.ts`**

```typescript
import { google } from 'googleapis'
import { getAuthorizedClient } from '../tools/gmail'
import { getSettings } from '../memory/settings'
import type { Alert, EnqueueFn, RegisterFn } from './index'

export function buildCalendarAlerts(
  events: Array<{ id?: string | null; summary?: string | null; start: { dateTime?: string | null; date?: string | null } }>,
  seen: Set<string>,
): Alert[] {
  const now = Date.now()
  const alerts: Alert[] = []

  for (const event of events) {
    const eventId = event.id ?? 'unknown'
    const title = event.summary ?? 'Untitled event'
    const startMs = Date.parse(event.start.dateTime ?? event.start.date ?? '')
    if (isNaN(startMs)) continue

    const minsUntil = Math.round((startMs - now) / 60_000)

    if (minsUntil <= 15 && minsUntil > 0) {
      const alertId = `cal:${eventId}:15`
      if (!seen.has(alertId)) {
        alerts.push({ id: alertId, text: `You have ${title} in ${minsUntil} minute${minsUntil === 1 ? '' : 's'}.`, priority: 'urgent', source: 'calendar', expiresAt: startMs })
      }
    } else if (minsUntil <= 30 && minsUntil > 15) {
      const alertId = `cal:${eventId}:30`
      if (!seen.has(alertId)) {
        alerts.push({ id: alertId, text: `Heads up — ${title} in about ${minsUntil} minutes.`, priority: 'normal', source: 'calendar', expiresAt: startMs })
      }
    }
  }

  return alerts
}

export function startCalendarMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  if (!getSettings().monitorCalendar) return

  const seen = new Set<string>()

  const poll = async (): Promise<void> => {
    try {
      const auth = await getAuthorizedClient()
      const calendar = google.calendar({ version: 'v3', auth })
      const now = new Date()
      const timeMax = new Date(Date.now() + 60 * 60_000) // next 60 min
      const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
      })
      const events = res.data.items ?? []
      const alerts = buildCalendarAlerts(events, seen)
      for (const a of alerts) {
        seen.add(a.id)
        enqueue(a)
      }
    } catch (err) {
      console.error('[monitor:calendar] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 5 * 60_000)
  register(() => clearInterval(timer))
  void poll()
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test tests/backend/monitors/calendar.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Build**

```bash
npm run build:backend
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/backend/monitors/calendar.ts src/backend/tools/gmail.ts tests/backend/monitors/calendar.test.ts
git commit -m "feat(monitors): calendar monitor — 15/30-min event alerts"
```

---

## Task 5: Email monitor

**Files:**
- Create: `src/backend/monitors/email.ts`
- Create: `tests/backend/monitors/email.test.ts`

- [ ] **Step 1: Write failing email monitor tests**

Create `tests/backend/monitors/email.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildEmailAlerts } from '../../../src/backend/monitors/email'

interface FakeMsg { id: string; payload?: { headers?: Array<{ name: string; value: string }> } }

function makeMsg(id: string, from: string, subject: string): FakeMsg {
  return {
    id,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
      ],
    },
  }
}

describe('buildEmailAlerts', () => {
  it('returns one alert per new message (≤ 3)', () => {
    const seen = new Set<string>()
    const msgs = [
      makeMsg('m1', 'prof@vt.edu', 'Research update needed'),
      makeMsg('m2', 'mom@gmail.com', 'Dinner plans'),
    ]
    const alerts = buildEmailAlerts(msgs, seen)
    expect(alerts).toHaveLength(2)
    expect(alerts[0].text).toContain('Research update needed')
    expect(alerts[0].id).toBe('email:m1')
  })

  it('deduplicates already-seen message IDs', () => {
    const seen = new Set(['email:m1'])
    const msgs = [makeMsg('m1', 'x@x.com', 'Hi')]
    expect(buildEmailAlerts(msgs, seen)).toHaveLength(0)
  })

  it('rolls up when more than 3 new messages', () => {
    const seen = new Set<string>()
    const msgs = Array.from({ length: 5 }, (_, i) => makeMsg(`m${i}`, 'x@x.com', `Email ${i}`))
    const alerts = buildEmailAlerts(msgs, seen)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].text).toMatch(/5 new emails/)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
npm test tests/backend/monitors/email.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `src/backend/monitors/email.ts`**

```typescript
import { getAuthorizedClient } from '../tools/gmail'
import { google } from 'googleapis'
import { getSettings } from '../memory/settings'
import type { Alert, EnqueueFn, RegisterFn } from './index'

interface GmailMessage {
  id?: string | null
  payload?: { headers?: Array<{ name?: string | null; value?: string | null }> | null } | null
}

function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name === name)?.value ?? ''
}

export function buildEmailAlerts(msgs: GmailMessage[], seen: Set<string>): Alert[] {
  const newMsgs = msgs.filter(m => m.id && !seen.has(`email:${m.id}`))
  if (newMsgs.length === 0) return []

  if (newMsgs.length > 3) {
    const id = `email:bulk:${Date.now()}`
    return [{ id, text: `You have ${newMsgs.length} new emails.`, priority: 'normal', source: 'email' }]
  }

  return newMsgs.map(m => {
    const from = header(m, 'From').replace(/<.*>/, '').trim() || header(m, 'From')
    const subject = header(m, 'Subject') || '(no subject)'
    return {
      id: `email:${m.id}`,
      text: `New email from ${from} — ${subject}.`,
      priority: 'normal' as const,
      source: 'email' as const,
    }
  })
}

export function startEmailMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  if (!getSettings().monitorEmail) return

  const seen = new Set<string>()

  const poll = async (): Promise<void> => {
    try {
      const auth = await getAuthorizedClient()
      const gmail = google.gmail({ version: 'v1', auth })
      const list = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread newer_than:4m -category:promotions -category:social',
        maxResults: 10,
      })
      const messages = list.data.messages ?? []
      if (messages.length === 0) return

      const full = await Promise.all(
        messages.slice(0, 10).map(m =>
          gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'Subject'] })
        )
      )
      const alerts = buildEmailAlerts(full.map(r => r.data), seen)
      for (const a of alerts) {
        if (a.id.startsWith('email:') && !a.id.includes('bulk')) seen.add(a.id)
        enqueue(a)
      }
    } catch (err) {
      console.error('[monitor:email] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 3 * 60_000)
  register(() => clearInterval(timer))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/backend/monitors/email.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Build**

```bash
npm run build:backend
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/backend/monitors/email.ts tests/backend/monitors/email.test.ts
git commit -m "feat(monitors): email monitor — new mail alerts with rollup"
```

---

## Task 6: Spotify monitor

**Files:**
- Create: `src/backend/monitors/spotify.ts`

No test file needed — Spotify API calls require auth tokens that are impossible to mock cleanly in unit tests. The monitor is tested manually.

- [ ] **Step 1: Create `src/backend/monitors/spotify.ts`**

```typescript
import { getSettings } from '../memory/settings'
import type { Alert, EnqueueFn, RegisterFn } from './index'

interface SpotifyPlaybackState {
  is_playing: boolean
  item?: { id: string; name: string } | null
  device?: { id: string; name: string; type: string } | null
}

async function fetchPlayback(token: string): Promise<SpotifyPlaybackState | null> {
  if (!token) return null
  const res = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 204 || res.status === 401 || res.status === 403) return null
  if (!res.ok) return null
  return res.json() as Promise<SpotifyPlaybackState>
}

export function startSpotifyMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  if (!getSettings().monitorSpotify) return

  let prevIsPlaying = false
  let stoppedCount = 0
  const seenDevices = new Set<string>()

  const poll = async (): Promise<void> => {
    try {
      const token = getSettings().spotifyAccessToken
      const state = await fetchPlayback(token)
      if (!state) {
        prevIsPlaying = false
        stoppedCount = 0
        return
      }

      // Track change to non-Computer device
      const device = state.device
      if (device && device.type !== 'Computer') {
        const devAlertId = `spotify:device:${device.id}`
        if (!seenDevices.has(devAlertId)) {
          seenDevices.add(devAlertId)
          enqueue({ id: devAlertId, text: `Spotify switched to ${device.name}.`, priority: 'normal', source: 'spotify' })
        }
      }

      // Playback stopped detection (2 consecutive stopped polls)
      if (!state.is_playing && prevIsPlaying) {
        stoppedCount++
        if (stoppedCount >= 2) {
          const trackId = state.item?.id ?? 'unknown'
          enqueue({ id: `spotify:stopped:${trackId}`, text: 'Music stopped. Want me to queue something?', priority: 'normal', source: 'spotify' })
          stoppedCount = 0
        }
      } else if (state.is_playing) {
        stoppedCount = 0
      }

      prevIsPlaying = state.is_playing
    } catch (err) {
      console.error('[monitor:spotify] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 10_000)
  register(() => clearInterval(timer))
}
```

- [ ] **Step 2: Build**

```bash
npm run build:backend
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/backend/monitors/spotify.ts
git commit -m "feat(monitors): Spotify monitor — playback-end and device-change alerts"
```

---

## Task 7: System monitor (battery)

**Files:**
- Modify: `package.json` (install `systeminformation`)
- Create: `src/backend/monitors/system.ts`
- Create: `tests/backend/monitors/system.test.ts`

- [ ] **Step 1: Install `systeminformation`**

```bash
npm install systeminformation
```

Expected: package added to `dependencies` in `package.json`.

- [ ] **Step 2: Write failing system monitor tests**

Create `tests/backend/monitors/system.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildBatteryAlerts } from '../../../src/backend/monitors/system'

describe('buildBatteryAlerts', () => {
  it('returns normal alert when below 20% and not charging', () => {
    const seen = new Set<string>()
    const alerts = buildBatteryAlerts({ percent: 15, isCharging: false }, seen)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].priority).toBe('normal')
    expect(alerts[0].text).toContain('15%')
    expect(alerts[0].id).toBe('system:battery:20')
  })

  it('returns urgent alert when below 10% and not charging', () => {
    const seen = new Set<string>()
    const alerts = buildBatteryAlerts({ percent: 7, isCharging: false }, seen)
    expect(alerts).toHaveLength(2) // both 20% and 10% thresholds
    const urgent = alerts.find(a => a.priority === 'urgent')
    expect(urgent).toBeDefined()
    expect(urgent?.id).toBe('system:battery:10')
  })

  it('returns no alert when charging', () => {
    const seen = new Set<string>()
    expect(buildBatteryAlerts({ percent: 5, isCharging: true }, seen)).toHaveLength(0)
  })

  it('deduplicates — does not repeat the same threshold', () => {
    const seen = new Set(['system:battery:20'])
    const alerts = buildBatteryAlerts({ percent: 18, isCharging: false }, seen)
    expect(alerts).toHaveLength(0)
  })

  it('clears seen thresholds when charging (re-arms for next discharge)', () => {
    const seen = new Set(['system:battery:20', 'system:battery:10'])
    buildBatteryAlerts({ percent: 50, isCharging: true }, seen)
    expect(seen.size).toBe(0)
  })
})
```

- [ ] **Step 3: Run to verify fail**

```bash
npm test tests/backend/monitors/system.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Create `src/backend/monitors/system.ts`**

```typescript
import type { Alert, EnqueueFn, RegisterFn } from './index'
import { getSettings } from '../memory/settings'

export interface BatterySnapshot {
  percent: number
  isCharging: boolean
}

export function buildBatteryAlerts(snapshot: BatterySnapshot, seen: Set<string>): Alert[] {
  if (snapshot.isCharging) {
    // Charger connected — clear thresholds so they re-arm on next discharge
    seen.delete('system:battery:20')
    seen.delete('system:battery:10')
    return []
  }

  const alerts: Alert[] = []

  if (snapshot.percent <= 20 && !seen.has('system:battery:20')) {
    seen.add('system:battery:20')
    alerts.push({
      id: 'system:battery:20',
      text: `Battery at ${snapshot.percent}%, you might want to plug in.`,
      priority: 'normal',
      source: 'system',
    })
  }

  if (snapshot.percent <= 10 && !seen.has('system:battery:10')) {
    seen.add('system:battery:10')
    alerts.push({
      id: 'system:battery:10',
      text: `Battery critically low at ${snapshot.percent}%.`,
      priority: 'urgent',
      source: 'system',
    })
  }

  return alerts
}

export function startSystemMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  if (!getSettings().monitorSystem) return

  const seen = new Set<string>()

  const poll = async (): Promise<void> => {
    try {
      const si = await import('systeminformation')
      const batt = await si.battery()
      if (!batt.hasBattery) return
      const snapshot: BatterySnapshot = {
        percent: Math.round(batt.percent),
        isCharging: batt.isCharging,
      }
      const alerts = buildBatteryAlerts(snapshot, seen)
      for (const a of alerts) enqueue(a)
    } catch (err) {
      console.error('[monitor:system] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 60_000)
  register(() => clearInterval(timer))
  void poll()
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test tests/backend/monitors/system.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 6: Build**

```bash
npm run build:backend
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/backend/monitors/system.ts tests/backend/monitors/system.test.ts package.json package-lock.json
git commit -m "feat(monitors): system monitor — battery level alerts"
```

---

## Task 8: Wire monitors into `backend/index.ts`

**Files:**
- Modify: `src/backend/index.ts`

- [ ] **Step 1: Add monitor imports at the top of `index.ts`**

After the existing imports (around line 175), add:

```typescript
import { monitors } from './monitors/index'
import { startCalendarMonitor } from './monitors/calendar'
import { startEmailMonitor } from './monitors/email'
import { startSpotifyMonitor } from './monitors/spotify'
import { startSystemMonitor } from './monitors/system'
import { startCustomMonitor } from './monitors/custom'
```

- [ ] **Step 2: Register monitors and set speak function**

After `initDb()` is called (around line 189), add:

```typescript
// Register all monitor starters with the registry
monitors.addMonitor(startCalendarMonitor)
monitors.addMonitor(startEmailMonitor)
monitors.addMonitor(startSpotifyMonitor)
monitors.addMonitor(startSystemMonitor)
monitors.addMonitor(startCustomMonitor)
monitors.setSpeakFn((text) => speakOrIdle(text))
```

Note: `speakOrIdle` is defined later in the same file (hoisting is fine for function declarations). However since `speakOrIdle` is declared as `async function speakOrIdle(...)`, and we're storing a reference via arrow function, the reference is captured correctly regardless of declaration order.

- [ ] **Step 3: Start monitors when WebSocket server connects**

In the `wss.on('connection', ...)` handler (around line 284), after the `broadcast({ type: 'state', state: 'idle' })` line, add:

```typescript
  // Start background monitors on first connection
  if (!monitors['drainTimer']) {
    monitors.startAll()
    console.error('[monitors] background monitors started')
  }
```

Actually, to avoid accessing private fields, add a `isRunning()` method to `MonitorRegistry`. Edit `src/backend/monitors/index.ts` to add:

```typescript
  isRunning(): boolean { return this.drainTimer !== null }
```

Then in `index.ts`:
```typescript
  if (!monitors.isRunning()) {
    monitors.startAll()
    console.error('[monitors] background monitors started')
  }
```

- [ ] **Step 4: Set idle state at pipeline boundaries**

In `processAudio` (around line 522), after `isProcessing = true`, add:
```typescript
  monitors.setIdle(false)
```

In the `finally` block of `processAudio` (around line 552), after `isProcessing = false`, add:
```typescript
  monitors.setIdle(true)
```

Do the same in `processUserText` — after `isProcessing = true` (around line 586) and in the finally block.

- [ ] **Step 5: Stop monitors on shutdown**

In the `shutdown()` function (around line 836), before `shutdownCapture()`, add:
```typescript
  monitors.stopAll()
```

- [ ] **Step 6: Build and run full test suite**

```bash
npm run build:backend
npm test
```

Expected: build clean, 300+ tests still passing.

- [ ] **Step 7: Commit**

```bash
git add src/backend/index.ts src/backend/monitors/index.ts
git commit -m "feat(monitors): wire MonitorRegistry into backend — startAll, setIdle, shutdown"
```

---

## Task 9: PTT interruption in App.tsx

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add `audioRef` to track the active TTS Audio element**

In `App.tsx`, after `const quietModeRef = useRef(false)` (around line 33), add:

```typescript
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)
```

- [ ] **Step 2: Store and clear `activeAudioRef` in the audio event handler**

In the `audio` event handler (around line 79), after `const audio = new Audio(url)`, add:

```typescript
      activeAudioRef.current = audio
```

In `audio.onended` (around line 107), after `URL.revokeObjectURL(url)`, add:

```typescript
        activeAudioRef.current = null
```

In the `audio.play().catch(...)` error handler, also clear the ref:

```typescript
      audio.play().catch(err => {
        console.error('[audio] playback error:', err)
        activeAudioRef.current = null  // add this line
        cleanup()
        handleEvent({ type: 'state', state: 'idle' })
      })
```

- [ ] **Step 3: Kill active TTS on PTT start**

Find the `onPttStart` handler (around line 163):

```typescript
    ;(window as any).jarvis.onPttStart(() => { void startMeter() })
```

Change it to:

```typescript
    ;(window as any).jarvis.onPttStart(() => {
      // Kill any active TTS so Jarvis stops talking and listens
      if (activeAudioRef.current) {
        activeAudioRef.current.pause()
        activeAudioRef.current.currentTime = 0
        activeAudioRef.current = null
      }
      window.speechSynthesis.cancel()
      void startMeter()
    })
```

- [ ] **Step 4: Build renderer**

```bash
npx electron-vite build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`. Start Jarvis speaking a long response. Press Right Alt (PTT key) mid-sentence. Verify Jarvis stops speaking immediately and the listening state begins.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(ptt): kill active TTS immediately on PTT start"
```

---

## Task 10: Settings panel — Monitors section

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.tsx`

- [ ] **Step 1: Add Monitors section to SettingsPanel**

Open `src/renderer/src/components/SettingsPanel.tsx`. After the closing `</label>` and `</p>` of the QUIET MODE section (around line 95), and before the `<div style={sectionLabel}>AI MODEL</div>` line, insert:

```typescript
        <div style={sectionLabel}>MONITORS</div>
        <p style={{ fontSize: 10, color: 'var(--ov-text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
          Jarvis will speak these alerts when idle. Toggle off to silence specific monitors.
        </p>
        {(
          [
            { key: 'monitorCalendar', label: 'CALENDAR (upcoming events)' },
            { key: 'monitorEmail',    label: 'EMAIL (new important mail)' },
            { key: 'monitorSpotify',  label: 'SPOTIFY (playback ended)' },
            { key: 'monitorSystem',   label: 'SYSTEM (battery level)' },
            { key: 'monitorCustom',   label: 'REMINDERS (say "remind me…")' },
          ] as const
        ).map(({ key, label }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={!!(draft as any)[key]}
              onChange={e => setDraft({ ...draft, [key]: e.target.checked } as any)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--ov-accent)' }}
            />
            <span style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--ov-text-mid)' }}>
              {label}
            </span>
          </label>
        ))}
        <div style={{ marginBottom: 16 }} />
```

- [ ] **Step 2: Build renderer**

```bash
npx electron-vite build
```

Expected: clean build. The `as any` casts avoid fighting the TypeScript type union — `draft` is typed as `Settings` which now includes the monitor booleans, but the `key` const-array needs the cast to index dynamically.

If TypeScript rejects it, replace the `(draft as any)[key]` pattern with explicit ternary checks or cast `key as keyof Settings`.

- [ ] **Step 3: Verify settings save correctly**

Run `npm run dev`. Open Settings (TitleBar gear icon). Confirm Monitors section appears with 5 toggles, all checked by default. Uncheck one, click SAVE, reopen Settings — confirm the unchecked state persists.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all existing tests still pass (300+).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx
git commit -m "feat(settings): Monitors section with per-monitor toggles"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm test` — all tests pass (target: 330+ with new monitor tests)
- [ ] `npm run build:backend` — clean build
- [ ] `npx electron-vite build` — clean build
- [ ] Run `npm run dev` and test:
  - Say "remind me in 1 minute to stretch" → Jarvis confirms → ~60s later Jarvis speaks the reminder
  - Start Jarvis speaking → press Right Alt mid-sentence → Jarvis stops immediately, listening begins
  - Open Settings → Monitors section visible with 5 toggles → save works
  - Calendar: if a Google Calendar event is within 30 min, Jarvis speaks an alert at the next idle moment
