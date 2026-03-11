import React, { useRef, useEffect } from 'react'
import { LSTTokenConfig, LST_TOKENS_CONFIG } from '../utils/lstTokens'

interface LSTGridProps {
  selectedLST: LSTTokenConfig
  onSelectLST: (lst: LSTTokenConfig) => void
  bestYieldSymbol: string
  sortBy: 'apy' | 'risk' | 'provider'
  filterProvider?: string
}

/**
 * Ultimate LST Grid/Carousel Component
 * Cyberpunk neon glassmorphism cards with live APY, provider, trend arrows
 */
export function LSTGrid({
  selectedLST,
  onSelectLST,
  bestYieldSymbol,
  sortBy,
  filterProvider,
}: LSTGridProps) {
  // Filter and sort LSTs
  let displayLSTs = [...LST_TOKENS_CONFIG]
  
  // Filter by provider if specified
  if (filterProvider && filterProvider !== 'all') {
    displayLSTs = displayLSTs.filter((lst) => lst.provider === filterProvider)
  }
  
  // Sort
  displayLSTs.sort((a, b) => {
    if (sortBy === 'apy') {
      return b.apy - a.apy
    } else if (sortBy === 'risk') {
      const riskOrder = { low: 0, medium: 1, high: 2 }
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel]
    } else {
      // Sort by provider name
      return a.provider.localeCompare(b.provider)
    }
  })

  const isBestYield = (symbol: string) => symbol === bestYieldSymbol
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Disable page scroll when hovering over the carousel
  const handleMouseEnter = () => {
    document.body.style.overflow = 'hidden'
  }

  const handleMouseLeave = () => {
    document.body.style.overflow = ''
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Handle mouse wheel scrolling - prevent page scroll and only scroll horizontally
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollContainerRef.current) {
      e.preventDefault()
      e.stopPropagation()
      // Only scroll horizontally, ignore vertical scroll
      scrollContainerRef.current.scrollLeft += e.deltaY
    }
  }

  return (
    <div className="space-y-4">
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="no-scrollbar overflow-x-auto pb-2 scroll-smooth"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="flex gap-3 min-w-max">
          {displayLSTs.map((lst) => {
            const isSelected = lst.symbol === selectedLST.symbol
            const isBest = isBestYield(lst.symbol)
            const trendIcon = lst.apyTrend === 'up' ? '↗' : lst.apyTrend === 'down' ? '↘' : '→'
            const trendColor = lst.apyTrend === 'up' ? 'text-emerald-400' : lst.apyTrend === 'down' ? 'text-rose-400' : 'text-slate-400'

            return (
              <button
                key={lst.symbol}
                onClick={() => onSelectLST(lst)}
                className={`
                  group relative flex min-w-[180px] flex-col gap-2 rounded-2xl border px-4 py-3 text-left
                  transition-all duration-300 ease-out backdrop-blur-xl
                  ${isSelected
                    ? 'border-purple-400/90 bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.45),transparent_60%),rgba(15,23,42,0.95)] shadow-[0_0_40px_rgba(168,85,247,0.9)] scale-105'
                    : 'border-purple-400/40 bg-[rgba(15,23,42,0.85)] hover:border-purple-400/70 hover:bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.35),transparent_60%),rgba(15,23,42,0.95)] hover:shadow-[0_0_28px_rgba(168,85,247,0.8)] hover:scale-105'
                  }
                  ${isBest ? 'ring-2 ring-emerald-400/60 ring-offset-2 ring-offset-black/50' : ''}
                  xfuel-tap-glow
                `}
              >
                {/* BEST YIELD Badge */}
                {isBest && (
                  <div className="absolute -top-2 -right-2 z-10">
                    <div className="rounded-full border border-emerald-400/80 bg-gradient-to-br from-emerald-500/40 to-emerald-600/40 px-3 py-1 backdrop-blur-sm shadow-[0_0_20px_rgba(16,185,129,0.8)]">
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-200">
                        ⭐ BEST YIELD
                      </span>
                    </div>
                  </div>
                )}

                {/* Logo placeholder */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-400/30 bg-gradient-to-br from-purple-500/20 to-cyan-500/20 backdrop-blur-sm">
                      <span className="text-base font-bold text-purple-300">{lst.symbol[0]}</span>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">{lst.symbol}</p>
                      <p className="text-[9px] uppercase tracking-wide text-slate-400">{lst.provider}</p>
                    </div>
                  </div>
                  <span className={`text-lg ${trendColor}`} title={lst.apyTrend || 'stable'}>
                    {trendIcon}
                  </span>
                </div>

                {/* APY Display */}
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-emerald-300 drop-shadow-[0_0_16px_rgba(16,185,129,0.9)]">
                    {lst.apy > 0 ? lst.apy.toFixed(1) : '—'}
                  </span>
                  {lst.apy > 0 && (
                    <span className="text-[10px] font-normal uppercase tracking-[0.14em] text-slate-300/80">
                      APY
                    </span>
                  )}
                </div>

                {/* Risk Level */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] uppercase tracking-wide text-slate-400">Risk:</span>
                  <span
                    className={`text-[10px] font-semibold ${
                      lst.riskLevel === 'low'
                        ? 'text-emerald-400'
                        : lst.riskLevel === 'medium'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {lst.riskLevel.toUpperCase()}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default LSTGrid

