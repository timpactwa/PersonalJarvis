import { google } from 'googleapis'
import { readFileSync, writeFileSync, existsSync } from 'fs'

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>
import { join } from 'path'
import { createServer } from 'http'
import { randomUUID } from 'crypto'
import { emitEvent } from '../events'

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

async function getAuthorizedClient(): Promise<OAuth2Client> {
  const auth = getOAuth2Client()

  if (existsSync(TOKEN_PATH)) {
    auth.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf-8')))
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

export async function composeEmail(to: string, subject: string, body: string, cc = '', bcc = ''): Promise<string> {
  const draft = { id: randomUUID(), to, cc, bcc, subject, body }
  emitEvent({ type: 'email_compose', draft })
  return `I've opened a composer for your email to ${to} — review and send when ready.`
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
    description: 'Search Gmail messages inline and return a text summary (subject, sender, date, ID). Use when you need to answer a question about emails, not when the user wants to read or act on them.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "from:boss@company.com", "is:unread newer_than:7d")' },
        max_results: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'Read the full body of a single Gmail message by its ID. Use after gmail_search to get full content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID from gmail_search results' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'gmail_compose',
    description: 'Open an interactive email composer popup so the user can review, edit, and send or save a draft. Use for ANY "write", "send", "draft", "reply", or "compose" email request. Non-destructive — the user controls the final send.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body:    { type: 'string', description: 'Plain-text email body' },
        cc:      { type: 'string', description: 'CC recipients (optional, comma-separated)' },
        bcc:     { type: 'string', description: 'BCC recipients (optional, comma-separated)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_browse',
    description: 'Pull emails into an interactive viewer popup the user can flip through. Use when the user wants to see, read, or review multiple emails (e.g. "show me my emails", "pull important emails this week"). Use Gmail query operators: is:important, is:unread, newer_than:7d, from:X, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:       { type: 'string', description: 'Gmail search query' },
        max_results: { type: 'number', description: 'Max emails to pull (default 5, max 10)' },
      },
      required: ['query'],
    },
  },
]

export const calendarToolDefs = [
  {
    name: 'calendar_list',
    description: 'List upcoming Google Calendar events and return them as text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        max_results: { type: 'number', description: 'Max events to return (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'calendar_create',
    description: 'Open an interactive event editor popup so the user can review and confirm a new Google Calendar event before it is saved. Use for any "add event", "schedule", "create meeting" request.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:       { type: 'string', description: 'Event title' },
        start:       { type: 'string', description: 'Start time in ISO 8601 format (e.g. 2026-06-15T14:00:00)' },
        end:         { type: 'string', description: 'End time in ISO 8601 format' },
        description: { type: 'string', description: 'Optional event description' },
      },
      required: ['title', 'start', 'end'],
    },
  },
]

export async function handleGmailTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case 'gmail_search':    return searchEmails(input.query, input.max_results)
    case 'gmail_read':      return readEmail(input.message_id)
    case 'gmail_compose':   return composeEmail(input.to, input.subject, input.body, input.cc, input.bcc)
    case 'gmail_browse':    return browseEmails(input.query, input.max_results)
    case 'calendar_list':   return listCalendarEvents(input.max_results)
    case 'calendar_create': return openEventCompose(input.title, input.start, input.end, input.description)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
