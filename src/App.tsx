import { useEffect, useMemo, useState, useTransition } from 'react'
import { ethers } from 'ethers'
import confetti from 'canvas-confetti'
import ScreenBackground from './components/ScreenBackground'
import GlassCard from './components/GlassCard'
import NeonButton from './components/NeonButton'
import ApyOrb from './components/ApyOrb'
import YieldBubbleSelector, { type LSTOption } from './components/YieldBubbleSelector'
import NeonTabs, { type NeonTabId } from './components/NeonTabs'
import LotteryWinExplosion from './components/LotteryWinExplosion'
import CreatePoolModal from './components/CreatePoolModal'
import EarlyBelieversCard from './components/EarlyBelieversCard'
import EarlyBelieversModal from './components/EarlyBelieversModal'
import EdgeNodeDashboard from './components/EdgeNodeDashboard'
import { THETA_TESTNET, THETA_MAINNET, ROUTER_ADDRESS, TIP_POOL_ADDRESS, ROUTER_ABI, TIP_POOL_ABI, ERC20_ABI } from './config/thetaConfig'
import { APP_CONFIG, MOCK_ROUTER_ADDRESS } from './config/appConfig'
import { usePriceStore } from './stores/priceStore'

type SwapStatus = 'idle' | 'approving' | 'swapping' | 'success' | 'error'

interface WalletInfo {
  address: string | null
  fullAddress: string | null // Store full address for contract calls
  balance: string
  isConnected: boolean
}

interface SwapTransaction {
  id: string
  txHash: string
  amount: number
  outputAmount: number
  targetLST: string
  timestamp: number
  simulated: boolean
}

// TODO: Replace hardcoded APY values with verified on-chain or API-sourced data
// APY sources could be:
// - On-chain protocol queries (e.g., Persistence, pSTAKE)
// - Aggregator APIs (DeFiLlama, CoinGecko, etc.)
// - Protocol-specific APIs
// For now using placeholder values - need verification from user
const LST_OPTIONS: LSTOption[] = [
  { name: 'stkTIA', apy: 38.2 }, // TODO: Verify source
  { name: 'stkATOM', apy: 32.5 }, // TODO: Verify source
  { name: 'stkXPRT', apy: 28.7 }, // TODO: Verify source
  { name: 'pSTAKE BTC', apy: 25.4 }, // TODO: Verify source
  { name: 'stkOSMO', apy: 22.1 }, // TODO: Verify source
]

