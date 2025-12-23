import React from 'react'
import NeonButton from './NeonButton'

export interface PoolData {
  id: string
  name: string
  token0: string
  token1: string
  token0Symbol: string
  token1Symbol: string
  fee: number
  apy: number
  tvl: number
  myShare?: number
  poolAddress?: string
  chain: 'theta' | 'cosmos'
  provider: string
  singleSided?: boolean
}

interface Props {
  pool: PoolData
  onAdd: (pool: PoolData) => void
  onRemove: (pool: PoolData) => void
  walletConnected: boolean
}

// Token color mapping
const TOKEN_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  TFUEL: { bg: 'bg-cyan-500/20', text: 'text-cyan-300', glow: 'shadow-[0_0_20px_rgba(6,182,212,0.6)]' },
  USDC: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', glow: 'shadow-[0_0_20px_rgba(16,185,129,0.6)]' },
  stkTIA: { bg: 'bg-purple-500/20', text: 'text-purple-300', glow: 'shadow-[0_0_20px_rgba(168,85,247,0.6)]' },
  stkATOM: { bg: 'bg-purple-500/20', text: 'text-purple-300', glow: 'shadow-[0_0_20px_rgba(168,85,247,0.6)]' },
  ATOM: { bg: 'bg-purple-500/20', text: 'text-purple-300', glow: 'shadow-[0_0_20px_rgba(168,85,247,0.6)]' },
  XPRT: { bg: 'bg-slate-500/20', text: 'text-slate-300', glow: 'shadow-[0_0_20px_rgba(148,163,184,0.6)]' },
  default: { bg: 'bg-slate-500/20', text: 'text-slate-300', glow: 'shadow-[0_0_20px_rgba(148,163,184,0.6)]' },
}

export default function PoolBubbleCard({ pool, onAdd, onRemove, walletConnected }: Props) {
  const token0Color = TOKEN_COLORS[pool.token0Symbol] || TOKEN_COLORS.default
  const token1Color = TOKEN_COLORS[pool.token1Symbol] || TOKEN_COLORS.default

  const formatTVL = (tvl: number) => {
    if (tvl >= 1000000) return `$${(tvl / 1000000).toFixed(2)}M`
    if (tvl >= 1000) return `$${(tvl / 1000).toFixed(2)}K`
    return `$${tvl.toFixed(2)}`
  }

  return (
    <div
      className={[
        'group relative flex-shrink-0 w-[320px] sm:w-[360px] rounded-3xl border',
        'bg-gradient-to-br from-[rgba(168,85,247,0.35)] via-[rgba(56,189,248,0.25)] to-[rgba(15,23,42,0.5)]',
        'backdrop-blur-xl',
        'border-purple-400/60',
        'shadow-[0_0_60px_rgba(168,85,247,0.75),0_8px_32px_rgba(15,23,42,0.9)]',
        'transition-all duration-300 ease-out',
        'hover:shadow-[0_0_80px_rgba(168,85,247,0.9),0_12px_40px_rgba(15,23,42,0.95)]',
        'hover:border-purple-400/90 hover:scale-[1.02]',
        'before:pointer-events-none before:absolute before:inset-0 before:rounded-3xl',
        'before:bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02),transparent)] before:opacity-60',
      ].join(' ')}
      style={{ backgroundColor: 'rgba(15,23,42,0.25)' }}
    >
      <div className="relative z-10 p-6 space-y-4">
        {/* Header: Pair tokens */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <div
                className={[
                  'w-10 h-10 rounded-full border-2 border-white/20 flex items-center justify-center font-bold text-sm',
                  token0Color.bg,
                  token0Color.text,
                  token0Color.glow,
                ].join(' ')}
              >
                {pool.token0Symbol.slice(0, 2)}
              </div>
              <div
                className={[
                  'w-10 h-10 rounded-full border-2 border-white/20 flex items-center justify-center font-bold text-sm',
                  token1Color.bg,
                  token1Color.text,
                  token1Color.glow,
                ].join(' ')}
              >
                {pool.token1Symbol.slice(0, 2)}
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{pool.name}</h3>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                {pool.chain} • {pool.provider}
              </p>
            </div>
          </div>
          {pool.singleSided && (
            <span className="rounded-full border border-cyan-400/60 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-300">
              Single
            </span>
          )}
        </div>

        {/* BIG APY */}
        <div className="text-center py-2">
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-purple-300 drop-shadow-[0_0_30px_rgba(16,185,129,0.9)]">
              {pool.apy.toFixed(1)}
            </span>
            <span className="text-2xl font-bold text-emerald-300 drop-shadow-[0_0_20px_rgba(16,185,129,0.7)]">
              %
            </span>
          </div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mt-1">APY</p>
        </div>

        {/* TVL + My Share */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-purple-400/20">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">TVL</p>
            <p className="mt-1 text-lg font-bold text-cyan-300">{formatTVL(pool.tvl)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">My Share</p>
            <p className="mt-1 text-lg font-bold text-purple-300">
              {pool.myShare ? `$${pool.myShare.toFixed(2)}` : '—'}
            </p>
          </div>
        </div>

        {/* Fee badge */}
        <div className="flex items-center justify-center">
          <span className="rounded-full border border-purple-400/40 bg-purple-500/10 px-3 py-1 text-[10px] font-medium text-purple-200">
            Fee: {pool.fee / 10000}%
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => onAdd(pool)}
            disabled={!walletConnected}
            className={[
              'flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all',
              'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20',
              'border-emerald-400/60 text-emerald-300',
              'hover:border-emerald-400/90 hover:bg-gradient-to-r hover:from-emerald-500/30 hover:to-cyan-500/30',
              'hover:shadow-[0_0_30px_rgba(16,185,129,0.6)]',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none',
            ].join(' ')}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => onRemove(pool)}
            disabled={!walletConnected || !pool.myShare || pool.myShare === 0}
            className={[
              'flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all',
              'bg-gradient-to-r from-rose-500/20 to-pink-500/20',
              'border-rose-400/60 text-rose-300',
              'hover:border-rose-400/90 hover:bg-gradient-to-r hover:from-rose-500/30 hover:to-pink-500/30',
              'hover:shadow-[0_0_30px_rgba(244,63,94,0.6)]',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none',
            ].join(' ')}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

