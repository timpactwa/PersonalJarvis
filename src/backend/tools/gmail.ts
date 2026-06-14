import { google } from 'googleapis'
import { readFileSync, writeFileSync, existsSync } from 'fs'

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>
import { join } from 'path'
import { createServer } from 'http'
import { randomUUID } from 'crypto'
import { emitEvent } from '../events'
import { resolveContactEmail } from '../memory/contacts'
import { shouldSuppressComposeUI } from '../toolSession'

const TOKEN_PATH = join(process.cwd(), '.gmail-token.json')
const CREDS_PATH = join(process.cwd(), '.gmail-credentials.json')

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
]

function getOAuth2Client(): OAuth2Client {
  if (!existsSync(CREDS_PATH)) {
    throw new Error('Gmail credentials not found. Add .gmail-credentials.json (from Google Cloud Console).')
  }
  const creds = JSON.parse(readFileSync(CREDS_PATH, 'utf-8'))
  const { client_id, client_secret } = creds.installed ?? creds.web
  return new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3456')
}

let _auth: OAuth2Client | null = null

export function resetAuthClient(): void {
  _auth = null
}

export async function getAuthorizedClient(): Promise<OAuth2Client> {
  if (_auth) return _auth

  const auth = getOAuth2Client()

  if (existsSync(TOKEN_PATH)) {
    auth.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')))
    auth.on('tokens', (newTokens) => {
      try {
        const current = existsSync(TOKEN_PATH)
          ? JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'))
          : {}
        writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }))
      } catch (e) {
        console.error('[gmail] failed to save refreshed tokens:', e)
      }
    })
    _auth = auth
    return auth
  }

  // OAuth2 flow — opens browser for authorization
  const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES })
  console.log('[gmail] Opening browser for OAuth:', authUrl)

  const code = await new Promise<string>((resolve) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:3456')
      const authCode = url.searchParams.get('code')
      if (authCode) {
        res.end('Authorized! You can close this tab.')
        srv.close()
        resolve(authCode)
      } else {
        res.end('Waiting for authorization...')
      }
    }).listen(3456)
    require('child_process').exec(`start "${authUrl}"`)
  })

  const { tokens } = await auth.getToken(code)
  auth.setCredentials(tokens)
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens))
  _auth = auth
  return auth
}

export async function searchEmails(query: string, maxResults = 5): Promise<string> {
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults })
  if (!list.data.messages?.length) return 'No messages found.'

  const msgs = await Promise.all(
    list.data.messages.slice(0, maxResults).map(m =>
      gmail.users.messages.get({
        userId: 'me',
        id: m.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      })
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
  return extractPlainBody(msg.data.payload, msg.data.snippet).slice(0, 5000)
}

function extractPlainBody(payload: any, snippet?: string | null): string {
  if (!payload) return snippet ?? '(no body)'
  const parts: any[] = payload.parts ?? []
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8')
    }
    if (part.parts) {
      const nested = extractPlainBody(part, null)
      if (nested !== '(no body)') return nested
    }
  }
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  return snippet ?? '(no plain text body)'
}

