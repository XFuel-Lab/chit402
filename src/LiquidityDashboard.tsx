import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import ScreenBackground from './components/ScreenBackground'
import GlassCard from './components/GlassCard'
import NeonButton from './components/NeonButton'
import ApyOrb from './components/ApyOrb'

interface PoolStats {
  volume24h: string
  totalFees: string
  totalBurned: string
  tvl: string
  apy: number
}

function LiquidityDashboard() {
  const [stats, setStats] = useState<PoolStats>({
    volume24h: '0',
    totalFees: '0',
    totalBurned: '0',
    tvl: '0',
    apy: 0,
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate fetching live data from contracts
    const fetchStats = async () => {
      setIsLoading(true)
      
      // Mock data - in production, these would be contract calls
      // Example: const router = new ethers.Contract(routerAddress, routerABI, provider)
      // const totalBurned = await router.totalXFuelBurned()
      
      await new Promise((resolve) => setTimeout(resolve, 1000))
      
      setStats({
        volume24h: '1,234,567.89',
        totalFees: '45,678.90',
        totalBurned: '123,456.78',
        tvl: '5,678,901.23',
        apy: 28.7,
      })
      
      setIsLoading(false)
    }

    fetchStats()
    const interval = setInterval(fetchStats, 30000) // Update every 30 seconds
    
    return () => clearInterval(interval)
  }, [])

  const formatNumber = (value: string) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(parseFloat(value))
  }

  return (
    <ScreenBackground>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-col items-center justify-between gap-4 sm:mb-10 sm:flex-row">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 via-cyan-400 to-pink-500 shadow-[0_0_40px_rgba(168,85,247,0.9)] sm:h-14 sm:w-14">
              <span className="text-2xl font-black tracking-tight text-white sm:text-3xl">X</span>
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="bg-gradient-to-r from-purple-300 via-purple-100 to-cyan-300 bg-clip-text text-lg font-semibold uppercase tracking-[0.32em] text-transparent sm:text-xl">
                XFUEL Liquidity
              </h1>
              <p className="text-xs text-slate-300/80 sm:text-sm">
                TFUEL↔XPRT Pool • Live Metrics
              </p>
            </div>
          </div>

          <div className="flex w-full max-w-xs flex-col items-end gap-2 sm:max-w-none sm:flex-row sm:items-center sm:justify-end sm:gap-4">
            <div className="w-full max-w-[180px] sm:max-w-[200px]">
              <ApyOrb apyText={`${stats.apy.toFixed(1)}%`} label="pool APY" />
            </div>
            <NeonButton
              label="Back to Swap"
              variant="secondary"
              onClick={() => {
                window.location.href = '/'
              }}
            />
          </div>
        </header>

        {/* Main Dashboard */}
        <main className="flex flex-1 flex-col gap-6 pb-10">
          {/* Pool Overview Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <GlassCard>
              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">24h Volume</p>
                <p className="text-2xl font-bold text-white">
                  {isLoading ? '...' : `$${formatNumber(stats.volume24h)}`}
                </p>
                <p className="text-xs text-green-400">+12.5%</p>
              </div>
            </GlassCard>

            <GlassCard>
              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">Total Fees</p>
                <p className="text-2xl font-bold text-white">
                  {isLoading ? '...' : `$${formatNumber(stats.totalFees)}`}
                </p>
                <p className="text-xs text-cyan-400">All time</p>
              </div>
            </GlassCard>

            <GlassCard>
              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">XF Burned</p>
                <p className="text-2xl font-bold text-white">
                  {isLoading ? '...' : `${formatNumber(stats.totalBurned)} XF`}
                </p>
                <p className="text-xs text-pink-400">60% of fees</p>
              </div>
            </GlassCard>

            <GlassCard>
              <div className="flex flex-col gap-2">
                <p className="text-xs uppercase tracking-wider text-slate-400">Total Value Locked</p>
                <p className="text-2xl font-bold text-white">
                  {isLoading ? '...' : `$${formatNumber(stats.tvl)}`}
                </p>
                <p className="text-xs text-purple-400">TFUEL↔XPRT</p>
              </div>
            </GlassCard>
          </div>

          {/* Fee Distribution */}
          <GlassCard>
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white">Revenue Split</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-purple-400/40 bg-purple-500/10 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-slate-300">Buyback & Burn</span>
                    <span className="text-sm font-semibold text-purple-300">60%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                      style={{ width: '60%' }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {isLoading ? '...' : `${formatNumber((parseFloat(stats.totalFees) * 0.6).toString())} XF burned`}
                  </p>
                </div>

                <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-slate-300">veXF Yield</span>
                    <span className="text-sm font-semibold text-cyan-300">25%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                      style={{ width: '25%' }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {isLoading ? '...' : `$${formatNumber((parseFloat(stats.totalFees) * 0.25).toString())} USDC`}
                  </p>
                </div>

                <div className="rounded-xl border border-green-400/40 bg-green-500/10 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-slate-300">Treasury</span>
                    <span className="text-sm font-semibold text-green-300">15%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-500"
                      style={{ width: '15%' }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {isLoading ? '...' : `$${formatNumber((parseFloat(stats.totalFees) * 0.15).toString())} USDC`}
                  </p>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Pool Details */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <GlassCard>
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">Pool Configuration</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <span className="text-sm text-slate-400">Token Pair</span>
                    <span className="text-sm font-medium text-white">TFUEL / XPRT</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <span className="text-sm text-slate-400">Fee Tiers</span>
                    <span className="text-sm font-medium text-white">0.05% • 0.08%</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <span className="text-sm text-slate-400">Pool Type</span>
                    <span className="text-sm font-medium text-white">Concentrated Liquidity</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">IL Protection</span>
                    <span className="text-sm font-medium text-green-400">>8% Backstop Active</span>
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard>
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-white">Live Metrics</h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <span className="text-sm text-slate-400">Current Price</span>
                    <span className="text-sm font-medium text-white">
                      {isLoading ? '...' : '1 TFUEL = 0.95 XPRT'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <span className="text-sm text-slate-400">24h Transactions</span>
                    <span className="text-sm font-medium text-white">
                      {isLoading ? '...' : '1,234'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                    <span className="text-sm text-slate-400">Active LPs</span>
                    <span className="text-sm font-medium text-white">
                      {isLoading ? '...' : '456'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Last Update</span>
                    <span className="text-sm font-medium text-cyan-400">
                      {new Date().toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Burn Counter Animation */}
          <GlassCard>
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="text-center">
                <p className="text-xs uppercase tracking-wider text-slate-400">Total XF Burned</p>
                <p className="mt-2 text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400">
                  {isLoading ? '...' : `${formatNumber(stats.totalBurned)} XF`}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>🔥</span>
                <span>Permanently removed from supply</span>
                <span>🔥</span>
              </div>
            </div>
          </GlassCard>
        </main>
      </div>
    </ScreenBackground>
  )
}

export default LiquidityDashboard

