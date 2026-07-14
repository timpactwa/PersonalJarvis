import type { Entity } from './db'
import { findEntityByContactRef, upsertEntity } from './db'

export const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export function extractEmailFromText(text: string): string | null {
  const match = text.match(EMAIL_RE)
  return match ? match[0] : null
}

export interface ParsedContact {
  name: string
  relationship: string
  context: string
  email: string
}

/** Parse "remember Amanda... email is X. Bob... email is Y" without relying on the LLM. */
export function parseContactsFromUserMessage(text: string): ParsedContact[] {
  const lower = text.toLowerCase()
  if (!/\b(remember|save|note|store)\b/.test(lower) && !/\bemail\s+is\b/.test(lower)) {
    return []
  }

  const contacts: ParsedContact[] = []
  const seen = new Set<string>()

  const personPattern = /([A-Z][a-z]+),?\s+is\s+my\s+([^]+?)\.\s*(?:Her|His|Their)\s+email\s+is\s+(\S+@\S+)/gi
  let m: RegExpExecArray | null
  while ((m = personPattern.exec(text)) !== null) {
    const name = m[1].trim()
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    contacts.push({
      name,
      relationship: m[2].trim().replace(/\.$/, ''),
      context: m[2].trim().replace(/\.$/, ''),
      email: m[3].match(EMAIL_RE)?.[0] ?? m[3].replace(/[,.\]]+$/, ''),
    })
  }

  const familyPattern = /(?:my\s+)?(?:dad'?s?|father'?s?|mother'?s?|mom'?s?)[^.\n]*?(?:name\s+is\s+)?([A-Z][a-z]+)[^.\n]*?(?:email\s+is)\s+(\S+@\S+)/gi
  while ((m = familyPattern.exec(text)) !== null) {
    const name = m[1].trim()
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const rel = /father|dad/i.test(m[0]) ? 'father'
      : /mother|mom/i.test(m[0]) ? 'mother' : ''
    contacts.push({
      name,
      relationship: rel,
      context: rel ? `${rel} of user` : '',
      email: m[2].match(EMAIL_RE)?.[0] ?? m[2].replace(/[,.\]]+$/, ''),
    })
  }

  return contacts
}

const VAGUE_CONTEXT_RE = /^(email recipient|mom'?s email|dad'?s email|email|email address)$/i

export function isVagueContext(context: string): boolean {
  const t = context.trim()
  return VAGUE_CONTEXT_RE.test(t) || (t.length < 24 && !EMAIL_RE.test(t))
}

export function mergeContext(oldCtx: string, newCtx: string): string {
  const o = oldCtx.trim()
  const n = newCtx.trim()
  if (!n) return o
  if (!o) return n
  if (isVagueContext(n) && !isVagueContext(o)) return o

  const emailInN = extractEmailFromText(n)
  const emailInO = extractEmailFromText(o)
  if (emailInN && !emailInO) return o.includes(n) ? o : `${o}; ${n}`
  if (emailInO && !emailInN && isVagueContext(n)) return o
  if (o.includes(n)) return o
  if (n.includes(o)) return n
  return `${o}; ${n}`
}

export function formatEntityContext(entity: Entity): string {
  const rel = entity.relationship ? ` (${entity.relationship})` : ''
  const email = entity.email?.trim() || extractEmailFromText(entity.context)
  const parts: string[] = []
  if (email) parts.push(`email: ${email}`)
  const ctx = entity.context?.trim()
  if (ctx && (!email || !ctx.includes(email))) parts.push(ctx)
  return `${entity.name}${rel}: ${parts.join('; ') || 'no details yet'}`
}

interface HistoryMsg {
  role: string
  content: string
}

/** Detect when the user is linking a contact name to an email from recent context. */
export function extractContactEmailHints(
  userText: string,
  recentHistory: HistoryMsg[],
): { contactRef: string; email: string } | null {
  if (/\b(remember|save|note)\b.*\b(email\s+is|@)\b/i.test(userText)) {
    return null
  }

  const direct = userText.match(
    /(?:my\s+)?([a-z][\w-]{1,20})(?:'s|s)\s+email\s+is\s+(\S+@\S+)/i,
  )
  if (direct) {
    return { contactRef: direct[1].trim(), email: direct[2].match(EMAIL_RE)?.[0] ?? direct[2].trim() }
  }

  const remember = userText.match(
    /(?:that'?s\s+)?(?:my\s+)?([a-z][\w-]*)(?:'s|s)\s+email|remember\s+(?:that\s+)?(?:my\s+)?([a-z][\w-]*)(?:'s|s)\s+email/i,
  )
  if (remember) {
    const ref = (remember[1] || remember[2] || '').trim().toLowerCase().replace(/'+$/, '')
    if (!ref) return null

    const inUser = extractEmailFromText(userText)
    if (inUser) return { contactRef: ref, email: inUser }

    for (const msg of [...recentHistory].reverse()) {
      const email = extractEmailFromText(msg.content)
      if (email) return { contactRef: ref, email }
    }
  }

  const emailInMsg = extractEmailFromText(userText)
  if (emailInMsg) {
    const forContact = userText.match(
      /(?:for|to)\s+([a-z][\w.'-]*)(?:\s|$|[,.])/i,
    )
    if (forContact) {
      return { contactRef: forContact[1].trim().toLowerCase(), email: emailInMsg }
    }
  }

  return null
}

export function resolveContactEmail(identifier: string): string {
  const trimmed = identifier.trim()
  if (EMAIL_RE.test(trimmed)) return trimmed

  const entity = findEntityByContactRef(trimmed)
  if (!entity) return trimmed

  if (entity.email?.trim()) return entity.email.trim()
  const fromContext = extractEmailFromText(entity.context ?? '')
  if (fromContext) return fromContext

  return trimmed
}

/** Persist contact↔email links the user states explicitly (backend-side, no LLM needed). */
export function applyContactEmailHints(
  userText: string,
  recentHistory: HistoryMsg[],
): boolean {
  const hint = extractContactEmailHints(userText, recentHistory)
  if (!hint) return false

  const existing = findEntityByContactRef(hint.contactRef)
  const name = existing?.name ?? hint.contactRef.charAt(0).toUpperCase() + hint.contactRef.slice(1)
  const relationship = existing?.relationship
    ?? (hint.contactRef === 'mom' || hint.contactRef === 'mother' ? 'mother' : '')
  const context = existing?.context ?? `email on file for ${hint.contactRef}`

  upsertEntity(name, 'person', relationship, context, existing?.aliases ?? [], hint.email)
  console.error(`[contacts] linked ${name} → ${hint.email}`)
  return true
}
