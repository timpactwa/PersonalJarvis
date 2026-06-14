import { useEffect, useRef } from 'react'
import type { AnimState } from '../../../backend/types'

/**
 * ParticleRing — the "face" of Jarvis.
 *
 * A thin orbital ring of tiny silver/white metallic triangles on a deep
 * navy-black field. Particles are governed by a spring-damper radial system
 * loosely tethered to the ring path, perturbed by per-particle drift
 * oscillators, so the ring never reads as a perfect circle — it breathes.
 *
 * All state-dependent behavior is driven by a single continuously-lerped
 * parameter vector, so transitions between idle / listening / thinking /
 * speaking blend smoothly instead of snapping.
 *
 * Glow is baked into pre-rendered radial-gradient sprites (one cool-white, one
 * cyan) and composited additively per particle — softer and an order of
 * magnitude cheaper than ctx.shadowBlur across ~180 particles.
 *
 * The canvas is transparent: each frame fades existing pixels toward clear via
 * a destination-out wipe (soft motion trails) rather than painting an opaque
 * background, so the Backdrop's aurora shows through behind the ring.
 */

interface Particle {
  angle: number // current orbital angle (rad)
  speed: number // base angular velocity (rad / frame @60fps)
  radius: number // current radial distance (spring-integrated)
  radiusOffset: number // -1..1 gaussian-ish offset within ring thickness
  vr: number // radial velocity
  va: number // angular velocity perturbation (thinking jitter)
  size: number // triangle size (px @ minDim 600, rescaled)
  rotation: number // triangle facing
  rotSpeed: number
  opacity: number // base opacity
  shimmerPhase: number
  shimmerSpeed: number
  driftPhase: number // organic radial wander oscillator
  driftSpeed: number
  glint: number // 0..1 sparkle event envelope
}

interface Dust {
  angle: number
  speed: number
  radiusOffset: number
  size: number
  opacity: number
  twinklePhase: number
  twinkleSpeed: number
}

/** Lerped per-state behavior parameters. */
interface Params {
  speed: number // angular speed multiplier
  radiusMult: number // ring radius multiplier (tighten / expand)
  scatter: number // radial spread multiplier
  glow: number // particle halo strength
  blue: number // 0..1 silver -> blue tint mix
  listenWave: number // inward rhythmic waveform amplitude
  speakWave: number // outward flowing wave amplitude
  jitter: number // erratic angular/radial agitation (thinking)
  breath: number // ring radius breathing amplitude (fraction of minDim)
  trail: number // frame fade alpha (lower = longer motion trails)
}

const STATE_PARAMS: Record<AnimState, Params> = {
  idle:      { speed: 1.0,  radiusMult: 1.0,  scatter: 1.0,  glow: 0.18, blue: 0.25, listenWave: 0, speakWave: 0, jitter: 0,   breath: 0.005, trail: 0.70 },
  listening: { speed: 0.80, radiusMult: 0.92, scatter: 0.5,  glow: 0.45, blue: 0.65, listenWave: 1, speakWave: 0, jitter: 0,   breath: 0.003, trail: 0.64 },
  thinking:  { speed: 2.8,  radiusMult: 1.0,  scatter: 2.2,  glow: 0.90, blue: 1.0,  listenWave: 0, speakWave: 0, jitter: 1,   breath: 0.004, trail: 0.52 },
  speaking:  { speed: 1.6,  radiusMult: 1.05, scatter: 1.3,  glow: 0.62, blue: 0.50, listenWave: 0, speakWave: 1, jitter: 0,   breath: 0.022, trail: 0.62 },
}

const NUM_PARTICLES = 130
const NUM_DUST = 40
const RING_RADIUS_RATIO = 0.26
const RING_THICKNESS_RATIO = 0.05
const PARAM_LERP = 0.045

/** Sum of 3 uniforms -> soft gaussian-ish distribution in [-1, 1]. */
function softRandom(): number {
  return ((Math.random() + Math.random() + Math.random()) / 1.5) - 1
}

function createParticles(): Particle[] {
  return Array.from({ length: NUM_PARTICLES }, (_, i) => ({
    angle: (i / NUM_PARTICLES) * Math.PI * 2 + (Math.random() - 0.5) * 0.2,
    speed: (0.0011 + Math.random() * 0.0014) * (Math.random() < 0.78 ? 1 : -1),
    radius: 0,
    radiusOffset: softRandom(),
    vr: 0,
    va: 0,
    size: 1.4 + Math.pow(Math.random(), 1.6) * 2.7,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.02,
    opacity: 0.45 + Math.random() * 0.55,
    shimmerPhase: Math.random() * Math.PI * 2,
    shimmerSpeed: 0.015 + Math.random() * 0.035,
    driftPhase: Math.random() * Math.PI * 2,
    driftSpeed: 0.004 + Math.random() * 0.011,
    glint: 0
  }))
}

function createDust(): Dust[] {
  return Array.from({ length: NUM_DUST }, () => ({
    angle: Math.random() * Math.PI * 2,
    speed: (0.0004 + Math.random() * 0.0009) * (Math.random() < 0.5 ? 1 : -1),
    radiusOffset: softRandom() * 2.6,
    size: 0.4 + Math.random() * 0.9,
    opacity: 0.04 + Math.random() * 0.18,
    twinklePhase: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.008 + Math.random() * 0.03
  }))
}

