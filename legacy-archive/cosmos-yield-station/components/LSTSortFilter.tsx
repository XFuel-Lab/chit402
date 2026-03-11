import React from 'react'
import { LSTProvider } from '../utils/lstTokens'

interface LSTSortFilterProps {
  sortBy: 'apy' | 'risk' | 'provider'
  filterProvider: string
  onSortChange: (sort: 'apy' | 'risk' | 'provider') => void
  onFilterChange: (provider: string) => void
}

/**
 * Advanced Sort/Filter Controls for LST Grid
 */
export function LSTSortFilter({
  sortBy,
  filterProvider,
  onSortChange,
  onFilterChange,
}: LSTSortFilterProps) {
  const providers: (LSTProvider | 'all')[] = ['all', 'Stride', 'MilkyWay', 'Quicksilver', 'Persistence', 'pSTAKE']

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-purple-400/40 bg-black/30 px-4 py-3 backdrop-blur-sm">
      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Sort:</span>
        <div className="flex gap-2">
          {(['apy', 'risk', 'provider'] as const).map((sort) => (
            <button
              key={sort}
              onClick={() => onSortChange(sort)}
              className={`
                rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all
                ${sortBy === sort
                  ? 'border-purple-400/80 bg-purple-500/30 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                  : 'border-purple-400/30 bg-black/20 text-purple-300 hover:border-purple-400/60 hover:bg-purple-500/10'
                }
              `}
            >
              {sort === 'apy' ? 'APY' : sort === 'risk' ? 'Risk' : 'Provider'}
            </button>
          ))}
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Filter:</span>
        <div className="flex gap-2">
          {providers.map((provider) => (
            <button
              key={provider}
              onClick={() => onFilterChange(provider)}
              className={`
                rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all
                ${filterProvider === provider
                  ? 'border-cyan-400/80 bg-cyan-500/30 text-white shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                  : 'border-cyan-400/30 bg-black/20 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10'
                }
              `}
            >
              {provider === 'all' ? 'All' : provider}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LSTSortFilter

