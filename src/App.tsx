import { useEffect, useMemo, useState } from 'react'
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
import { THETA_TESTNET, ROUTER_ADDRESS, TIP_POOL_ADDRESS, ROUTER_ABI, TIP_POOL_ABI, ERC20_ABI } from './config/thetaConfig'
import { APP_CONFIG, MOCK_ROUTER_ADDRESS } from './config/appConfig'

type SwapStatus = 'idle' | 'approving' | 'swapping' | 'success' | 'error'

interface WalletInfo {
  address: string | null
  fullAddress: string | null // Store full address for contract calls
  balance: string
  isConnected: boolean
}

const LST_OPTIONS: LSTOption[] = [
  { name: 'stkTIA', apy: 38.2 },
  { name: 'stkATOM', apy: 32.5 },
  { name: 'stkXPRT', apy: 28.7 },
  { name: 'pSTAKE BTC', apy: 25.4 },
  { name: 'stkOSMO', apy: 22.1 },
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
  const [showPercentageDropdown, setShowPercentageDropdown] = useState(false)
  const [showLSTDropdown, setShowLSTDropdown] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [faucetLoading, setFaucetLoading] = useState(false)
  const [tipPools, setTipPools] = useState<any[]>([])
  const [mockMode, setMockMode] = useState(APP_CONFIG.USE_MOCK_MODE)
  const [balanceRefreshInterval, setBalanceRefreshInterval] = useState<NodeJS.Timeout | null>(null)
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false)
  const [showWinExplosion, setShowWinExplosion] = useState(false)
  const [winAmount, setWinAmount] = useState(0)
  const [winNFT, setWinNFT] = useState<{ id: string; name: string; rarity: 'Mythic' | 'Legendary' | 'Epic' | 'Rare' } | undefined>(undefined)
  const [enteredRaffles, setEnteredRaffles] = useState<Set<number>>(new Set())
  const [myNFTs, setMyNFTs] = useState<Array<{ id: string; name: string; rarity: 'Mythic' | 'Legendary' | 'Epic' | 'Rare'; poolId: number; winAmount: number }>>([])

  const numericBalance = useMemo(
    () => parseFloat(wallet.balance.replace(/,/g, '')) || 0,
    [wallet.balance],
  )

  const liveApyText = useMemo(() => `${selectedLST.apy.toFixed(1)}%`, [selectedLST.apy])

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
          const ethersProvider = new ethers.providers.Web3Provider(provider)
          const balance = await ethersProvider.getBalance(address)
          const balanceFormatted = parseFloat(ethers.utils.formatEther(balance)).toLocaleString('en-US', {
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
      const ethersProvider = new ethers.providers.Web3Provider(provider)
      const balance = await ethersProvider.getBalance(address)
      const balanceFormatted = parseFloat(ethers.utils.formatEther(balance)).toLocaleString('en-US', {
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
    setSelectedPercentage(pct)
    if (wallet.isConnected && numericBalance > 0) {
      const amount = (numericBalance * pct) / 100
      setTfuelAmount(amount.toFixed(2))
    }
    setShowPercentageDropdown(false)
  }

  const handleLSTSelect = (lst: LSTOption) => {
    setSelectedLST(lst)
    setShowLSTDropdown(false)
  }

  const computedTfuelAmount = useMemo(() => {
    if (selectedPercentage !== null && wallet.isConnected && numericBalance > 0) {
      return (numericBalance * selectedPercentage) / 100
    }
    return parseFloat(tfuelAmount) || 0
  }, [selectedPercentage, numericBalance, wallet.isConnected, tfuelAmount])

  const estimatedLSTAmount = useMemo(() => {
    return computedTfuelAmount * 0.95 // Mock: 5% fee
  }, [computedTfuelAmount])

  const estimatedDailyYield = useMemo(() => {
    return (estimatedLSTAmount * selectedLST.apy) / 100 / 365
  }, [estimatedLSTAmount, selectedLST.apy])

  const handleSwapFlow = async () => {
    if (!wallet.isConnected || !wallet.fullAddress) {
      setStatusMessage('Connect wallet first')
      setSwapStatus('error')
      return
    }

    const amount = computedTfuelAmount
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatusMessage('Select balance percentage and valid amount')
      setSwapStatus('error')
      return
    }

    // Check if user has enough balance (with small buffer for gas)
    const minRequired = amount + 0.01 // Add small buffer for gas
    if (numericBalance < minRequired) {
      setStatusMessage(`Insufficient balance. Need ${minRequired.toFixed(2)} TFUEL (including gas).`)
      setSwapStatus('error')
      // Show faucet button suggestion
      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 5000)
      return
    }

    // Use real router if address is set, otherwise use mock
    const useMock = !ROUTER_ADDRESS || mockMode
    const routerAddress = useMock ? MOCK_ROUTER_ADDRESS : ROUTER_ADDRESS

    if (useMock) {
      // Mock mode: simulate swap without on-chain transaction
      setSwapStatus('swapping')
      setStatusMessage(`Simulating swap: ${amount.toFixed(2)} TFUEL → ${selectedLST.name}…`)
      
      // Simulate transaction delay
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Generate mock tx hash
      const mockTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
      setTxHash(mockTxHash)
      
      // Trigger confetti
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#a855f7', '#06b6d4', '#ec4899', '#10b981'],
      })

      setStatusMessage(
        `✅ Staked into ${selectedLST.name} — earning ${selectedLST.apy.toFixed(1)}% APY (Mock Mode)`,
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
    }

    // Real on-chain swap flow on Theta testnet
    try {
      const provider = new ethers.providers.Web3Provider(
        (window as any).theta || (window as any).ethereum,
      )
      const signer = provider.getSigner()
      const amountWei = ethers.utils.parseEther(amount.toString())

      // Check balance one more time before sending
      const balanceWei = await provider.getBalance(wallet.fullAddress)
      const balanceEth = parseFloat(ethers.utils.formatEther(balanceWei))
      
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

      const routerContract = new ethers.Contract(routerAddress, ROUTER_ABI, signer)

      // Call swapAndStake with native TFUEL (msg.value)
      // TFUEL is native token, so no approval needed - just send via msg.value
      const tx = await routerContract.swapAndStake(amountWei, selectedLST.name, {
        value: amountWei, // Send native TFUEL
        gasLimit: 500000, // Adjust as needed
      })

      setTxHash(tx.hash)
      setStatusMessage(`Transaction sent! Waiting for confirmation…`)

      // Wait for confirmation
      const receipt = await tx.wait()
      
      // Trigger confetti animation on success
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#a855f7', '#06b6d4', '#ec4899', '#10b981'],
      })

      setStatusMessage(
        `✅ Staked into ${selectedLST.name} — earning ${selectedLST.apy.toFixed(1)}% APY`,
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
      
      // Handle specific error cases
      let errorMessage = e?.message ?? 'Unexpected error'
      if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance') || errorMessage.includes('insufficient funds for gas')) {
        errorMessage = 'Insufficient TFUEL balance. Get test TFUEL from faucet.'
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('User denied') || errorMessage.includes('rejected')) {
        errorMessage = 'Transaction rejected by user'
      } else if (errorMessage.includes('network') || errorMessage.includes('Network')) {
        errorMessage = 'Network error. Please check your connection.'
      }
      
      setStatusMessage(`Failed: ${errorMessage}`)
      setSwapStatus('error')
      setTxHash(null)

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 5000)
    }
  }

  const [poolLoading, setPoolLoading] = useState(false)
  const [tipAmount, setTipAmount] = useState('')

  // Load tip pools from chain
  const loadTipPools = async () => {
    if (!TIP_POOL_ADDRESS || !wallet.isConnected) return

    try {
      const provider = new ethers.providers.Web3Provider(
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
      const provider = new ethers.providers.Web3Provider(
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
      const provider = new ethers.providers.Web3Provider(
        (window as any).ethereum || (window as any).theta,
      )
      const signer = provider.getSigner()
      const tipPoolContract = new ethers.Contract(TIP_POOL_ADDRESS, TIP_POOL_ABI, signer)
      const amountWei = ethers.utils.parseEther(amount)

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
      const provider = new ethers.providers.Web3Provider(
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

    // Set active tab based on current path
    if (window.location.pathname === '/liquidity' || window.location.pathname === '/liquidity/') {
      setActiveTab('liquidity')
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
      const provider = new ethers.providers.Web3Provider(
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
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 via-cyan-400 to-pink-500 shadow-[0_0_40px_rgba(168,85,247,0.9)] sm:h-14 sm:w-14">
              <span className="text-2xl font-black tracking-tight text-white sm:text-3xl">X</span>
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
              {/* Mock Mode Toggle */}
              {(!ROUTER_ADDRESS || mockMode) && (
                <div className="w-full sm:w-auto">
                  <button
                    onClick={() => setMockMode(!mockMode)}
                    className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300 transition-colors hover:bg-amber-500/20"
                    title={mockMode ? 'Using mock mode (no real transactions)' : 'Switch to mock mode'}
                  >
                    {mockMode ? 'Mock Mode' : 'Real Mode'}
                  </button>
                </div>
              )}
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
                if (id === 'liquidity') {
                  window.location.href = '/liquidity'
                } else {
                  setActiveTab(id)
                }
              }}
              tabs={[
                { id: 'swap', label: 'Swap', pill: 'live' },
                { id: 'liquidity', label: 'Liquidity', pill: 'pool' },
                { id: 'staking', label: 'Staking', pill: 'apy lanes' },
                { id: 'tip-pools', label: 'Tip Pools', pill: 'fans' },
                { id: 'creator', label: 'Creator', pill: 'dashboard' },
                { id: 'mining', label: 'Mining', pill: 'edge' },
                { id: 'profile', label: 'Profile', pill: 'wallet' },
              ]}
            />

            <GlassCard>
                  {activeTab === 'swap' && (
                <>
                  {/* Wallet connection */}
                  {!wallet.isConnected ? (
                    <div className="mb-6">
                      <NeonButton
                        label="Connect Theta Wallet"
                        onClick={connectWallet}
                        rightHint="mock"
                      />
                    </div>
                  ) : (
                    <div className="mb-6 space-y-4">
                      {/* Wallet info */}
                      <div className="flex items-center justify-between rounded-2xl border border-purple-400/30 bg-black/20 px-4 py-3 backdrop-blur-sm">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                            Connected
                          </p>
                          <p className="mt-1 text-sm font-mono text-emerald-300">{wallet.address}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-white">{wallet.balance}</p>
                          <p className="text-xs text-slate-400">TFUEL</p>
                          {numericBalance < 0.1 && (
                            <p className="mt-1 text-[10px] text-amber-400">Low balance</p>
                          )}
                        </div>
                      </div>

                      {/* Big percentage dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowPercentageDropdown(!showPercentageDropdown)}
                          disabled={!wallet.isConnected}
                          className="w-full rounded-3xl border border-purple-400/60 bg-gradient-to-br from-[rgba(168,85,247,0.25)] via-[rgba(56,189,248,0.20)] to-[rgba(15,23,42,0.30)] px-8 py-6 text-left backdrop-blur-xl transition-all hover:border-purple-400/80 hover:shadow-[0_0_40px_rgba(168,85,247,0.6)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                            Balance to swap
                          </p>
                          <p className="mt-2 text-3xl font-bold text-white">
                            {selectedPercentage !== null ? `${selectedPercentage}%` : 'Select %'}
                          </p>
                          {selectedPercentage !== null && numericBalance > 0 && (
                            <p className="mt-1 text-sm text-purple-300">
                              {((numericBalance * selectedPercentage) / 100).toFixed(2)} TFUEL
                            </p>
                          )}
                        </button>
                        {showPercentageDropdown && wallet.isConnected && (
                          <div className="absolute top-full z-50 mt-2 w-full rounded-2xl border border-purple-400/40 bg-[rgba(15,23,42,0.98)] backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.8)]">
                            {[25, 50, 75, 100].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => handlePercentageSelect(pct)}
                                className="w-full px-6 py-4 text-left transition-colors hover:bg-purple-500/10 first:rounded-t-2xl last:rounded-b-2xl"
                              >
                                <p className="text-lg font-semibold text-white">{pct}%</p>
                                <p className="text-sm text-purple-300">
                                  {((numericBalance * pct) / 100).toFixed(2)} TFUEL
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Big LST dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowLSTDropdown(!showLSTDropdown)}
                          className="w-full rounded-3xl border border-purple-400/60 bg-gradient-to-br from-[rgba(168,85,247,0.25)] via-[rgba(56,189,248,0.20)] to-[rgba(15,23,42,0.30)] px-8 py-6 text-left backdrop-blur-xl transition-all hover:border-purple-400/80 hover:shadow-[0_0_40px_rgba(168,85,247,0.6)]"
                        >
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                            Liquid staking token
                          </p>
                          <div className="mt-2 flex items-baseline gap-3">
                            <p className="text-2xl font-bold text-white">{selectedLST.name}</p>
                            <p className="text-lg font-semibold text-emerald-300">
                              {selectedLST.apy.toFixed(1)}% APY
                            </p>
                          </div>
                        </button>
                        {showLSTDropdown && (
                          <div className="absolute top-full z-50 mt-2 w-full rounded-2xl border border-purple-400/40 bg-[rgba(15,23,42,0.98)] backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.8)]">
                            {LST_OPTIONS.map((lst) => (
                              <button
                                key={lst.name}
                                type="button"
                                onClick={() => handleLSTSelect(lst)}
                                className="w-full px-6 py-4 text-left transition-colors hover:bg-purple-500/10 first:rounded-t-2xl last:rounded-b-2xl"
                              >
                                <div className="flex items-center justify-between">
                                  <p className="text-lg font-semibold text-white">{lst.name}</p>
                                  <p className="text-sm font-semibold text-emerald-300">
                                    {lst.apy.toFixed(1)}% APY
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Live preview */}
                      {computedTfuelAmount > 0 && (
                        <GlassCard className="mt-4">
                          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                            You'll receive
                          </p>
                          <div className="mt-3 flex items-baseline gap-3">
                            <p className="text-3xl font-bold text-cyan-300">
                              ~{estimatedLSTAmount.toFixed(2)}
                            </p>
                            <p className="text-xl font-semibold text-white">{selectedLST.name}</p>
                          </div>
                          <p className="mt-2 text-sm text-emerald-300">
                            ~${estimatedDailyYield.toFixed(2)}/day yield
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                                Finality
                              </p>
                              <p className="mt-1 text-xs font-mono text-emerald-300">2.8s</p>
                            </div>
                            <div className="rounded-xl border border-purple-400/30 bg-purple-500/10 px-3 py-1.5">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                                Gas
                              </p>
                              <p className="mt-1 text-xs text-cyan-300">Paid by treasury</p>
                            </div>
                          </div>
                        </GlassCard>
                      )}
                    </div>
                  )}

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
                            href={`${THETA_TESTNET.explorerUrl}/tx/${txHash}`}
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

                  {/* Single Swap & Stake button */}
                  <NeonButton
                    label={
                      swapStatus === 'approving'
                        ? 'Approving…'
                        : swapStatus === 'swapping'
                        ? 'Swapping…'
                        : swapStatus === 'success'
                        ? 'Swap complete'
                        : 'Swap & Stake'
                    }
                    rightHint={
                      swapStatus === 'idle'
                        ? '2 steps'
                        : swapStatus === 'success'
                        ? undefined
                        : 'live'
                    }
                    disabled={
                      !wallet.isConnected ||
                      computedTfuelAmount <= 0 ||
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
                          Liquidity‑aware routing with gas abstracted by treasury.
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
                            href={`${THETA_TESTNET.explorerUrl}/tx/${txHash}`}
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
                        <span className="text-[11px] font-semibold text-purple-300">
                          {selectedLST.apy.toFixed(1)}% APY
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        Group tips per creator into shared pools that compound yield between drops,
                        tours, and streams. Lottery draws when pool ends.
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
                <div className="space-y-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Edge mining
                  </p>
                  <p className="text-sm text-slate-200">
                    Plug Theta EdgeCloud GPU and video workloads straight into Cosmos LST yield
                    streams. XFUEL smooths the volatility and ships you pure APY.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-[11px]">
                      <p className="text-slate-400">Active rigs</p>
                      <p className="mt-1 text-base text-emerald-300">42</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-[11px]">
                      <p className="text-slate-400">Avg utilization</p>
                      <p className="mt-1 text-base text-cyan-300">87%</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-[11px]">
                      <p className="text-slate-400">Daily XFUEL</p>
                      <p className="mt-1 text-base text-purple-300">1.24k</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Full mining controls are coming next — this is a live preview of routing
                    telemetry.
                  </p>
                </div>
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
                    <p className="text-sm text-slate-200">
                      Connect a wallet in the <span className="font-semibold">Swap</span> tab to see
                      a live profile of your XFUEL routes and yield history.
                    </p>
                  )}

                  {wallet.isConnected && !isSignedIn && (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-200">
                        You&apos;re connected with{' '}
                        <span className="font-mono text-emerald-300">{wallet.address}</span>. Sign a
                        short message to unlock arenas, creator dashboards, and fan badges.
                      </p>
                      <div className="max-w-xs">
                        <NeonButton
                          label="Sign in with wallet"
                          rightHint="non-custodial"
                          onClick={handleWalletSignIn}
                        />
                      </div>
                    </div>
                  )}

                  {wallet.isConnected && isSignedIn && (
                    <>
                      <p className="text-sm text-slate-200">
                        Welcome back{' '}
                        <span className="font-semibold text-purple-200">
                          {userAlias ?? wallet.address}
                        </span>
                        . This panel will surface cross‑chain positions, yield history, and arena
                        stats.
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-[11px]">
                        <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-3">
                          <p className="text-slate-400">Net APY target</p>
                          <p className="mt-1 text-base text-emerald-300">
                            {selectedLST.apy.toFixed(1)}%
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
            ) : activeTab === 'swap' && wallet.isConnected && computedTfuelAmount > 0 ? (
              // Dashboard elements for swap tab when connected
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Earnings card */}
                <GlassCard className="p-5">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Earnings today
                  </p>
                  <p className="mt-3 text-4xl font-bold text-white">
                    ${(estimatedDailyYield * 0.8).toFixed(2)}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    Approx. based on blended APY (mock)
                  </p>
                </GlassCard>

                {/* Streak badge */}
                <GlassCard className="p-5">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Streak
                  </p>
                  <p className="mt-3 text-4xl font-bold text-purple-300">12</p>
                  <p className="mt-2 text-xs text-slate-400">days</p>
                </GlassCard>
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
        apy={selectedLST.apy}
      />
    </ScreenBackground>
  )
}

export default App


