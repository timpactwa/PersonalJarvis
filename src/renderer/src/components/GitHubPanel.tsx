import { useEffect, useRef, useState } from 'react'
import type { GithubRow, RendererEvent } from '../../../backend/types'

type Tab = 'STATUS' | 'PRs' | 'ISSUES' | 'COMMITS'

interface Props {
  onClose: () => void
  githubData: { tab: Tab; rows: GithubRow[] } | null
  send: (event: RendererEvent) => void
}

const TABS: Tab[] = ['STATUS', 'PRs', 'ISSUES', 'COMMITS']

const TAB_COMMANDS: Record<Tab, string> = {
  STATUS: 'github status',
  PRs: 'github prs',
  ISSUES: 'github issues',
  COMMITS: 'github commits'
}

const SKELETON_WIDTHS = ['80%', '60%', '75%', '50%', '65%']

const MONO = 'var(--font-mono)'

export function GitHubPanel({ onClose, githubData, send }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('STATUS')
  const [isLoading, setIsLoading] = useState(false)
  const sendRef = useRef(send)
  sendRef.current = send

  const handleTabClick = (tab: Tab): void => {
    setActiveTab(tab)
    setIsLoading(true)
    send({ type: 'command', text: TAB_COMMANDS[tab] })
  }

  // Clear the loading state once data for the active tab arrives.
  useEffect(() => {
    if (githubData?.tab === activeTab) setIsLoading(false)
  }, [githubData, activeTab])

  // On mount: auto-load the STATUS tab.
  useEffect(() => {
    setIsLoading(true)
    sendRef.current({ type: 'command', text: TAB_COMMANDS.STATUS })
  }, [])

  const hasData = githubData !== null && githubData.tab === activeTab

  return (
    <div
      className="no-drag"
      role="dialog"
      aria-label="GitHub"
      style={{
        position: 'fixed',
        top: 36,
        right: 0,
        bottom: 0,
        width: 440,
        background: 'var(--ov-bg)',
        borderLeft: '1px solid var(--ov-border)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'drawerIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
        zIndex: 200
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px 20px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: MONO,
            letterSpacing: '0.12em',
            color: 'var(--ov-text-dim)'
          }}
        >
          ⬡ GITHUB
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="pill-btn pill-btn--icon"
            aria-label="Refresh"
            onClick={() => handleTabClick(activeTab)}
          >
            ↺
          </button>
          <button className="pill-btn pill-btn--icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          padding: '0 20px',
          borderBottom: '1px solid var(--ov-separator)',
          display: 'flex'
        }}
      >
        {TABS.map((tab) => {
          const active = tab === activeTab
          return (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              style={{
                padding: '8px 14px',
                fontSize: 10,
                letterSpacing: '0.1em',
                cursor: 'pointer',
                border: 'none',
                background: 'none',
                fontFamily: MONO,
                color: active ? 'var(--ov-accent)' : 'var(--ov-text-dim)',
                borderBottom: active ? '2px solid var(--ov-accent)' : '2px solid transparent',
                marginBottom: -1
              }}
            >
              {tab}
            </button>
          )
        })}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {isLoading ? (
          SKELETON_WIDTHS.map((width, i) => (
            <div key={i} className="skeleton-row" style={{ width, marginBottom: 10 }} />
          ))
        ) : hasData ? (
          githubData.rows.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 0',
                fontSize: 11,
                fontFamily: MONO,
                color: 'var(--ov-text-dim)'
              }}
            >
              No {activeTab.toLowerCase()} found
            </div>
          ) : (
            githubData.rows.map((row, i) => <RowCard key={i} row={row} />)
          )
        ) : (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 0',
              fontSize: 11,
              fontFamily: MONO,
              color: 'var(--ov-text-dim)'
            }}
          >
            Select a tab to load data
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--ov-separator)',
          fontSize: 10,
          fontFamily: MONO,
          color: 'var(--ov-text-dim)'
        }}
      >
        Connected to local repo — say &lsquo;show PRs&rsquo; or &lsquo;github status&rsquo;
      </div>
    </div>
  )
}

function RowCard({ row }: { row: GithubRow }): JSX.Element {
  const badgeColor = row.badgeColor ?? 'var(--ov-accent)'
  return (
    <div
      style={{
        background: 'var(--ov-bg-raised)',
        border: '1px solid var(--ov-separator)',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 8
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: MONO,
            fontWeight: 500,
            color: 'var(--ov-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {row.title}
        </span>
        {row.badge !== undefined && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 9,
              fontFamily: MONO,
              letterSpacing: '0.08em',
              padding: '2px 6px',
              borderRadius: 10,
              color: badgeColor,
              background: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
              border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`
            }}
          >
            {row.badge}
          </span>
        )}
      </div>
      {(row.subtitle !== undefined || row.meta !== undefined) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            marginTop: 4
          }}
        >
          <span style={{ fontSize: 10, fontFamily: MONO, color: 'var(--ov-text-mid)' }}>
            {row.subtitle}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: 'var(--ov-text-dim)',
              textAlign: 'right',
              flexShrink: 0
            }}
          >
            {row.meta}
          </span>
        </div>
      )}
    </div>
  )
}
