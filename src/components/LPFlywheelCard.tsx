import { useState, useEffect, useMemo } from 'react'
import { ethers } from 'ethers'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import ApyOrb from './ApyOrb'

interface LPPool {
  id: string
  name: string
  token0: string
  token1: string
  tvl: number
  apy: number
  volume24h: number
  userLiquidity: number
  userEarnings: number
}

interface RebalanceRecord {
  timestamp: number
  pool: string
  action: string
  amount: number
  txHash: string
}

interface Props {
  userAddress: string | null
  onAddLiquidity: (poolId: string, amount: number) => Promise<void>
  onClaimRewards: (poolId: string) => Promise<void>
}

// Mock LP pools - in production, fetch from contracts
const LP_POOLS: LPPool[] = [
  {
    id: 'usdc-xprt',
    name: 'USDC/XPRT',
    token0: 'USDC',
    token1: 'XPRT',
    tvl: 2_456_789,
    apy: 32.5,
    volume24h: 187_543,
    userLiquidity: 0,
    userEarnings: 0,
  },
  {
    id: 'tfuel-xprt',
    name: 'TFUEL/XPRT',
    token0: 'TFUEL',
    token1: 'XPRT',
    tvl: 1_823_456,
    apy: 28.7,
    volume24h: 143_221,
    userLiquidity: 0,
    userEarnings: 0,
  },
  {
    id: 'usdc-atom',
    name: 'USDC/ATOM',
    token0: 'USDC',
    token1: 'ATOM',
    tvl: 3_112_890,
    apy: 24.3,
    volume24h: 223_456,
    userLiquidity: 0,
    userEarnings: 0,
  },
]

