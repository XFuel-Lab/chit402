import React, { type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

/**
 * Cyberpunk XFUEL background:
 * - Deep space purple/indigo base
 * - Soft nebula gradients
 * - Tiled faint XFUEL "X" logo pattern
 * - Subtle parallax glow layers
 */
export function ScreenBackground({ children }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020014] text-white">
      {/* Nebula gradients */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-[-20%] bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.45),transparent_55%),radial-gradient(circle_at_bottom_left,_rgba(56,189,248,0.28),transparent_55%),radial-gradient(circle_at_bottom_right,_rgba(236,72,153,0.26),transparent_55%)] opacity-80" />
        {/* Soft vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.65)_70%,_rgba(0,0,0,0.95)_100%)] mix-blend-multiply" />
      </div>

      {/* XFUEL logo tiling */}
      <div className="pointer-events-none fixed inset-0 opacity-[0.045] [background-image:radial-gradient(circle_at_0_0,_rgba(148,163,184,0.2)_0,_rgba(148,163,184,0.2)_1px,transparent_1px),radial-gradient(circle_at_100%_0,_rgba(148,163,184,0.15)_0,_rgba(148,163,184,0.15)_1px,transparent_1px)] [background-size:120px_120px] mix-blend-screen" />

      {/* Large faint XFUEL glyph watermark (X with gas pump hose) */}
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center opacity-[0.08]">
        <div className="relative h-[420px] w-[420px] rotate-3">
          {/* Stylized X */}
          <div className="absolute inset-16 -skew-x-6 rounded-[999px] border border-purple-500/40 shadow-[0_0_120px_rgba(168,85,247,0.85)]" />
          <div className="absolute inset-16 skew-x-6 rounded-[999px] border border-cyan-400/35 shadow-[0_0_120px_rgba(56,189,248,0.85)]" />
          {/* Pump hose arc */}
          <div className="absolute -right-6 top-10 h-64 w-64 rounded-full border border-purple-500/40 border-t-transparent border-l-transparent" />
        </div>
      </div>

      {/* Moving particles / stars */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="xfuel-particles" />
      </div>

      {/* Content layer */}
      <div className="relative z-10">{children}</div>
    </div>
  )
}

export default ScreenBackground


