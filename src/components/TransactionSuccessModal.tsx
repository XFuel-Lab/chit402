import { useState } from 'react'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'

interface TransactionSuccessModalProps {
  isOpen: boolean
  onClose: () => void
  txHash: string
  lstSymbol: string
  amount: number
  apy: number
  chain: 'theta' | 'cosmos'
}

export default function TransactionSuccessModal({
  isOpen,
  onClose,
  txHash,
  lstSymbol,
  amount,
  apy,
  chain,
}: TransactionSuccessModalProps) {
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const explorerUrl = chain === 'theta' 
    ? `https://explorer.thetatoken.org/tx/${txHash}`
    : `https://www.mintscan.io/stride/txs/${txHash}`

  const handleCopyHash = async () => {
    try {
      await navigator.clipboard.writeText(txHash)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const shortHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-md animate-scaleIn">
        <GlassCard className="relative overflow-hidden border-2 border-emerald-400/50">
          {/* Animated background glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-purple-500/20 animate-pulse" />
          <div className="absolute -inset-1 bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-400 opacity-20 blur-2xl" />

          {/* Content */}
          <div className="relative space-y-6 p-6">
            {/* Success Icon */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 animate-ping">
                  <div className="h-20 w-20 rounded-full bg-emerald-400/30" />
                </div>
                <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/30 to-cyan-400/30 shadow-[0_0_40px_rgba(16,185,129,0.6)]">
                  <span className="text-5xl">✅</span>
                </div>
              </div>
            </div>

            {/* Title */}
            <div className="text-center">
              <h2
                className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-emerald-300"
                style={{
                  textShadow: '0 0 30px rgba(16, 185, 129, 0.8), 0 0 60px rgba(16, 185, 129, 0.4)',
                }}
              >
                Swap Successful!
              </h2>
            </div>

            {/* Amount Info */}
            <div className="rounded-xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent p-4 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
              <div className="text-center">
                <p className="text-sm text-slate-400 uppercase tracking-wider mb-2">
                  Received
                </p>
                <p className="text-3xl font-bold text-emerald-300 drop-shadow-[0_0_15px_rgba(16,185,129,0.8)] mb-1">
                  ~{amount.toFixed(4)} {lstSymbol}
                </p>
                <p className="text-xs text-cyan-300">
                  Earning {apy.toFixed(1)}% APY
                </p>
              </div>
            </div>

            {/* Transaction Hash */}
            <div className="space-y-2">
              <label className="text-xs text-slate-400 uppercase tracking-wider">
                Transaction Hash
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg border border-purple-400/40 bg-slate-900/50 px-3 py-2 font-mono text-sm text-purple-300">
                  {shortHash}
                </div>
                <button
                  onClick={handleCopyHash}
                  className="flex items-center gap-1 rounded-lg border border-cyan-400/50 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-cyan-300 transition-all hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-200 hover:shadow-[0_0_15px_rgba(6,182,212,0.6)]"
                  title="Copy transaction hash"
                >
                  {copied ? (
                    <>
                      <span>✓</span>
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <span>📋</span>
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
              {/* View on Explorer */}
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative overflow-hidden rounded-xl border-2 border-purple-400/50 bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-cyan-500/20 px-6 py-3 text-center font-semibold uppercase tracking-wider text-purple-200 transition-all hover:border-purple-400 hover:shadow-[0_0_30px_rgba(168,85,247,0.8)] active:scale-95"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-400/0 via-purple-400/30 to-purple-400/0 opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="relative flex items-center justify-center gap-2">
                  <span>🔍</span>
                  <span>View on Explorer</span>
                  <span className="text-xs">↗</span>
                </div>
              </a>

              {/* Close Button */}
              <NeonButton
                onClick={onClose}
                variant="secondary"
                className="w-full"
              >
                Close
              </NeonButton>
            </div>

            {/* Additional Info */}
            <div className="text-center text-xs text-slate-500">
              <p>Your {lstSymbol} tokens are now {chain === 'theta' ? 'staked' : 'in your Keplr wallet'}</p>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

