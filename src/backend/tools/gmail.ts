import { google } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createServer } from 'http'
import { requestConfirmation } from '../confirm'
import { emitEvent } from '../events'

const TOKEN_PATH = join(process.cwd(), '.gmail-token.json')
const CREDS_PATH = join(process.cwd(), '.gmail-credentials.json')

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
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
  const parts = msg.data.payload?.parts ?? []
  const textPart = parts.find(p => p.mimeType === 'text/plain')
  const body = textPart?.body?.data
    ? Buffer.from(textPart.body.data, 'base64').toString('utf-8')
    : msg.data.snippet ?? '(no plain text body)'

  return body.slice(0, 5000)
}

function buildRawMessage(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body,
  ]
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

async function sendEmailNow(to: string, subject: string, body: string): Promise<string> {
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: buildRawMessage(to, subject, body) } })
  return `Email sent to ${to}.`
}

export async function queueSendEmail(to: string, subject: string, body: string): Promise<string> {
  if (!to) throw new Error('Recipient (to) is required')
  const conf = requestConfirmation('Send email', `To: ${to}\nSubject: ${subject}`, () => sendEmailNow(to, subject, body))
  emitEvent({ type: 'confirm_request', id: conf.id, action: conf.action, detail: conf.detail })
  return `I've drafted an email to ${to} with subject "${subject}". Shall I send it?`
}

export async function createDraft(to: string, subject: string, body: string): Promise<string> {
  if (!to) throw new Error('Recipient (to) is required')
  const auth = await getAuthorizedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw: buildRawMessage(to, subject, body) } } })
  return `Draft saved for ${to}.`
}

export const gmailToolDefs = [
  {
    name: 'gmail_search',
    description: 'Search Gmail messages. Returns subject, sender, date, and message ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "from:boss@company.com", "is:unread")' },
        max_results: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'Read the full body of a Gmail message by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID from gmail_search results' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'gmail_send',
    description: 'Send an email. This is a destructive action: it will be queued for explicit user confirmation before sending.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_draft',
    description: 'Create a Gmail draft without sending it. Safe, non-destructive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain-text email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
]

export async function handleGmailTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case 'gmail_search': return searchEmails(input.query, input.max_results)
    case 'gmail_read':   return readEmail(input.message_id)
    case 'gmail_send':   return queueSendEmail(input.to, input.subject, input.body)
    case 'gmail_draft':  return createDraft(input.to, input.subject, input.body)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
