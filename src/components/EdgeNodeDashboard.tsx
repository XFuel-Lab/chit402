import React, { useEffect, useState } from 'react'
import { fetchEdgeCloudStats, fetchPersonalEarnings, type EdgeCloudStats, type PersonalEarnings } from '../utils/thetaEdgeCloud'
import NeonButton from './NeonButton'

interface EdgeNodeDashboardProps {
  walletAddress: string | null
  walletBalance: string
  onPumpEarnings: () => void
}

/**
 * Edge Node Mining Dashboard
 * Displays live Theta EdgeCloud network stats and personal earnings
 * Features glassmorphism cards with cyberpunk neon styling
 */
export default function EdgeNodeDashboard({ walletAddress, walletBalance, onPumpEarnings }: EdgeNodeDashboardProps) {
  const [networkStats, setNetworkStats] = useState<EdgeCloudStats>({
    activeNodes: 0,
    totalCompute: '0',
    currentAIJobs: 0,
  })
  const [personalEarnings, setPersonalEarnings] = useState<PersonalEarnings | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())

  // Fetch network stats on mount and periodically
  useEffect(() => {
    const loadStats = async () => {
      try {
        const stats = await fetchEdgeCloudStats()
        setNetworkStats(stats)
        setLastUpdate(new Date())
        setLoading(false)
      } catch (error) {
        console.error('Failed to load EdgeCloud stats:', error)
        setLoading(false)
      }
    }

    loadStats()
    const interval = setInterval(loadStats, 30000) // Refresh every 30 seconds

    return () => clearInterval(interval)
  }, [])

  // Fetch personal earnings if wallet is connected
  useEffect(() => {
    const loadEarnings = async () => {
      if (!walletAddress) {
        setPersonalEarnings(null)
        return
      }

      try {
        const earnings = await fetchPersonalEarnings(walletAddress)
        setPersonalEarnings(earnings)
      } catch (error) {
        console.error('Failed to load personal earnings:', error)
      }
    }

    loadEarnings()
    const interval = setInterval(loadEarnings, 60000) // Refresh every minute

    return () => clearInterval(interval)
  }, [walletAddress])

  const handleRunEdgeNode = () => {
    window.open('https://docs.thetatoken.org/docs/setup-theta-edge-node', '_blank')
  }

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">Edge Node Mining</p>
        <h2 className="mt-1 text-2xl font-bold text-white">Theta EdgeCloud Dashboard</h2>
        <p className="mt-2 text-sm text-slate-300/80">
          Live network stats and your earnings from Theta EdgeCloud GPU compute
        </p>
      </div>

      {/* Live Network Stats - Cyberpunk Neon Cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.15em] text-purple-300/80">Network Statistics</p>
          {!loading && (
            <p className="text-[10px] text-slate-400">Updated {formatTimeAgo(lastUpdate)}</p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Active Nodes Card */}
          <div className="group relative overflow-hidden rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-cyan-500/20 via-purple-500/15 to-pink-500/20 backdrop-blur-xl shadow-[0_0_30px_rgba(6,182,212,0.4)] transition-all duration-300 hover:border-cyan-400/60 hover:shadow-[0_0_40px_rgba(6,182,212,0.6)]">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-400/10 via-transparent to-purple-400/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="relative px-4 py-4">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-300/70">Active Nodes</p>
              <p className="mt-2 text-2xl font-bold text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]">
                {loading ? (
                  <span className="inline-block h-7 w-16 animate-pulse rounded bg-cyan-400/30" />
                ) : (
                  networkStats.activeNodes.toLocaleString()
                )}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">Global Edge Nodes</p>
            </div>
          </div>

          {/* Total Compute Card */}
          <div className="group relative overflow-hidden rounded-2xl border border-purple-400/40 bg-gradient-to-br from-purple-500/20 via-pink-500/15 to-cyan-500/20 backdrop-blur-xl shadow-[0_0_30px_rgba(168,85,247,0.4)] transition-all duration-300 hover:border-purple-400/60 hover:shadow-[0_0_40px_rgba(168,85,247,0.6)]">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-400/10 via-transparent to-pink-400/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="relative px-4 py-4">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-300/70">Total Compute</p>
              <p className="mt-2 text-2xl font-bold text-purple-300 drop-shadow-[0_0_8px_rgba(168,85,247,0.8)]">
                {loading ? (
                  <span className="inline-block h-7 w-24 animate-pulse rounded bg-purple-400/30" />
                ) : (
                  networkStats.totalCompute
                )}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">GPU Power</p>
            </div>
          </div>

          {/* Current AI Jobs Card */}
          <div className="group relative overflow-hidden rounded-2xl border border-pink-400/40 bg-gradient-to-br from-pink-500/20 via-purple-500/15 to-cyan-500/20 backdrop-blur-xl shadow-[0_0_30px_rgba(236,72,153,0.4)] transition-all duration-300 hover:border-pink-400/60 hover:shadow-[0_0_40px_rgba(236,72,153,0.6)]">
            <div className="absolute inset-0 bg-gradient-to-br from-pink-400/10 via-transparent to-purple-400/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="relative px-4 py-4">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-300/70">AI Jobs</p>
              <p className="mt-2 text-2xl font-bold text-pink-300 drop-shadow-[0_0_8px_rgba(236,72,153,0.8)]">
                {loading ? (
                  <span className="inline-block h-7 w-16 animate-pulse rounded bg-pink-400/30" />
                ) : (
                  networkStats.currentAIJobs
                )}
              </p>
              <p className="mt-1 text-[10px] text-slate-400">Active Tasks</p>
            </div>
          </div>
        </div>
      </div>

      {/* Personal Earnings Section - Only show if wallet connected */}
      {walletAddress && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.15em] text-emerald-300/80">Your Earnings</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* TFUEL Rewards Card */}
            <div className="group relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500/20 via-cyan-500/15 to-green-500/20 backdrop-blur-xl shadow-[0_0_30px_rgba(16,185,129,0.4)] transition-all duration-300 hover:border-emerald-400/60 hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/10 via-transparent to-cyan-400/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative px-4 py-4">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-300/70">TFUEL Rewards</p>
                <p className="mt-2 text-2xl font-bold text-emerald-300 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]">
                  {personalEarnings?.tfuelRewards || '0.00'}
                </p>
                <p className="mt-1 text-[10px] text-slate-400">Total Earned</p>
              </div>
            </div>

            {/* Pending Rewards Card */}
            <div className="group relative overflow-hidden rounded-2xl border border-yellow-400/40 bg-gradient-to-br from-yellow-500/20 via-orange-500/15 to-amber-500/20 backdrop-blur-xl shadow-[0_0_30px_rgba(234,179,8,0.4)] transition-all duration-300 hover:border-yellow-400/60 hover:shadow-[0_0_40px_rgba(234,179,8,0.6)]">
              <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/10 via-transparent to-orange-400/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative px-4 py-4">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-300/70">Pending</p>
                <p className="mt-2 text-2xl font-bold text-yellow-300 drop-shadow-[0_0_8px_rgba(234,179,8,0.8)]">
                  {personalEarnings?.pendingRewards || '0.00'}
                </p>
                <p className="mt-1 text-[10px] text-slate-400">Awaiting Distribution</p>
              </div>
            </div>

            {/* TDROP Boost Card */}
            <div className="group relative overflow-hidden rounded-2xl border border-blue-400/40 bg-gradient-to-br from-blue-500/20 via-indigo-500/15 to-purple-500/20 backdrop-blur-xl shadow-[0_0_30px_rgba(59,130,246,0.4)] transition-all duration-300 hover:border-blue-400/60 hover:shadow-[0_0_40px_rgba(59,130,246,0.6)]">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-transparent to-indigo-400/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative px-4 py-4">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-300/70">TDROP Boost</p>
                <p className="mt-2 text-2xl font-bold text-blue-300 drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]">
                  {personalEarnings?.tdropBoost ? `+${personalEarnings.tdropBoost}%` : '0%'}
                </p>
                <p className="mt-1 text-[10px] text-slate-400">Earnings Multiplier</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Run Edge Node Button */}
        <NeonButton
          label="Run Edge Node"
          rightHint="Setup Guide"
          onClick={handleRunEdgeNode}
          className="w-full"
        />

        {/* Pump My Earnings Button - Only show if wallet connected */}
        {walletAddress && (
          <NeonButton
            label="Pump My Earnings"
            rightHint={walletBalance ? `${walletBalance} TFUEL` : 'Connect'}
            onClick={onPumpEarnings}
            className="w-full"
          />
        )}
      </div>

      {/* Info Text */}
      <p className="text-[11px] text-slate-400">
        Connect your Theta Edge Node to start earning TFUEL rewards. All rewards are automatically routed through XFUEL for instant Cosmos LST yield.
      </p>
    </div>
  )
}