function buildRawMessage(to: string, subject: string, body: string, cc = '', bcc = ''): string {
  const safeHeader = (v: string): string => v.replace(/[\r\n]+/g, ' ').trim()
  const lines = [
    `To: ${safeHeader(to)}`,
    ...(cc  ? [`Cc: ${safeHeader(cc)}`]  : []),
    ...(bcc ? [`Bcc: ${safeHeader(bcc)}`] : []),
    `Subject: ${safeHeader(subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body,
  ]
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

export async function sendEmailNow(to: string, subject: string, body: string, cc = '', bcc = ''): Promise<string> {
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: buildRawMessage(to, subject, body, cc, bcc) } })
  return `Email sent to ${to}.`
}

export async function createDraft(to: string, subject: string, body: string, cc = '', bcc = ''): Promise<string> {
  if (!to) throw new Error('Recipient (to) is required')
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: buildRawMessage(to, subject, body, cc, bcc) } } })
  return `Draft saved for ${to}.`
}

export async function composeEmail(to: string, subject: string, body: string, cc = '', bcc = '', suppressUi = false): Promise<string> {
  const resolvedTo = resolveContactEmail(to)
  const draft = { id: randomUUID(), to: resolvedTo, cc, bcc, subject, body }

  if (suppressUi || shouldSuppressComposeUI(resolvedTo, subject, draft.id)) {
    return `Email to ${resolvedTo} was already handled — the composer is closed. Say "compose an email to ${to}" if you need it again.`
  }

  emitEvent({ type: 'email_compose', draft })
  const label = resolvedTo !== to ? `${to} (${resolvedTo})` : to
  return `I've opened a composer for your email to ${label} — review and send when ready.`
}

export async function browseEmails(query: string, maxResults = 5): Promise<string> {
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults })
  if (!list.data.messages?.length) {
    emitEvent({ type: 'email_view', emails: [] })
    return 'No messages found.'
  }
  const msgs = await Promise.all(
    list.data.messages.slice(0, maxResults).map(m =>
      gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'full' })
    )
  )
  const emails = msgs.map(m => {
    const headers = m.data.payload?.headers ?? []
    const get = (name: string) => headers.find((h: any) => h.name === name)?.value ?? ''
    return {
      id: m.data.id ?? randomUUID(),
      from: get('From'),
      subject: get('Subject'),
      date: get('Date'),
      body: extractPlainBody(m.data.payload, m.data.snippet).slice(0, 3000),
    }
  })
  emitEvent({ type: 'email_view', emails })
  return `Pulled ${emails.length} email${emails.length !== 1 ? 's' : ''} into the viewer.`
}

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

export async function listCalendarEvents(maxResults = 10): Promise<string> {
  const auth = await getAuthorizedClient()
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  })
  const events = res.data.items ?? []
  if (!events.length) return 'No upcoming events.'
  return events.map(e => {
    const start = e.start?.dateTime ?? e.start?.date ?? 'unknown'
    return `${e.summary} — ${start}`
  }).join('\n')
}

export async function createCalendarEvent(
  title: string,
  startDateTime: string,
  endDateTime: string,
  description = '',
): Promise<string> {
  const auth = await getAuthorizedClient()
  const calendar = google.calendar({ version: 'v3', auth })
  await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description,
      start: { dateTime: startDateTime, timeZone: LOCAL_TZ },
      end: { dateTime: endDateTime, timeZone: LOCAL_TZ },
    },
  })
  return `Event "${title}" added to your calendar.`
}

export async function openEventCompose(title: string, start: string, end: string, description = ''): Promise<string> {
  const event = { id: randomUUID(), title, start, end, description }
  emitEvent({ type: 'event_compose', event })
  return `I've opened an event editor for "${title}" — review and save when ready.`
}

