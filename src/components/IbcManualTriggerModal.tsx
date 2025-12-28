/**
 * IBC Manual Trigger Modal
 * 
 * UI for manually triggering IBC routing for deposits without recipient address
 */

import { useState } from 'react'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'

interface IbcManualTriggerModalProps {
  isOpen: boolean
  onClose: () => void
  thetaTxHash?: string
}

export default function IbcManualTriggerModal({
  isOpen,
  onClose,
  thetaTxHash: initialTxHash = '',
}: IbcManualTriggerModalProps) {
  const [thetaTxHash, setThetaTxHash] = useState(initialTxHash)
  const [recipientAddress, setRecipientAddress] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  if (!isOpen) return null

  const handleSubmit = async () => {
    if (!thetaTxHash || !recipientAddress) {
      setResult({
        success: false,
        message: 'Please fill in all fields',
      })
      return
    }

    // Validate recipient address
    if (!recipientAddress.startsWith('persistence1') || recipientAddress.length !== 45) {
      setResult({
        success: false,
        message: 'Invalid Persistence address (must start with persistence1 and be 45 characters)',
      })
      return
    }

    setIsProcessing(true)
    setResult(null)

    try {
      const response = await fetch('/api/ibc/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          thetaTxHash,
          recipientAddress,
          force: false,
        }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setResult({
          success: true,
          message: `Successfully triggered IBC routing! Transaction ID: ${data.transaction.id}`,
        })

        // Clear form after 3 seconds
        setTimeout(() => {
          setThetaTxHash('')
          setRecipientAddress('')
          setResult(null)
        }, 3000)
      } else {
        setResult({
          success: false,
          message: data.message || data.error || 'Failed to trigger routing',
        })
      }
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Network error',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl">
        <GlassCard className="relative border-2 border-cyan-400/70 bg-gradient-to-br from-[rgba(6,182,212,0.25)] via-[rgba(168,85,247,0.20)] to-[rgba(15,23,42,0.40)] shadow-[0_0_60px_rgba(6,182,212,0.7),inset_0_0_30px_rgba(6,182,212,0.2)]">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-2 rounded-lg border border-slate-500/30 bg-slate-900/50 text-slate-400 hover:text-white hover:border-red-400/50 hover:bg-red-500/10 transition-all"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="space-y-6 p-6">
            {/* Header */}
            <div>
              <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 mb-2">
                🔧 Manual IBC Trigger
              </h2>
              <p className="text-sm text-slate-400">
                Manually trigger IBC routing for a deposit that needs a recipient address
              </p>
            </div>

            {/* Form */}
            <div className="space-y-4">
              {/* Theta TX Hash */}
              <div>
                <label className="block text-xs uppercase tracking-[0.18em] text-slate-400 mb-2">
                  Theta Transaction Hash
                </label>
                <input
                  type="text"
                  value={thetaTxHash}
                  onChange={(e) => setThetaTxHash(e.target.value)}
                  placeholder="0x..."
                  disabled={isProcessing}
                  className="w-full px-4 py-3 bg-slate-900/50 border border-purple-400/30 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/50 transition-all disabled:opacity-50"
                />
              </div>

              {/* Recipient Address */}
              <div>
                <label className="block text-xs uppercase tracking-[0.18em] text-slate-400 mb-2">
                  Recipient Persistence Address
                </label>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  placeholder="persistence1..."
                  disabled={isProcessing}
                  className="w-full px-4 py-3 bg-slate-900/50 border border-purple-400/30 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/50 transition-all disabled:opacity-50"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Must start with "persistence1" and be 45 characters long
                </p>
              </div>
            </div>

            {/* Result Message */}
            {result && (
              <div
                className={`p-4 rounded-lg border-2 ${
                  result.success
                    ? 'bg-emerald-500/10 border-emerald-400/50 text-emerald-300'
                    : 'bg-red-500/10 border-red-400/50 text-red-300'
                }`}
              >
                <p className="text-sm font-semibold">
                  {result.success ? '✅ Success' : '❌ Error'}
                </p>
                <p className="text-sm mt-1">{result.message}</p>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300 mb-2">
                ⚠️ How this works
              </p>
              <ul className="text-sm text-slate-300 space-y-1">
                <li>1. User deposits TFUEL to the receive address</li>
                <li>2. If no recipient address in memo, deposit requires manual trigger</li>
                <li>3. Enter the Theta transaction hash and recipient Persistence address</li>
                <li>4. Click "Trigger IBC Routing" to start the flow</li>
                <li>5. Monitor status via the transaction hash</li>
              </ul>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <NeonButton
                label={isProcessing ? 'Processing...' : 'Trigger IBC Routing'}
                rightHint="channel-190"
                onClick={handleSubmit}
                disabled={isProcessing || !thetaTxHash || !recipientAddress}
                className="flex-1"
              />
              <button
                onClick={onClose}
                disabled={isProcessing}
                className="px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-xl border-2 border-slate-500/60 bg-slate-800/40 text-slate-300 transition-all hover:border-slate-400 hover:bg-slate-700/40 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

