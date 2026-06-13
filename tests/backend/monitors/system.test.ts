import { describe, it, expect } from 'vitest'
import { buildBatteryAlerts } from '../../../src/backend/monitors/system'

describe('buildBatteryAlerts', () => {
  it('returns normal alert when below 20% and not charging', () => {
    const seen = new Set<string>()
    const alerts = buildBatteryAlerts({ percent: 15, isCharging: false }, seen)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].priority).toBe('normal')
    expect(alerts[0].text).toContain('15%')
    expect(alerts[0].id).toBe('system:battery:20')
  })

  it('returns urgent alert when below 10% and not charging', () => {
    const seen = new Set<string>()
    const alerts = buildBatteryAlerts({ percent: 7, isCharging: false }, seen)
    expect(alerts).toHaveLength(2) // both 20% and 10% thresholds
    const urgent = alerts.find(a => a.priority === 'urgent')
    expect(urgent).toBeDefined()
    expect(urgent?.id).toBe('system:battery:10')
  })

  it('returns no alert when charging', () => {
    const seen = new Set<string>()
    expect(buildBatteryAlerts({ percent: 5, isCharging: true }, seen)).toHaveLength(0)
  })

  it('deduplicates — does not repeat the same threshold', () => {
    const seen = new Set(['system:battery:20'])
    const alerts = buildBatteryAlerts({ percent: 18, isCharging: false }, seen)
    expect(alerts).toHaveLength(0)
  })

  it('clears seen thresholds when charging (re-arms for next discharge)', () => {
    const seen = new Set(['system:battery:20', 'system:battery:10'])
    buildBatteryAlerts({ percent: 50, isCharging: true }, seen)
    expect(seen.size).toBe(0)
  })
})
