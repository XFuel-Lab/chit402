import React from 'react'

type Props = {
  apyText: string
  label?: string
}

/**
 * Pulsing APY orb at the top of the experience.
 * Uses CSS animations to approximate the Reanimated-style sweep + glow.
 */
export function ApyOrb({ apyText, label = 'blended APY' }: Props) {
  return (
    <div className="relative mx-auto mb-8 mt-2 flex items-center justify-center">
      {/* Outer rotating ring */}
      <div className="apy-orb-ring pointer-events-none absolute h-32 w-32 rounded-full border border-slate-200/25 bg-[conic-gradient(from_0deg,_rgba(168,85,247,0.7),rgba(56,189,248,0.85),rgba(16,185,129,0.7),rgba(168,85,247,0.7))] opacity-90" />

      {/* Inner glow */}
      <div className="apy-orb-inner pointer-events-none absolute h-24 w-24 rounded-full bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.55),transparent_55%),radial-gradient(circle_at_bottom,_rgba(56,189,248,0.35),transparent_60%),rgba(15,23,42,0.9)] shadow-[0_0_40px_rgba(168,85,247,0.95)]" />

      {/* Core content */}
      <div className="relative z-10 flex h-24 w-24 flex-col items-center justify-center rounded-full border border-slate-300/40 bg-[radial-gradient(circle_at_top,_rgba(248,250,252,0.12),transparent_60%),rgba(15,23,42,0.92)] backdrop-blur-xl">
        <span className="text-lg font-semibold text-slate-50 drop-shadow-[0_0_12px_rgba(248,250,252,0.8)]">
          {apyText}
        </span>
        <span className="mt-1 text-[11px] uppercase tracking-[0.16em] text-slate-300/80">
          {label}
        </span>
      </div>
    </div>
  )
}

export default ApyOrb


