import { randomUUID } from 'crypto'

export interface PendingConfirmation {
  id: string
  action: string
  detail: string
  execute: () => Promise<string>
}

const pending = new Map<string, PendingConfirmation>()

export function requestConfirmation(
  action: string,
  detail: string,
  execute: () => Promise<string>,
): PendingConfirmation {
  const conf: PendingConfirmation = { id: randomUUID(), action, detail, execute }
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
  let latest: PendingConfirmation | null = null
  for (const c of pending.values()) latest = c
  return latest
}

export function hasPending(): boolean {
  return pending.size > 0
}

export function clearPending(): void {
  pending.clear()
}
