import type { ViewTab } from '../hooks/useAnimState'

interface Props {
  active: ViewTab
  onChange: (view: ViewTab) => void
}

const TABS: { id: ViewTab; label: string }[] = [
  { id: 'chat', label: 'CHAT' },
  { id: 'dashboard', label: 'DASHBOARD' },
  { id: 'activity', label: 'ACTIVITY' },
]

/**
 * Top-center segmented control switching the main stage between Chat, the
 * Dashboard, and the Activity log. Uses the shared tactical button system; the
 * active tab carries the lit rail + glow.
 */
export function ViewTabs({ active, onChange }: Props): JSX.Element {
  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute',
        top: 6,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 6,
        // Above the title bar (z500) so the tabs sit in its empty center and
        // stay clickable rather than hiding behind the drag region.
        zIndex: 600,
      }}
    >
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={`pill-btn pill-btn--sm${active === tab.id ? ' pill-btn--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
