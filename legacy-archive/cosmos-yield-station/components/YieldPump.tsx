import React, { useState, useMemo, useRef, useEffect } from 'react'
import PoolBubbleCard, { type PoolData } from './PoolBubbleCard'
import GlassCard from './GlassCard'
import SingleSidedLPDeposit from './SingleSidedLPDeposit'
import NeonButton from './NeonButton'
import { usePriceStore } from '../stores/priceStore'

// Expanded pools list
const ALL_POOLS: PoolData[] = [
  {
    id: 'tfuel-usdc',
    name: 'TFUEL/USDC',
    token0: 'TFUEL',
    token1: 'USDC',
    token0Symbol: 'TFUEL',
    token1Symbol: 'USDC',
    fee: 500,
    apy: 12.5,
    tvl: 2450000,
    myShare: 0,
    chain: 'theta',
    provider: 'XFUEL',
    singleSided: true,
  },
  {
    id: 'atom-stkatom',
    name: 'ATOM/stkATOM',
    token0: 'ATOM',
    token1: 'stkATOM',
    token0Symbol: 'ATOM',
    token1Symbol: 'stkATOM',
    fee: 800,
    apy: 15.2,
    tvl: 1820000,
    myShare: 0,
    chain: 'cosmos',
    provider: 'Stride',
    singleSided: true,
  },
  {
    id: 'tfuel-stktia',
    name: 'TFUEL/stkTIA',
    token0: 'TFUEL',
    token1: 'stkTIA',
    token0Symbol: 'TFUEL',
    token1Symbol: 'stkTIA',
    fee: 500,
    apy: 18.7,
    tvl: 3200000,
    myShare: 0,
    chain: 'theta',
    provider: 'XFUEL',
    singleSided: true,
  },
  {
    id: 'usdc-stkatom',
    name: 'USDC/stkATOM',
    token0: 'USDC',
    token1: 'stkATOM',
    token0Symbol: 'USDC',
    token1Symbol: 'stkATOM',
    fee: 300,
    apy: 14.3,
    tvl: 1890000,
    myShare: 0,
    chain: 'cosmos',
    provider: 'Stride',
  },
  {
    id: 'tfuel-xprt',
    name: 'TFUEL/XPRT',
    token0: 'TFUEL',
    token1: 'XPRT',
    token0Symbol: 'TFUEL',
    token1Symbol: 'XPRT',
    fee: 800,
    apy: 16.8,
    tvl: 1560000,
    myShare: 0,
    chain: 'theta',
    provider: 'XFUEL',
  },
  {
    id: 'stktia-stkatom',
    name: 'stkTIA/stkATOM',
    token0: 'stkTIA',
    token1: 'stkATOM',
    token0Symbol: 'stkTIA',
    token1Symbol: 'stkATOM',
    fee: 500,
    apy: 17.9,
    tvl: 2780000,
    myShare: 0,
    chain: 'cosmos',
    provider: 'Stride',
  },
  {
    id: 'usdc-stktia',
    name: 'USDC/stkTIA',
    token0: 'USDC',
    token1: 'stkTIA',
    token0Symbol: 'USDC',
    token1Symbol: 'stkTIA',
    fee: 300,
    apy: 13.6,
    tvl: 2100000,
    myShare: 0,
    chain: 'cosmos',
    provider: 'Stride',
  },
  {
    id: 'atom-usdc',
    name: 'ATOM/USDC',
    token0: 'ATOM',
    token1: 'USDC',
    token0Symbol: 'ATOM',
    token1Symbol: 'USDC',
    fee: 500,
    apy: 11.4,
    tvl: 1950000,
    myShare: 0,
    chain: 'cosmos',
    provider: 'Osmosis',
  },
]

interface Props {
  walletAddress: string | null
  walletBalance: string
  walletConnected: boolean
  onSuccess?: (lpAmount: string, poolId: string) => void
  onConnectWallet?: () => void
}

