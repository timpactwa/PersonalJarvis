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
    if (!getSettings().monitorEmail) return
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
        if (!a.id.includes('bulk')) seen.add(a.id)
        enqueue(a)
      }
    } catch (err) {
      console.error('[monitor:email] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 3 * 60_000)
  register(() => clearInterval(timer))
}