/** Pre-render a soft radial glow sprite (cheap stand-in for shadowBlur). */
function makeHaloSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${r},${g},${b},0.65)`)
  grad.addColorStop(0.22, `rgba(${r},${g},${b},0.30)`)
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.10)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  x.fillStyle = grad
  x.fillRect(0, 0, 64, 64)
  return c
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

interface Props {
  state: AnimState
  amplitude?: number
}

export function ParticleRing({ state, amplitude = 0 }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<AnimState>(state)
  stateRef.current = state
  const ampRef = useRef<number>(amplitude)
  ampRef.current = amplitude

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const particles = createParticles()
    const dust = createDust()
    const haloSilver = makeHaloSprite(168, 232, 246) // cool white-cyan core glow
    const haloBlue   = makeHaloSprite(34, 211, 238)  // bright cyan glow

    // Live (lerped) parameter vector — starts at current state's targets.
    const p0 = STATE_PARAMS[stateRef.current]
    const cur: Params = { ...p0 }

    let w = 0
    let h = 0
    let dpr = 1
    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
    }
    resize()
    window.addEventListener('resize', resize)

    // Subtle pointer parallax — the ring drifts a few px against the cursor so it
    // reads as floating in front of the backdrop. Target is lerped each frame.
    let parTx = 0, parTy = 0   // target offset, -1..1
    let parCx = 0, parCy = 0   // current (lerped)
    const onMouse = (e: MouseEvent): void => {
      parTx = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2
      parTy = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2
    }
    window.addEventListener('mousemove', onMouse)

    let raf = 0
    let time = 0 // virtual frame counter normalized to 60fps
    let lastTs = 0
    let firstFrame = true

    const animate = (ts: number): void => {
      raf = requestAnimationFrame(animate)
      const dt = lastTs === 0 ? 1 : Math.min((ts - lastTs) / 16.667, 3)
      lastTs = ts
      time += dt

      const minDim = Math.min(w, h)
      // Ease parallax toward the pointer target, then offset the ring centre.
      parCx += (parTx - parCx) * (1 - Math.pow(0.94, dt))
      parCy += (parTy - parCy) * (1 - Math.pow(0.94, dt))
      const parShift = minDim * 0.014
      const cx = w / 2 + parCx * parShift
      const cy = h / 2 + parCy * parShift
      const sizeScale = minDim / 600
      const thickness = minDim * RING_THICKNESS_RATIO

      // --- Lerp every behavior parameter toward the active state's targets.
      const target = STATE_PARAMS[stateRef.current]
      const k = 1 - Math.pow(1 - PARAM_LERP, dt)
      cur.speed = lerp(cur.speed, target.speed, k)
      cur.radiusMult = lerp(cur.radiusMult, target.radiusMult, k)
      cur.scatter = lerp(cur.scatter, target.scatter, k)
      cur.glow = lerp(cur.glow, target.glow, k)
      cur.blue = lerp(cur.blue, target.blue, k)
      cur.listenWave = lerp(cur.listenWave, target.listenWave, k)
      cur.speakWave = lerp(cur.speakWave, target.speakWave, k)
      cur.jitter = lerp(cur.jitter, target.jitter, k)
      cur.breath = lerp(cur.breath, target.breath, k)
      cur.trail = lerp(cur.trail, target.trail, k)

      // Ring breathes; speaking state breathes much deeper (expand/contract).
      const breath = Math.sin(time * 0.021) * minDim * cur.breath
      const ringRadius = minDim * RING_RADIUS_RATIO * cur.radiusMult + breath

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // --- Fade existing pixels toward transparent (destination-out) so the
      // backdrop shows through while soft motion trails persist.
      ctx.globalAlpha = 1
      if (firstFrame) {
        ctx.clearRect(0, 0, w, h)
        firstFrame = false
      } else {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0,0,0,${cur.trail.toFixed(3)})`
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      }

      // --- Ambient cyan bloom — additive annular glow that seats the ring in light.
      const pulse = 0.72 + 0.28 * Math.sin(time * 0.06)
      const ambient = (0.05 + cur.glow * 0.12) * (cur.blue > 0.4 ? pulse : 1)
      if (ambient > 0.004) {
        ctx.globalCompositeOperation = 'lighter'
        const gr = ctx.createRadialGradient(cx, cy, ringRadius * 0.55, cx, cy, ringRadius * 1.5)
        // Soft teal → bright cyan as blue increases
        const ar = Math.round(lerp(18,  34,  cur.blue))
        const ag = Math.round(lerp(150, 211, cur.blue))
        const ab = Math.round(lerp(178, 238, cur.blue))
        gr.addColorStop(0,    `rgba(${ar},${ag},${ab},0)`)
        gr.addColorStop(0.5,  `rgba(${ar},${ag},${ab},${ambient.toFixed(3)})`)
        gr.addColorStop(1,    `rgba(${ar},${ag},${ab},0)`)
        ctx.fillStyle = gr
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      }

      // --- Dust layer: faint drifting motes around the ring, for depth.
      ctx.fillStyle = 'rgba(140, 224, 242, 1)'
      for (let i = 0; i < dust.length; i++) {
        const d = dust[i]
        d.angle += d.speed * cur.speed * 0.6 * dt
        const r = ringRadius + d.radiusOffset * thickness
        const tw = 0.5 + 0.5 * Math.sin(time * d.twinkleSpeed + d.twinklePhase)
        ctx.globalAlpha = d.opacity * tw
        const s = d.size * sizeScale
        ctx.fillRect(cx + Math.cos(d.angle) * r - s / 2, cy + Math.sin(d.angle) * r - s / 2, s, s)
      }

      // --- Sparkle events: occasionally a particle catches the light.
      if (Math.random() < 0.035 * dt) {
        particles[(Math.random() * particles.length) | 0].glint = 1
      }

      // --- Main particles.
      const haloMixBlue = cur.blue
      const glintDecay = Math.pow(0.94, dt)
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]

        // Thinking agitation: angular random-walk + sporadic radial kicks.
        if (cur.jitter > 0.01) {
          p.va += (Math.random() - 0.5) * 0.0006 * cur.jitter * dt
          if (Math.random() < 0.006 * cur.jitter * dt) p.vr += (Math.random() - 0.5) * thickness * 0.22
        }
        p.va *= Math.pow(0.96, dt)
        p.angle += (p.speed * cur.speed + p.va) * dt
        p.rotation += p.rotSpeed * (0.5 + cur.speed * 0.5) * dt

        // Organic wander: slow per-particle oscillation of the radial home.
        const wander = Math.sin(time * p.driftSpeed + p.driftPhase) * thickness * 0.55

        // amp: 0 → gentle ambient pulse (0.3), 1 → full reactive pulse (1.0)
        const amp = 0.3 + ampRef.current * 0.7

        // Listening: rhythmic waveform traveling around the ring, pulling inward.
        const lw = Math.sin(time * 0.058 - p.angle * 4)
        const listenPull = -(lw > 0 ? lw * lw : 0) * thickness * 1.05 * cur.listenWave * amp

        // Speaking: waves flowing outward around the ring.
        const sw = Math.sin(time * 0.045 + p.angle * 3)
        const speakPush = (sw > 0 ? sw : sw * 0.3) * thickness * 1.1 * cur.speakWave * amp

        // Spring-damper integration toward the (perturbed) ring path.
        const home = ringRadius + (p.radiusOffset * thickness + wander) * cur.scatter + listenPull + speakPush
        p.vr = p.vr * Math.pow(0.9, dt) + (home - p.radius) * 0.045 * dt
        p.radius += p.vr * dt

        const x = cx + Math.cos(p.angle) * p.radius
        const y = cy + Math.sin(p.angle) * p.radius
        const size = p.size * sizeScale

        // Metallic shimmer: slow luminance swell + sharp specular glint.
        const ph = time * p.shimmerSpeed + p.shimmerPhase
        const swell = 0.5 + 0.5 * Math.sin(ph)
        const specRaw = Math.sin(ph * 1.7 + p.radiusOffset * 5)
        const spec = specRaw > 0 ? Math.pow(specRaw, 14) : 0
        p.glint *= glintDecay
        const bright = Math.min(1, p.opacity * (0.4 + 0.6 * swell) + spec * 0.55 + p.glint * 0.9)

        // Halo (baked glow sprite) — additive bloom, stronger while thinking/speaking.
        const haloA = bright * (0.10 + cur.glow * 0.42 + p.glint * 0.5)
        if (haloA > 0.012) {
          ctx.globalCompositeOperation = 'lighter'
          const hs = size * (7 + cur.glow * 5 + p.glint * 6)
          if (haloMixBlue < 0.97) {
            ctx.globalAlpha = haloA * (1 - haloMixBlue)
            ctx.drawImage(haloSilver, x - hs / 2, y - hs / 2, hs, hs)
          }
          if (haloMixBlue > 0.03) {
            ctx.globalAlpha = haloA * haloMixBlue
            ctx.drawImage(haloBlue, x - hs / 2, y - hs / 2, hs, hs)
          }
          ctx.globalCompositeOperation = 'source-over'
        }

        // Pixel square — light steel-cyan on the dark void, shifting toward bright
        // cyan by cur.blue. Hot/glint events flash to near-white. No per-frame alloc.
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(p.rotation)
        ctx.globalAlpha = bright

        const hot = Math.min(1, spec + p.glint)
        // idle (blue=0.25): soft steel-cyan → thinking (blue=1): bright cyan; glint→white
        const cr = Math.round(lerp(lerp(150, 120, cur.blue), 245, hot * 0.7))
        const cg = Math.round(lerp(lerp(208, 226, cur.blue), 250, hot * 0.45))
        const cb = Math.round(lerp(lerp(228, 245, cur.blue), 255, hot * 0.25))
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`

        const sq = size * 1.35
        ctx.fillRect(-sq / 2, -sq / 2, sq, sq)
        ctx.restore()
      }

      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(animate)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouse)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
