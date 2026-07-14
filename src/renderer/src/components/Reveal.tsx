import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Stagger in ms — cards in a grid pass increasing delays for a coordinated
      "construct from a point" reveal. */
  delay?: number
  className?: string
  style?: CSSProperties
}

/**
 * Wraps content in Jarvis's signature reveal: it materializes from a small
 * bright seed, de-blurs, and settles (the `.materialize` keyframe in
 * global.css). Use anywhere information is "pulled up" — dashboard cards,
 * panels, now-playing — so the whole UI shares one motion language.
 */
export function Reveal({ children, delay = 0, className = '', style }: Props): JSX.Element {
  return (
    <div
      className={`materialize ${className}`.trim()}
      style={{ animationDelay: delay ? `${delay}ms` : undefined, ...style }}
    >
      {children}
    </div>
  )
}
