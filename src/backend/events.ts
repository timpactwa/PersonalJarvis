import type { BackendEvent } from './types'

let emit: (event: BackendEvent) => void = () => {}

export function setEmitter(fn: (event: BackendEvent) => void): void {
  emit = fn
}

export function emitEvent(event: BackendEvent): void {
  emit(event)
}
