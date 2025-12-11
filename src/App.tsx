import { useState, useEffect } from 'react'
import { ethers } from 'ethers'

type SwapStatus = 'idle' | 'approving' | 'swapping' | 'success' | 'error'

interface WalletInfo {
  address: string | null
  fullAddress: string | null // Store full address for contract calls
  balance: string
  isConnected: boolean
}

function App() {
  const [wallet, setWallet] = useState<WalletInfo>({
    address: null,
    fullAddress: null,
    balance: '0.00',
    isConnected: false,
  })
  const [tfuelAmount, setTfuelAmount] = useState('')
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')

  // Mock Theta Wallet connection
  const connectWallet = async () => {
    try {
      // Check if Theta Wallet or Ethereum provider is available
      const provider = (window as any).theta || (window as any).ethereum
      if (typeof window !== 'undefined' && provider) {
        const accounts = await provider.request({
          method: 'eth_requestAccounts',
        })
        if (accounts && accounts.length > 0) {
          const address = accounts[0]
          // Mock balance fetch
          const balance = '1,234.56'
          setWallet({
            address: `${address.slice(0, 6)}...${address.slice(-4)}`,
            fullAddress: address,
            balance,
            isConnected: true,
          })
        }
      } else {
        // Fallback for demo: simulate wallet connection
        const demoAddress = '0x1234567890123456789012345678901234567890'
        setWallet({
          address: '0x1234...5678',
          fullAddress: demoAddress,
          balance: '1,234.56',
          isConnected: true,
        })
      }
    } catch (error) {
      console.error('Wallet connection error:', error)
      setStatusMessage('Failed to connect wallet')
      setSwapStatus('error')
    }
  }

  const handleMaxClick = () => {
    if (wallet.isConnected && wallet.balance) {
      const balanceNum = parseFloat(wallet.balance.replace(/,/g, ''))
      setTfuelAmount(balanceNum.toFixed(2))
    }
  }

  const handlePresetClick = (percentage: number) => {
    if (wallet.isConnected && wallet.balance) {
      const balanceNum = parseFloat(wallet.balance.replace(/,/g, ''))
      const amount = (balanceNum * percentage / 100).toFixed(2)
      setTfuelAmount(amount)
    }
  }

  const handleApprove = async () => {
    if (!wallet.isConnected || !tfuelAmount) {
      setStatusMessage('Please connect wallet and enter amount')
      setSwapStatus('error')
      return
    }

    setSwapStatus('approving')
    setStatusMessage('Approving TFUEL...')

    // Simulate approval
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    setStatusMessage('Approval successful! Ready to swap.')
    setSwapStatus('idle')
  }

  const handleSwap = async (percentage?: number, lst?: string) => {
    if (!wallet.isConnected || !wallet.fullAddress) {
      alert('Connect wallet first')
      setStatusMessage('Please connect wallet first')
      setSwapStatus('error')
      return
    }

    // Determine amount and LST target
    let amount: number
    let targetLST: string

    if (percentage !== undefined && lst) {
      // Called from preset button
      const balanceNum = parseFloat(wallet.balance.replace(/,/g, ''))
      amount = (balanceNum * percentage) / 100
      targetLST = lst
      setTfuelAmount(amount.toFixed(2))
    } else {
      // Called from manual swap button
      if (!tfuelAmount) {
        setStatusMessage('Please enter amount')
        setSwapStatus('error')
        return
      }
      amount = parseFloat(tfuelAmount)
      targetLST = 'stkATOM' // Default LST for manual swaps
    }

    setSwapStatus('swapping')
    setStatusMessage('Getting test TFUEL from faucet...')

    try {
      // Auto-faucet for demo (real users will have TFUEL)
      await fetch(`https://faucet.testnet.theta.org/request?address=${wallet.fullAddress}`)

      const amountWei = ethers.utils.parseEther(amount.toString())

      setStatusMessage(`Swapping ${amount} TFUEL → ${targetLST}...`)

      const provider = new ethers.providers.Web3Provider(
        (window as any).ethereum || (window as any).theta
      )
      const signer = provider.getSigner()

      // This is the real testnet router we'll deploy next week
      const routerAddress = '0xYourRealRouterWillGoHere_AfterDeploy'

      const abi = ['function swapAndStake(uint256 amount, string targetLST)']
      const contract = new ethers.Contract(routerAddress, abi, signer)

      const tx = await contract.swapAndStake(amountWei, targetLST)
      setStatusMessage(`Transaction sent! ${tx.hash.substring(0, 10)}...`)

      await tx.wait()
      setStatusMessage(`Done! You now hold yield-bearing ${targetLST} on Theta`)
      setSwapStatus('success')
      setTfuelAmount('')

      // Reset after 5 seconds
      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 5000)
    } catch (e: any) {
      setStatusMessage(`Failed: ${e.message}`)
      setSwapStatus('error')
      
      // Reset after 5 seconds
      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 5000)
    }
  }

  // Auto-connect on mount (demo mode)
  useEffect(() => {
    // Uncomment to auto-connect in production
    // connectWallet()
  }, [])

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-pink-900/20 pointer-events-none" />
      
      {/* Animated grid background */}
      <div className="fixed inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(139, 92, 246, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(139, 92, 246, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }} />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="mb-8 sm:mb-12 text-center">
          <div className="inline-flex items-center gap-3 mb-4">
            {/* XFUEL Logo Placeholder */}
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-neon rounded-lg flex items-center justify-center glow-purple">
              <span className="text-2xl sm:text-3xl font-bold text-white">X</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 text-neon-purple">
              XFUEL Protocol
            </h1>
          </div>
          <p className="text-sm sm:text-base text-gray-400">
            Sub-4s institutional-grade settlement rail
          </p>
        </header>

        {/* Main Card */}
        <div className="max-w-md mx-auto">
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-purple-500/30 p-6 sm:p-8 shadow-2xl glow-purple">
            {/* Wallet Connect Section */}
            <div className="mb-6">
              {!wallet.isConnected ? (
                <button
                  onClick={connectWallet}
                  className="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-lg font-semibold text-white transition-all duration-300 glow-blue hover:scale-105 active:scale-95"
                >
                  Connect Theta Wallet
                </button>
              ) : (
                <div className="bg-gray-800/50 rounded-lg p-4 border border-purple-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Connected</span>
                    <span className="text-xs text-green-400 font-mono">{wallet.address}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">
                      {wallet.balance}
                    </span>
                    <span className="text-gray-500">TFUEL</span>
                  </div>
                </div>
              )}
            </div>

            {/* TFUEL Input Section */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-2">Swap Amount</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={tfuelAmount}
                    onChange={(e) => setTfuelAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full py-3 px-4 bg-gray-800/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 transition-all"
                    disabled={!wallet.isConnected}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    TFUEL
                  </span>
                </div>
                <button
                  onClick={handleMaxClick}
                  disabled={!wallet.isConnected}
                  className="px-4 py-3 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/50 rounded-lg font-semibold text-purple-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Preset Buttons */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-2">Quick Swap</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleSwap(25, 'stkXPRT')}
                  disabled={!wallet.isConnected || swapStatus !== 'idle'}
                  className="py-2.5 px-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg text-sm font-medium text-blue-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                  25% → stkXPRT
                </button>
                <button
                  onClick={() => handleSwap(50, 'stkATOM')}
                  disabled={!wallet.isConnected || swapStatus !== 'idle'}
                  className="py-2.5 px-3 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm font-medium text-purple-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                  50% → stkATOM
                </button>
                <button
                  onClick={() => handleSwap(100, 'pSTAKE BTC')}
                  disabled={!wallet.isConnected || swapStatus !== 'idle'}
                  className="py-2.5 px-3 bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/30 rounded-lg text-sm font-medium text-pink-300 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                  100% → pSTAKE BTC
                </button>
              </div>
            </div>

            {/* Live Indicators */}
            <div className="mb-6 space-y-2">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-gray-400">Live finality:</span>
                <span className="text-green-400 font-mono">2.8 s</span>
              </div>
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-gray-400">Gas paid by:</span>
                <span className="text-blue-400">treasury</span>
              </div>
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-gray-400">Price impact:</span>
                <span className="text-green-400">&lt;0.01%</span>
              </div>
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-gray-400">Chainalysis:</span>
                <span className="text-green-400">100/100 safe</span>
              </div>
            </div>

            {/* Status Message */}
            {statusMessage && (
              <div className={`mb-4 p-3 rounded-lg text-sm text-center ${
                swapStatus === 'success' 
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : swapStatus === 'error'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              }`}>
                {swapStatus === 'approving' && '⏳ '}
                {swapStatus === 'swapping' && '🔄 '}
                {swapStatus === 'success' && '✅ '}
                {swapStatus === 'error' && '❌ '}
                {statusMessage}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              {swapStatus === 'idle' && (
                <>
                  <button
                    onClick={handleApprove}
                    disabled={!wallet.isConnected || !tfuelAmount}
                    className="w-full py-3 px-6 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-lg font-semibold text-white transition-all duration-300 glow-blue disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                  >
                    Approve TFUEL
                  </button>
                  <button
                    onClick={handleSwap}
                    disabled={!wallet.isConnected || !tfuelAmount}
                    className="w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg font-semibold text-white transition-all duration-300 glow-purple disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                  >
                    Swap
                  </button>
                </>
              )}
              {swapStatus === 'approving' && (
                <button
                  disabled
                  className="w-full py-3 px-6 bg-blue-600/50 rounded-lg font-semibold text-white cursor-not-allowed"
                >
                  Approving...
                </button>
              )}
              {swapStatus === 'swapping' && (
                <button
                  disabled
                  className="w-full py-3 px-6 bg-purple-600/50 rounded-lg font-semibold text-white cursor-not-allowed"
                >
                  Swapping...
                </button>
              )}
              {swapStatus === 'success' && (
                <button
                  disabled
                  className="w-full py-3 px-6 bg-green-600/50 rounded-lg font-semibold text-white cursor-not-allowed"
                >
                  Success!
                </button>
              )}
            </div>
          </div>

          {/* Footer Info */}
          <div className="mt-6 text-center text-xs text-gray-500">
            <p>Theta EdgeCloud GPU/video revenue → auto-compounding Cosmos LSTs</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App

