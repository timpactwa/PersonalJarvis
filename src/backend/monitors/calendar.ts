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
        alerts.push({
          id: alertId,
          text: `You have ${title} in ${minsUntil} minute${minsUntil === 1 ? '' : 's'}.`,
          priority: 'urgent',
          source: 'calendar',
          expiresAt: startMs,
        })
      }
    } else if (minsUntil <= 30 && minsUntil > 15) {
      const alertId = `cal:${eventId}:30`
      if (!seen.has(alertId)) {
        alerts.push({
          id: alertId,
          text: `Heads up — ${title} in about ${minsUntil} minutes.`,
          priority: 'normal',
          source: 'calendar',
          expiresAt: startMs,
        })
      }
    }
  }

  return alerts
}

export function startCalendarMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  if (!getSettings().monitorCalendar) return

  const seen = new Set<string>()

  const poll = async (): Promise<void> => {
    if (!getSettings().monitorCalendar) return
    try {
      const auth = await getAuthorizedClient()
      const calendar = google.calendar({ version: 'v3', auth })
      const now = new Date()
      const timeMax = new Date(Date.now() + 60 * 60_000)
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
