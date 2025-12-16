import React, { type ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
}

/**
 * High-translucency glassmorphism card.
 * Lets the XFUEL wallpaper + logo grid breathe through with a crisp blur.
 */
export function GlassCard({ children, className = '' }: Props) {
  return (
    <div
      className={[
        'relative overflow-hidden rounded-3xl border border-purple-400/35 bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.22),transparent_55%),rgba(15,23,42,0.55)]',
        'shadow-[0_0_60px_rgba(168,85,247,0.65)] backdrop-blur-2xl',
        'before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-16 before:rounded-[999px] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.32),rgba(255,255,255,0.02),transparent)] before:opacity-80',
        'transition-transform duration-500 ease-out hover:-translate-y-1',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="relative z-10 px-6 py-5 sm:px-7 sm:py-6">{children}</div>
    </div>
  )
}

export default GlassCard