function App() {
  const [wallet, setWallet] = useState<WalletInfo>({
    address: null,
    fullAddress: null,
    balance: '0.00',
    isConnected: false,
  })
  const [tfuelAmount, setTfuelAmount] = useState('')
  const [selectedPercentage, setSelectedPercentage] = useState<number | null>(null)
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [selectedLST, setSelectedLST] = useState<LSTOption>(LST_OPTIONS[0])
  const [activeTab, setActiveTab] = useState<NeonTabId>('swap')
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [userAlias, setUserAlias] = useState<string | null>(null)
  const [showLSTDropdown, setShowLSTDropdown] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [faucetLoading, setFaucetLoading] = useState(false)
  const [tipPools, setTipPools] = useState<any[]>([])
  // Force real mode for production - disable mock mode
  const [mockMode, setMockMode] = useState(false)
  const [balanceRefreshInterval, setBalanceRefreshInterval] = useState<NodeJS.Timeout | null>(null)
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false)
  const [showWinExplosion, setShowWinExplosion] = useState(false)
  const [winAmount, setWinAmount] = useState(0)
  const [winNFT, setWinNFT] = useState<{ id: string; name: string; rarity: 'Mythic' | 'Legendary' | 'Epic' | 'Rare' } | undefined>(undefined)
  const [enteredRaffles, setEnteredRaffles] = useState<Set<number>>(new Set())
  const [myNFTs, setMyNFTs] = useState<Array<{ id: string; name: string; rarity: 'Mythic' | 'Legendary' | 'Epic' | 'Rare'; poolId: number; winAmount: number }>>([])
  const [swapHistory, setSwapHistory] = useState<SwapTransaction[]>([])
  const [showEarlyBelieversModal, setShowEarlyBelieversModal] = useState(false)
  const [gasPrice, setGasPrice] = useState<bigint | null>(null) // Gas price in wei
  const [estimatedGasCost, setEstimatedGasCost] = useState<number | null>(null) // Estimated gas cost in TFUEL
  const [routerQuote, setRouterQuote] = useState<number | null>(null) // Quote from router if available
  const [isPending, startTransition] = useTransition()
  const [debouncedTfuelAmount, setDebouncedTfuelAmount] = useState<string>('') // Debounced amount for heavy calcs

  // Global oracle data (prefetched + cached via Zustand)
  const {
    prices,
    apys,
    pricesLoading,
    isInitialLoad,
  } = usePriceStore()

  const numericBalance = useMemo(
    () => parseFloat(wallet.balance.replace(/,/g, '')) || 0,
    [wallet.balance],
  )

  // Derive TFUEL + LST prices for the currently selected LST from global store
  const tfuelPrice = useMemo(() => prices?.TFUEL?.price ?? null, [prices])

  const lstPrices = useMemo(() => {
    const result: Record<string, number> = {}
    if (!prices) return result

    if (prices.stkTIA?.price) result['stkTIA'] = prices.stkTIA.price
    if (prices.stkATOM?.price) result['stkATOM'] = prices.stkATOM.price
    if (prices.stkXPRT?.price) result['stkXPRT'] = prices.stkXPRT.price
    if (prices.pSTAKEBTC?.price) result['pSTAKE BTC'] = prices.pSTAKEBTC.price
    if (prices.stkOSMO?.price) result['stkOSMO'] = prices.stkOSMO.price

    return result
  }, [prices])

  // Check if using fallback price source (show "Estimated" label)
  const priceSourceInfo = useMemo(() => {
    if (!prices) return { isUsingFallback: false, source: null }
    const lstKey = selectedLST.name === 'pSTAKE BTC' ? 'pSTAKEBTC' : selectedLST.name
    const priceData = prices[lstKey as keyof typeof prices]
    
    // Consider osmosis/coingecko as fallback (not primary defillama)
    const isUsingFallback = priceData?.source === 'osmosis' || priceData?.source === 'coingecko' || priceData?.source === 'fallback'
    return {
      isUsingFallback,
      source: priceData?.source || null,
    }
  }, [prices, selectedLST.name])

  const isUsingFallbackPrice = priceSourceInfo.isUsingFallback

  // Use oracle APY if available, otherwise fallback to hardcoded
  const currentApy = useMemo(() => {
    const fromOracle = apys[selectedLST.name]?.apy
    return (fromOracle && fromOracle > 0) ? fromOracle : selectedLST.apy
  }, [selectedLST.name, selectedLST.apy, apys])

  const liveApyText = useMemo(() => `${currentApy.toFixed(1)}%`, [currentApy])

  // Real Theta Wallet connection with balance fetching
  const connectWallet = async () => {
    try {
      const provider = (window as any).theta || (window as any).ethereum
      if (typeof window !== 'undefined' && provider) {
        // Request account access
        const accounts = await provider.request({
          method: 'eth_requestAccounts',
        })
        if (accounts && accounts.length > 0) {
          const address = accounts[0]
          
          // Fetch real balance from chain
          const ethersProvider = new ethers.BrowserProvider(provider)
          const balance = await ethersProvider.getBalance(address)
          const balanceFormatted = parseFloat(ethers.formatEther(balance)).toLocaleString('en-US', {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2,
          })
          
          setWallet({
            address: `${address.slice(0, 6)}...${address.slice(-4)}`,
            fullAddress: address,
            balance: balanceFormatted,
            isConnected: true,
          })
          
          // Refresh balance periodically
          refreshBalance(address, provider)
        }
      } else {
        alert('Please install Theta Wallet or MetaMask to connect')
      }
    } catch (error) {
      console.error('Wallet connection error:', error)
      setStatusMessage('Failed to connect wallet')
      setSwapStatus('error')
    }
  }

  // Refresh wallet balance from chain
  const refreshBalance = async (address: string, provider: any) => {
    try {
      const ethersProvider = new ethers.BrowserProvider(provider)
      const balance = await ethersProvider.getBalance(address)
      const balanceFormatted = parseFloat(ethers.formatEther(balance)).toLocaleString('en-US', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })
      setWallet((prev) => ({ ...prev, balance: balanceFormatted }))
    } catch (error) {
      console.error('Balance refresh error:', error)
    }
  }

  // Set up periodic balance refresh when wallet is connected
  useEffect(() => {
    if (wallet.isConnected && wallet.fullAddress) {
      const provider = (window as any).theta || (window as any).ethereum
      if (provider) {
        // Refresh immediately
        refreshBalance(wallet.fullAddress, provider)
        
        // Set up interval to refresh every 10 seconds
        const interval = setInterval(() => {
          refreshBalance(wallet.fullAddress!, provider)
        }, 10000)
        
        setBalanceRefreshInterval(interval)
        
        return () => {
          if (interval) clearInterval(interval)
        }
      }
    } else {
      // Clear interval when wallet disconnects
      if (balanceRefreshInterval) {
        clearInterval(balanceRefreshInterval)
        setBalanceRefreshInterval(null)
      }
    }
  }, [wallet.isConnected, wallet.fullAddress])

  // Get Test TFUEL from faucet
  const handleFaucet = async () => {
    if (!wallet.fullAddress) {
      setStatusMessage('Connect wallet first')
      setSwapStatus('error')
      return
    }

    setFaucetLoading(true)
    try {
      const response = await fetch(`${THETA_TESTNET.faucetUrl}?address=${wallet.fullAddress}`)
      if (response.ok) {
        setStatusMessage('Test TFUEL requested! Check your wallet in a few moments.')
        setSwapStatus('success')
        // Refresh balance after a delay
        setTimeout(() => {
          const provider = (window as any).theta || (window as any).ethereum
          if (provider) {
            refreshBalance(wallet.fullAddress!, provider)
          }
        }, 3000)
      } else {
        setStatusMessage('Faucet request failed. Please try again later.')
        setSwapStatus('error')
      }
    } catch (error) {
      console.error('Faucet error:', error)
      setStatusMessage('Failed to request test TFUEL')
      setSwapStatus('error')
    } finally {
      setFaucetLoading(false)
      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 5000)
    }
  }

  const handlePercentageSelect = (pct: number) => {
    startTransition(() => {
      setSelectedPercentage(pct)
      if (wallet.isConnected && numericBalance > 0) {
        const amount = (numericBalance * pct) / 100
        setTfuelAmount(amount.toFixed(2))
      }
    })
  }

  // Handle manual input changes
  const handleAmountInputChange = (value: string) => {
    startTransition(() => {
      // Clear percentage selection when manually typing
      setSelectedPercentage(null)
      setTfuelAmount(value)
    })
  }

  // Sanitize manual amount input (allow only numbers and a single decimal point)
  const sanitizeAmountValue = (raw: string): string => {
    const value = raw.replace(/[^0-9.]/g, '')
    const parts = value.split('.')
    if (parts.length > 2) {
      return parts[0] + '.' + parts.slice(1).join('')
    }
    return value
  }

  // Debounce amount input so heavy calculations only run after a short pause
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedTfuelAmount(tfuelAmount)
    }, 180) // 150–200ms sweet spot

    return () => clearTimeout(handle)
  }, [tfuelAmount])

  // Handle MAX button - use 99% to leave gas
  const handleMaxClick = () => {
    if (wallet.isConnected && numericBalance > 0) {
      const maxAmount = numericBalance * 0.99 // 99% to leave gas
      setSelectedPercentage(99)
      setTfuelAmount(maxAmount.toFixed(2))
    }
  }

  // Validate input amount
  const isValidAmount = useMemo(() => {
    if (!tfuelAmount || tfuelAmount === '') return true // Allow empty input
    const amount = parseFloat(tfuelAmount)
    if (isNaN(amount) || amount <= 0) return false
    if (wallet.isConnected && numericBalance > 0 && amount > numericBalance) return false
    return true
  }, [tfuelAmount, wallet.isConnected, numericBalance])

  const handleLSTSelect = (lst: LSTOption) => {
    setSelectedLST(lst)
    setShowLSTDropdown(false)
  }

  // Handle "Pump My Earnings" - pre-fill swap with full TFUEL balance
  const handlePumpEarnings = () => {
    if (wallet.isConnected && numericBalance > 0) {
      setTfuelAmount(numericBalance.toFixed(2))
      setSelectedPercentage(100) // Set to 100%
      setActiveTab('swap') // Switch to swap tab
    } else {
      // If wallet not connected, try to connect
      connectWallet()
    }
  }

  const computedTfuelAmount = useMemo(() => {
    if (selectedPercentage !== null && wallet.isConnected && numericBalance > 0) {
      // Handle MAX (99%) case
      if (selectedPercentage === 99) {
        return numericBalance * 0.99
      }
      return (numericBalance * selectedPercentage) / 100
    }
    // For manual input, use debounced value so we don't thrash calculations on every keystroke
    return parseFloat(debouncedTfuelAmount) || 0
  }, [selectedPercentage, numericBalance, wallet.isConnected, debouncedTfuelAmount])

  // Real output preview: prefer router quote, then price-based calculation per selected LST
  const estimatedLSTAmount = useMemo(() => {
    if (computedTfuelAmount <= 0) return 0
    
    // Priority 1: Use router quote if available
    if (routerQuote !== null && routerQuote > 0) {
      return routerQuote
    }
    
    // Priority 2: Calculate using real prices for selected LST: inputAmount * TFUEL_price / LST_price * (1 - fee)
    if (tfuelPrice && lstPrices[selectedLST.name] && lstPrices[selectedLST.name] > 0) {
      const tfuelUSD = computedTfuelAmount * tfuelPrice
      const lstPriceUSD = lstPrices[selectedLST.name]
      // Router fee: 0.3% (30 bps) from baseFeeBps
      const feeMultiplier = 0.997 // 1 - 0.003
      return (tfuelUSD / lstPriceUSD) * feeMultiplier
    }
    
    // No fallback - return null to show "Price unavailable"
    return null
  }, [computedTfuelAmount, routerQuote, tfuelPrice, lstPrices, selectedLST.name])

  // Calculate exchange rate: 1 TFUEL ≈ X LST
  const exchangeRate = useMemo(() => {
    if (!tfuelPrice) return null
    const feeMultiplier = 0.997
    // If we have LST price, use it; otherwise assume 1:1 (LST typically tracks underlying)
    if (lstPrices[selectedLST.name] && lstPrices[selectedLST.name] > 0) {
      return (tfuelPrice / lstPrices[selectedLST.name]) * feeMultiplier
    }
    // Fallback to 1:1 ratio
    return feeMultiplier
  }, [tfuelPrice, lstPrices, selectedLST.name])

  const estimatedDailyYield = useMemo(() => {
    if (estimatedLSTAmount === null || estimatedLSTAmount <= 0) return 0
    return (estimatedLSTAmount * currentApy) / 100 / 365
  }, [estimatedLSTAmount, currentApy])

  // Price + APY data is now handled by the global price store.

  // Fetch router quote (if getAmountsOut is available) and estimate gas
  useEffect(() => {
    const fetchQuoteAndGas = async () => {
      if (!wallet.isConnected || !ROUTER_ADDRESS || computedTfuelAmount <= 0) {
        setRouterQuote(null)
        setEstimatedGasCost(null)
        return
      }

      try {
        const provider = (window as any).theta || (window as any).ethereum
        if (!provider) return

        const ethersProvider = new ethers.BrowserProvider(provider)
        const signer = await ethersProvider.getSigner()
        
        // Get current gas price
        const feeData = await ethersProvider.getFeeData()
        const currentGasPrice = feeData.gasPrice || BigInt(4000000000000) // Fallback to 4000 Gwei (Theta min)
        setGasPrice(currentGasPrice)

        const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer)
        const amountWei = ethers.parseEther(computedTfuelAmount.toString())

        // Try to get quote from router (if getAmountsOut or similar exists)
        // Note: Router contract doesn't currently have this, but keeping structure for future
        try {
          // If router has getAmountsOut, use it here
          // const quote = await routerContract.getAmountsOut(amountWei, selectedLST.name)
          // For now, quote will be calculated from prices
          setRouterQuote(null)
        } catch (quoteError) {
          // Router doesn't have quote function, will use price calculation
          setRouterQuote(null)
        }

        // Estimate actual gas for swap transaction
        try {
          const gasEstimate = await routerContract.swapAndStake.estimateGas(amountWei, selectedLST.name, 0, {
            value: amountWei,
          })
          
          const gasCostWei = currentGasPrice * gasEstimate
          const gasCostTfuel = parseFloat(ethers.formatEther(gasCostWei))
          setEstimatedGasCost(gasCostTfuel)
        } catch (estError) {
          // If estimation fails, use conservative estimate
          console.warn('Gas estimation failed, using default:', estError)
          const estimatedGas = BigInt(200000) // Conservative estimate
          const gasCostWei = currentGasPrice * estimatedGas
          const gasCostTfuel = parseFloat(ethers.formatEther(gasCostWei))
          setEstimatedGasCost(gasCostTfuel)
        }
      } catch (error) {
        console.error('❌ Error fetching quote/gas:', error)
        // Fallback: use Theta minimum gas price
        const fallbackGasPrice = BigInt(4000000000000) // 4000 Gwei
        setGasPrice(fallbackGasPrice)
        const estimatedGas = BigInt(200000)
        const gasCostWei = fallbackGasPrice * estimatedGas
        setEstimatedGasCost(parseFloat(ethers.formatEther(gasCostWei)))
      }
    }

    fetchQuoteAndGas()
    // Refresh every 30 seconds or when amount/LST changes
    const interval = setInterval(fetchQuoteAndGas, 30000)
    return () => clearInterval(interval)
  }, [wallet.isConnected, ROUTER_ADDRESS, computedTfuelAmount, selectedLST.name])

  // Calculate daily yield in USD (convert LST yield to USD via TFUEL price)
  const estimatedDailyYieldUSD = useMemo(() => {
    if (!tfuelPrice || estimatedDailyYield === 0) return 0
    // Daily yield is in LST tokens, convert to USD using TFUEL price
    // Assuming LST price ≈ TFUEL price (1:1 ratio for simplicity, or use actual LST price if available)
    return estimatedDailyYield * tfuelPrice
  }, [estimatedDailyYield, tfuelPrice])

  const handleSwapFlow = async () => {
    // Connect wallet if not connected
    if (!wallet.isConnected || !wallet.fullAddress) {
      await connectWallet()
      // Give user a moment to connect
      if (!wallet.isConnected) {
        setStatusMessage('Please connect your wallet to continue')
        setSwapStatus('error')
        setTimeout(() => {
          setSwapStatus('idle')
          setStatusMessage('')
        }, 3000)
        return
      }
    }

    // Re-fetch prices for final rate before swap execution
    try {
      const { fetchPrices } = usePriceStore.getState()
      await fetchPrices(true) // Force fresh prices for accurate swap rate
    } catch (error) {
      console.warn('Failed to refresh prices before swap:', error)
      // Continue with cached prices if refresh fails
    }

    const amount = computedTfuelAmount
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatusMessage('Select balance percentage and valid amount')
      setSwapStatus('error')
      return
    }

    // Real swap execution - no simulation mode for production
    const minRequired = amount + 0.01 // Add small buffer for gas
    
    // Skip simulation mode in production - always use real swaps
    const useSimulation = false // Disabled for production

    if (useSimulation && false) { // Force false for production
      // Use backend API for simulation
      try {
        setSwapStatus('swapping')
        setStatusMessage(`Simulating swap: ${amount.toFixed(2)} TFUEL → ${selectedLST.name}…`)

        const response = await fetch(`${APP_CONFIG.API_URL}/api/swap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userAddress: wallet.fullAddress,
            amount: amount,
            targetLST: selectedLST.name,
            userBalance: numericBalance,
          }),
        })

        if (!response.ok) {
          throw new Error('Simulation request failed')
        }

        const data = await response.json()

        if (data.success) {
          setTxHash(data.txHash)
          
          // Add to transaction history
          const newTx: SwapTransaction = {
            id: `tx-${Date.now()}`,
            txHash: data.txHash,
            amount: amount,
            outputAmount: data.outputAmount,
            targetLST: selectedLST.name,
            timestamp: Date.now(),
            simulated: true,
          }
          setSwapHistory(prev => [newTx, ...prev])

          // Trigger confetti
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#a855f7', '#06b6d4', '#ec4899', '#10b981'],
          })

          setStatusMessage(
            `✅ Staked into ${selectedLST.name} — earning ${currentApy.toFixed(1)}% APY (Simulated)`,
          )
          setSwapStatus('success')
          setTfuelAmount('')
          setSelectedPercentage(null)

          setTimeout(() => {
            setSwapStatus('idle')
            setStatusMessage('')
            setTxHash(null)
          }, 8000)
          return
        } else {
          throw new Error(data.message || 'Simulation failed')
        }
      } catch (error: any) {
        console.error('Simulation error:', error)
        setStatusMessage(`Simulation failed: ${error.message || 'Unknown error'}`)
        setSwapStatus('error')
        setTimeout(() => {
          setSwapStatus('idle')
          setStatusMessage('')
        }, 5000)
        return
      }
    }

    // Real on-chain swap flow on Theta mainnet (production)
    try {
      const provider = new ethers.BrowserProvider(
        (window as any).theta || (window as any).ethereum,
      )
      const signer = provider.getSigner()
      const amountWei = ethers.parseEther(amount.toString())

      // Check balance one more time before sending
      const balanceWei = await provider.getBalance(wallet.fullAddress)
      const balanceEth = parseFloat(ethers.formatEther(balanceWei))
      
      if (balanceEth < minRequired) {
        setStatusMessage(`Insufficient balance. Need ${minRequired.toFixed(2)} TFUEL (including gas).`)
        setSwapStatus('error')
        setTimeout(() => {
          setSwapStatus('idle')
          setStatusMessage('')
        }, 5000)
        return
      }

      setSwapStatus('swapping')
      setStatusMessage(`Swapping ${amount.toFixed(2)} TFUEL → ${selectedLST.name}…`)

      // Use real router address from environment - production only
      if (!ROUTER_ADDRESS) {
        setStatusMessage('Router address not configured. Please set VITE_ROUTER_ADDRESS.')
        setSwapStatus('error')
        setTimeout(() => {
          setSwapStatus('idle')
          setStatusMessage('')
        }, 5000)
        return
      }
      
      const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer)

      // Estimate gas first for better UX
      let gasEstimate = BigInt(200000) // Default estimate
      try {
        const gasEst = await routerContract.swapAndStake.estimateGas(amountWei, selectedLST.name, 0, {
          value: amountWei,
        })
        gasEstimate = gasEst
      } catch (e) {
        console.warn('Gas estimation failed, using default:', e)
      }

      // Call swapAndStake with native TFUEL (msg.value)
      // TFUEL is native token, so no approval needed - just send via msg.value
      // minAmountOut: 0 for now (could add slippage protection later)
      const tx = await routerContract.swapAndStake(amountWei, selectedLST.name, 0, {
        value: amountWei, // Send native TFUEL
        gasLimit: gasEstimate + (gasEstimate / BigInt(10)), // Add 10% buffer
      })

      setTxHash(tx.hash)
      setStatusMessage(`Transaction sent! Waiting for confirmation…`)

      // Wait for confirmation
      const receipt = await tx.wait()
      
      // Extract real gas cost from receipt
      if (receipt.gasUsed && receipt.gasPrice) {
        const realGasCostWei = receipt.gasUsed * receipt.gasPrice
        const realGasCostTfuel = parseFloat(ethers.formatEther(realGasCostWei))
        setEstimatedGasCost(realGasCostTfuel)
      }
      
      // Get real output amount from receipt/events if available, otherwise estimate
      // In production, parse events from receipt to get actual output
      let outputAmount = amount * 0.95 // Fallback: 5% fee estimate
      
      // Try to parse SwapAndStake event from receipt
      try {
        const swapEvent = receipt.logs?.find((log: any) => {
          try {
            const parsed = routerContract.interface.parseLog(log)
            return parsed?.name === 'SwapAndStake'
          } catch {
            return false
          }
        })
        if (swapEvent) {
          const parsed = routerContract.interface.parseLog(swapEvent)
          if (parsed?.args && parsed.args.stakedAmount) {
            outputAmount = parseFloat(ethers.formatEther(parsed.args.stakedAmount))
          }
        }
      } catch (e) {
        console.warn('Could not parse swap event, using estimate:', e)
      }
      
      // Add to transaction history (real transaction)
      const newTx: SwapTransaction = {
        id: `tx-${Date.now()}`,
        txHash: tx.hash,
        amount: amount,
        outputAmount: outputAmount,
        targetLST: selectedLST.name,
        timestamp: Date.now(),
        simulated: false,
      }
      setSwapHistory(prev => [newTx, ...prev])
      
      // Trigger confetti animation on success
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#a855f7', '#06b6d4', '#ec4899', '#10b981'],
      })

      setStatusMessage(
        `✅ Swapped ${amount.toFixed(2)} TFUEL → ${outputAmount.toFixed(4)} ${selectedLST.name} — earning ${currentApy.toFixed(1)}% APY`,
      )
      setSwapStatus('success')
      setTfuelAmount('')
      setSelectedPercentage(null)

      // Refresh balance after transaction
      setTimeout(() => {
        const providerForRefresh = (window as any).theta || (window as any).ethereum
        if (providerForRefresh) {
          refreshBalance(wallet.fullAddress!, providerForRefresh)
        }
      }, 2000)

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
        setTxHash(null)
      }, 8000)
    } catch (e: any) {
      console.error('Swap error:', e)
      
      // Handle specific error cases with clear messages
      let errorMessage = e?.message ?? e?.reason ?? 'Unexpected error'
      
      // Check for revert reasons
      if (errorMessage.includes('execution reverted') || errorMessage.includes('revert')) {
        // Try to extract revert reason
        const revertMatch = errorMessage.match(/reverted with reason string '(.+?)'/)?.[1] ||
                           errorMessage.match(/revert (.+)/)?.[1]
        if (revertMatch) {
          errorMessage = `Transaction reverted: ${revertMatch}`
        } else {
          errorMessage = 'Transaction reverted. Check your balance and try again.'
        }
      } else if (errorMessage.includes('insufficient funds') || 
                 errorMessage.includes('insufficient balance') || 
                 errorMessage.includes('insufficient funds for gas') ||
                 errorMessage.includes('gas')) {
        errorMessage = 'Insufficient TFUEL balance for transaction and gas fees.'
      } else if (errorMessage.includes('user rejected') || 
                 errorMessage.includes('User denied') || 
                 errorMessage.includes('rejected') ||
                 errorMessage.includes('user rejected')) {
        errorMessage = 'Transaction rejected by user'
      } else if (errorMessage.includes('network') || 
                 errorMessage.includes('Network') ||
                 errorMessage.includes('fetch')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (errorMessage.includes('nonce')) {
        errorMessage = 'Transaction nonce error. Please try again.'
      }
      
      setStatusMessage(`❌ ${errorMessage}`)
      setSwapStatus('error')
      setTxHash(null)

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 8000)
    }
  }

  const [poolLoading, setPoolLoading] = useState(false)
  const [tipAmount, setTipAmount] = useState('')

  // Load tip pools from chain
  const loadTipPools = async () => {
    if (!TIP_POOL_ADDRESS || !wallet.isConnected) return

    try {
      const provider = new ethers.BrowserProvider(
        (window as any).ethereum || (window as any).theta,
      )
      const tipPoolContract = new ethers.Contract(TIP_POOL_ADDRESS, TIP_POOL_ABI, provider)

      // Load pool info (simplified - in production would iterate through pools)
      // For now, we'll show a demo pool that can be interacted with
    } catch (error) {
      console.error('Failed to load tip pools:', error)
    }
  }

  // Create a new tip pool
  const createPool = async (duration: number) => {
    if (!TIP_POOL_ADDRESS || !wallet.fullAddress) {
      setStatusMessage('Connect wallet first')
      setSwapStatus('error')
      return
    }

    setPoolLoading(true)
    try {
      const provider = new ethers.BrowserProvider(
        (window as any).ethereum || (window as any).theta,
      )
      const signer = provider.getSigner()
      const tipPoolContract = new ethers.Contract(TIP_POOL_ADDRESS, TIP_POOL_ABI, signer)

      const tx = await tipPoolContract.createPool(duration, wallet.fullAddress)
      setTxHash(tx.hash)
      setStatusMessage(`Creating pool... ${tx.hash.substring(0, 10)}…`)

      await tx.wait()
      setStatusMessage('Pool created successfully!')
      setSwapStatus('success')
      loadTipPools()

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
        setTxHash(null)
      }, 5000)
    } catch (error: any) {
      setStatusMessage(`Failed: ${error?.message ?? 'Unexpected error'}`)
      setSwapStatus('error')
    } finally {
      setPoolLoading(false)
    }
  }

  // Tip a pool
  const tipPool = async (poolId: number, amount: string) => {
    if (!TIP_POOL_ADDRESS || !wallet.fullAddress) {
      setStatusMessage('Connect wallet first')
      setSwapStatus('error')
      return
    }

    const amountNum = parseFloat(amount)
    const isHighValue = amountNum >= 100

    setPoolLoading(true)
    try {
      const provider = new ethers.BrowserProvider(
        (window as any).ethereum || (window as any).theta,
      )
      const signer = provider.getSigner()
      const tipPoolContract = new ethers.Contract(TIP_POOL_ADDRESS, TIP_POOL_ABI, signer)
      const amountWei = ethers.parseEther(amount)

      const tx = await tipPoolContract.tipPool(poolId, { value: amountWei })
      setTxHash(tx.hash)
      setStatusMessage(`Sending tip... ${tx.hash.substring(0, 10)}…`)

      await tx.wait()
      
      // Auto-entry into raffle for $100+ tips
      if (isHighValue) {
        setEnteredRaffles((prev) => new Set([...prev, poolId]))
        setStatusMessage(`Tip sent! 🎟️ Entered raffle for Pool #${poolId}`)
        
        // Trigger confetti for raffle entry
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#a855f7', '#ec4899', '#fbbf24'],
        })
      } else {
        setStatusMessage('Tip sent successfully!')
      }
      
      setSwapStatus('success')
      loadTipPools()

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
        setTxHash(null)
      }, 5000)
    } catch (error: any) {
      setStatusMessage(`Failed: ${error?.message ?? 'Unexpected error'}`)
      setSwapStatus('error')
    } finally {
      setPoolLoading(false)
    }
  }

  // End pool and draw winner
  const endPoolAndDraw = async (poolId: number) => {
    if (!TIP_POOL_ADDRESS || !wallet.fullAddress) {
      setStatusMessage('Connect wallet first')
      setSwapStatus('error')
      return
    }

    setPoolLoading(true)
    try {
      const provider = new ethers.BrowserProvider(
        (window as any).ethereum || (window as any).theta,
      )
      const signer = provider.getSigner()
      const tipPoolContract = new ethers.Contract(TIP_POOL_ADDRESS, TIP_POOL_ABI, signer)

      const tx = await tipPoolContract.endPool(poolId)
      setTxHash(tx.hash)
      setStatusMessage(`Ending pool and drawing winner... ${tx.hash.substring(0, 10)}…`)

      const receipt = await tx.wait()
      
      // Check if current user won (mock check - in production would check event logs)
      const mockWin = Math.random() > 0.7 // 30% chance for demo
      if (mockWin && wallet.fullAddress) {
        const mockWinAmount = Math.floor(Math.random() * 50000) + 1000
        setWinAmount(mockWinAmount)
        // Random chance for NFT
        if (Math.random() > 0.5) {
          const rarities: Array<'Mythic' | 'Legendary' | 'Epic' | 'Rare'> = ['Mythic', 'Legendary', 'Epic', 'Rare']
          setWinNFT({
            id: `nft-${Date.now()}`,
            name: `Pool #${poolId} Winner NFT`,
            rarity: rarities[Math.floor(Math.random() * rarities.length)],
          })
        }
        setShowWinExplosion(true)
      } else {
        // Regular confetti for non-winners
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#a855f7', '#06b6d4', '#ec4899', '#10b981'],
        })
      }

      setStatusMessage('Pool ended! Winner drawn and payouts distributed.')
      setSwapStatus('success')
      loadTipPools()

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
        setTxHash(null)
      }, 8000)
    } catch (error: any) {
      setStatusMessage(`Failed: ${error?.message ?? 'Unexpected error'}`)
      setSwapStatus('error')
    } finally {
      setPoolLoading(false)
    }
  }

  // Load tip pools on mount
  useEffect(() => {
    if (wallet.isConnected && TIP_POOL_ADDRESS) {
      loadTipPools()
    }
  }, [wallet.isConnected, TIP_POOL_ADDRESS])

  // Ensure only visible tabs can be active
  useEffect(() => {
    const validTabs: NeonTabId[] = ['swap', 'staking', 'profile']
    if (!validTabs.includes(activeTab)) {
      setActiveTab('swap')
    }
  }, [activeTab])

  // Auto-connect on mount (demo mode)
  useEffect(() => {
    // connectWallet()

    // Restore lightweight session (mock 2026-style wallet login)
    try {
      const raw = window.localStorage.getItem('xfuel-session')
      if (raw) {
        const parsed = JSON.parse(raw) as { address?: string; alias?: string }
        if (parsed?.address) {
          setIsSignedIn(true)
          setUserAlias(parsed.alias ?? null)
        }
      }
    } catch {
      // ignore
    }

    // Set active tab based on current path (only for visible tabs)
    // Hidden tabs are not accessible, default to swap
    const validTabs: NeonTabId[] = ['swap', 'staking', 'profile']
    if (window.location.pathname === '/liquidity' || window.location.pathname === '/liquidity/') {
      // Redirect hidden liquidity tab to swap
      window.history.replaceState({}, '', '/')
      setActiveTab('swap')
    }
  }, [])

  const handleWalletSignIn = async () => {
    if (!wallet.isConnected || !wallet.fullAddress) {
      setStatusMessage('Connect wallet in Swap first to sign in')
      setSwapStatus('error')
      setActiveTab('swap')
      return
    }

    try {
      // In a full 2026 setup this would be a SIWE-style message validated by a backend.
      const provider = new ethers.BrowserProvider(
        (window as any).ethereum || (window as any).theta,
      )
      const signer = provider.getSigner()
      const message = `Sign in to XFUEL arenas as ${wallet.fullAddress} @ ${new Date().toISOString()}`

      await signer.signMessage(message)

      const alias = `fan-${wallet.address?.slice(2, 6) ?? '0000'}`
      setIsSignedIn(true)
      setUserAlias(alias)

      try {
        window.localStorage.setItem(
          'xfuel-session',
          JSON.stringify({ address: wallet.fullAddress, alias }),
        )
      } catch {
        // ignore
      }
    } catch (e: any) {
      console.error('Sign-in failed', e)
      setIsSignedIn(false)
      setUserAlias(null)
    }
  }

  return (
    <ScreenBackground>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        {/* Top chrome: logo + live orb */}
        <header className="mb-6 flex flex-col items-center justify-between gap-4 sm:mb-10 sm:flex-row">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-12 w-12 items-center justify-center sm:h-14 sm:w-14">
              <img 
                src="/logo.png" 
                alt="XFUEL Logo" 
                className="h-full w-full object-contain xfuel-logo-glow xfuel-logo-pulse"
              />
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="bg-gradient-to-r from-purple-300 via-purple-100 to-cyan-300 bg-clip-text text-lg font-semibold uppercase tracking-[0.32em] text-transparent sm:text-xl">
                XFUEL
              </h1>
              <p className="text-xs text-slate-300/80 sm:text-sm">
                Sub-4s settlement rail for auto-compounding Cosmos LSTs
              </p>
            </div>
          </div>

          <div className="flex w-full max-w-xs flex-col items-end gap-2 sm:max-w-none sm:flex-row sm:items-center sm:justify-end sm:gap-4">
            <div className="w-full max-w-[180px] sm:max-w-[200px]">
              <ApyOrb apyText={liveApyText} label="live blended APY" />
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {/* Production mode - no dev toggles */}
              <div className="w-full sm:w-auto">
                <NeonButton
                  label={isSignedIn ? 'Logged in' : 'Log in'}
                  rightHint={isSignedIn ? undefined : 'wallet'}
                  variant={isSignedIn ? 'secondary' : 'primary'}
                  onClick={handleWalletSignIn}
                />
              </div>
              <div className="w-full sm:w-auto">
                <NeonButton
                  label="Private Client"
                  rightHint="institutional"
                  variant="secondary"
                  onClick={() => {
                    window.location.href = '/institutions'
                  }}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main layout: glass panels centered */}
        <main className="flex flex-1 flex-col items-center justify-center pb-10">
          <div className="w-full max-w-xl space-y-4 sm:space-y-6">
            <NeonTabs
              activeId={activeTab}
              onChange={(id) => {
                // Only allow navigation to visible tabs
                const validTabs: NeonTabId[] = ['swap', 'staking', 'profile']
                if (validTabs.includes(id)) {
                  setActiveTab(id)
                } else {
                  // Default to swap if trying to access hidden tab
                  setActiveTab('swap')
                }
              }}
              tabs={[
                { id: 'swap', label: 'Swap', pill: 'live' },
                { id: 'staking', label: 'Yield Pump', pill: 'apy lanes' },
                { id: 'profile', label: 'Profile', pill: 'wallet' },
              ]}
            />

            {/* Early Believers Card */}
            <EarlyBelieversCard onClick={() => setShowEarlyBelieversModal(true)} />

            <GlassCard>
              {activeTab === 'swap' && (
                <>
                  {/* Wallet connection - show at top but don't block UI */}
                  <div className="mb-6">
                    {!wallet.isConnected ? (
                      <div className="mb-4">
                        <NeonButton
                          label="Connect Theta Wallet"
                          onClick={connectWallet}
                          rightHint="connect"
                          variant="secondary"
                        />
                      </div>
                    ) : (
                      <div className="mb-4 space-y-4">
                      {/* Wallet info - subtle top-right style */}
                      <div className="flex items-center justify-between rounded-xl border border-purple-400/20 bg-black/10 px-3 py-2 backdrop-blur-sm">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/60">
                            Connected
                          </p>
                          <p className="mt-0.5 text-xs font-mono text-emerald-300/80">{wallet.address}</p>
                        </div>
                        <div className="flex items-center gap-2 text-right">
                          <div>
                            <p className="text-base font-semibold text-white/90">{wallet.balance}</p>
                            <div className="flex items-center justify-end gap-1">
                              <img src="/logo.png" alt="TFUEL" className="h-3 w-3 object-contain opacity-70" />
                              <p className="text-[10px] text-slate-400/70">TFUEL</p>
                            </div>
                          </div>
                        </div>
                      </div>


                      {/* Support Email Card */}
                      <div className="mb-4 flex justify-center">
                        <div className="relative overflow-hidden rounded-2xl border border-purple-400/40 bg-gradient-to-br from-[rgba(168,85,247,0.15)] via-[rgba(56,189,248,0.1)] to-[rgba(15,23,42,0.3)] px-5 py-3 backdrop-blur-xl shadow-[0_0_30px_rgba(168,85,247,0.4)]">
                          <p className="text-sm text-slate-300/90">
                            <span className="text-slate-400/80">Questions? </span>
                            <a
                              href="mailto:xfuel.support@xfuel.app"
                              className="text-purple-300 transition-all hover:text-purple-200"
                              style={{
                                textShadow: '0 0 10px rgba(139, 92, 246, 0.8), 0 0 20px rgba(139, 92, 246, 0.6)',
                              }}
                            >
                              xfuel.support@xfuel.app
                            </a>
                          </p>
                        </div>
                      </div>
                      </div>
                    )}
                  </div>

                  {/* Amount input with preset buttons - larger input - always visible */}
                  <div className="space-y-4">
                    <div className="relative">
                      <label className="block text-[11px] uppercase tracking-[0.22em] text-slate-300/70 mb-3">
                        Amount to swap
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={tfuelAmount}
                          onChange={(e) => {
                            const sanitized = sanitizeAmountValue(e.target.value)
                            handleAmountInputChange(sanitized)
                          }}
                          placeholder="0.00"
                          className={[
                            'w-full rounded-3xl border-2 bg-gradient-to-br from-[rgba(168,85,247,0.30)] via-[rgba(56,189,248,0.25)] to-[rgba(15,23,42,0.40)] px-10 py-8 text-left backdrop-blur-xl transition-all',
                            'text-4xl font-bold text-white placeholder:text-slate-500/40',
                            'focus:outline-none focus:ring-4 focus:ring-purple-400/40',
                            isValidAmount
                              ? 'border-purple-400/70 hover:border-purple-400 shadow-[0_0_50px_rgba(168,85,247,0.7),inset_0_0_30px_rgba(168,85,247,0.2)]'
                              : 'border-rose-400/70 hover:border-rose-400 shadow-[0_0_50px_rgba(244,63,94,0.7),inset_0_0_30px_rgba(244,63,94,0.2)]',
                            'disabled:cursor-not-allowed disabled:opacity-50',
                          ].join(' ')}
                          style={{
                            textShadow: isValidAmount 
                              ? '0 0 20px rgba(168,85,247,0.8)' 
                              : '0 0 20px rgba(244,63,94,0.8)',
                          }}
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          {selectedPercentage !== null && (
                            <span className="text-sm font-semibold text-purple-300">
                              {selectedPercentage}%
                            </span>
                          )}
                          <span className="text-sm text-slate-400">TFUEL</span>
                        </div>
                          </div>
                          {!isValidAmount && tfuelAmount && (
                            <p className="mt-2 text-xs text-rose-400">
                              {parseFloat(tfuelAmount) > numericBalance 
                                ? 'Amount exceeds balance' 
                                : 'Please enter a valid amount'}
                            </p>
                          )}
                          {wallet.isConnected && numericBalance > 0 ? (
                            <p className="mt-2 text-xs text-slate-400/80">
                              Available: <span className="font-semibold text-slate-300">{numericBalance.toFixed(2)} TFUEL</span>
                            </p>
                          ) : !wallet.isConnected ? (
                            <p className="mt-2 text-xs text-slate-400/60 italic">
                              Connect wallet to see balance
                            </p>
                          ) : null}
                          {!isValidAmount && numericBalance > 0 && parseFloat(tfuelAmount) > numericBalance && (
                            <p className="mt-2 text-xs font-semibold text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.6)]">
                              ⚠️ Amount exceeds available balance
                            </p>
                          )}
                        </div>

                        {/* Preset buttons - 25%, 50%, MAX only */}
                        <div className="flex flex-wrap gap-2">
                          {[25, 50].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => {
                                if (wallet.isConnected) {
                                  handlePercentageSelect(pct)
                                } else {
                                  connectWallet()
                                }
                              }}
                              className={[
                                'flex-1 min-w-[100px] rounded-2xl border-2 px-4 py-2.5 text-sm font-bold transition-all',
                                selectedPercentage === pct
                                  ? 'border-purple-400 bg-purple-500/30 text-purple-100 shadow-[0_0_30px_rgba(168,85,247,0.8),inset_0_0_20px_rgba(168,85,247,0.3)]'
                                  : 'border-purple-400/50 bg-purple-500/10 text-purple-300 hover:border-purple-400/80 hover:bg-purple-500/20 hover:shadow-[0_0_25px_rgba(168,85,247,0.6)]',
                                'disabled:cursor-not-allowed disabled:opacity-50',
                              ].join(' ')}
                            >
                              {pct}%
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              if (wallet.isConnected) {
                                handleMaxClick()
                              } else {
                                connectWallet()
                              }
                            }}
                            className={[
                              'flex-1 min-w-[100px] rounded-2xl border-2 px-4 py-2.5 text-sm font-bold transition-all',
                              selectedPercentage === 99
                                ? 'border-cyan-400 bg-cyan-500/30 text-cyan-100 shadow-[0_0_30px_rgba(56,189,248,0.8),inset_0_0_20px_rgba(56,189,248,0.3)]'
                                : 'border-cyan-400/50 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400/80 hover:bg-cyan-500/20 hover:shadow-[0_0_25px_rgba(56,189,248,0.6)]',
                              'disabled:cursor-not-allowed disabled:opacity-50',
                            ].join(' ')}
                          >
                            MAX
                          </button>
                        </div>
                      </div>

                      {/* Big LST dropdown with logos */}
                      <div className="relative z-30">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setShowLSTDropdown(!showLSTDropdown)
                          }}
                          className="w-full rounded-3xl border-2 border-purple-400/70 bg-gradient-to-br from-[rgba(168,85,247,0.30)] via-[rgba(56,189,248,0.25)] to-[rgba(15,23,42,0.40)] px-8 py-6 text-left backdrop-blur-xl transition-all hover:border-purple-400 shadow-[0_0_50px_rgba(168,85,247,0.6),inset_0_0_30px_rgba(168,85,247,0.15)] hover:shadow-[0_0_60px_rgba(168,85,247,0.8),inset_0_0_40px_rgba(168,85,247,0.2)]"
                        >
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                            Liquid staking token
                          </p>
                          <div className="mt-3 flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-purple-400/50 bg-gradient-to-br from-purple-500/40 to-cyan-500/30 shadow-[0_0_20px_rgba(168,85,247,0.5)]">
                              <span className="text-2xl">🔷</span>
                            </div>
                            <div className="flex-1">
                              <div className="flex items-baseline gap-3">
                                <p className="text-3xl font-bold text-white">{selectedLST.name}</p>
                                {selectedLST === LST_OPTIONS[0] && (
                                  <span className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.6)]">
                                    Best Yield
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xl font-bold text-emerald-300 drop-shadow-[0_0_15px_rgba(16,185,129,0.8)]">
                                {currentApy.toFixed(1)}% APY
                              </p>
                            </div>
                          </div>
                        </button>
                        {showLSTDropdown && (
                          <>
                            {/* Invisible backdrop to catch outside clicks */}
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setShowLSTDropdown(false)}
                            />
                            {/* Dropdown menu */}
                            <div className="absolute top-full z-50 mt-2 w-full overflow-hidden rounded-2xl border-2 border-purple-400/50 bg-[rgba(15,23,42,0.98)] backdrop-blur-2xl shadow-[0_8px_40px_rgba(0,0,0,0.9)]">
                              {LST_OPTIONS.map((lst, idx) => (
                                <button
                                  key={lst.name}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleLSTSelect(lst)
                                  }}
                                  className={[
                                    'w-full px-6 py-4 text-left transition-all first:rounded-t-2xl last:rounded-b-2xl',
                                    'hover:bg-purple-500/20 hover:shadow-[inset_0_0_20px_rgba(168,85,247,0.3)]',
                                    lst === selectedLST ? 'bg-purple-500/15 border-l-4 border-purple-400' : '',
                                  ].join(' ')}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-400/40 bg-gradient-to-br from-purple-500/30 to-cyan-500/20">
                                        <span className="text-lg">🔷</span>
                                      </div>
                                      <div>
                                        <p className="text-lg font-bold text-white">{lst.name}</p>
                                        {idx === 0 && (
                                          <span className="text-[10px] text-emerald-300 font-semibold">Best Yield</span>
                                        )}
                                      </div>
                                    </div>
                                  <p className="text-base font-bold text-emerald-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.6)]">
                                      {(apys[lst.name]?.apy ?? lst.apy).toFixed(1)}% APY
                                    </p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Live preview - instant updates with cached prices per selected LST - always visible */}
                      <GlassCard className="mt-4 border-2 border-cyan-400/60 bg-gradient-to-br from-[rgba(56,189,248,0.25)] via-[rgba(168,85,247,0.20)] to-[rgba(15,23,42,0.35)] shadow-[0_0_50px_rgba(56,189,248,0.6),inset_0_0_25px_rgba(56,189,248,0.15)] min-h-[200px]">
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                            You'll receive
                          </p>
                        {/* Content area: either skeleton (while pending) or real numbers/placeholder */}
                        {isPending ? (
                          <div className="mt-4 space-y-4 animate-pulse">
                            <div className="flex items-baseline gap-4">
                              <div className="h-10 w-32 rounded-lg bg-cyan-400/20" />
                              <div className="h-6 w-20 rounded-lg bg-slate-500/30" />
                            </div>
                            <div className="h-4 w-40 rounded bg-slate-500/30" />
                          </div>
                        ) : computedTfuelAmount > 0 && estimatedLSTAmount !== null ? (
                          <>
                            <div className="mt-4 flex items-baseline gap-4">
                              <p className="text-5xl font-bold text-cyan-300 drop-shadow-[0_0_30px_rgba(56,189,248,1),0_0_60px_rgba(56,189,248,0.5)]">
                                ~{estimatedLSTAmount.toFixed(4)}
                              </p>
                              <p className="text-2xl font-bold text-white">{selectedLST.name}</p>
                              {isUsingFallbackPrice && (
                                <span 
                                  className="ml-2 rounded-lg border border-amber-400/50 bg-amber-500/15 px-2 py-1 text-xs font-bold uppercase tracking-wider text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.4)]"
                                  title={`Price from ${priceSourceInfo.source || 'fallback'} oracle`}
                                >
                                  Est.
                                </span>
                              )}
                            </div>
                            {exchangeRate !== null && (
                              <p className="mt-3 text-sm font-semibold text-slate-300/80">
                                1 TFUEL ≈ {exchangeRate.toFixed(6)} {selectedLST.name}
                              </p>
                            )}
                          </>
                        ) : computedTfuelAmount === 0 ? (
                          <>
                            <div className="mt-4 flex items-baseline gap-4">
                              <p className="text-5xl font-bold text-slate-500/50 drop-shadow-none">
                                —
                              </p>
                              <p className="text-2xl font-bold text-slate-500/50">{selectedLST.name}</p>
                            </div>
                            {exchangeRate !== null && (
                              <p className="mt-3 text-sm font-semibold text-slate-400/60">
                                1 TFUEL ≈ {exchangeRate.toFixed(6)} {selectedLST.name}
                              </p>
                            )}
                          </>
                        ) : !prices || (Object.values(prices).every(p => p === null)) ? (
                          // Only show if absolutely no prices available (shouldn't happen with fallbacks)
                          <div className="mt-4 flex flex-col items-center justify-center py-8">
                            <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400"></div>
                            <p className="text-sm font-semibold text-cyan-400 drop-shadow-[0_0_15px_rgba(56,189,248,0.6)]">
                              Loading prices…
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              Connecting to oracles...
                            </p>
                          </div>
                        ) : (
                          <div className="mt-4">
                            <p className="text-lg font-semibold text-amber-400 drop-shadow-[0_0_15px_rgba(251,191,36,0.6)]">
                              Price unavailable — try later
                            </p>
                            <p className="mt-2 text-sm text-slate-400">
                              Unable to fetch {selectedLST.name} price from any oracle. Please try again in a few moments.
                            </p>
                          </div>
                        )}
                        <div className="mt-5 flex flex-wrap gap-3">
                          <div className="rounded-xl border-2 border-emerald-400/50 bg-emerald-500/15 px-4 py-2 shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                              Finality
                            </p>
                            <p className="mt-1 text-sm font-mono font-bold text-emerald-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.6)]">2.8s</p>
                          </div>
                          <div className="rounded-xl border-2 border-purple-400/50 bg-purple-500/15 px-4 py-2 shadow-[0_0_20px_rgba(168,85,247,0.4)]">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                              Est. Gas
                            </p>
                            <p className="mt-1 text-sm font-bold text-cyan-300 drop-shadow-[0_0_10px_rgba(56,189,248,0.6)]">
                              {estimatedGasCost !== null 
                                ? `~${estimatedGasCost.toFixed(6)} TFUEL`
                                : `~0.001 TFUEL`}
                            </p>
                          </div>
                        </div>
                      </GlassCard>

                  {/* Status message */}
                  {statusMessage && (
                    <div
                      className={[
                        'mb-4 rounded-2xl border px-4 py-3 text-sm text-center',
                        swapStatus === 'success'
                          ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                          : swapStatus === 'error'
                          ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                          : 'border-sky-400/40 bg-sky-500/10 text-sky-200',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {swapStatus === 'approving' && '⏳ '}
                      {swapStatus === 'swapping' && '🔄 '}
                      {swapStatus === 'success' && '✅ '}
                      {swapStatus === 'error' && '❌ '}
                      {statusMessage}
                      {txHash && (
                        <div className="mt-2 flex flex-col gap-1">
                          <a
                            href={`${THETA_MAINNET.explorerUrl}/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-cyan-300 underline hover:text-cyan-200 transition-colors"
                          >
                            View on Theta Explorer: {txHash.substring(0, 10)}…{txHash.substring(txHash.length - 8)}
                          </a>
                          <span className="text-[10px] text-slate-400 font-mono break-all">
                            {txHash}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Get Test TFUEL button - show when balance is low */}
                  {wallet.isConnected && numericBalance < 0.1 && (
                    <div className="mb-4">
                      <NeonButton
                        label={faucetLoading ? 'Requesting…' : 'Get Test TFUEL'}
                        rightHint="faucet"
                        variant="secondary"
                        onClick={handleFaucet}
                        disabled={faucetLoading}
                      />
                    </div>
                  )}
                  
                  {/* Also show faucet button if swap fails due to low balance */}
                  {wallet.isConnected && swapStatus === 'error' && statusMessage.includes('Insufficient') && (
                    <div className="mb-4">
                      <NeonButton
                        label={faucetLoading ? 'Requesting…' : 'Get Test TFUEL'}
                        rightHint="faucet"
                        variant="secondary"
                        onClick={handleFaucet}
                        disabled={faucetLoading}
                      />
                    </div>
                  )}

                  {/* Transaction History */}
                  {swapHistory.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-3 text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                        Recent Swaps
                      </p>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {swapHistory.slice(0, 10).map((tx) => (
                          <div
                            key={tx.id}
                            className="flex items-center justify-between rounded-xl border border-purple-400/20 bg-black/20 px-4 py-2 backdrop-blur-sm"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-white">
                                  {tx.amount.toFixed(2)} TFUEL → {tx.outputAmount.toFixed(2)} {tx.targetLST}
                                </p>
                                {tx.simulated && (
                                  <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                                    Simulated
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-slate-400">
                                {new Date(tx.timestamp).toLocaleString()}
                              </p>
                            </div>
                            <a
                              href={`${THETA_MAINNET.explorerUrl}/tx/${tx.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-4 text-xs text-cyan-300 hover:text-cyan-200 underline transition-colors"
                            >
                              View
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Single Swap & Stake button */}
                  <NeonButton
                    label={
                      swapStatus === 'approving'
                        ? 'Approving…'
                        : swapStatus === 'swapping'
                        ? 'Swapping…'
                        : swapStatus === 'success'
                        ? 'Swap complete'
                        : !isValidAmount && computedTfuelAmount > numericBalance
                        ? 'Insufficient balance'
                        : 'Swap & Stake'
                    }
                    rightHint={
                      swapStatus === 'idle'
                        ? 'mainnet'
                        : swapStatus === 'success'
                        ? undefined
                        : 'live'
                    }
                    disabled={
                      !wallet.isConnected ||
                      computedTfuelAmount <= 0 ||
                      !isValidAmount ||
                      swapStatus === 'approving' ||
                      swapStatus === 'swapping'
                    }
                    onClick={handleSwapFlow}
                  />
                </>
              )}

              {activeTab === 'staking' && (
                <div className="space-y-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Staking lanes
                  </p>
                  <p className="text-sm text-slate-200">
                    Discover where XFUEL stakes across Cosmos LSTs. Higher left, calmer right — all
                    auto‑rebalanced behind the scenes.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {LST_OPTIONS.map((opt) => (
                      <GlassCard key={opt.name} className="p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
                            {opt.name}
                          </span>
                          <span className="text-xs font-semibold text-emerald-300">
                            {opt.apy.toFixed(1)}% APY
                          </span>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400">
                          Liquidity‑aware routing with optimized gas usage.
                        </p>
                      </GlassCard>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'tip-pools' && (
                <div className="space-y-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Tip arenas
                  </p>
                  <p className="text-sm text-slate-200">
                    Spin up sticky fan arenas where every tip routes into shared staking lanes. Fans
                    tap once, stars feel it forever. Pools end with VRF lottery draws - winner takes
                    90%, creator gets 10%. <span className="font-semibold text-amber-300">Tip $100+ to auto-enter NFT raffles!</span>
                  </p>

                  {statusMessage && (
                    <div
                      className={[
                        'rounded-2xl border px-4 py-3 text-sm text-center',
                        swapStatus === 'success'
                          ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                          : swapStatus === 'error'
                          ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                          : 'border-sky-400/40 bg-sky-500/10 text-sky-200',
                      ].join(' ')}
                    >
                      {statusMessage}
                      {txHash && (
                        <div className="mt-2 flex flex-col gap-1">
                          <a
                            href={`${THETA_MAINNET.explorerUrl}/tx/${txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-cyan-300 underline hover:text-cyan-200 transition-colors"
                          >
                            View on Theta Explorer: {txHash.substring(0, 10)}…{txHash.substring(txHash.length - 8)}
                          </a>
                          <span className="text-[10px] text-slate-400 font-mono break-all">
                            {txHash}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <GlassCard className={`p-4 transition-all ${enteredRaffles.has(1) ? 'ring-2 ring-amber-400/60 shadow-[0_0_40px_rgba(251,191,36,0.6)]' : ''}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
                          Arena: Main Stage
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                            🎟️ Raffle
                          </span>
                          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                            LIVE
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        Real‑time tip stream flowing into {selectedLST.name} for the headliner.
                      </p>
                      {enteredRaffles.has(1) && (
                        <div className="mt-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                            ✨ Entered Raffle
                          </p>
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                        <span>Pool ID</span>
                        <span className="font-mono text-emerald-300">#1</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
                        <span>Total tips</span>
                        <span className="font-mono text-cyan-300">12.43 TFUEL</span>
                      </div>
                      {wallet.isConnected && TIP_POOL_ADDRESS && (
                        <>
                          <div className="mt-3 space-y-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Tip amount (TFUEL)"
                              value={tipAmount}
                              onChange={(e) => setTipAmount(e.target.value)}
                              className="w-full rounded-xl border border-purple-400/30 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                            />
                            <NeonButton
                              label="Send Tip"
                              rightHint="on-chain"
                              onClick={() => tipPool(1, tipAmount || '0.1')}
                              disabled={poolLoading || !tipAmount}
                            />
                          </div>
                          <div className="mt-2">
                            <NeonButton
                              label="End Pool & Draw Winner"
                              rightHint="VRF lottery"
                              variant="secondary"
                              onClick={() => endPoolAndDraw(1)}
                              disabled={poolLoading}
                            />
                          </div>
                        </>
                      )}
                      {!TIP_POOL_ADDRESS && (
                        <p className="mt-3 text-[10px] text-slate-500">
                          Tip Pool contract address not configured
                        </p>
                      )}
                    </GlassCard>

                    <GlassCard className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
                          Creator pools
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                            🎟️ Raffle
                          </span>
                          <span className="text-[11px] font-semibold text-purple-300">
                            {currentApy.toFixed(1)}% APY
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        Group tips per creator into shared pools that compound yield between drops,
                        tours, and streams. Lottery draws when pool ends. <span className="text-amber-300/80">High-value pools include NFT raffles!</span>
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                        <span>Active pools</span>
                        <span className="font-mono text-emerald-300">
                          {TIP_POOL_ADDRESS ? 'Connected' : 'Not configured'}
                        </span>
                      </div>
                      {wallet.isConnected && TIP_POOL_ADDRESS && (
                        <div className="mt-3">
                          <NeonButton
                            label="Create New Pool"
                            rightHint="24h duration"
                            variant="secondary"
                            onClick={() => setShowCreatePoolModal(true)}
                            disabled={poolLoading}
                          />
                        </div>
                      )}
                    </GlassCard>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Tip pools use weighted random selection (VRF) to pick winners. Winner gets 90% of
                    pool, creator receives 10% cut. All payouts are automatic on-chain.
                  </p>
                </div>
              )}

              {activeTab === 'mining' && (
                <EdgeNodeDashboard
                  walletAddress={wallet.fullAddress}
                  walletBalance={wallet.balance}
                  onPumpEarnings={handlePumpEarnings}
                />
              )}

              {activeTab === 'creator' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                        Creator Dashboard
                      </p>
                      <h2 className="mt-1 text-2xl font-bold text-white">My Active Pools</h2>
                    </div>
                    <NeonButton
                      label="Create New Pool"
                      rightHint="24h default"
                      onClick={() => setShowCreatePoolModal(true)}
                    />
                  </div>

                  {/* My Active Pools List */}
                  <div className="space-y-3">
                    {/* Mock active pools */}
                    {[
                      { id: 1, name: 'Main Stage Arena', pot: 12430, tips: 47, endsAt: Date.now() + 86400000, hasRaffle: true },
                      { id: 2, name: 'Creator Pool #42', pot: 5420, tips: 23, endsAt: Date.now() + 172800000, hasRaffle: false },
                    ].map((pool) => {
                      const hoursLeft = Math.max(0, Math.floor((pool.endsAt - Date.now()) / 3600000))
                      const minutesLeft = Math.max(0, Math.floor(((pool.endsAt - Date.now()) % 3600000) / 60000))
                      return (
                        <GlassCard key={pool.id} className="p-5">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="text-lg font-semibold text-white">{pool.name}</h3>
                                {pool.hasRaffle && (
                                  <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                                    🎟️ Raffle
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-4 mt-3">
                                <div>
                                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Pot Size</p>
                                  <p className="mt-1 text-xl font-bold text-cyan-300">{pool.pot.toLocaleString()} TFUEL</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Tips</p>
                                  <p className="mt-1 text-xl font-bold text-purple-300">{pool.tips}</p>
                                </div>
                              </div>
                              <div className="mt-3">
                                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Ends In</p>
                                <p className="mt-1 text-sm font-mono text-emerald-300">
                                  {hoursLeft}h {minutesLeft}m
                                </p>
                              </div>
                            </div>
                          </div>
                        </GlassCard>
                      )
                    })}
                  </div>

                  {/* Earnings Card */}
                  <GlassCard className="p-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70 mb-4">
                      Earnings & Your Cut
                    </p>
                    <div className="space-y-4">
                      <div>
                        <p className="text-3xl font-bold text-white">$1,247.50</p>
                        <p className="text-sm text-slate-400 mt-1">Total earnings (all time)</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-purple-400/20">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Your Cut (10%)</p>
                          <p className="mt-1 text-lg font-semibold text-purple-300">$124.75</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">Winners (90%)</p>
                          <p className="mt-1 text-lg font-semibold text-cyan-300">$1,122.75</p>
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                </div>
              )}

              {activeTab === 'profile' && (
                <div className="space-y-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Session profile
                  </p>
                  {!wallet.isConnected && (
                    <div className="space-y-6">
                      {/* Hero section with connect button */}
                      <div className="relative overflow-hidden rounded-3xl border-2 border-purple-400/60 bg-gradient-to-br from-[rgba(168,85,247,0.25)] via-[rgba(56,189,248,0.15)] to-[rgba(15,23,42,0.40)] p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.7),inset_0_0_40px_rgba(168,85,247,0.15)]">
                        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl" />
                        <div className="absolute -left-8 -bottom-8 h-40 w-40 rounded-full bg-cyan-500/20 blur-3xl" />
                        
                        <div className="relative text-center">
                          <div className="mb-4 flex justify-center">
                            <div className="rounded-full border-2 border-purple-400/50 bg-gradient-to-br from-purple-500/30 to-cyan-500/20 p-6 shadow-[0_0_40px_rgba(168,85,247,0.6)]">
                              <span className="text-6xl">👤</span>
                            </div>
                          </div>
                          
                          <h2 className="mb-3 text-3xl font-bold text-white uppercase tracking-[0.12em]" style={{
                            textShadow: '0 0 30px rgba(168, 85, 247, 0.8), 0 0 50px rgba(168, 85, 247, 0.4)',
                          }}>
                            Connect Your Wallet
                          </h2>
                          
                          <p className="mb-6 text-sm text-slate-300/90 max-w-md mx-auto">
                            View your live balances, yield history, swap activity, and track your earning streak across the Theta and Cosmos ecosystems.
                          </p>
                          
                          <div className="flex justify-center">
                            <div className="w-full max-w-xs">
                              <NeonButton
                                label="Connect Theta Wallet"
                                onClick={connectWallet}
                                rightHint="secure"
                                variant="primary"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Feature cards preview */}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="rounded-2xl border border-purple-400/30 bg-gradient-to-br from-[rgba(15,23,42,0.9)] to-[rgba(30,41,59,0.7)] p-5 backdrop-blur-sm">
                          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-purple-400/40 bg-purple-500/20">
                            <span className="text-2xl">💰</span>
                          </div>
                          <h3 className="mb-2 text-sm font-bold text-purple-300 uppercase tracking-wider">Live Balances</h3>
                          <p className="text-xs text-slate-400">TFUEL, USDC, rXF, and LST positions</p>
                        </div>

                        <div className="rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-[rgba(15,23,42,0.9)] to-[rgba(30,41,59,0.7)] p-5 backdrop-blur-sm">
                          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/20">
                            <span className="text-2xl">📊</span>
                          </div>
                          <h3 className="mb-2 text-sm font-bold text-cyan-300 uppercase tracking-wider">Yield History</h3>
                          <p className="text-xs text-slate-400">Track daily earnings and APY performance</p>
                        </div>

                        <div className="rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-[rgba(15,23,42,0.9)] to-[rgba(30,41,59,0.7)] p-5 backdrop-blur-sm">
                          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/20">
                            <span className="text-2xl">🔥</span>
                          </div>
                          <h3 className="mb-2 text-sm font-bold text-emerald-300 uppercase tracking-wider">Streak Counter</h3>
                          <p className="text-xs text-slate-400">Build your daily activity streak</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {wallet.isConnected && !isSignedIn && (
                    <div className="space-y-6">
                      <div className="mb-6 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-slate-400/80 uppercase tracking-wider">Connected</p>
                          <p className="mt-1 text-lg font-mono text-emerald-300">{wallet.address}</p>
                        </div>
                        <div className="rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-2">
                          <p className="text-xs font-semibold text-emerald-300">● Live</p>
                        </div>
                      </div>

                      {/* Live Balances Section */}
                      <div className="mb-6">
                        <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-slate-300/80">
                          💰 Live Balances
                        </h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {/* TFUEL Balance */}
                          <div className="relative overflow-hidden rounded-2xl border border-purple-400/40 bg-gradient-to-br from-[rgba(168,85,247,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">TFUEL</p>
                            <p className="mt-2 text-2xl font-bold text-white">{wallet.balance}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {tfuelPrice ? `~$${(numericBalance * tfuelPrice).toFixed(2)}` : '—'}
                            </p>
                          </div>

                          {/* USDC Balance (placeholder) */}
                          <div className="relative overflow-hidden rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-[rgba(56,189,248,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">USDC</p>
                            <p className="mt-2 text-2xl font-bold text-white">0.00</p>
                            <p className="mt-1 text-xs text-slate-400">$0.00</p>
                          </div>

                          {/* rXF Balance (placeholder) */}
                          <div className="relative overflow-hidden rounded-2xl border border-pink-400/40 bg-gradient-to-br from-[rgba(236,72,153,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">rXF</p>
                            <p className="mt-2 text-2xl font-bold text-white">0.00</p>
                            <p className="mt-1 text-xs text-slate-400">Reward XF</p>
                          </div>

                          {/* LST Balance (placeholder - Keplr) */}
                          <div className="relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-[rgba(16,185,129,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">LSTs</p>
                            <p className="mt-2 text-2xl font-bold text-white">—</p>
                            <p className="mt-1 text-xs text-slate-400">Connect Keplr</p>
                          </div>
                        </div>
                      </div>

                      {/* Sign in prompt */}
                      <div className="rounded-2xl border border-purple-400/40 bg-gradient-to-br from-[rgba(168,85,247,0.1)] to-[rgba(15,23,42,0.6)] p-6 backdrop-blur-sm">
                        <p className="mb-4 text-sm text-slate-200">
                          Sign a message to unlock full features: arenas, creator dashboards, and fan badges.
                        </p>
                        <div className="max-w-xs">
                          <NeonButton
                            label="Sign in with wallet"
                            rightHint="non-custodial"
                            onClick={handleWalletSignIn}
                          />
                        </div>
                      </div>

                      {/* Basic Activity Preview */}
                      <div className="mt-6">
                        <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-slate-300/80">
                          📊 Recent Activity
                        </h3>
                        {swapHistory.length === 0 ? (
                          <div className="rounded-2xl border border-purple-400/30 bg-gradient-to-br from-[rgba(15,23,42,0.9)] to-[rgba(30,41,59,0.7)] p-8 text-center backdrop-blur-sm">
                            <p className="text-sm text-slate-400">No swap activity yet</p>
                            <p className="mt-2 text-xs text-slate-500">
                              Make your first swap to start tracking earnings
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {swapHistory.slice(0, 3).map((tx) => (
                              <div
                                key={tx.id}
                                className="rounded-2xl border border-purple-400/30 bg-gradient-to-r from-[rgba(15,23,42,0.8)] to-[rgba(30,41,59,0.6)] p-4 backdrop-blur-sm"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-semibold text-white">
                                      {tx.amount.toFixed(2)} TFUEL → {tx.outputAmount.toFixed(4)} {tx.targetLST}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-400">
                                      {new Date(tx.timestamp).toLocaleDateString()}
                                    </p>
                                  </div>
                                  <span className="text-xl">✅</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {wallet.isConnected && isSignedIn && (
                    <>
                      <div className="mb-6 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-slate-400/80 uppercase tracking-wider">Welcome back</p>
                          <p className="mt-1 text-2xl font-bold text-white">
                            <span className="text-purple-300">
                              {userAlias ?? wallet.address}
                            </span>
                          </p>
                        </div>
                        <div className="rounded-full border border-emerald-400/50 bg-emerald-500/10 px-4 py-2">
                          <p className="text-xs font-semibold text-emerald-300">● Connected</p>
                        </div>
                      </div>

                      {/* Live Balances Section */}
                      <div className="mb-6">
                        <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-slate-300/80">
                          💰 Live Balances
                        </h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {/* TFUEL Balance */}
                          <div className="relative overflow-hidden rounded-2xl border border-purple-400/40 bg-gradient-to-br from-[rgba(168,85,247,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">TFUEL</p>
                            <p className="mt-2 text-2xl font-bold text-white">{wallet.balance}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {tfuelPrice ? `~$${(numericBalance * tfuelPrice).toFixed(2)}` : '—'}
                            </p>
                          </div>

                          {/* USDC Balance (placeholder) */}
                          <div className="relative overflow-hidden rounded-2xl border border-cyan-400/40 bg-gradient-to-br from-[rgba(56,189,248,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">USDC</p>
                            <p className="mt-2 text-2xl font-bold text-white">0.00</p>
                            <p className="mt-1 text-xs text-slate-400">$0.00</p>
                          </div>

                          {/* rXF Balance (placeholder) */}
                          <div className="relative overflow-hidden rounded-2xl border border-pink-400/40 bg-gradient-to-br from-[rgba(236,72,153,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">rXF</p>
                            <p className="mt-2 text-2xl font-bold text-white">0.00</p>
                            <p className="mt-1 text-xs text-slate-400">Reward XF</p>
                          </div>

                          {/* LST Balance (placeholder - Keplr) */}
                          <div className="relative overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-[rgba(16,185,129,0.15)] to-[rgba(15,23,42,0.8)] p-4 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">LSTs</p>
                            <p className="mt-2 text-2xl font-bold text-white">—</p>
                            <p className="mt-1 text-xs text-slate-400">Connect Keplr</p>
                          </div>
                        </div>
                      </div>

                      {/* My Activity / Earnings Summary Section */}
                      <div className="mt-6">
                        <h3 className="mb-4 text-lg font-semibold text-white uppercase tracking-[0.18em] text-purple-300/90" style={{
                          textShadow: '0 0 20px rgba(168, 85, 247, 0.8), 0 0 40px rgba(168, 85, 247, 0.4)',
                        }}>
                          ⚡ Earnings Summary
                        </h3>
                        
                        {/* Streak & Daily Earnings Cards */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
                          {/* Day Streak Badge */}
                          <div className="relative overflow-hidden rounded-3xl border-2 border-purple-400/70 bg-gradient-to-br from-[rgba(168,85,247,0.35)] via-[rgba(139,92,246,0.25)] to-[rgba(15,23,42,0.40)] p-6 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.8),inset_0_0_40px_rgba(168,85,247,0.2)] transition-all hover:shadow-[0_0_80px_rgba(168,85,247,1),inset_0_0_50px_rgba(168,85,247,0.3)]">
                            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-purple-500/20 blur-3xl" />
                            <p className="relative text-[11px] uppercase tracking-[0.22em] text-purple-200/80">
                              🔥 Streak
                            </p>
                            <div className="relative mt-3 flex items-baseline gap-3">
                              <p className="text-6xl font-bold text-purple-300 drop-shadow-[0_0_30px_rgba(168,85,247,1),0_0_60px_rgba(168,85,247,0.6)]">
                                12
                              </p>
                              <div>
                                <p className="text-lg font-bold text-purple-200">days</p>
                                <p className="text-xs text-slate-300/70">Keep it going!</p>
                              </div>
                            </div>
                            <div className="relative mt-4 flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-purple-900/50">
                                <div 
                                  className="h-full bg-gradient-to-r from-purple-400 to-pink-500 shadow-[0_0_15px_rgba(168,85,247,0.8)]"
                                  style={{ width: '80%' }}
                                />
                              </div>
                              <span className="text-xs font-semibold text-purple-300">80%</span>
                            </div>
                            <p className="relative mt-2 text-xs text-slate-400">to 🏆 15-day milestone</p>
                          </div>

                          {/* Daily Earnings */}
                          <div className="relative overflow-hidden rounded-3xl border-2 border-cyan-400/70 bg-gradient-to-br from-[rgba(56,189,248,0.35)] via-[rgba(34,211,238,0.25)] to-[rgba(15,23,42,0.40)] p-6 backdrop-blur-xl shadow-[0_0_60px_rgba(56,189,248,0.8),inset_0_0_40px_rgba(56,189,248,0.2)] transition-all hover:shadow-[0_0_80px_rgba(56,189,248,1),inset_0_0_50px_rgba(56,189,248,0.3)]">
                            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-cyan-500/20 blur-3xl" />
                            <p className="relative text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">
                              💰 Daily Earnings
                            </p>
                            <div className="relative mt-3">
                              <p className="text-5xl font-bold text-cyan-300 drop-shadow-[0_0_30px_rgba(56,189,248,1),0_0_60px_rgba(56,189,248,0.6)]">
                                {tfuelPrice && numericBalance > 0
                                  ? `$${((numericBalance * tfuelPrice * currentApy) / 100 / 365).toFixed(2)}`
                                  : '$0.00'}
                              </p>
                              <p className="mt-2 text-sm font-semibold text-cyan-200">
                                ~{((numericBalance * currentApy) / 100 / 365).toFixed(4)} TFUEL
                              </p>
                            </div>
                            <div className="relative mt-4 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2">
                              <p className="text-xs text-emerald-300">
                                <span className="font-semibold">{currentApy.toFixed(1)}% APY</span>
                                <span className="text-slate-300/70"> on {selectedLST.name}</span>
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Activity History */}
                        <div className="relative overflow-hidden rounded-3xl border-2 border-purple-400/50 bg-gradient-to-br from-[rgba(15,23,42,0.95)] via-[rgba(30,41,59,0.9)] to-[rgba(15,23,42,0.95)] p-6 backdrop-blur-xl shadow-[0_0_40px_rgba(168,85,247,0.4)]">
                          <h4 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-purple-300">
                            <span>📊</span>
                            Activity History
                          </h4>
                          
                          {swapHistory.length === 0 ? (
                            <div className="py-8 text-center">
                              <p className="text-sm text-slate-400">No activity yet</p>
                              <p className="mt-2 text-xs text-slate-500">
                                Your swap history will appear here
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-3 max-h-80 overflow-y-auto">
                              {swapHistory.slice(0, 7).map((tx, idx) => {
                                const dailyYield = (tx.outputAmount * currentApy) / 100 / 365
                                const dailyYieldUSD = tfuelPrice ? dailyYield * tfuelPrice : 0
                                return (
                                  <div
                                    key={tx.id}
                                    className="group relative overflow-hidden rounded-2xl border border-purple-400/30 bg-gradient-to-r from-[rgba(15,23,42,0.8)] to-[rgba(30,41,59,0.6)] p-4 backdrop-blur-sm transition-all hover:border-purple-400/60 hover:shadow-[0_0_25px_rgba(168,85,247,0.4)]"
                                  >
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                          <span className="text-xl">{idx === 0 ? '🔥' : '✅'}</span>
                                          <p className="text-sm font-semibold text-white">
                                            {tx.amount.toFixed(2)} TFUEL → {tx.outputAmount.toFixed(4)} {tx.targetLST}
                                          </p>
                                          {tx.simulated && (
                                            <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                                              Test
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex flex-col gap-1 text-xs">
                                          <p className="text-slate-400">
                                            {new Date(tx.timestamp).toLocaleDateString('en-US', {
                                              month: 'short',
                                              day: 'numeric',
                                              year: 'numeric',
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}
                                          </p>
                                          <p className="text-emerald-300 font-semibold">
                                            +{tfuelPrice ? `$${dailyYieldUSD.toFixed(2)}` : `${dailyYield.toFixed(4)} TFUEL`}/day
                                          </p>
                                        </div>
                                      </div>
                                      <a
                                        href={`${THETA_MAINNET.explorerUrl}/tx/${tx.txHash}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex-shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-all hover:border-cyan-400/70 hover:bg-cyan-500/20 hover:shadow-[0_0_15px_rgba(56,189,248,0.4)]"
                                      >
                                        View
                                      </a>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          
                          {swapHistory.length > 7 && (
                            <div className="mt-4 text-center">
                              <p className="text-xs text-slate-500">
                                Showing last 7 transactions
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Stats Grid */}
                      <div className="mt-6">
                        <h4 className="mb-3 text-sm font-semibold text-slate-300/80 uppercase tracking-[0.14em]">
                          Stats
                        </h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-[11px]">
                          <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3">
                            <p className="text-slate-400">Net APY target</p>
                            <p className="mt-1 text-base text-emerald-300">
                              {currentApy.toFixed(1)}%
                            </p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3">
                            <p className="text-slate-400">Preferred lane</p>
                            <p className="mt-1 text-base text-cyan-300">{selectedLST.name}</p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3">
                            <p className="text-slate-400">Risk guard</p>
                            <p className="mt-1 text-base text-emerald-300">Chainalysis 100/100</p>
                          </div>
                        </div>
                      </div>

                      {/* My NFTs & Raffles */}
                      <div className="mt-6">
                        <h3 className="mb-4 text-lg font-semibold text-white">My NFTs & Raffles</h3>
                        {myNFTs.length === 0 ? (
                          <GlassCard className="p-6 text-center">
                            <p className="text-sm text-slate-300/80 mb-2">No NFT wins yet</p>
                            <p className="text-xs text-slate-400">
                              Tip $100+ in pools with raffle flags to enter NFT raffles!
                            </p>
                          </GlassCard>
                        ) : (
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {myNFTs.map((nft) => (
                              <GlassCard key={nft.id} className="p-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-purple-400/60 bg-gradient-to-br from-purple-500/40 to-cyan-500/30">
                                    <span className="text-3xl">🏆</span>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold text-white">{nft.name}</h4>
                                    <p className="text-xs text-purple-300 mt-1">{nft.rarity}</p>
                                    <p className="text-xs text-slate-400 mt-1">Won ${nft.winAmount.toLocaleString()}</p>
                                  </div>
                                </div>
                              </GlassCard>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </GlassCard>

            {/* Bottom-row bubbles: APY selector for core tabs, tip bubbles only for Tip Pools */}
            {activeTab === 'tip-pools' ? (
              <div className="mt-6 flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs text-slate-300/80">
                  <span className="uppercase tracking-[0.18em] text-slate-400/90">Tip pools</span>
                  <span className="text-[11px] text-purple-200/80">Fans → shared yield</span>
                </div>
                <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2 pt-2">
                  <button
                    type="button"
                    className="bubble-glow xfuel-tap-glow group relative flex min-w-[180px] flex-col items-start gap-1 rounded-full border border-purple-400/80 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.45),transparent_55%),rgba(15,23,42,0.9)] px-5 py-3 text-left backdrop-blur-xl transition-all hover:scale-105"
                  >
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-50">
                      Main Stage
                    </span>
                    <span className="flex items-baseline gap-1 text-sm font-semibold text-emerald-300 drop-shadow-[0_0_12px_rgba(16,185,129,0.9)]">
                      12,430 XFUEL
                      <span className="text-[10px] font-normal uppercase tracking-[0.14em] text-slate-300/80">
                        24h tips
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="bubble-glow xfuel-tap-glow group relative flex min-w-[180px] flex-col items-start gap-1 rounded-full border border-pink-400/70 bg-[radial-gradient(circle_at_top,_rgba(236,72,153,0.4),transparent_55%),rgba(15,23,42,0.9)] px-5 py-3 text-left backdrop-blur-xl transition-all hover:scale-105"
                    style={{
                      boxShadow: '0 0 32px rgba(236,72,153,0.8), 0 0 64px rgba(236,72,153,0.4)',
                    }}
                  >
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-50">
                      Creator Pools
                    </span>
                    <span className="flex items-baseline gap-1 text-sm font-semibold text-cyan-300 drop-shadow-[0_0_12px_rgba(56,189,248,0.9)]">
                      87 active
                      <span className="text-[10px] font-normal uppercase tracking-[0.14em] text-slate-300/80">
                        stars
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="bubble-glow xfuel-tap-glow group relative flex min-w-[180px] flex-col items-start gap-1 rounded-full border border-cyan-400/70 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.4),transparent_55%),rgba(15,23,42,0.9)] px-5 py-3 text-left backdrop-blur-xl transition-all hover:scale-105"
                    style={{
                      boxShadow: '0 0 32px rgba(56,189,248,0.85), 0 0 64px rgba(56,189,248,0.4)',
                    }}
                  >
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-50">
                      Fan Badges
                    </span>
                    <span className="flex items-baseline gap-1 text-sm font-semibold text-emerald-300 drop-shadow-[0_0_12px_rgba(16,185,129,0.9)]">
                      LVL 03
                      <span className="text-[10px] font-normal uppercase tracking-[0.14em] text-slate-300/80">
                        early
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <YieldBubbleSelector
                options={LST_OPTIONS}
                selected={selectedLST}
                onSelect={setSelectedLST}
              />
            )}

            {/* Footer tagline */}
            <p className="pt-2 text-center text-[11px] text-slate-400/80 sm:text-xs">
              Theta EdgeCloud GPU / video revenue → auto-compounding Cosmos LSTs in one tap.
            </p>
            
            {/* Footer Support Email */}
            <div className="pt-4 text-center">
              <p className="text-xs text-slate-400/70 sm:text-sm">
                <span className="text-slate-500/80">Support: </span>
                <a
                  href="mailto:xfuel.support@xfuel.app"
                  className="text-purple-300 transition-all hover:text-purple-200"
                  style={{
                    textShadow: '0 0 10px rgba(139, 92, 246, 0.8), 0 0 20px rgba(139, 92, 246, 0.6)',
                  }}
                >
                  xfuel.support@xfuel.app
                </a>
              </p>
            </div>
          </div>
        </main>
      </div>

      {/* Create Pool Modal */}
      <CreatePoolModal
        visible={showCreatePoolModal}
        onClose={() => setShowCreatePoolModal(false)}
        onCreate={async (duration) => {
          await createPool(duration)
        }}
        loading={poolLoading}
      />

      {/* Lottery Win Explosion */}
      <LotteryWinExplosion
        visible={showWinExplosion}
        winAmount={winAmount}
        nft={winNFT}
        onClose={() => {
          setShowWinExplosion(false)
          if (winNFT) {
            setMyNFTs((prev) => [...prev, {
              ...winNFT,
              poolId: 1,
              winAmount: winAmount,
            }])
          }
        }}
        apy={currentApy}
      />

      {/* Early Believers Modal */}
      <EarlyBelieversModal
        visible={showEarlyBelieversModal}
        onClose={() => setShowEarlyBelieversModal(false)}
        walletAddress={wallet.fullAddress}
        onConnectWallet={connectWallet}
        isMainnet={true}
      />
    </ScreenBackground>
  )
}

export default App


