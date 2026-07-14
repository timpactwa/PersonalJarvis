import type { PendingEntity } from './claude'
import { EMAIL_RE } from './memory/contacts'

const ENTITY_TAG_RE = /\[(PERSON|PLACE|PROJECT|ORG):\s*([^\]]+)\]/gi
const REMEMBER_TAG_RE = /\[REMEMBER:\s*([^\]]+)\]/i
const REPORT_TAG_RE = /\[REPORT:\s*(html|md)\|([^\]]+)\]/i
const TAG_START_RE = /\[(PERSON|PLACE|PROJECT|ORG|REMEMBER|REPORT):/i

/** Hide internal metadata tags while the model is still streaming. */
export function visibleStreamingText(raw: string): string {
  const cut = raw.search(TAG_START_RE)
  return cut >= 0 ? raw.slice(0, cut).trim() : raw
}

export function sanitizeEmail(raw: string): string {
  const match = raw.match(EMAIL_RE)
  return match ? match[0] : raw.replace(/[,.\]\)>;!?'"]+$/g, '').trim()
}

export function stripResponseTags(raw: string): {
  text: string
  pendingMemory: string | null
  pendingEntities: PendingEntity[]
  pendingReport: { format: 'html' | 'md'; content: string } | null
} {
  let text = raw.trim()
  let pendingMemory: string | null = null
  const pendingEntities: PendingEntity[] = []

  const memMatch = text.match(REMEMBER_TAG_RE)
  if (memMatch) {
    pendingMemory = memMatch[1].trim()
    text = text.replace(memMatch[0], '').trim()
  }

  let pendingReport: { format: 'html' | 'md'; content: string } | null = null
  const reportMatch = text.match(REPORT_TAG_RE)
  if (reportMatch) {
    pendingReport = { format: reportMatch[1].toLowerCase() as 'html' | 'md', content: reportMatch[2].trim() }
    text = text.replace(reportMatch[0], '').trim()
  }

  const tags = [...text.matchAll(ENTITY_TAG_RE)]
  for (const tag of tags) {
    const type = tag[1].toLowerCase() as PendingEntity['type']
    const parts = tag[2].split('|').map(s => s.trim())
    const name = parts[0] ?? ''
    const second = parts[1] ?? ''
    const context = parts.slice(2).join(' | ').trim() || (type === 'person' ? '' : second)
    if (!name) continue

    const emailRaw = context.match(/email:\s*(\S+)/i)?.[1] ?? ''
    pendingEntities.push({
      name,
      type,
      relationship: type === 'person' ? second : '',
      context: type === 'person' ? context : second,
      aliases: [],
      email: emailRaw ? sanitizeEmail(emailRaw) : undefined,
    })
    text = text.replace(tag[0], '').trim()
  }

  if (!text && (pendingMemory || pendingEntities.length > 0 || pendingReport)) {
    if (pendingEntities.length === 1) {
      const e = pendingEntities[0]
      text = e.email
        ? `I'll remember ${e.name} (${e.email}).`
        : `I'll remember ${e.name}.`
    } else if (pendingEntities.length > 1) {
      text = `Got it — I've saved ${pendingEntities.map(e => e.name).join(', ')}.`
    } else if (pendingReport && !pendingMemory) {
      text = 'Report ready.'
    } else {
      text = 'Noted.'
    }
  }

  return { text, pendingMemory, pendingEntities, pendingReport }
}
