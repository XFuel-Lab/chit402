import React from 'react'

type Props = {
  apyText: string
  label?: string
  isEstimated?: boolean // Show "Estimated" badge when using fallback data
}

/**
 * Giant pulsing APY orb matching EdgeFarm mobile premium style.
 * Rotating outer ring, pulsing inner glow, vibrant purple/cyan gradients.
 */
export function ApyOrb({ apyText, label = 'blended APY', isEstimated = false }: Props) {
  return (
    <div className="relative mx-auto flex items-center justify-center">
      {/* "Estimated" badge */}
      {isEstimated && (
        <div className="absolute -top-2 -right-2 z-20 rounded-full border border-amber-400/60 bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.5)] backdrop-blur-sm">
          Estimated
        </div>
      )}
      
      {/* Outer rotating ring with gradient */}
      <div 
        className="apy-orb-ring pointer-events-none absolute h-[132px] w-[132px] rounded-full opacity-95"
        style={{
          background: 'conic-gradient(from 0deg, rgba(168,85,247,0.65), rgba(56,189,248,0.55), rgba(16,185,110,0.35), rgba(168,85,247,0.65))',
          border: '1px solid rgba(248,250,252,0.22)',
        }}
      />

      {/* Pulsing inner glow */}
      <div 
        className="apy-orb-inner pointer-events-none absolute h-[104px] w-[104px] rounded-full"
        style={{
          backgroundColor: 'rgba(15,23,42,0.85)',
          boxShadow: '0 0 32px rgba(168,85,247,0.9)',
        }}
      />

      {/* Core content with gradient border */}
      <div 
        className="relative z-10 flex h-24 w-24 flex-col items-center justify-center rounded-full backdrop-blur-xl"
        style={{
          background: 'linear-gradient(135deg, rgba(79,70,229,0.28) 0%, rgba(15,23,42,0.96) 100%)',
          border: '1px solid rgba(148,163,184,0.65)',
        }}
      >
        <span className="text-[22px] font-semibold leading-[24px] text-[rgba(248,250,252,0.98)]">
          {apyText}
        </span>
        <span className="mt-[2px] text-[10px] uppercase tracking-[0.14em] text-[rgba(148,163,184,0.95)]">
          {label}
        </span>
      </div>
    </div>
  )
}

export default ApyOrb