export default function LPFlywheelCard({ userAddress, onAddLiquidity, onClaimRewards }: Props) {
  const [pools, setPools] = useState<LPPool[]>(LP_POOLS)
  const [selectedPool, setSelectedPool] = useState<string | null>(null)
  const [depositAmount, setDepositAmount] = useState('')
  const [isDepositing, setIsDepositing] = useState(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [rebalanceHistory, setRebalanceHistory] = useState<RebalanceRecord[]>([])
  const [reinvestmentRate, setReinvestmentRate] = useState(70) // 70% reinvest rate

  // Calculate total LP stats
  const totalStats = useMemo(() => {
    return pools.reduce(
      (acc, pool) => ({
        tvl: acc.tvl + pool.tvl,
        volume24h: acc.volume24h + pool.volume24h,
        userLiquidity: acc.userLiquidity + pool.userLiquidity,
        userEarnings: acc.userEarnings + pool.userEarnings,
      }),
      { tvl: 0, volume24h: 0, userLiquidity: 0, userEarnings: 0 }
    )
  }, [pools])

  // Load rebalance history
  useEffect(() => {
    // Mock rebalance history - in production, fetch from contract events
    const mockHistory: RebalanceRecord[] = [
      {
        timestamp: Date.now() - 2 * 60 * 60 * 1000,
        pool: 'USDC/XPRT',
        action: 'Rebalanced 60/40 → 52/48',
        amount: 12_345,
        txHash: '0xabc...123',
      },
      {
        timestamp: Date.now() - 6 * 60 * 60 * 1000,
        pool: 'TFUEL/XPRT',
        action: 'Reinvested fees (70%)',
        amount: 8_765,
        txHash: '0xdef...456',
      },
      {
        timestamp: Date.now() - 12 * 60 * 60 * 1000,
        pool: 'USDC/ATOM',
        action: 'Rebalanced 55/45 → 50/50',
        amount: 15_678,
        txHash: '0xghi...789',
      },
    ]
    setRebalanceHistory(mockHistory)
  }, [])

  // Handle liquidity deposit
  const handleDeposit = async () => {
    if (!selectedPool || !depositAmount) return

    const amount = parseFloat(depositAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount')
      return
    }

    setIsDepositing(true)
    try {
      await onAddLiquidity(selectedPool, amount)
      
      // Update pool liquidity locally
      setPools((prev) =>
        prev.map((pool) =>
          pool.id === selectedPool
            ? { ...pool, userLiquidity: pool.userLiquidity + amount }
            : pool
        )
      )

      alert(`Successfully added ${amount.toLocaleString()} liquidity to ${selectedPool}!`)
      setDepositAmount('')
      setSelectedPool(null)
    } catch (error) {
      console.error('Deposit failed:', error)
      alert('Deposit failed. Please try again.')
    } finally {
      setIsDepositing(false)
    }
  }

  // Handle claim rewards
  const handleClaimRewards = async (poolId: string) => {
    const pool = pools.find((p) => p.id === poolId)
    if (!pool || pool.userEarnings === 0) return

    setIsClaiming(true)
    try {
      await onClaimRewards(poolId)
      
      alert(`Claimed ${pool.userEarnings.toLocaleString()} USDC rewards!`)
      
      // Reset earnings locally
      setPools((prev) =>
        prev.map((p) => (p.id === poolId ? { ...p, userEarnings: 0 } : p))
      )
    } catch (error) {
      console.error('Claim failed:', error)
      alert('Claim failed. Please try again.')
    } finally {
      setIsClaiming(false)
    }
  }

  // Format time ago
  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp
    const hours = Math.floor(diff / (60 * 60 * 1000))
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000))

    if (hours > 0) return `${hours}h ago`
    return `${minutes}m ago`
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <GlassCard className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">LP Flywheel</h2>
              <p className="text-sm text-slate-300">
                Auto-reinvesting liquidity pools with {reinvestmentRate}% fee recycling
              </p>
            </div>
            <div className="w-20 h-20">
              <ApyOrb apyText="♻️" label="Active" />
            </div>
          </div>

          {/* Total Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-xs text-slate-400 mb-1">Total TVL</p>
              <p className="text-lg font-bold text-white">
                ${totalStats.tvl.toLocaleString()}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-400 mb-1">24h Volume</p>
              <p className="text-lg font-bold text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text">
                ${totalStats.volume24h.toLocaleString()}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-400 mb-1">Your Liquidity</p>
              <p className="text-lg font-bold text-transparent bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text">
                ${totalStats.userLiquidity.toLocaleString()}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-slate-400 mb-1">Your Earnings</p>
              <p className="text-lg font-bold text-transparent bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text">
                ${totalStats.userEarnings.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Reinvestment Info Banner */}
      <GlassCard className="p-4 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border-purple-400/30">
        <div className="flex items-center gap-3">
          <div className="text-3xl">⚡</div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white mb-1">
              Auto-Compound: {reinvestmentRate}% Reinvestment Active
            </h3>
            <p className="text-xs text-slate-300">
              Protocol fees are automatically reinvested into LP pools to deepen liquidity.
              {100 - reinvestmentRate}% allocated to treasury for ecosystem growth.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* LP Pools */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-white">Active Liquidity Pools</h3>
        
        {pools.map((pool) => (
          <GlassCard key={pool.id} className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h4 className="text-xl font-bold text-white">{pool.name}</h4>
                  <div className="px-3 py-1 rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-400/30">
                    <p className="text-sm font-bold text-green-300">{pool.apy}% APY</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-slate-400">TVL</p>
                    <p className="text-white font-semibold">
                      ${pool.tvl.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">24h Volume</p>
                    <p className="text-white font-semibold">
                      ${pool.volume24h.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Your Liquidity</p>
                    <p className="text-white font-semibold">
                      ${pool.userLiquidity.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Your Earnings</p>
                    <p className="text-transparent bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text font-semibold">
                      ${pool.userEarnings.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <NeonButton
                label="Add Liquidity"
                variant="primary"
                onClick={() => setSelectedPool(pool.id)}
                className="flex-1"
              />
              {pool.userEarnings > 0 && (
                <NeonButton
                  label={isClaiming ? 'Claiming...' : 'Claim Rewards'}
                  variant="secondary"
                  disabled={isClaiming}
                  onClick={() => handleClaimRewards(pool.id)}
                  className="flex-1"
                />
              )}
            </div>

            {/* Deposit Form */}
            {selectedPool === pool.id && (
              <div className="pt-4 border-t border-white/10 space-y-3">
                <div>
                  <label htmlFor={`amount-${pool.id}`} className="block text-sm text-slate-300 mb-2">
                    Amount to Deposit (USDC)
                  </label>
                  <input
                    id={`amount-${pool.id}`}
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white text-lg focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div className="flex gap-3">
                  <NeonButton
                    label={isDepositing ? 'Depositing...' : 'Confirm Deposit'}
                    variant="primary"
                    disabled={isDepositing || !depositAmount}
                    onClick={handleDeposit}
                    className="flex-1"
                  />
                  <NeonButton
                    label="Cancel"
                    variant="secondary"
                    onClick={() => {
                      setSelectedPool(null)
                      setDepositAmount('')
                    }}
                    className="flex-1"
                  />
                </div>
              </div>
            )}
          </GlassCard>
        ))}
      </div>

      {/* Rebalance History */}
      <GlassCard className="p-6 space-y-4">
        <h3 className="text-lg font-bold text-white">Recent Flywheel Activity</h3>
        
        {rebalanceHistory.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">
            No recent activity
          </p>
        ) : (
          <div className="space-y-3">
            {rebalanceHistory.map((record, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10"
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white mb-1">
                    {record.pool}
                  </p>
                  <p className="text-xs text-slate-300">{record.action}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-purple-400">
                    ${record.amount.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatTimeAgo(record.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Info Section */}
      <GlassCard className="p-6 space-y-3">
        <h3 className="text-lg font-bold text-white">How the LP Flywheel Works</h3>
        <div className="space-y-2 text-sm text-slate-300">
          <p className="flex items-start gap-2">
            <span className="text-purple-400 font-bold">1.</span>
            <span>
              Protocol collects fees from swaps (0.3% per transaction)
            </span>
          </p>
          <p className="flex items-start gap-2">
            <span className="text-purple-400 font-bold">2.</span>
            <span>
              {reinvestmentRate}% of fees are automatically reinvested back into LP pools
            </span>
          </p>
          <p className="flex items-start gap-2">
            <span className="text-purple-400 font-bold">3.</span>
            <span>
              Deeper liquidity = lower slippage = more volume = more fees
            </span>
          </p>
          <p className="flex items-start gap-2">
            <span className="text-purple-400 font-bold">4.</span>
            <span>
              Remaining {100 - reinvestmentRate}% goes to treasury for ecosystem development
            </span>
          </p>
        </div>
      </GlassCard>
    </div>
  )
}



