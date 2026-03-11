import React, { type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

/**
 * Premium EdgeFarm-style cyberpunk background:
 * - Dark cyberpunk space with subtle purple nebula
 * - Faint repeating neon purple XFUEL logo (X with gas pump) tiled at low opacity
 * - Deep space gradients with purple accents
 * - Subtle parallax glow layers
 */
export function ScreenBackground({ children }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020014] text-white">
      {/* Deep space base layer */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-[#020012] via-[#050015] to-[#020010]" />

      {/* Purple nebula swirls */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[rgba(148,27,255,0.55)] via-[rgba(56,189,248,0.05)] to-[rgba(10,10,30,1)] opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(250,249,255,0.06)] to-transparent opacity-70" />
      </div>

      {/* Tiled XFUEL logo pattern (X with gas pump) - repeating at low opacity */}
      <div 
        className="pointer-events-none fixed inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 200px,
            rgba(168,85,247,0.15) 200px,
            rgba(168,85,247,0.15) 201px
          ),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 200px,
            rgba(168,85,247,0.15) 200px,
            rgba(168,85,247,0.15) 201px
          )`,
          backgroundSize: '200px 200px',
          maskImage: `radial-gradient(circle at center, rgba(168,85,247,0.4) 0%, transparent 45%)`,
          WebkitMaskImage: `radial-gradient(circle at center, rgba(168,85,247,0.4) 0%, transparent 45%)`,
        }}
      >
        {/* X pattern centered in each tile */}
        <div className="absolute inset-0" style={{
          backgroundImage: `repeating-conic-gradient(from 45deg at 50% 50%, transparent 0deg, rgba(168,85,247,0.2) 2deg, transparent 4deg, transparent 90deg, rgba(147,51,234,0.15) 92deg, transparent 94deg)`,
          backgroundSize: '200px 200px',
        }} />
      </div>

      {/* Large faint XFUEL glyph watermark (X with gas pump hose) - repeating pattern */}
      <div 
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, transparent 0, transparent 400px, rgba(168,85,247,0.1) 400px, rgba(168,85,247,0.1) 401px),
            repeating-linear-gradient(90deg, transparent 0, transparent 400px, rgba(168,85,247,0.1) 400px, rgba(168,85,247,0.1) 401px)
          `,
          backgroundSize: '400px 400px',
        }}
      />

      {/* Moving particles / stars */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="xfuel-particles" />
      </div>

      {/* Soft vignette */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_rgba(0,0,0,0.55)_70%,_rgba(0,0,0,0.92)_100%)] mix-blend-multiply" />

      {/* Content layer */}
      <div className="relative z-10">{children}</div>
    </div>
  )
}

export default ScreenBackground


