import { useState, useMemo, useEffect } from 'react'
import { ethers } from 'ethers'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import {
  connectKeplrForPersistence,
  isKeplrInstalled,
  getStkXPRTBalance,
  stakeXPRTToStkXPRT,
  estimateStkXPRTOutput,
  getStkXPRTAPY,
  getPersistenceExplorerUrl,
  formatStkXPRTSuccessMessage,
} from '../utils/persistenceStaking'
import { bridgeThetaToCosmos, estimateAxelarRelayFee } from '../utils/axelarBridge'
import { ROUTER_ADDRESS, ROUTER_ABI } from '../config/thetaConfig'
import { usePriceStore } from '../stores/priceStore'

interface XPRTPlaybookCardProps {
  thetaWallet: {
    address: string | null
    fullAddress: string | null
    balance: string
    isConnected: boolean
  }
  onConnectTheta: () => Promise<void>
}

type PlaybookStep = 'idle' | 'swap' | 'bridge' | 'dex-swap' | 'stake' | 'success' | 'error'

export default function XPRTPlaybookCard({ thetaWallet, onConnectTheta }: XPRTPlaybookCardProps) {
  // State
  const [inputToken, setInputToken] = useState<'TFUEL' | 'USDC'>('TFUEL')
  const [inputAmount, setInputAmount] = useState('')
  const [keplrAddress, setKeplrAddress] = useState<string | null>(null)
  const [stkXPRTBalance, setStkXPRTBalance] = useState<number>(0)
  const [currentStep, setCurrentStep] = useState<PlaybookStep>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [stkXPRTAPY, setStkXPRTAPY] = useState<number>(25.7)

  const { prices } = usePriceStore()

  // Fetch stkXPRT APY on mount
  useEffect(() => {
    getStkXPRTAPY().then(apy => setStkXPRTAPY(apy))
  }, [])

  // Get prices
  const tfuelPrice = useMemo(() => prices?.TFUEL?.price || 0.065, [prices])
  const usdcPrice = 1.0 // USDC is always $1

  // Estimate output
  const [estimatedOutput, setEstimatedOutput] = useState<Awaited<ReturnType<typeof estimateStkXPRTOutput>> | null>(null)

  useEffect(() => {
    const amount = parseFloat(inputAmount)
    if (!amount || amount <= 0) {
      setEstimatedOutput(null)
      return
    }

    const inputPrice = inputToken === 'TFUEL' ? tfuelPrice : usdcPrice
    estimateStkXPRTOutput(amount, inputPrice).then(setEstimatedOutput)
  }, [inputAmount, inputToken, tfuelPrice])

  // Connect Keplr
  const handleConnectKeplr = async () => {
    try {
      if (!isKeplrInstalled()) {
        alert('Please install Keplr wallet extension')
        return
      }

      const address = await connectKeplrForPersistence()
      setKeplrAddress(address)

      // Fetch stkXPRT balance
      const balance = await getStkXPRTBalance(address)
      setStkXPRTBalance(balance)
    } catch (error) {
      console.error('Keplr connection error:', error)
      alert('Failed to connect Keplr wallet')
    }
  }

  // Execute playbook
  const handleExecutePlaybook = async () => {
    if (!thetaWallet.isConnected) {
      alert('Please connect Theta wallet')
      return
    }

    if (!keplrAddress) {
      alert('Please connect Keplr wallet')
      return
    }

    const amount = parseFloat(inputAmount)
    if (!amount || amount <= 0) {
      alert('Please enter a valid amount')
      return
    }

    try {
      setCurrentStep('swap')
      setStatusMessage('Step 1/4: Swapping to USDC on Theta...')

      // Get Theta provider
      const provider = new ethers.BrowserProvider(
        (window as any).theta || (window as any).ethereum
      )
      const signer = await provider.getSigner()

      let usdcAmount = amount
      
      // Step 1: If input is TFUEL, swap to USDC on Theta
      if (inputToken === 'TFUEL') {
        const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer)
        
        // Swap TFUEL to USDC
        const amountIn = ethers.parseEther(amount.toString())
        const tx = await router.swap(
          ethers.ZeroAddress, // TFUEL (native token)
          '0x...', // USDC address on Theta - TODO: Add actual address
          amountIn,
          { value: amountIn }
        )
        await tx.wait()
        
        // Estimate USDC received (98% of input value after fees)
        usdcAmount = amount * tfuelPrice * 0.98
      }

      // Step 2: Bridge USDC to Persistence via Axelar
      setCurrentStep('bridge')
      setStatusMessage('Step 2/4: Bridging USDC to Persistence via Axelar GMP...')

      const bridgeTxHash = await bridgeThetaToCosmos(
        provider,
        usdcAmount.toString(),
        'core-1', // Persistence chain ID
        keplrAddress,
        {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          type: 'ibc',
          chain: 'cosmos',
          chainId: 'core-1',
          ibcDenom: 'ibc/...',
        }
      )

      // Wait for bridge to complete (~60 seconds)
      setStatusMessage('Step 2/4: Bridge in progress... (takes ~1-2 minutes)')
      
      // Simulate bridge completion for demo
      // In production, would poll Axelar API for bridge status
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Step 3: Swap ibc/USDC to XPRT on Persistence DEX
      setCurrentStep('dex-swap')
      setStatusMessage('Step 3/4: Swapping USDC to XPRT on Dexter DEX...')

      // In production, would call swapIbcUSDCToXPRT
      // For now, simulate with message
      const estimatedXPRT = estimatedOutput?.estimatedXPRT || 0
      
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Step 4: Stake XPRT to stkXPRT
      setCurrentStep('stake')
      setStatusMessage('Step 4/4: Staking XPRT to stkXPRT (instant)...')

      const stakeResult = await stakeXPRTToStkXPRT(estimatedXPRT)

      if (!stakeResult.success) {
        throw new Error(stakeResult.error || 'Failed to stake XPRT')
      }

      // Success!
      setCurrentStep('success')
      const finalAmount = stakeResult.stkXPRTAmount || 0
      setStatusMessage(formatStkXPRTSuccessMessage(finalAmount, stkXPRTAPY))
      setTxHash(stakeResult.txHash || null)

      // Update balance
      if (keplrAddress) {
        const newBalance = await getStkXPRTBalance(keplrAddress)
        setStkXPRTBalance(newBalance)
      }

      // Reset form
      setInputAmount('')

      // Reset after delay
      setTimeout(() => {
        setCurrentStep('idle')
        setStatusMessage('')
        setTxHash(null)
      }, 10000)
    } catch (error: any) {
      console.error('Playbook execution error:', error)
      setCurrentStep('error')
      setStatusMessage(`❌ Transaction failed: ${error.message || 'Unknown error'}`)

      setTimeout(() => {
        setCurrentStep('idle')
        setStatusMessage('')
      }, 5000)
    }
  }

  // Get step progress
  const stepProgress = useMemo(() => {
    const steps = ['swap', 'bridge', 'dex-swap', 'stake', 'success']
    const currentIndex = steps.indexOf(currentStep)
    return currentIndex >= 0 ? ((currentIndex + 1) / 4) * 100 : 0
  }, [currentStep])

  return (
    <GlassCard className="max-w-2xl mx-auto">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 flex items-center justify-center text-2xl shadow-[0_0_30px_rgba(168,85,247,0.8)]">
              🔮
            </div>
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-orange-400">
              XPRT Playbook
            </h2>
          </div>
          <p className="text-sm text-cyan-300 font-semibold">
            TFUEL → USDC → Bridge → XPRT → stkXPRT
          </p>
          <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-400/40">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            <span className="text-xs font-bold text-green-300 uppercase tracking-wider">
              Real Yield: {stkXPRTAPY.toFixed(1)}% APY
            </span>
          </div>
        </div>

        {/* Wallet Status */}
        <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-gradient-to-br from-slate-900/60 to-slate-800/60 border border-purple-500/30">
          <div>
            <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">Theta Wallet</div>
            {thetaWallet.isConnected ? (
              <div className="text-sm text-emerald-400 font-mono font-semibold">
                {thetaWallet.address}
              </div>
            ) : (
              <button
                onClick={onConnectTheta}
                className="text-sm text-purple-400 hover:text-purple-300 underline font-semibold"
              >
                Connect Theta
              </button>
            )}
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">Keplr Wallet</div>
            {keplrAddress ? (
              <div className="flex flex-col gap-1">
                <div className="text-sm text-emerald-400 font-mono font-semibold">
                  {keplrAddress.slice(0, 10)}...
                </div>
                {stkXPRTBalance > 0 && (
                  <div className="text-xs text-cyan-300">
                    {stkXPRTBalance.toFixed(4)} stkXPRT
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleConnectKeplr}
                className="text-sm text-purple-400 hover:text-purple-300 underline font-semibold"
              >
                Connect Keplr
              </button>
            )}
          </div>
        </div>

        {/* Input Token Selector */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
            Input Token
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setInputToken('TFUEL')}
              className={`flex-1 p-3 rounded-lg font-semibold transition-all ${
                inputToken === 'TFUEL'
                  ? 'bg-gradient-to-r from-purple-500/40 to-pink-500/40 border-2 border-purple-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.6)]'
                  : 'bg-slate-800/50 border border-slate-600 text-slate-400 hover:border-purple-500/50'
              }`}
            >
              TFUEL
            </button>
            <button
              onClick={() => setInputToken('USDC')}
              className={`flex-1 p-3 rounded-lg font-semibold transition-all ${
                inputToken === 'USDC'
                  ? 'bg-gradient-to-r from-purple-500/40 to-pink-500/40 border-2 border-purple-400 text-white shadow-[0_0_20px_rgba(168,85,247,0.6)]'
                  : 'bg-slate-800/50 border border-slate-600 text-slate-400 hover:border-purple-500/50'
              }`}
            >
              USDC
            </button>
          </div>
        </div>

        {/* Input Amount */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
            Amount to Swap
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="0.00"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="w-full p-4 pr-20 text-2xl font-bold bg-slate-900/70 border-2 border-purple-500/40 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-purple-400 focus:shadow-[0_0_30px_rgba(168,85,247,0.5)] transition-all"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-purple-300">
              {inputToken}
            </span>
          </div>
          {thetaWallet.isConnected && inputToken === 'TFUEL' && (
            <button
              onClick={() => {
                const balance = parseFloat(thetaWallet.balance.replace(/,/g, ''))
                setInputAmount((balance * 0.99).toFixed(2)) // Leave 1% for gas
              }}
              className="text-xs text-cyan-400 hover:text-cyan-300 uppercase tracking-wider font-semibold"
            >
              MAX
            </button>
          )}
        </div>

        {/* Estimated Output */}
        {estimatedOutput && (
          <div className="p-5 rounded-xl bg-gradient-to-br from-purple-900/30 via-pink-900/20 to-orange-900/30 border-2 border-purple-500/40 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Estimated Output
              </span>
              <div className="text-right">
                <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
                  {estimatedOutput.estimatedStkXPRT.toFixed(4)}
                </div>
                <div className="text-xs text-slate-400">stkXPRT</div>
              </div>
            </div>

            {/* Flow Breakdown */}
            <div className="space-y-2 pt-3 border-t border-purple-500/20">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">1. {inputToken} → USDC</span>
                <span className="text-cyan-300 font-semibold">
                  ${estimatedOutput.breakdown.tfuelToUSDC.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">2. Bridge Fee (Axelar)</span>
                <span className="text-orange-300 font-semibold">-$2.00</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">3. ibc/USDC → XPRT</span>
                <span className="text-cyan-300 font-semibold">
                  {estimatedOutput.breakdown.xprtFromSwap.toFixed(4)} XPRT
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">4. XPRT → stkXPRT</span>
                <span className="text-emerald-300 font-semibold">
                  {estimatedOutput.breakdown.stkXPRTFinal.toFixed(4)} stkXPRT
                </span>
              </div>
            </div>

            {/* APY Badge */}
            <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-400/30">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <span className="text-sm font-bold text-green-300">
                Earning {stkXPRTAPY.toFixed(1)}% APY on Persistence
              </span>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {currentStep !== 'idle' && currentStep !== 'error' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold uppercase tracking-wider">Progress</span>
              <span className="text-cyan-300 font-bold">{Math.round(stepProgress)}%</span>
            </div>
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 transition-all duration-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]"
                style={{ width: `${stepProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Status Message */}
        {statusMessage && (
          <div
            className={`p-4 rounded-xl text-sm font-semibold text-center border-2 ${
              currentStep === 'error'
                ? 'bg-red-900/20 border-red-500/50 text-red-300'
                : currentStep === 'success'
                ? 'bg-emerald-900/20 border-emerald-500/50 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.4)]'
                : 'bg-purple-900/20 border-purple-500/50 text-purple-300'
            }`}
          >
            {statusMessage}
            {txHash && currentStep === 'success' && (
              <div className="mt-2">
                <a
                  href={getPersistenceExplorerUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyan-400 hover:text-cyan-300 underline"
                >
                  View on Mintscan →
                </a>
              </div>
            )}
          </div>
        )}

        {/* Execute Button */}
        <NeonButton
          label={
            currentStep === 'idle'
              ? 'Execute Playbook'
              : currentStep === 'success'
              ? 'Success! ✨'
              : currentStep === 'error'
              ? 'Try Again'
              : 'Processing...'
          }
          rightHint={currentStep === 'idle' ? 'Real Yield' : undefined}
          onClick={handleExecutePlaybook}
          disabled={
            !thetaWallet.isConnected ||
            !keplrAddress ||
            !inputAmount ||
            parseFloat(inputAmount) <= 0 ||
            (currentStep !== 'idle' && currentStep !== 'error' && currentStep !== 'success')
          }
          className="w-full"
        />

        {/* Info Footer */}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <span>Powered by</span>
          <span className="text-purple-400 font-semibold">Axelar GMP</span>
          <span>•</span>
          <span className="text-pink-400 font-semibold">Dexter DEX</span>
          <span>•</span>
          <span className="text-orange-400 font-semibold">pStake</span>
        </div>
      </div>
    </GlassCard>
  )
}

