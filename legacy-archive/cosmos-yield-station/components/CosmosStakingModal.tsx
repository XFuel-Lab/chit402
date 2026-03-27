import React, { useState, useEffect } from 'react'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import { LST_TOKENS, type LSTTokenType, formatBalance, getTokenBalance, STRIDE_CHAIN_INFO } from '../utils/keplr'

interface CosmosStakingModalProps {
  isOpen: boolean
  onClose: () => void
  keplrAddress: string | null
  chainId: string
  onStakeSuccess: (txHash: string, lstType: LSTTokenType, amount: string) => void
}

type StakingStep = 'select' | 'confirm' | 'signing' | 'success' | 'error'

export default function CosmosStakingModal({
  isOpen,
  onClose,
  keplrAddress,
  chainId,
  onStakeSuccess,
}: CosmosStakingModalProps) {
  const [step, setStep] = useState<StakingStep>('select')
  const [selectedLST, setSelectedLST] = useState<LSTTokenType | null>(null)
  const [amount, setAmount] = useState('')
  const [availableBalance, setAvailableBalance] = useState<string>('0')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch available balance when LST is selected
  useEffect(() => {
    if (selectedLST && keplrAddress && isOpen) {
      const lstConfig = LST_TOKENS[selectedLST]
      getTokenBalance(chainId, keplrAddress, lstConfig.denom, STRIDE_CHAIN_INFO.rest).then((balance) => {
        setAvailableBalance(balance)
      })
    }
  }, [selectedLST, keplrAddress, chainId, isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select')
      setSelectedLST(null)
      setAmount('')
      setAvailableBalance('0')
      setTxHash(null)
      setError(null)
    }
  }, [isOpen])

  const handleLSTSelect = (lstType: LSTTokenType) => {
    setSelectedLST(lstType)
    setError(null)
  }

  const handleAmountChange = (value: string) => {
    // Allow only numbers and decimal point
    const regex = /^\d*\.?\d*$/
    if (regex.test(value)) {
      setAmount(value)
      setError(null)
    }
  }

  const handleMaxClick = () => {
    if (availableBalance && selectedLST) {
      const lstConfig = LST_TOKENS[selectedLST]
      const formatted = formatBalance(availableBalance, lstConfig.decimals)
      setAmount(formatted)
    }
  }

  const handleStake = async () => {
    if (!selectedLST || !amount || parseFloat(amount) <= 0) {
      setError('Please select an LST and enter an amount')
      return
    }

    if (!keplrAddress) {
      setError('Keplr wallet not connected')
      return
    }

    const lstConfig = LST_TOKENS[selectedLST]
    const amountInSmallestUnit = (parseFloat(amount) * 10 ** lstConfig.decimals).toString()

    // Check if user has enough balance
    const balance = parseFloat(formatBalance(availableBalance, lstConfig.decimals))
    if (parseFloat(amount) > balance) {
      setError('Insufficient balance')
      return
    }

    setStep('confirm')
  }

  const handleConfirm = async () => {
    if (!selectedLST || !amount || !keplrAddress) return

    setStep('signing')
    setError(null)

    try {
      const lstConfig = LST_TOKENS[selectedLST]
      
      // Convert amount from display format to smallest unit (e.g., 1.5 stkATOM -> 1500000 stuatom)
      const amountFloat = parseFloat(amount)
      if (isNaN(amountFloat) || amountFloat <= 0) {
        throw new Error('Invalid amount')
      }
      
      // Multiply by 10^decimals and convert to integer string
      const amountInSmallestUnit = Math.floor(amountFloat * 10 ** lstConfig.decimals).toString()

      // Import the stake function and execute real transaction
      const { stakeLST } = await import('../utils/keplr')
      const result = await stakeLST(chainId, amountInSmallestUnit, selectedLST, `Stake ${amount} ${lstConfig.displayDenom} via XFUEL`)

      setTxHash(result.txHash)
      setStep('success')
      onStakeSuccess(result.txHash, selectedLST, amount)
    } catch (err: any) {
      console.error('Staking error:', err)
      // Provide more detailed error messages
      let errorMessage = 'Failed to stake. Please try again.'
      if (err.message) {
        errorMessage = err.message
      } else if (err.toString().includes('insufficient funds')) {
        errorMessage = 'Insufficient balance for transaction fees'
      } else if (err.toString().includes('user rejected')) {
        errorMessage = 'Transaction rejected by user'
      }
      setError(errorMessage)
      setStep('error')
    }
  }

  const formattedBalance = selectedLST
    ? formatBalance(availableBalance, LST_TOKENS[selectedLST].decimals)
    : '0'

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md p-6">
        <GlassCard className="relative">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-white"
            aria-label="Close modal"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <h2 className="mb-6 text-2xl font-bold text-white">Stake Cosmos LST</h2>

          {step === 'select' && (
            <>
              {/* LST Selection */}
              <div className="mb-6">
                <p className="mb-3 text-sm font-semibold text-slate-300">Select Liquid Staking Token</p>
                <div className="grid grid-cols-2 gap-3">
                  {(['stkATOM', 'stkTIA'] as LSTTokenType[]).map((lstType) => {
                    const lstConfig = LST_TOKENS[lstType]
                    const isSelected = selectedLST === lstType
                    return (
                      <button
                        key={lstType}
                        onClick={() => handleLSTSelect(lstType)}
                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                          isSelected
                            ? 'border-purple-400/80 bg-purple-500/20 shadow-[0_0_20px_rgba(168,85,247,0.4)]'
                            : 'border-purple-400/30 bg-black/20 hover:border-purple-400/50'
                        }`}
                      >
                        <p className="text-lg font-bold text-white">{lstConfig.displayDenom}</p>
                        <p className="mt-1 text-xs text-slate-400">{lstConfig.chainName}</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Amount Input */}
              {selectedLST && (
                <div className="mb-6">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-300">Amount</p>
                    <p className="text-xs text-slate-400">
                      Available: <span className="text-emerald-300">{formattedBalance}</span>
                    </p>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => handleAmountChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-2xl border border-purple-400/40 bg-black/30 px-4 py-3 pr-20 text-white placeholder-slate-500 focus:border-purple-400/80 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
                    />
                    <button
                      onClick={handleMaxClick}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl border border-purple-400/40 bg-purple-500/20 px-3 py-1.5 text-xs font-semibold text-purple-300 transition-colors hover:bg-purple-500/30"
                    >
                      MAX
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-4 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <NeonButton label="Cancel" onClick={onClose} variant="secondary" className="flex-1" />
                <NeonButton
                  label="Stake"
                  onClick={handleStake}
                  disabled={!selectedLST || !amount || parseFloat(amount) <= 0}
                  className="flex-1"
                />
              </div>
            </>
          )}

          {step === 'confirm' && selectedLST && (
            <>
              <div className="mb-6 space-y-4">
                <div className="rounded-2xl border border-purple-400/30 bg-black/20 p-4">
                  <p className="mb-2 text-xs text-slate-400">You are staking</p>
                  <p className="text-2xl font-bold text-white">
                    {amount} {LST_TOKENS[selectedLST].displayDenom}
                  </p>
                </div>
                <div className="rounded-2xl border border-purple-400/30 bg-black/20 p-4">
                  <p className="mb-2 text-xs text-slate-400">Network</p>
                  <p className="text-lg font-semibold text-white">{LST_TOKENS[selectedLST].chainName}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <NeonButton
                  label="Back"
                  onClick={() => setStep('select')}
                  variant="secondary"
                  className="flex-1"
                />
                <NeonButton label="Confirm & Sign" onClick={handleConfirm} className="flex-1" />
              </div>
            </>
          )}

          {step === 'signing' && (
            <div className="mb-6 text-center">
              <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-purple-400 border-t-transparent"></div>
              <p className="text-lg font-semibold text-white">Signing transaction...</p>
              <p className="mt-2 text-sm text-slate-400">Please approve in Keplr wallet</p>
            </div>
          )}

          {step === 'success' && txHash && selectedLST && (
            <>
              <div className="mb-6 text-center">
                <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
                  <svg className="h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-2xl font-bold text-white">Staking Successful!</p>
                <p className="mt-2 text-sm text-slate-400">
                  You received {amount} {LST_TOKENS[selectedLST].displayDenom}
                </p>
                <div className="mt-4 rounded-xl border border-purple-400/30 bg-black/20 p-3">
                  <p className="mb-1 text-xs text-slate-400">Transaction Hash</p>
                  <p className="break-all font-mono text-xs text-purple-300">{txHash}</p>
                </div>
              </div>
              <NeonButton label="Close" onClick={onClose} className="w-full" />
            </>
          )}

          {step === 'error' && error && (
            <>
              <div className="mb-6 rounded-xl border border-red-400/40 bg-red-500/10 p-4">
                <p className="text-sm text-red-300">{error}</p>
              </div>
              <div className="flex gap-3">
                <NeonButton label="Back" onClick={() => setStep('select')} variant="secondary" className="flex-1" />
                <NeonButton label="Close" onClick={onClose} className="flex-1" />
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  )
}

