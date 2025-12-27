import { useState, useMemo, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import {
  Token,
  getThetaTokens,
  getCosmosTokens,
  isValidSwapPair,
  getTokenBySymbol,
} from '../config/tokenConfig'
import { connectKeplr, isKeplrInstalled, getKeplrBalance, KeplrWalletInfo } from '../utils/keplrWallet'
import {
  calculateBestRoute,
  estimateBridgeFee,
  bridgeThetaToCosmos,
  bridgeCosmosToTheta,
  crossChainSwap,
  sendToCosmos,
  estimateAxelarRelayFee,
  BridgeRoute,
} from '../utils/axelarBridge'
import { usePriceStore } from '../stores/priceStore'
import StrideAccountHelp from './StrideAccountHelp'

interface BiDirectionalSwapCardProps {
  thetaWallet: {
    address: string | null
    fullAddress: string | null
    balance: string
    isConnected: boolean
  }
  onConnectTheta: () => Promise<void>
  onDisconnectTheta?: () => void
}

export default function BiDirectionalSwapCard({
  thetaWallet,
  onConnectTheta,
  onDisconnectTheta,
}: BiDirectionalSwapCardProps) {
  // State
  const [fromToken, setFromToken] = useState<Token>(getThetaTokens()[0])
  const [toToken, setToToken] = useState<Token>(getCosmosTokens()[0])
  const [inputAmount, setInputAmount] = useState('')
  const [keplrWallet, setKeplrWallet] = useState<KeplrWalletInfo | null>(null)
  const [showFromDropdown, setShowFromDropdown] = useState(false)
  const [showToDropdown, setShowToDropdown] = useState(false)
  const [swapStatus, setSwapStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [route, setRoute] = useState<BridgeRoute | null>(null)
  const [strideAccountError, setStrideAccountError] = useState<string | null>(null)

  const { prices } = usePriceStore()

  // Available tokens based on direction
  const availableFromTokens = useMemo(() => {
    return [...getThetaTokens(), ...getCosmosTokens()]
  }, [])

  const availableToTokens = useMemo(() => {
    // Opposite chain tokens (auto-suggest)
    if (fromToken.chain === 'theta') {
      return getCosmosTokens()
    } else {
      return getThetaTokens()
    }
  }, [fromToken.chain])

  // Calculate output amount estimate
  const estimatedOutput = useMemo(() => {
    const amount = parseFloat(inputAmount)
    if (!amount || amount <= 0) return null

    // Get prices from store
    // Special case: USDC is a stablecoin, always $1.00
    let fromPrice: number | null = null
    if (fromToken.symbol === 'USDC') {
      fromPrice = 1.0
    } else {
      fromPrice = prices?.[fromToken.symbol]?.price || null
    }

    let toPrice: number | null = null
    if (toToken.symbol === 'USDC') {
      toPrice = 1.0
    } else {
      toPrice = prices?.[toToken.symbol]?.price || null
    }

    // If we can't get prices, return null (don't show 0)
    if (!fromPrice || !toPrice) {
      console.warn('Missing price data:', { 
        fromToken: fromToken.symbol, 
        fromPrice, 
        toToken: toToken.symbol, 
        toPrice,
        availablePrices: prices ? Object.keys(prices) : []
      })
      return null
    }

    // Calculate: inputAmount * inputPrice / outputPrice * (1 - fee)
    const fromUSD = amount * fromPrice
    const slippage = 0.005 // 0.5%
    const bridgeFee = parseFloat(route?.bridgeFee || '2.0')
    const netUSD = fromUSD * (1 - slippage) - bridgeFee

    // Log calculation for debugging ratio issues
    console.log('💱 Swap Calculation:', {
      inputAmount: amount,
      fromToken: fromToken.symbol,
      fromPrice: `$${fromPrice.toFixed(4)}`,
      toToken: toToken.symbol,
      toPrice: `$${toPrice.toFixed(4)}`,
      fromUSD: `$${fromUSD.toFixed(2)}`,
      slippage: '0.5%',
      bridgeFee: `$${bridgeFee}`,
      netUSD: `$${netUSD.toFixed(2)}`,
      outputAmount: (netUSD / toPrice).toFixed(4),
    })

    // Return 0 only if calculation is truly 0 or negative
    const output = netUSD / toPrice
    return output > 0 ? output : 0
  }, [inputAmount, fromToken.symbol, toToken.symbol, prices, route?.bridgeFee])

  // Check if both wallets are connected for cross-chain swaps
  const needsBothWallets = fromToken.chain !== toToken.chain
  const walletsConnected = useMemo(() => {
    if (!needsBothWallets) return true
    return thetaWallet.isConnected && keplrWallet !== null
  }, [needsBothWallets, thetaWallet.isConnected, keplrWallet])

  // Calculate route when tokens change
  useEffect(() => {
    if (isValidSwapPair(fromToken, toToken) && parseFloat(inputAmount) > 0) {
      const calculatedRoute = calculateBestRoute(fromToken, toToken, parseFloat(inputAmount))
      setRoute(calculatedRoute)

      // Estimate bridge fees
      estimateBridgeFee(fromToken.chainId, toToken.chainId, '0x').then(({ bridgeFee }) => {
        setRoute(prev => prev ? { ...prev, bridgeFee } : null)
      })
    } else {
      setRoute(null)
    }
  }, [fromToken, toToken, inputAmount])

  // Auto-update toToken when fromToken chain changes
  useEffect(() => {
    if (!isValidSwapPair(fromToken, toToken)) {
      // Select first token from opposite chain
      if (fromToken.chain === 'theta') {
        setToToken(getCosmosTokens()[0])
      } else {
        setToToken(getThetaTokens()[0])
      }
    }
  }, [fromToken])

  // Connect Keplr wallet
  const handleConnectKeplr = async () => {
    try {
      if (!isKeplrInstalled()) {
        alert('Please install Keplr wallet extension')
        return
      }

      // Connect to the chain of the selected Cosmos token
      const chainId = toToken.chain === 'cosmos' ? toToken.chainId : getCosmosTokens()[0].chainId
      const wallet = await connectKeplr(chainId)
      setKeplrWallet(wallet)
    } catch (error) {
      console.error('Keplr connection error:', error)
      alert('Failed to connect Keplr wallet')
    }
  }

  // Toggle dropdown handlers (optimized for performance)
  const toggleFromDropdown = useCallback(() => {
    setShowFromDropdown(prev => !prev)
  }, [])

  const toggleToDropdown = useCallback(() => {
    setShowToDropdown(prev => !prev)
  }, [])

  // Token selection handlers (optimized to reduce re-renders)
  const selectFromToken = useCallback((token: Token) => {
    setFromToken(token)
    setShowFromDropdown(false)
  }, [])

  const selectToToken = useCallback((token: Token) => {
    setToToken(token)
    setShowToDropdown(false)
  }, [])

  // Swap tokens (reverse direction)
  const handleSwapDirection = useCallback(() => {
    setFromToken(toToken)
    setToToken(fromToken)
    setInputAmount('')
  }, [toToken, fromToken])

  // Execute swap
  const handleSwap = async () => {
    if (!walletsConnected) {
      setStatusMessage('Please connect both wallets')
      setSwapStatus('error')
      return
    }

    const amount = parseFloat(inputAmount)
    if (!amount || amount <= 0) {
      setStatusMessage('Please enter a valid amount')
      setSwapStatus('error')
      return
    }

    try {
      setSwapStatus('loading')
      setStatusMessage('Initiating cross-chain swap...')

      let txHash = ''

      // Theta → Cosmos swap
      if (fromToken.chain === 'theta' && toToken.chain === 'cosmos') {
        if (!thetaWallet.fullAddress || !keplrWallet) {
          throw new Error('Wallets not connected')
        }

        // Get Theta provider
        const provider = new ethers.BrowserProvider(
          (window as any).theta || (window as any).ethereum
        )
        const signer = await provider.getSigner()

        // Step 1: Swap on Theta if needed (TFUEL → bridgeable token)
        setStatusMessage('Step 1/4: Swapping on Theta...')
        let bridgeAmount = inputAmount
        
        if (fromToken.symbol === 'TFUEL') {
          // For now, we'll simulate the swap. In production, call actual router
          // const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer)
          // const tx = await router.swap(...)
          bridgeAmount = inputAmount // Amount after swap
        }

        // Step 2: Bridge via Axelar GMP
        setStatusMessage('Step 2/4: Bridging via Axelar GMP...')
        txHash = await bridgeThetaToCosmos(
          provider,
          bridgeAmount,
          toToken.chainId,
          keplrWallet.address,
          toToken
        )

        // Step 3: Wait for bridge (in production, poll Axelar API)
        setStatusMessage('Step 3/4: Waiting for bridge confirmation (~1 min)...')
        await new Promise(resolve => setTimeout(resolve, 2000)) // Simulate wait

        // Step 4: Stake on destination chain via Keplr
        setStatusMessage('Step 4/4: Staking to LST via Keplr...')
        
        // Import staking function
        const { stakeLSTOnStride } = await import('../utils/cosmosLSTStaking')
        
        const stakeAmount = parseFloat(bridgeAmount)
        const stakeResult = await stakeLSTOnStride(toToken.symbol, stakeAmount)
        
        if (!stakeResult.success) {
          throw new Error(stakeResult.error || 'Failed to stake LST')
        }
        
        if (stakeResult.txHash) {
          txHash = stakeResult.txHash
        }
      }
      // Cosmos → Theta swap
      else if (fromToken.chain === 'cosmos' && toToken.chain === 'theta') {
        if (!keplrWallet || !thetaWallet.fullAddress) {
          throw new Error('Wallets not connected')
        }

        setStatusMessage('Step 1/3: Unstaking LST...')

        // Execute bridge transaction
        setStatusMessage('Step 2/3: Bridging via Axelar...')
        txHash = await bridgeCosmosToTheta(
          fromToken.chainId,
          inputAmount,
          thetaWallet.fullAddress,
          fromToken
        )

        setStatusMessage('Step 3/3: Swapping on Theta...')
      }

      // Success
      setSwapStatus('success')
      const outputAmount = estimatedOutput || 0
      setStatusMessage(
        `✅ Success! ${outputAmount.toFixed(4)} ${toToken.symbol} received in Keplr wallet`
      )
      setInputAmount('')

      // Refresh Keplr balance
      if (keplrWallet && toToken.chain === 'cosmos') {
        try {
          const { getKeplrBalance } = await import('../utils/keplrWallet')
          const newBalance = await getKeplrBalance(keplrWallet.address, toToken.chainId)
          // Update balance in state if there's a callback
          console.log(`Updated ${toToken.symbol} balance:`, newBalance)
        } catch (balanceError) {
          console.warn('Failed to refresh Keplr balance:', balanceError)
        }
      }

      // Show tx hash with explorer link
      if (txHash) {
        setTimeout(() => {
          setStatusMessage(
            `✅ ${outputAmount.toFixed(4)} ${toToken.symbol} in Keplr • TX: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`
          )
        }, 2000)
      }

      // Reset after delay
      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 15000)
    } catch (error: any) {
      console.error('Swap error:', error)
      setSwapStatus('error')
      
      // Check if it's a Stride account error
      if (error.message?.includes('does not exist on chain')) {
        const addressMatch = error.message.match(/Account '([^']+)'/)
        setStrideAccountError(addressMatch ? addressMatch[1] : null)
      } else {
        setStrideAccountError(null)
      }
      
      setStatusMessage(`❌ Swap failed: ${error.message || 'Unknown error'}`)

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
        setStrideAccountError(null)
      }, 15000) // Give users more time to read the help message
    }
  }

  return (
    <GlassCard className="max-w-2xl mx-auto">
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 opacity-50">
            Cross-Chain Swap
          </h2>
          <p className="text-sm text-slate-400 mt-2 opacity-50">
            Theta ↔ Cosmos LSTs • Powered by Axelar
          </p>
        </div>

        {/* Wallet Status */}
        <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-slate-800/50 border border-purple-500/20">
          <div className="flex-1">
            <div className="text-xs text-slate-400 mb-1">Theta Wallet</div>
            {thetaWallet.isConnected ? (
              <div className="flex items-center gap-2">
                <div className="text-sm text-emerald-400 font-mono">
                  {thetaWallet.address}
                </div>
                {onDisconnectTheta && (
                  <button
                    onClick={onDisconnectTheta}
                    className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md border border-red-500/50 bg-red-500/10 text-red-300 transition-all hover:border-red-400 hover:bg-red-500/20 hover:text-red-200 hover:shadow-[0_0_15px_rgba(239,68,68,0.6)]"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  console.log('BiDirectionalSwapCard: Connect Theta Wallet button clicked')
                  onConnectTheta().catch(err => {
                    console.error('BiDirectionalSwapCard: Error in onConnectTheta:', err)
                  })
                }}
                className="text-sm text-purple-400 hover:text-purple-300 underline"
              >
                Connect Theta Wallet
              </button>
            )}
          </div>

          <div className="flex-1">
            <div className="text-xs text-slate-400 mb-1">Keplr Wallet</div>
            {keplrWallet ? (
              <div className="flex items-center gap-2">
                <div className="text-sm text-emerald-400 font-mono">
                  {keplrWallet.address.slice(0, 12)}...
                </div>
                <button
                  onClick={() => setKeplrWallet(null)}
                  className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md border border-red-500/50 bg-red-500/10 text-red-300 transition-all hover:border-red-400 hover:bg-red-500/20 hover:text-red-200 hover:shadow-[0_0_15px_rgba(239,68,68,0.6)]"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectKeplr}
                className="text-sm text-purple-400 hover:text-purple-300 underline"
              >
                Connect Keplr
              </button>
            )}
          </div>
        </div>

        {/* From Token */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400 uppercase tracking-wider">
            From
          </label>
          <div className="relative">
            <button
              onClick={toggleFromDropdown}
              className="w-full flex items-center justify-between p-4 rounded-lg bg-slate-800/70 border border-purple-500/30 hover:border-purple-500/50 transition-colors"
            >
              <span className="text-lg font-semibold text-white">
                {fromToken.symbol}
              </span>
              <span className="text-sm text-slate-400">{fromToken.name}</span>
            </button>

            {showFromDropdown && (
              <div className="absolute z-10 w-full mt-2 p-2 rounded-lg bg-slate-900 border border-purple-500/50 shadow-xl max-h-60 overflow-y-auto">
                {availableFromTokens.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => selectFromToken(token)}
                    className="w-full flex items-center justify-between p-3 rounded hover:bg-purple-500/20 transition-colors"
                  >
                    <span className="text-white font-semibold">{token.symbol}</span>
                    <span className="text-xs text-slate-400">{token.chain}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input Amount */}
          <input
            type="text"
            placeholder="0.00"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full p-4 text-2xl font-bold bg-slate-800/50 border border-purple-500/20 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center">
          <button
            onClick={handleSwapDirection}
            className="p-3 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 border border-purple-500/50 hover:from-purple-500/30 hover:to-cyan-500/30 transition-all hover:scale-110"
          >
            <svg
              className="w-6 h-6 text-purple-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
          </button>
        </div>

        {/* To Token */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400 uppercase tracking-wider">
            To (estimated)
          </label>
          <div className="relative">
            <button
              onClick={toggleToDropdown}
              className="w-full flex items-center justify-between p-4 rounded-lg bg-slate-800/70 border border-purple-500/30 hover:border-purple-500/50 transition-colors"
            >
              <span className="text-lg font-semibold text-white">
                {toToken.symbol}
              </span>
              <span className="text-sm text-slate-400">{toToken.name}</span>
            </button>

            {showToDropdown && (
              <div className="absolute z-10 w-full mt-2 p-2 rounded-lg bg-slate-900 border border-purple-500/50 shadow-xl max-h-60 overflow-y-auto">
                {availableToTokens.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => selectToToken(token)}
                    className="w-full flex items-center justify-between p-3 rounded hover:bg-purple-500/20 transition-colors"
                  >
                    <span className="text-white font-semibold">{token.symbol}</span>
                    <span className="text-xs text-slate-400">{token.chain}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Output Amount */}
          <div className="w-full p-4 text-2xl font-bold bg-slate-800/50 border border-purple-500/20 rounded-lg text-emerald-400">
            {estimatedOutput === null ? (
              <span className="text-slate-500 text-base">Enter amount</span>
            ) : estimatedOutput === 0 ? (
              <span className="text-amber-400">0.00</span>
            ) : (
              `~${estimatedOutput.toFixed(4)}`
            )}
          </div>
        </div>

        {/* Route Preview */}
        {route && (
          <div className="space-y-3 p-4 rounded-lg bg-gradient-to-br from-purple-900/20 to-cyan-900/20 border border-purple-500/30">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-purple-300">Best Route</div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider">via Axelar</span>
              </div>
            </div>
            
            {/* Steps */}
            <div className="space-y-2">
              {route.steps.map((step, idx) => (
                <div key={idx} className="flex items-center gap-3 text-xs">
                  <div className="w-6 h-6 rounded-full bg-purple-500/30 flex items-center justify-center text-purple-300 font-bold">
                    {idx + 1}
                  </div>
                  <span className="text-slate-300">{step.description}</span>
                  <span className="ml-auto text-slate-500">~{step.estimatedTime}s</span>
                </div>
              ))}
            </div>

            {/* Fee Breakdown */}
            <div className="pt-3 border-t border-purple-500/20 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Est. Gas Fee</span>
                <span className="text-white">{route.estimatedGas} {fromToken.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Axelar Relay Fee</span>
                <span className="text-white">${route.bridgeFee}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Est. Time</span>
                <span className="text-emerald-400">~{Math.ceil(route.estimatedTime / 60)} min</span>
              </div>
            </div>
          </div>
        )}

        {/* Status Message */}
        {statusMessage && (
          <div>
            <div
              className={`p-3 rounded-lg text-sm text-center ${
                swapStatus === 'error'
                  ? 'bg-red-900/20 border border-red-500/50 text-red-300'
                  : swapStatus === 'success'
                  ? 'bg-emerald-900/20 border border-emerald-500/50 text-emerald-300'
                  : 'bg-purple-900/20 border border-purple-500/50 text-purple-300'
              }`}
            >
              {statusMessage}
            </div>
            
            {/* Show Stride account help if it's that error */}
            {strideAccountError && <StrideAccountHelp strideAddress={strideAccountError} />}
          </div>
        )}

        {/* Swap Button */}
        <NeonButton
          label={
            swapStatus === 'loading'
              ? 'Processing...'
              : !walletsConnected
              ? 'Connect Wallets'
              : 'Swap & Stake'
          }
          rightHint={swapStatus === 'idle' && walletsConnected ? 'cross-chain' : undefined}
          onClick={handleSwap}
          disabled={
            !walletsConnected ||
            !inputAmount ||
            parseFloat(inputAmount) <= 0 ||
            swapStatus === 'loading'
          }
          className="w-full"
        />

        {/* Info Footer */}
        <div className="text-center text-xs text-slate-500">
          Powered by Axelar GMP • Secure cross-chain messaging
        </div>
      </div>
    </GlassCard>
  )
}

