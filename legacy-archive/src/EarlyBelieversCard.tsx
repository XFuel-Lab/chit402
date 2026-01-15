import React from 'react'
import GlassCard from './GlassCard'

type Props = {
  onClick: () => void
}

/**
 * Neon card for Early Believers Round — rXF Day 1 Minted
 * Cyberpunk neon styling with pulsing glow
 */
export function EarlyBelieversCard({ onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="group relative w-full transition-all duration-300 hover:scale-[1.02]"
    >
      <GlassCard className="relative overflow-hidden border-cyan-400/70 bg-gradient-to-br from-[rgba(56,189,248,0.35)] via-[rgba(168,85,247,0.28)] to-[rgba(236,72,153,0.25)] shadow-[0_0_60px_rgba(56,189,248,0.6),0_8px_32px_rgba(15,23,42,0.9)] hover:shadow-[0_0_80px_rgba(56,189,248,0.8),0_12px_40px_rgba(15,23,42,0.95)] hover:border-cyan-400/90">
        {/* Animated background glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.3),transparent_70%)] opacity-60 group-hover:opacity-80 transition-opacity duration-300" />
        
        {/* Content */}
        <div className="relative z-10 flex flex-col items-start gap-3">
          <div className="flex w-full items-center gap-3">
            <img src="/logo.png" alt="XFUEL" className="h-10 w-10 flex-shrink-0 object-contain xfuel-logo-glow" />
            <div className="flex flex-1 items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.9)]">
                Early Believers Round — Mainnet Live
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(56,189,248,1)]" />
            </div>
          </div>
          
          <h3 className="text-2xl font-bold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.5)]">
            Mainnet Live
          </h3>
          
          {/* One-liner */}
          <p className="text-base font-semibold text-cyan-300 leading-relaxed drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]">
            TFUEL farmed into fresh rXF soul — day 1 yield, 4× governance power
          </p>
          
          {/* Main explanation */}
          <div className="space-y-3">
            <p className="text-sm text-slate-300/90 leading-relaxed">
              Contribute with TFUEL or USDC to receive rXF tokens at launch. Your contribution converts to rXF at a 1:1 USD value ratio, 
              with tier bonuses applied.
            </p>
            
            {/* Key Benefits */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-2">
                <p className="font-semibold text-cyan-300 mb-0.5">Day 1 Yield</p>
                <p className="text-slate-400">rXF at launch</p>
              </div>
              <div className="rounded-lg border border-purple-400/20 bg-purple-500/5 p-2">
                <p className="font-semibold text-purple-300 mb-0.5">4× Power</p>
                <p className="text-slate-400">Governance boost</p>
              </div>
            </div>
          </div>
          
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-cyan-300/80">
            <span className="font-semibold">Tier Bonuses:</span>
            <span className="rounded-full border border-cyan-400/50 bg-cyan-400/10 px-2 py-0.5">
              $50k+ → 10% bonus
            </span>
            <span className="rounded-full border border-purple-400/50 bg-purple-400/10 px-2 py-0.5">
              $100k+ → 25% bonus
            </span>
          </div>
          
          {/* Arrow indicator */}
          <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-cyan-300/70 group-hover:text-cyan-300 transition-colors">
            <span>Contribute Now</span>
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </div>
        </div>
      </GlassCard>
    </button>
  )
}

export default EarlyBelieversCard

