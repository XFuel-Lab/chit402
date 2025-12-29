import { useState, useMemo, useEffect } from 'react'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import QRDepositModal from './QRDepositModal'
import { usePriceStore } from '../stores/priceStore'
import { ROUTER_ADDRESS } from '../config/thetaConfig'

interface SimpleSwapCardProps {
  onSwapComplete?: () => void
}

export default function SimpleSwapCard({ onSwapComplete }: SimpleSwapCardProps) {
  const [tfuelAmount, setTfuelAmount] = useState('')
  const [showQRModal, setShowQRModal] = useState(false)
  const [selectedOutputToken, setSelectedOutputToken] = useState<'stkXPRT' | 'stkTIA' | 'stkATOM'>('stkXPRT')
  
  const { prices, pricesLoading } = usePriceStore()

  // Get prices for calculation
  const tfuelPrice = useMemo(() => prices?.TFUEL?.price ?? null, [prices])
  const outputPrice = useMemo(() => {
    switch (selectedOutputToken) {
      case 'stkTIA':
        return prices?.stkTIA?.price ?? null
      case 'stkATOM':
        return prices?.stkATOM?.price ?? null
      case 'stkXPRT':
      default:
        return prices?.stkXPRT?.price ?? null
    }
  }, [prices, selectedOutputToken])

  // Calculate estimated output with 0.3% fee + slippage
  const estimatedOutput = useMemo(() => {
    const amount = parseFloat(tfuelAmount)
    if (!amount || amount <= 0 || !tfuelPrice || !outputPrice) {
      return null
    }

    // Calculate: inputAmount * inputPrice / outputPrice * (1 - fee - slippage)
    const tfuelValueUSD = amount * tfuelPrice
    const feePercent = 0.003 // 0.3% protocol fee
    const slippagePercent = 0.005 // 0.5% estimated slippage
    const totalDeduction = feePercent + slippagePercent
    
    const netValueUSD = tfuelValueUSD * (1 - totalDeduction)
    const outputAmount = netValueUSD / outputPrice

    return outputAmount > 0 ? outputAmount : 0
  }, [tfuelAmount, tfuelPrice, outputPrice])

  // Calculate USD values
  const tfuelValueUSD = useMemo(() => {
    const amount = parseFloat(tfuelAmount)
    if (!amount || !tfuelPrice) return null
    return amount * tfuelPrice
  }, [tfuelAmount, tfuelPrice])

  const estimatedValueUSD = useMemo(() => {
    if (!estimatedOutput || !outputPrice) return null
    return estimatedOutput * outputPrice
  }, [estimatedOutput, outputPrice])

  // Amount with fee for QR modal (user needs to send slightly more)
  const amountWithFee = useMemo(() => {
    const amount = parseFloat(tfuelAmount)
    if (!amount) return '0'
    return (amount * 1.003).toFixed(6) // Add 0.3% fee
  }, [tfuelAmount])

  const handleSwapClick = () => {
    const amount = parseFloat(tfuelAmount)
    if (!amount || amount <= 0) return
    setShowQRModal(true)
  }

  const isValidAmount = useMemo(() => {
    const amount = parseFloat(tfuelAmount)
    return amount > 0 && !isNaN(amount)
  }, [tfuelAmount])

  return (
    <>
      <GlassCard className="max-w-2xl mx-auto">
        <div className="space-y-6 p-6">
          {/* Header */}
          <div className="text-center">
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 mb-2">
              Swap TFUEL
            </h2>
            <p className="text-sm text-slate-400">
              No wallet connect • Instant swap via QR
            </p>
          </div>

          {/* Input Section */}
          <div className="space-y-3">
            <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Send TFUEL
            </label>
            
            {/* Amount Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="0.00"
                value={tfuelAmount}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '')
                  // Prevent multiple decimals
                  if ((value.match(/\./g) || []).length <= 1) {
                    setTfuelAmount(value)
                  }
                }}
                className="w-full p-6 text-4xl font-bold bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 border-2 border-purple-400/30 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-cyan-400/60 focus:shadow-[0_0_30px_rgba(56,189,248,0.4)] transition-all"
              />
              <div className="absolute right-6 top-1/2 -translate-y-1/2">
                <span className="text-2xl font-bold text-slate-400">TFUEL</span>
              </div>
            </div>

            {/* USD Value */}
            {tfuelValueUSD !== null && (
              <div className="text-right text-sm text-slate-400">
                ≈ ${tfuelValueUSD.toFixed(2)} USD
                {pricesLoading && (
                  <span className="ml-2 text-xs text-cyan-400 animate-pulse">updating...</span>
                )}
              </div>
            )}
          </div>

          {/* Swap Arrow */}
          <div className="flex justify-center">
            <div className="p-3 rounded-full bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-cyan-500/20 border border-purple-400/50">
              <svg
                className="w-6 h-6 text-cyan-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            </div>
          </div>

          {/* Output Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                Est. Receive
              </label>
              
              {/* Token Selector */}
              <div className="flex gap-2">
                {(['stkXPRT', 'stkTIA', 'stkATOM'] as const).map((token) => (
                  <button
                    key={token}
                    onClick={() => setSelectedOutputToken(token)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                      selectedOutputToken === token
                        ? 'bg-gradient-to-r from-cyan-500/30 to-purple-500/30 border-2 border-cyan-400/60 text-cyan-300 shadow-[0_0_20px_rgba(6,182,212,0.5)]'
                        : 'bg-slate-800/50 border border-slate-600/30 text-slate-400 hover:border-slate-500/50 hover:text-slate-300'
                    }`}
                  >
                    {token}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Estimated Output */}
            <div className="relative p-6 bg-gradient-to-br from-cyan-900/20 via-purple-900/20 to-slate-900/40 border-2 border-cyan-400/40 rounded-2xl shadow-[0_0_30px_rgba(6,182,212,0.3),inset_0_0_20px_rgba(6,182,212,0.1)]">
              {estimatedOutput === null ? (
                <div className="text-3xl font-bold text-slate-500 text-center">
                  Enter amount
                </div>
              ) : (
                <>
                  <div className="flex items-baseline justify-center gap-3">
                    <span className="text-4xl font-bold text-cyan-300 drop-shadow-[0_0_20px_rgba(6,182,212,1)]">
                      ~{estimatedOutput.toFixed(4)}
                    </span>
                    <span className="text-2xl font-bold text-white">{selectedOutputToken}</span>
                  </div>
                  {estimatedValueUSD !== null && (
                    <div className="text-center text-sm text-slate-400 mt-2">
                      ≈ ${estimatedValueUSD.toFixed(2)} USD
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Fee Breakdown */}
            {isValidAmount && estimatedOutput !== null && (
              <div className="p-4 rounded-xl bg-slate-800/50 border border-purple-400/20 space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Protocol Fee</span>
                  <span className="text-white font-semibold">0.3%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Est. Slippage</span>
                  <span className="text-white font-semibold">~0.5%</span>
                </div>
                <div className="pt-2 border-t border-slate-700/50 flex justify-between items-center">
                  <span className="text-emerald-400 font-semibold">You Pay (incl. fee)</span>
                  <span className="text-emerald-300 font-bold">{amountWithFee} TFUEL</span>
                </div>
              </div>
            )}
          </div>

          {/* Swap Button */}
          <div className="pt-4">
            <NeonButton
              label="Swap & Stake"
              rightHint="QR"
              onClick={handleSwapClick}
              disabled={!isValidAmount || !estimatedOutput}
              className="w-full text-lg py-4"
            />
          </div>

          {/* Info Note */}
          <div className="bg-purple-500/10 border border-purple-400/30 rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-purple-300 mb-2 flex items-center gap-2">
              <span className="text-lg">✨</span>
              How it works
            </p>
            <ul className="text-sm text-slate-300 space-y-1">
              <li>• Click "Swap & Stake" to get QR code</li>
              <li>• Send TFUEL from Theta Wallet app</li>
              <li>• Backend listener processes automatically</li>
              <li>• Receive stkXPRT in ~1-2 minutes</li>
            </ul>
          </div>

          {/* Cyberpunk Accent */}
          <div className="flex items-center justify-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-500/20 via-cyan-500/20 to-purple-500/20 border border-cyan-400/30">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(6,182,212,1)]" />
              <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider">
                Live
              </span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
          </div>
        </div>
      </GlassCard>

      {/* QR Modal */}
      {ROUTER_ADDRESS && (
        <QRDepositModal
          isOpen={showQRModal}
          onClose={() => setShowQRModal(false)}
          depositAddress={ROUTER_ADDRESS}
          amount={tfuelAmount}
          network="Theta Mainnet"
          memo={`Swap ${tfuelAmount} TFUEL → ${selectedOutputToken}`}
        />
      )}
    </>
  )
}

