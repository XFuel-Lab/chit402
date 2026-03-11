import React, { type ReactNode } from 'react'

type Props = {
  children: ReactNode
  className?: string
}

/**
 * Premium glassmorphism card matching EdgeFarm mobile:
 * - High translucency with strong blur (wallpaper visible through)
 * - Neon purple borders with glossy highlights
 * - Smooth animations
 */
export function GlassCard({ children, className = '' }: Props) {
  return (
    <div
      className={[
        'relative overflow-hidden rounded-3xl',
        'border border-purple-400/60',
        'bg-gradient-to-br from-[rgba(168,85,247,0.42)] via-[rgba(56,189,248,0.26)] to-[rgba(15,23,42,0.45)]',
        'backdrop-blur-xl',
        'shadow-[0_0_60px_rgba(168,85,247,0.75),0_8px_32px_rgba(15,23,42,0.9)]',
        'before:pointer-events-none before:absolute before:inset-0 before:rounded-3xl before:bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02),transparent)] before:opacity-60',
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-3xl after:border after:border-purple-400/40 after:opacity-50',
        'transition-all duration-300 ease-out hover:shadow-[0_0_80px_rgba(168,85,247,0.9),0_12px_40px_rgba(15,23,42,0.95)] hover:border-purple-400/80',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        backgroundColor: 'rgba(15,23,42,0.18)',
      }}
    >
      <div className="relative z-10 px-6 py-5 sm:px-7 sm:py-6">{children}</div>
    </div>
  )
}

export default GlassCard


