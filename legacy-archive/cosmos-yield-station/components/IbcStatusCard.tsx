/**
 * IBC Transaction Status Card
 * 
 * Displays the status of an IBC routing transaction
 */

import { useState, useEffect } from 'react'
import GlassCard from './GlassCard'

interface IbcTransaction {
  id: string
  thetaTxHash: string
  ibcTxHash?: string
  swapTxHash?: string
  stakeTxHash?: string
  status: string
  statusMessage: string
  errorMessage?: string
  tfuelAmount: string
  xprtAmount?: string
  stkXprtAmount?: string
  recipientAddress: string
  createdAt: number
  completedAt?: number
}

interface IbcStatusCardProps {
  thetaTxHash: string
  autoRefresh?: boolean
  refreshInterval?: number
}

export default function IbcStatusCard({
  thetaTxHash,
  autoRefresh = true,
  refreshInterval = 5000,
}: IbcStatusCardProps) {
  const [transaction, setTransaction] = useState<IbcTransaction | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/ibc/status/${thetaTxHash}`)
      const data = await response.json()

      if (response.ok && data.found) {
        setTransaction(data.transaction)
        setError(null)
      } else {
        setError(data.message || 'Transaction not found')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()

    if (autoRefresh) {
      const interval = setInterval(fetchStatus, refreshInterval)
      return () => clearInterval(interval)
    }
  }, [thetaTxHash, autoRefresh, refreshInterval])

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
          <span className="ml-3 text-slate-400">Loading transaction status...</span>
        </div>
      </GlassCard>
    )
  }

  if (error) {
    return (
      <GlassCard className="p-6 border-2 border-red-400/50">
        <div className="text-center py-8">
          <p className="text-red-400 font-semibold mb-2">❌ {error}</p>
          <button
            onClick={fetchStatus}
            className="text-sm text-cyan-400 hover:text-cyan-300 underline"
          >
            Try again
          </button>
        </div>
      </GlassCard>
    )
  }

  if (!transaction) return null

  const statusSteps = [
    { key: 'pending', label: 'Pending', icon: '⏳' },
    { key: 'confirmed', label: 'Confirmed', icon: '✅' },
    { key: 'ibc_transfer', label: 'IBC Transfer', icon: '📡' },
    { key: 'ibc_complete', label: 'IBC Complete', icon: '✅' },
    { key: 'swapping', label: 'DEX Swap', icon: '💱' },
    { key: 'swap_complete', label: 'Swap Complete', icon: '✅' },
    { key: 'staking', label: 'Staking', icon: '🔒' },
    { key: 'complete', label: 'Complete', icon: '🎉' },
  ]

  const currentStepIndex = statusSteps.findIndex((s) => s.key === transaction.status)
  const isComplete = transaction.status === 'complete'
  const isFailed = transaction.status === 'failed'

  return (
    <GlassCard className="p-6 border-2 border-cyan-400/50">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold text-cyan-300">IBC Routing Status</h3>
          <span
            className={`px-3 py-1 text-xs font-bold uppercase rounded-full ${
              isComplete
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50'
                : isFailed
                ? 'bg-red-500/20 text-red-300 border border-red-400/50'
                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 animate-pulse'
            }`}
          >
            {transaction.status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-sm text-slate-400">{transaction.statusMessage}</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-6">
        <div className="relative">
          {/* Progress Bar */}
          <div className="absolute top-5 left-0 w-full h-0.5 bg-slate-700">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-purple-400 transition-all duration-500"
              style={{
                width: `${((currentStepIndex + 1) / statusSteps.length) * 100}%`,
              }}
            />
          </div>

          {/* Steps */}
          <div className="relative flex justify-between">
            {statusSteps.map((step, index) => {
              const isActive = index <= currentStepIndex
              const isCurrent = step.key === transaction.status

              return (
                <div key={step.key} className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                      isActive
                        ? 'bg-gradient-to-br from-cyan-500/30 to-purple-500/30 border-cyan-400 text-cyan-300'
                        : 'bg-slate-800 border-slate-600 text-slate-500'
                    } ${isCurrent ? 'animate-pulse scale-110' : ''}`}
                  >
                    {step.icon}
                  </div>
                  <span
                    className={`text-xs mt-2 ${
                      isActive ? 'text-cyan-300' : 'text-slate-500'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Transaction Details */}
      <div className="space-y-3">
        {/* Theta TX */}
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Theta TX:</span>
          <a
            href={`https://explorer.thetatoken.org/tx/${transaction.thetaTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 font-mono"
          >
            {transaction.thetaTxHash.slice(0, 10)}...{transaction.thetaTxHash.slice(-8)}
          </a>
        </div>

        {/* IBC TX */}
        {transaction.ibcTxHash && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">IBC TX:</span>
            <a
              href={`https://www.mintscan.io/persistence/tx/${transaction.ibcTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 font-mono"
            >
              {transaction.ibcTxHash.slice(0, 10)}...{transaction.ibcTxHash.slice(-8)}
            </a>
          </div>
        )}

        {/* Swap TX */}
        {transaction.swapTxHash && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Swap TX:</span>
            <a
              href={`https://www.mintscan.io/persistence/tx/${transaction.swapTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 font-mono"
            >
              {transaction.swapTxHash.slice(0, 10)}...{transaction.swapTxHash.slice(-8)}
            </a>
          </div>
        )}

        {/* Stake TX */}
        {transaction.stakeTxHash && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Stake TX:</span>
            <a
              href={`https://www.mintscan.io/persistence/tx/${transaction.stakeTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 font-mono"
            >
              {transaction.stakeTxHash.slice(0, 10)}...{transaction.stakeTxHash.slice(-8)}
            </a>
          </div>
        )}

        {/* Amounts */}
        <div className="pt-3 border-t border-slate-700">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-400">Input:</span>
            <span className="text-white font-semibold">
              {(parseInt(transaction.tfuelAmount) / 1e18).toFixed(4)} TFUEL
            </span>
          </div>
          {transaction.xprtAmount && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-400">Swapped:</span>
              <span className="text-white font-semibold">
                {(parseInt(transaction.xprtAmount) / 1e6).toFixed(4)} XPRT
              </span>
            </div>
          )}
          {transaction.stkXprtAmount && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Output:</span>
              <span className="text-emerald-300 font-bold">
                {(parseInt(transaction.stkXprtAmount) / 1e6).toFixed(4)} stkXPRT
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {transaction.errorMessage && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-400/50 rounded-lg">
          <p className="text-sm text-red-300">
            <strong>Error:</strong> {transaction.errorMessage}
          </p>
        </div>
      )}

      {/* Refresh Indicator */}
      {autoRefresh && !isComplete && !isFailed && (
        <div className="mt-4 text-center text-xs text-slate-500">
          Auto-refreshing every {refreshInterval / 1000}s...
        </div>
      )}
    </GlassCard>
  )
}

