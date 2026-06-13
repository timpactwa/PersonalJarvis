import type { Alert, EnqueueFn, RegisterFn } from './index'
import { getSettings } from '../memory/settings'

export interface BatterySnapshot {
  percent: number
  isCharging: boolean
}

export function buildBatteryAlerts(snapshot: BatterySnapshot, seen: Set<string>): Alert[] {
  if (snapshot.isCharging) {
    seen.delete('system:battery:20')
    seen.delete('system:battery:10')
    return []
  }

  const alerts: Alert[] = []

  if (snapshot.percent <= 20 && !seen.has('system:battery:20')) {
    seen.add('system:battery:20')
    alerts.push({
      id: 'system:battery:20',
      text: `Battery at ${snapshot.percent}%, you might want to plug in.`,
      priority: 'normal',
      source: 'system',
    })
  }

  if (snapshot.percent <= 10 && !seen.has('system:battery:10')) {
    seen.add('system:battery:10')
    alerts.push({
      id: 'system:battery:10',
      text: `Battery critically low at ${snapshot.percent}%.`,
      priority: 'urgent',
      source: 'system',
    })
  }

  return alerts
}

export function startSystemMonitor(enqueue: EnqueueFn, register: RegisterFn): void {
  if (!getSettings().monitorSystem) return

  const seen = new Set<string>()

  const poll = async (): Promise<void> => {
    if (!getSettings().monitorSystem) return
    try {
      const si = await import('systeminformation')
      const batt = await si.battery()
      if (!batt.hasBattery) return
      const snapshot: BatterySnapshot = {
        percent: Math.round(batt.percent),
        isCharging: batt.isCharging,
      }
      const alerts = buildBatteryAlerts(snapshot, seen)
      for (const a of alerts) enqueue(a)
    } catch (err) {
      console.error('[monitor:system] error:', err instanceof Error ? err.message : err)
    }
  }

  const timer = setInterval(() => { void poll() }, 60_000)
  register(() => clearInterval(timer))
  void poll()
}
