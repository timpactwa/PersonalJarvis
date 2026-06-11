export function TitleBar(): JSX.Element {
  const controls = (window as any).jarvis?.windowControls

  return (
    <div
      className="titlebar-drag"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.82)',
        borderBottom: '1px solid rgba(3, 105, 161, 0.1)',
        backdropFilter: 'blur(12px)',
        zIndex: 500,
      }}
    >
      {/* Soft blue gradient rule at bottom edge */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 1,
        background: 'linear-gradient(90deg, transparent 5%, rgba(3,105,161,0.25) 30%, rgba(3,105,161,0.25) 70%, transparent 95%)',
        pointerEvents: 'none',
      }} />

      <span style={{
        paddingLeft: 16,
        fontFamily: 'var(--font-hud)',
        fontSize: 9,
        letterSpacing: '0.35em',
        color: 'rgba(3, 105, 161, 0.5)',
        userSelect: 'none',
      }}>
        JARVIS
      </span>

      <div className="no-drag" style={{ display: 'flex', height: '100%' }}>
        <WinBtn title="Minimize"  onClick={() => controls?.minimize()} hoverBg="rgba(3,105,161,0.08)">&#xE921;</WinBtn>
        <WinBtn title="Maximize"  onClick={() => controls?.maximize()} hoverBg="rgba(3,105,161,0.08)">&#xE922;</WinBtn>
        <WinBtn title="Close"     onClick={() => controls?.close()}    hoverBg="rgba(232,17,35,0.85)" danger>&#xE8BB;</WinBtn>
      </div>
    </div>
  )
}

function WinBtn({
  children, title, onClick, hoverBg, danger,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  hoverBg: string
  danger?: boolean
}): JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 46,
        height: '100%',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: danger ? 'rgba(100,60,60,0.55)' : 'rgba(3,105,161,0.45)',
        fontSize: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Segoe MDL2 Assets, "Segoe UI Symbol", monospace',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.background = hoverBg
        el.style.color = danger ? '#ffffff' : '#0369a1'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.background = 'transparent'
        el.style.color = danger ? 'rgba(100,60,60,0.55)' : 'rgba(3,105,161,0.45)'
      }}
    >
      {children}
    </button>
  )
}
