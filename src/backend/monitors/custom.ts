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
      if (!getSettings().monitorCustom) return
      const due = getDueReminders()
      for (const r of due) {
        enqueue({ id: r.id, text: createRemindAlertText(r.text), priority: 'normal', source: 'custom' })
        markReminderFired(r.id)
      }
    } catch (err) {
      console.error('[monitor:custom] error:', err)
    }
  }

  const timer = setInterval(tick, 30_000)
  register(() => clearInterval(timer))
  tick() // check immediately on start
}
