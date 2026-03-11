import React from 'react'

interface LSTHeroProps {
  topAPY: number
  topLSTSymbol: string
}

/**
 * Hero Section: "Stake to the Best Yield in Cosmos" + Live Top APY Badge
 */
export function LSTHero({ topAPY, topLSTSymbol }: LSTHeroProps) {
  return (
    <div className="mb-8 text-center">
      <h1 className="mb-4 bg-gradient-to-r from-purple-300 via-cyan-300 to-purple-300 bg-clip-text text-4xl font-bold tracking-tight text-transparent drop-shadow-[0_0_30px_rgba(168,85,247,0.6)] sm:text-5xl lg:text-6xl">
        Stake to the Best Yield in Cosmos
      </h1>
      <p className="mb-6 text-lg text-slate-300/80 sm:text-xl">
        2026 dominance — Institutional-grade auto-compounding LST gateway
      </p>
      
      {/* Live Top APY Badge */}
      <div className="inline-flex items-center gap-3 rounded-2xl border border-emerald-400/60 bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-transparent px-6 py-4 backdrop-blur-xl shadow-[0_0_40px_rgba(16,185,129,0.6)]">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
          <span className="text-xs uppercase tracking-[0.2em] text-emerald-200/80">Live Top APY</span>
        </div>
        <div className="h-6 w-px bg-emerald-400/40"></div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-emerald-300 drop-shadow-[0_0_20px_rgba(16,185,129,0.9)]">
            {topAPY.toFixed(1)}%
          </span>
          <span className="text-sm font-semibold text-emerald-200/90">{topLSTSymbol}</span>
        </div>
      </div>

      {/* Support Email Card */}
      <div className="mt-6 flex justify-center">
        <div className="relative overflow-hidden rounded-2xl border border-purple-400/40 bg-gradient-to-br from-[rgba(168,85,247,0.15)] via-[rgba(56,189,248,0.1)] to-[rgba(15,23,42,0.3)] px-5 py-3 backdrop-blur-xl shadow-[0_0_30px_rgba(168,85,247,0.4)]">
          <p className="text-sm text-slate-300/90">
            <span className="text-slate-400/80">Questions? </span>
            <a
              href="mailto:xfuel.support@xfuel.app"
              className="text-purple-300 transition-all hover:text-purple-200"
              style={{
                textShadow: '0 0 10px rgba(139, 92, 246, 0.8), 0 0 20px rgba(139, 92, 246, 0.6)',
              }}
            >
              xfuel.support@xfuel.app
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

export default LSTHero

