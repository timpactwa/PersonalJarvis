/** True when the user is asking to compose/send/draft an email right now. */
export function isExplicitEmailComposeRequest(userText: string): boolean {
  const lower = userText.toLowerCase()

  if (/\b(remember|remind|note|save|store|got it)\b/.test(lower) && !/\b(send|draft|compose|write)\s+(an?\s+)?(email|mail)\b/.test(lower)) {
    return false
  }
  if (/\b(already|just|i\s+(sent|dropped|emailed|mailed))\b/.test(lower)) return false
  if (/\b(sent|dropped)\s+(an?\s+)?(email|mail)\b/.test(lower) && !/\b(send|draft|compose|write)\b/.test(lower)) {
    return false
  }

  return /\b(send|draft|compose|write|email)\b/.test(lower)
    && /\b(email|mail|to\s+\w+)/.test(lower)
}