export const gmailToolDefs = [
  {
    name: 'gmail_search',
    description: 'Searches Gmail and returns a TEXT summary (subject, sender, date, message ID) for matching messages — nothing is shown on screen. Use this when you need email data to ANSWER a question inline, e.g. "did I get an email from my boss?", "how many unread emails do I have?", "when did Amazon email me?". Do NOT use when the user wants to visually see/flip through emails on screen (use gmail_browse) or to compose mail (use gmail_compose). Follow up with gmail_read to get a message\'s full body.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'A Gmail search query using Gmail operators, e.g. "from:boss@company.com", "is:unread newer_than:7d", "subject:invoice". Translate the user\'s natural request into these operators.' },
        max_results: { type: 'number', description: 'Maximum number of messages to return (default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'Returns the full plain-text body of ONE specific Gmail message identified by its message ID (first 5000 chars). Use only after gmail_search has given you a message ID and you need the full content to answer a detailed question. Do NOT use to find or list emails (use gmail_search) or to display emails to the user (use gmail_browse).',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'The exact Gmail message ID returned in a prior gmail_search result (the "ID:" field).' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'gmail_compose',
    description: 'Opens an interactive email composer popup pre-filled with the recipient, subject, and body so the user can review, edit, and then send or save it themselves — Jarvis never sends mail automatically. Use ONLY when the user explicitly asks to send, draft, write, compose, or reply to an email RIGHT NOW, e.g. "email mom that I\'ll be late", "draft a reply to my boss". Do NOT use for past-tense or memory statements ("remember I emailed John", "I just sent an email") and do NOT use to read or search existing mail (use gmail_search / gmail_browse).',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:      { type: 'string', description: 'Recipient email address, or a known contact\'s name like "mom" or "Amanda" — saved contacts are resolved to their address automatically.' },
        subject: { type: 'string', description: 'The email subject line. Infer a concise one from the request if the user did not state it.' },
        body:    { type: 'string', description: 'The plain-text body of the email, written out in full based on the user\'s instructions.' },
        cc:      { type: 'string', description: 'Optional CC recipients, comma-separated.' },
        bcc:     { type: 'string', description: 'Optional BCC recipients, comma-separated.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_browse',
    description: 'Pulls matching emails into an on-screen interactive viewer popup the user can scroll and flip through. Use when the user wants to SEE or visually review their actual emails, e.g. "show me my emails", "pull up important mail from this week", "let me see my unread". Do NOT use when you only need email facts to answer a question inline (use gmail_search) or to write mail (use gmail_compose).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:       { type: 'string', description: 'A Gmail search query using Gmail operators (is:important, is:unread, newer_than:7d, from:X, etc.) translated from the user\'s request. Use "in:inbox" for a general "show my emails".' },
        max_results: { type: 'number', description: 'Maximum number of emails to load into the viewer (default 5, max 10).' },
      },
      required: ['query'],
    },
  },
]

export const calendarToolDefs = [
  {
    name: 'calendar_list',
    description: 'Returns the user\'s upcoming Google Calendar events as text (title and start time), soonest first. Use when the user asks what is on their schedule, e.g. "what\'s on my calendar?", "do I have anything today?", "what\'s my next meeting?". This only READS events — do NOT use it to add an event (use calendar_create).',
    input_schema: {
      type: 'object' as const,
      properties: {
        max_results: { type: 'number', description: 'Maximum number of upcoming events to return (default 10).' },
      },
      required: [],
    },
  },
  {
    name: 'calendar_create',
    description: 'Opens an interactive event-editor popup pre-filled with the event details so the user can review and confirm before it is saved to Google Calendar — nothing is saved automatically. Use when the user asks to add, schedule, book, or create a calendar event or meeting, e.g. "schedule a dentist appointment Friday at 2pm", "add a meeting tomorrow morning". Do NOT use to view existing events (use calendar_list).',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:       { type: 'string', description: 'The event title/summary, e.g. "Dentist appointment".' },
        start:       { type: 'string', description: 'Start time in ISO 8601 local format, e.g. 2026-06-15T14:00:00. Resolve relative phrases ("tomorrow at 2pm") to an absolute date-time using the current time provided in context.' },
        end:         { type: 'string', description: 'End time in ISO 8601 local format. If the user gives no duration, default to one hour after start.' },
        description: { type: 'string', description: 'Optional longer description or notes for the event.' },
      },
      required: ['title', 'start', 'end'],
    },
  },
]

export async function handleGmailTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case 'gmail_search':    return searchEmails(input.query, input.max_results)
    case 'gmail_read':      return readEmail(input.message_id)
    case 'gmail_compose':   return composeEmail(input.to, input.subject, input.body, input.cc, input.bcc, !!input._suppressUi)
    case 'gmail_browse':    return browseEmails(input.query, input.max_results)
    case 'calendar_list':   return listCalendarEvents(input.max_results)
    case 'calendar_create': return openEventCompose(input.title, input.start, input.end, input.description)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
