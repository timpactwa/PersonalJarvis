export interface Alert {
  id: string
  text: string
  priority: 'urgent' | 'normal'
  source: 'calendar' | 'email' | 'spotify' | 'system' | 'custom'
  expiresAt?: number
}

type SpeakFn = (text: string) => Promise<void>
type StopFn = () => void
export type EnqueueFn = (alert: Alert) => void
export type RegisterFn = (stop: StopFn) => void
export type MonitorStarter = (enqueue: EnqueueFn, register: RegisterFn) => void

export class MonitorRegistry {
  private queue: Alert[] = []
  private seen = new Set<string>()
  private idle = true
  private speakFn: SpeakFn | null = null
  private stopFns: StopFn[] = []
  private starters: MonitorStarter[] = []
  private drainTimer: ReturnType<typeof setInterval> | null = null
  private draining = false
  private idleWatchdog: ReturnType<typeof setTimeout> | null = null

  // Upper bound on how long a single spoken alert may keep the queue blocked.
  // The drain normally re-idles when the renderer reports `speech_done`; if that
  // never arrives (renderer disconnect, audio `onended` never fires), this
  // watchdog re-idles anyway so proactive alerts can't go silent forever.
  private static readonly SPEAK_WATCHDOG_MS = 90_000

  setSpeakFn(fn: SpeakFn): void { this.speakFn = fn }

  setIdle(idle: boolean): void {
    this.idle = idle
    // Any transition back to idle (notably the renderer's speech_done) means the
    // watchdog has done its job or isn't needed — clear it.
    if (idle && this.idleWatchdog) {
      clearTimeout(this.idleWatchdog)
      this.idleWatchdog = null
    }
  }

  addMonitor(starter: MonitorStarter): void { this.starters.push(starter) }

  registerMonitor(stop: StopFn): void { this.stopFns.push(stop) }

  enqueue(alert: Alert): void {
    if (this.seen.has(alert.id)) return
    this.seen.add(alert.id)
    this.queue.push(alert)
    this.queue.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'urgent' ? -1 : 1))
  }

  queueLength(): number { return this.queue.length }

  peekNext(): Alert | undefined { return this.queue[0] }

  isRunning(): boolean { return this.drainTimer !== null }

  startAll(): void {
    if (this.drainTimer) return   // already running — prevent double-start
    const enqueue: EnqueueFn = (a) => this.enqueue(a)
    const register: RegisterFn = (stop) => this.registerMonitor(stop)
    for (const starter of this.starters) {
      try { starter(enqueue, register) } catch (err) {
        console.error('[monitors] failed to start monitor:', err)
      }
    }
    this.drainTimer = setInterval(() => { void this.drainOnce() }, 8_000)
  }

  stopAll(): void {
    for (const stop of this.stopFns) { try { stop() } catch { /* ignore */ } }
    this.stopFns = []
    if (this.drainTimer) { clearInterval(this.drainTimer); this.drainTimer = null }
    if (this.idleWatchdog) { clearTimeout(this.idleWatchdog); this.idleWatchdog = null }
  }

  async drainOnce(): Promise<void> {
    if (this.draining || !this.idle || !this.speakFn || this.queue.length === 0) return
    const now = Date.now()
    const expired = this.queue.filter(a => a.expiresAt && a.expiresAt <= now)
    for (const a of expired) this.seen.delete(a.id)
    this.queue = this.queue.filter(a => !a.expiresAt || a.expiresAt > now)
    if (this.queue.length === 0) return
    const alert = this.queue.shift()!
    this.idle = false       // block further drains until speech_done arrives
    this.draining = true
    // Safety net: force re-idle if speech_done never comes back.
    if (this.idleWatchdog) clearTimeout(this.idleWatchdog)
    this.idleWatchdog = setTimeout(() => {
      console.error('[monitors] speech_done watchdog fired — forcing re-idle')
      this.setIdle(true)
    }, MonitorRegistry.SPEAK_WATCHDOG_MS)
    if (typeof this.idleWatchdog === 'object' && typeof this.idleWatchdog.unref === 'function') {
      this.idleWatchdog.unref()
    }
    try { await this.speakFn!(alert.text) } catch (err) {
      console.error('[monitors] drain speak error:', err)
      this.setIdle(true)    // on error, re-enable drain so queue doesn't stall
    } finally {
      this.draining = false
    }
    // idle stays false here — renderer's speech_done event restores it via setIdle(true)
  }
}

export const monitors = new MonitorRegistry()
