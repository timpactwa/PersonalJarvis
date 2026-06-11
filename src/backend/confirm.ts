import { randomUUID } from 'crypto'

export interface PendingConfirmation {
  id: string
  action: string
  detail: string
  execute: () => Promise<string>
  createdAt: number
}

const TTL_MS = 5 * 60 * 1000  // 5 minutes
const pending = new Map<string, PendingConfirmation>()

function purgeExpired(): void {
  const now = Date.now()
  for (const [id, conf] of pending) {
    if (now - conf.createdAt > TTL_MS) pending.delete(id)
  }
}

export function requestConfirmation(
  action: string,
  detail: string,
  execute: () => Promise<string>,
): PendingConfirmation {
  purgeExpired()
  const conf: PendingConfirmation = { id: randomUUID(), action, detail, execute, createdAt: Date.now() }
  pending.set(conf.id, conf)
  return conf
}

export async function resolveConfirmation(id: string, approved: boolean): Promise<string | null> {
  const conf = pending.get(id)
  if (!conf) return null
  pending.delete(id)
  if (!approved) return null
  return conf.execute()
}

export function getLatestPending(): PendingConfirmation | null {
  purgeExpired()
  let latest: PendingConfirmation | null = null
  for (const c of pending.values()) {
    if (!latest || c.createdAt >= latest.createdAt) latest = c
  }
  return latest
}

export function hasPending(): boolean {
  purgeExpired()
  return pending.size > 0
}

export function clearPending(): void {
  pending.clear()
}
