const dismissedComposeKeys = new Set<string>()
const completedComposeKeys = new Set<string>()

export function composeKey(to: string, subject: string): string {
  return `${to.trim().toLowerCase()}|${subject.trim().toLowerCase()}`
}

export function markComposeDismissed(to: string, subject: string, draftId?: string): void {
  dismissedComposeKeys.add(composeKey(to, subject))
  if (draftId) dismissedComposeKeys.add(draftId)
}

export function markComposeCompleted(to: string, subject: string, draftId?: string): void {
  const key = composeKey(to, subject)
  completedComposeKeys.add(key)
  dismissedComposeKeys.add(key)
  if (draftId) {
    completedComposeKeys.add(draftId)
    dismissedComposeKeys.add(draftId)
  }
}

export function shouldSuppressComposeUI(to: string, subject: string, draftId?: string): boolean {
  const key = composeKey(to, subject)
  if (dismissedComposeKeys.has(key) || completedComposeKeys.has(key)) return true
  if (draftId && (dismissedComposeKeys.has(draftId) || completedComposeKeys.has(draftId))) return true
  return false
}

export function clearComposeSuppression(): void {
  dismissedComposeKeys.clear()
  completedComposeKeys.clear()
}
