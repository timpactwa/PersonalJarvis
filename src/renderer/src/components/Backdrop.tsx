/**
 * Backdrop — the depth layer behind the particle ring.
 *
 * Three blurred, slowly drifting aurora blobs (cyan / teal / amber) over a deep
 * navy radial base, plus a faint, almost-still HUD motif (concentric rings +
 * tick marks) at ~6% ink. All CSS-driven — no canvas, no deps — so it costs
 * nothing on the animation budget the ParticleRing already owns. Purely
 * decorative: pointer-events none, z-index 0, sits under everything.
 */
export default function Backdrop(): React.JSX.Element {
  return (
    <div className="bd-root" aria-hidden="true">
      <div className="bd-aurora bd-aurora--cyan" />
      <div className="bd-aurora bd-aurora--teal" />
      <div className="bd-aurora bd-aurora--amber" />

      <div className="bd-hud bd-hud--spin">
        <HudMotif />
      </div>
      <div className="bd-hud bd-hud--spin-r">
        <HudTicks />
      </div>

      <div className="bd-vignette" />
    </div>
  )
}

/** Concentric rings + crosshair guides — the "instrument" scaffolding. */
function HudMotif(): React.JSX.Element {
  return (
    <svg viewBox="0 0 1000 1000" fill="none" preserveAspectRatio="xMidYMid slice">
      <g stroke="#22d3ee" strokeWidth="1">
        <circle cx="500" cy="500" r="180" />
        <circle cx="500" cy="500" r="300" strokeDasharray="2 10" />
        <circle cx="500" cy="500" r="420" />
        <circle cx="500" cy="500" r="470" strokeDasharray="40 18" />
      </g>
      <g stroke="#22d3ee" strokeWidth="1" opacity="0.7">
        <line x1="500" y1="40" x2="500" y2="120" />
        <line x1="500" y1="880" x2="500" y2="960" />
        <line x1="40" y1="500" x2="120" y2="500" />
        <line x1="880" y1="500" x2="960" y2="500" />
      </g>
      {/* corner brackets */}
      <g stroke="#22d3ee" strokeWidth="1.5" opacity="0.8">
        <path d="M120 120 h70 M120 120 v70" />
        <path d="M880 120 h-70 M880 120 v70" />
        <path d="M120 880 h70 M120 880 v-70" />
        <path d="M880 880 h-70 M880 880 v-70" />
      </g>
    </svg>
  )
}

/** A fine ring of tick marks, rotating the other way for parallax depth. */
function HudTicks(): React.JSX.Element {
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const angle = (i * 360) / 72
    const long = i % 6 === 0
    const r1 = 360
    const r2 = long ? 388 : 376
    const rad = (angle * Math.PI) / 180
    const cx = 500
    const cy = 500
    return (
      <line
        key={i}
        x1={cx + r1 * Math.cos(rad)}
        y1={cy + r1 * Math.sin(rad)}
        x2={cx + r2 * Math.cos(rad)}
        y2={cy + r2 * Math.sin(rad)}
        stroke="#5fe0f0"
        strokeWidth={long ? 1.5 : 0.75}
        opacity={long ? 0.9 : 0.5}
      />
    )
  })
  return (
    <svg viewBox="0 0 1000 1000" fill="none" preserveAspectRatio="xMidYMid slice">
      {ticks}
    </svg>
  )
}
