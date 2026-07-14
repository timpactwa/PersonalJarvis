/**
 * Faint PCB-style traces hugging the screen edges, with a glowing "current"
 * pulse travelling along them like an electrical signal. Pure SVG + CSS
 * (stroke-dashoffset), zero animation-budget cost, and frozen under
 * prefers-reduced-motion via the .circuit-pulse rule in global.css.
 *
 * viewBox is a fixed design space stretched to fill (preserveAspectRatio:none),
 * so traces always reach the real edges regardless of window size.
 */

// Static routing — branches off each edge with right-angle jogs (PCB feel).
const TRACES = [
  'M 0 64 H 360 L 392 96 H 720',
  'M 1440 88 H 1108 L 1076 56 H 768',
  'M 64 0 V 232 L 96 264 V 520',
  'M 1376 900 V 648 L 1408 616 V 372',
  'M 0 836 H 296 L 328 804 H 632',
  'M 1440 792 H 1180 L 1148 824 H 880',
]

// Junction nodes.
const NODES = [
  [392, 96], [1076, 56], [96, 264], [1408, 616], [328, 804], [1148, 824],
]

// Long routes the current pulses ride along.
const PULSE_A = 'M 64 900 V 264 L 96 232 V 96 L 128 64 H 720'
const PULSE_B = 'M 1440 200 H 1108 L 1076 232 V 600 L 1108 632 H 1440'

export function CircuitFrame(): JSX.Element {
  return (
    <div className="circuit-frame" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="none">
        {TRACES.map((d, i) => (
          <path key={i} className="circuit-trace" d={d} />
        ))}
        {NODES.map(([cx, cy], i) => (
          <circle key={i} className="circuit-node" cx={cx} cy={cy} r={2.5} />
        ))}
        <path className="circuit-pulse" d={PULSE_A} />
        <path className="circuit-pulse circuit-pulse--b" d={PULSE_B} />
      </svg>
    </div>
  )
}
