import { useState, useMemo, useEffect } from 'react'
import { ethers } from 'ethers'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import { ROUTER_ADDRESS, ROUTER_ABI } from '../config/thetaConfig'
import { usePriceStore } from '../stores/priceStore'
import type { LSTOption } from './YieldBubbleSelector'

interface YieldPumpCardProps {
  wallet: {
    address: string | null
    fullAddress: string | null
    balance: string
    isConnected: boolean
  }
  lstOptions: LSTOption[]
  onConnectWallet: () => Promise<void>
}

export default function YieldPumpCard({
  wallet,
  lstOptions,
  onConnectWallet,
}: YieldPumpCardProps) {
  const [inputAmount, setInputAmount] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)

  const { prices, apys } = usePriceStore()

  // Auto-select highest APY LST
  const bestYieldLST = useMemo(() => {
    const sorted = [...lstOptions].sort((a, b) => {
      const apyA = apys[a.name]?.apy ?? a.apy
      const apyB = apys[b.name]?.apy ?? b.apy
      return apyB - apyA
    })
    return sorted[0]
  }, [lstOptions, apys])

  const currentApy = useMemo(() => {
    const fromOracle = apys[bestYieldLST.name]?.apy
    return (fromOracle && fromOracle > 0) ? fromOracle : bestYieldLST.apy
  }, [bestYieldLST.name, bestYieldLST.apy, apys])

  // Calculate output preview
  const estimatedOutput = useMemo(() => {
    const amount = parseFloat(inputAmount)
    if (!amount || amount <= 0) return null

    const tfuelPrice = prices?.TFUEL?.price
    const lstKey = bestYieldLST.name === 'pSTAKE BTC' ? 'pSTAKEBTC' : bestYieldLST.name
    const lstPrice = prices?.[lstKey as keyof typeof prices]?.price

    if (!tfuelPrice || !lstPrice) return null

    // Calculate: TFUEL value in USD / LST price * (1 - 0.3% fee)
    const tfuelUSD = amount * tfuelPrice
    const feeMultiplier = 0.997 // 0.3% fee
    return (tfuelUSD / lstPrice) * feeMultiplier
  }, [inputAmount, prices, bestYieldLST])

  // Calculate daily yield
  const estimatedDailyYield = useMemo(() => {
    if (!estimatedOutput) return 0
    return (estimatedOutput * currentApy) / 100 / 365
  }, [estimatedOutput, currentApy])

  const numericBalance = useMemo(
    () => parseFloat(wallet.balance.replace(/,/g, '')) || 0,
    [wallet.balance]
  )

  const handleMaxClick = () => {
    if (wallet.isConnected && numericBalance > 0) {
      const maxAmount = numericBalance * 0.99 // Leave 1% for gas
      setInputAmount(maxAmount.toFixed(2))
    }
  }

  const handleDeposit = async () => {
    if (!wallet.isConnected || !wallet.fullAddress) {
      await onConnectWallet()
      return
    }

    const amount = parseFloat(inputAmount)
    if (!amount || amount <= 0) {
      setStatusMessage('Please enter a valid amount')
      return
    }

    if (amount > numericBalance) {
      setStatusMessage('Insufficient balance')
      return
    }

    setIsProcessing(true)
    setStatusMessage('Processing deposit...')
    setTxHash(null)

    try {
      const provider = new ethers.BrowserProvider(
        (window as any).theta || (window as any).ethereum
      )
      const signer = await provider.getSigner()
      
      if (!ROUTER_ADDRESS) {
        throw new Error('Router address not configured')
      }

      const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer)
      const amountWei = ethers.parseEther(amount.toString())

      setStatusMessage('Swapping TFUEL to best yield LST...')

      // Call swapAndStake with TFUEL sent as value
      const tx = await router.swapAndStake(
        amountWei,
        bestYieldLST.name,
        0, // minAmountOut (0 for now, should calculate from estimatedOutput)
        {
          value: amountWei,
        }
      )

      setStatusMessage('Transaction submitted, waiting for confirmation...')
      await tx.wait()
      
      setTxHash(tx.hash)
      setStatusMessage(
        `✅ Successfully deposited ${amount} TFUEL to ${bestYieldLST.name}! Earning ${currentApy.toFixed(1)}% APY`
      )
      setInputAmount('')

      // Clear status after delay
      setTimeout(() => {
        setStatusMessage('')
        setTxHash(null)
      }, 8000)
    } catch (error: any) {
      console.error('Deposit error:', error)
      setStatusMessage(`❌ Deposit failed: ${error.message || 'Unknown error'}`)

      setTimeout(() => {
        setStatusMessage('')
      }, 5000)
    } finally {
      setIsProcessing(false)
    }
  }

  const isValidAmount = useMemo(() => {
    if (!inputAmount || inputAmount === '') return true
    const amount = parseFloat(inputAmount)
    if (isNaN(amount) || amount <= 0) return false
    if (wallet.isConnected && numericBalance > 0 && amount > numericBalance) return false
    return true
  }, [inputAmount, wallet.isConnected, numericBalance])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400">
          Pump TFUEL to Best Cosmos Yield
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Auto-selected highest APY • One-tap deposit & stake
        </p>
      </div>

      {/* Wallet Connection */}
      {!wallet.isConnected && (
        <GlassCard>
          <div className="text-center space-y-4">
            <p className="text-sm text-slate-300">
              Connect your Theta Wallet to start earning
            </p>
            <NeonButton
              label="Connect Theta Wallet"
              onClick={onConnectWallet}
              rightHint="connect"
              variant="secondary"
            />
          </div>
        </GlassCard>
      )}

      {/* Best Yield Display */}
      <GlassCard className="border-2 border-emerald-400/60 bg-gradient-to-br from-[rgba(16,185,129,0.25)] via-[rgba(168,85,247,0.20)] to-[rgba(15,23,42,0.35)] shadow-[0_0_50px_rgba(16,185,129,0.6),inset_0_0_25px_rgba(16,185,129,0.15)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">
              Auto-Selected Best Yield
            </p>
            <div className="mt-2 flex items-baseline gap-3">
              <h3 className="text-4xl font-bold text-white drop-shadow-[0_0_20px_rgba(16,185,129,0.8)]">
                {bestYieldLST.name}
              </h3>
              <span className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.6)]">
                Highest APY
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-slate-400">APY</p>
            <p className="mt-2 text-5xl font-bold text-emerald-300 drop-shadow-[0_0_30px_rgba(16,185,129,1),0_0_60px_rgba(16,185,129,0.5)]">
              {currentApy.toFixed(1)}%
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Amount Input */}
      <GlassCard>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wider text-slate-400">
              TFUEL Amount
            </label>
            {wallet.isConnected && (
              <button
                onClick={handleMaxClick}
                className="text-xs text-cyan-300 hover:text-cyan-200 underline transition-colors"
              >
                MAX: {numericBalance.toFixed(2)}
              </button>
            )}
          </div>

          <input
            type="text"
            inputMode="decimal"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            disabled={!wallet.isConnected}
            className={[
              'w-full rounded-2xl border-2 bg-gradient-to-br from-[rgba(168,85,247,0.25)] via-[rgba(56,189,248,0.20)] to-[rgba(15,23,42,0.30)] px-6 py-6 text-4xl font-bold text-white placeholder:text-slate-500/40',
              'focus:outline-none focus:ring-4 focus:ring-purple-400/40 backdrop-blur-xl transition-all',
              isValidAmount
                ? 'border-purple-400/70 hover:border-purple-400 shadow-[0_0_40px_rgba(168,85,247,0.6),inset_0_0_20px_rgba(168,85,247,0.15)]'
                : 'border-rose-400/70 hover:border-rose-400 shadow-[0_0_40px_rgba(244,63,94,0.6),inset_0_0_20px_rgba(244,63,94,0.15)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
            style={{
              textShadow: isValidAmount 
                ? '0 0 20px rgba(168,85,247,0.8)' 
                : '0 0 20px rgba(244,63,94,0.8)',
            }}
          />

          {!isValidAmount && inputAmount && (
            <p className="text-xs text-rose-400">
              {parseFloat(inputAmount) > numericBalance 
                ? 'Amount exceeds balance' 
                : 'Please enter a valid amount'}
            </p>
          )}
        </div>
      </GlassCard>

      {/* Preview */}
      {estimatedOutput && (
        <GlassCard className="border-2 border-cyan-400/60 bg-gradient-to-br from-[rgba(56,189,248,0.25)] via-[rgba(168,85,247,0.20)] to-[rgba(15,23,42,0.35)] shadow-[0_0_50px_rgba(56,189,248,0.6),inset_0_0_25px_rgba(56,189,248,0.15)]">
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-wider text-slate-400">
              You'll Receive
            </p>

            <div className="flex items-baseline gap-3">
              <p className="text-5xl font-bold text-cyan-300 drop-shadow-[0_0_30px_rgba(56,189,248,1),0_0_60px_rgba(56,189,248,0.5)]">
                ~{estimatedOutput.toFixed(4)}
              </p>
              <p className="text-2xl font-bold text-white">{bestYieldLST.name}</p>
            </div>

            <div className="pt-4 border-t border-cyan-400/20 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Daily Yield</span>
                <span className="text-emerald-300 font-semibold">
                  ~{estimatedDailyYield.toFixed(6)} {bestYieldLST.name}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">APY</span>
                <span className="text-emerald-300 font-semibold">{currentApy.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Fee</span>
                <span className="text-cyan-300 font-semibold">0.3%</span>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Status Message */}
      {statusMessage && (
        <div
          className={[
            'rounded-2xl border px-4 py-3 text-sm text-center',
            statusMessage.includes('✅')
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
              : statusMessage.includes('❌')
              ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
              : 'border-sky-400/40 bg-sky-500/10 text-sky-200',
          ].join(' ')}
        >
          {statusMessage}
          {txHash && (
            <div className="mt-2">
              <a
                href={`https://explorer.thetatoken.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-cyan-300 underline hover:text-cyan-200 transition-colors"
              >
                View on Explorer: {txHash.substring(0, 10)}…{txHash.substring(txHash.length - 8)}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Deposit Button */}
      <NeonButton
        label={isProcessing ? 'Processing...' : 'Deposit & Stake'}
        rightHint="best yield"
        onClick={handleDeposit}
        disabled={
          !wallet.isConnected ||
          !inputAmount ||
          !isValidAmount ||
          parseFloat(inputAmount) <= 0 ||
          isProcessing
        }
      />

      {/* Info Footer */}
      <div className="text-center text-xs text-slate-500">
        <p>Auto-routed to highest yield • Single transaction • Instant execution</p>
      </div>
    </div>
  )
}