export default function YieldPump({ walletAddress, walletBalance, walletConnected, onSuccess, onConnectWallet }: Props) {
  const [pools, setPools] = useState<PoolData[]>(ALL_POOLS)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterProvider, setFilterProvider] = useState<string>('all')
  const [filterChain, setFilterChain] = useState<string>('all')
  const [filterMinAPY, setFilterMinAPY] = useState<number>(0)
  const [selectedPool, setSelectedPool] = useState<PoolData | null>(null)
  const [showDepositModal, setShowDepositModal] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const priceStore = usePriceStore()
  const { prices, apys } = priceStore

  // Update pools with oracle data
  useEffect(() => {
    if (apys && Object.keys(apys).length > 0) {
      setPools((prevPools) =>
        prevPools.map((pool) => {
          // Try to match pool tokens to oracle APY data
          let updatedAPY = pool.apy
          if (pool.token1Symbol === 'stkTIA' && apys.stkTIA) {
            updatedAPY = apys.stkTIA.apy
          } else if (pool.token1Symbol === 'stkATOM' && apys.stkATOM) {
            updatedAPY = apys.stkATOM.apy
          } else if (pool.token0Symbol === 'stkTIA' && apys.stkTIA) {
            updatedAPY = apys.stkTIA.apy
          } else if (pool.token0Symbol === 'stkATOM' && apys.stkATOM) {
            updatedAPY = apys.stkATOM.apy
          }
          return { ...pool, apy: updatedAPY }
        })
      )
    }
  }, [apys])

  // Calculate best yield
  const bestYield = useMemo(() => {
    if (pools.length === 0) return null
    const best = pools.reduce((max, pool) => (pool.apy > max.apy ? pool : max), pools[0])
    return best
  }, [pools])

  // Filter pools
  const filteredPools = useMemo(() => {
    return pools.filter((pool) => {
      const matchesSearch =
        pool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.token0Symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.token1Symbol.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesProvider = filterProvider === 'all' || pool.provider === filterProvider
      const matchesChain = filterChain === 'all' || pool.chain === filterChain
      const matchesAPY = pool.apy >= filterMinAPY

      return matchesSearch && matchesProvider && matchesChain && matchesAPY
    })
  }, [pools, searchQuery, filterProvider, filterChain, filterMinAPY])

  // Get unique providers and chains
  const providers = useMemo(() => {
    const unique = new Set(pools.map((p) => p.provider))
    return Array.from(unique)
  }, [pools])

  const chains = useMemo(() => {
    const unique = new Set(pools.map((p) => p.chain))
    return Array.from(unique)
  }, [pools])

  // Handle horizontal scroll with mouse wheel and touch
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // Mouse wheel horizontal scroll
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault()
        container.scrollLeft += e.deltaY
      }
    }

    // Touch swipe support
    let touchStartX = 0
    let touchStartY = 0
    let isScrolling = false

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX
      touchStartY = e.touches[0].clientY
      isScrolling = false
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartX || !touchStartY) return

      const touchX = e.touches[0].clientX
      const touchY = e.touches[0].clientY
      const diffX = touchStartX - touchX
      const diffY = touchStartY - touchY

      // Determine if horizontal or vertical scroll
      if (Math.abs(diffX) > Math.abs(diffY)) {
        isScrolling = true
        container.scrollLeft += diffX
        touchStartX = touchX
        touchStartY = touchY
      }
    }

    const handleTouchEnd = () => {
      touchStartX = 0
      touchStartY = 0
      isScrolling = false
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [])

  const handleAdd = (pool: PoolData) => {
    setSelectedPool(pool)
    setShowDepositModal(true)
  }

  const handleRemove = (pool: PoolData) => {
    // TODO: Implement remove liquidity
    console.log('Remove liquidity from pool:', pool.id)
  }

  const handleDepositSuccess = (lpAmount: string, poolId: string) => {
    // Update pool myShare (simplified)
    setPools((prev) =>
      prev.map((p) => {
        if (p.id === poolId) {
          const lpValue = parseFloat(lpAmount) * (p.tvl / 1000000) // Simplified calculation
          return { ...p, myShare: (p.myShare || 0) + lpValue }
        }
        return p
      })
    )
    setShowDepositModal(false)
    setSelectedPool(null)
    if (onSuccess) {
      onSuccess(lpAmount, poolId)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Bar: Best Yield Badge */}
      {bestYield && (
        <div className="relative overflow-hidden rounded-3xl border border-emerald-400/60 bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-purple-500/20 backdrop-blur-xl shadow-[0_0_60px_rgba(16,185,129,0.75)]">
          <div className="relative z-10 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-4 h-4 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.9)]" />
                  <div className="absolute inset-0 w-4 h-4 rounded-full bg-emerald-400 animate-ping opacity-75" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/80 mb-1">
                    🚀 Best Yield
                  </p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-purple-300 drop-shadow-[0_0_20px_rgba(16,185,129,0.8)]">
                      {bestYield.apy.toFixed(1)}%
                    </p>
                    <p className="text-lg font-bold text-white">{bestYield.name}</p>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Total Value Locked</p>
                <p className="text-2xl font-bold text-cyan-300 drop-shadow-[0_0_15px_rgba(6,182,212,0.7)]">
                  ${(bestYield.tvl / 1000000).toFixed(2)}M
                </p>
              </div>
            </div>
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.1),transparent)] opacity-50" />
        </div>
      )}

      {/* Search and Filters */}
      <GlassCard>
        <div className="space-y-4">
          {/* Search */}
          <div>
            <input
              type="text"
              placeholder="Search pools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-purple-400/30 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-purple-400/70 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Provider Filter */}
            <div>
              <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5">
                Provider
              </label>
              <select
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value)}
                className="w-full rounded-xl border border-purple-400/30 bg-black/40 px-3 py-2 text-sm text-white focus:border-purple-400/70 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
              >
                <option value="all">All Providers</option>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {/* Chain Filter */}
            <div>
              <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5">
                Chain
              </label>
              <select
                value={filterChain}
                onChange={(e) => setFilterChain(e.target.value)}
                className="w-full rounded-xl border border-purple-400/30 bg-black/40 px-3 py-2 text-sm text-white focus:border-purple-400/70 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
              >
                <option value="all">All Chains</option>
                {chains.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Min APY Filter */}
            <div>
              <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-1.5">
                Min APY: {filterMinAPY}%
              </label>
              <input
                type="range"
                min="0"
                max="25"
                step="0.5"
                value={filterMinAPY}
                onChange={(e) => setFilterMinAPY(parseFloat(e.target.value))}
                className="w-full h-2 bg-purple-400/20 rounded-lg appearance-none cursor-pointer accent-purple-400"
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Wallet Connect Banner */}
      {!walletConnected && (
        <GlassCard>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white mb-1">Connect Wallet to Add Liquidity</p>
              <p className="text-xs text-slate-400">View all pools and yields below</p>
            </div>
            {onConnectWallet && (
              <NeonButton
                label="Connect Wallet"
                onClick={onConnectWallet}
                className="flex-shrink-0"
              />
            )}
          </div>
        </GlassCard>
      )}

      {/* Horizontal Scroll Grid */}
      <div className="relative w-full">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
            {filteredPools.length} Pool{filteredPools.length !== 1 ? 's' : ''} Available
          </p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-purple-300/80">
            ← Swipe to explore →
          </p>
        </div>
        <div
          ref={scrollContainerRef}
          className="flex gap-4 overflow-x-auto overflow-y-hidden pb-4 scroll-smooth no-scrollbar"
          style={{
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            scrollBehavior: 'smooth',
            width: '100%',
            display: 'flex',
            flexDirection: 'row',
          }}
        >
          {filteredPools.length > 0 ? (
            filteredPools.map((pool) => (
              <div
                key={pool.id}
                className="flex-shrink-0"
                style={{ scrollSnapAlign: 'start', minWidth: '320px' }}
              >
                <PoolBubbleCard
                  pool={pool}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                  walletConnected={walletConnected}
                />
              </div>
            ))
          ) : (
            <GlassCard>
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">No pools match your filters</p>
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Deposit Modal */}
      {showDepositModal && selectedPool && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDepositModal(false)
              setSelectedPool(null)
            }
          }}
        >
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <GlassCard>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-white">Add Liquidity</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDepositModal(false)
                      setSelectedPool(null)
                    }}
                    className="text-slate-400 hover:text-white transition-colors text-2xl leading-none"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="rounded-xl border border-purple-400/30 bg-black/40 p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex -space-x-2">
                        <div className="w-8 h-8 rounded-full border-2 border-white/20 bg-cyan-500/20 flex items-center justify-center font-bold text-xs text-cyan-300">
                          {selectedPool.token0Symbol.slice(0, 2)}
                        </div>
                        <div className="w-8 h-8 rounded-full border-2 border-white/20 bg-emerald-500/20 flex items-center justify-center font-bold text-xs text-emerald-300">
                          {selectedPool.token1Symbol.slice(0, 2)}
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">{selectedPool.name}</h3>
                        <p className="text-xs text-slate-400">{selectedPool.apy.toFixed(1)}% APY</p>
                      </div>
                    </div>
                  </div>
                  <SingleSidedLPDeposit
                    walletAddress={walletAddress}
                    walletBalance={walletBalance}
                    onSuccess={(lpAmount) => handleDepositSuccess(lpAmount, selectedPool.id)}
                  />
                </div>
              </div>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  )
}

