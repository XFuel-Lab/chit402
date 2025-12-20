import React, { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import { THETA_MAINNET } from '../config/thetaConfig'

// Theta Mainnet USDC address (update with actual address)
const USDC_ADDRESS_MAINNET = import.meta.env.VITE_USDC_ADDRESS_MAINNET || '0x0000000000000000000000000000000000000000'
const MULTISIG_ADDRESS = import.meta.env.VITE_MULTISIG_ADDRESS || '[INSERT YOUR MULTISIG OR OWNER ADDRESS HERE]'

// Webhook URL for logging (optional - set via env var)
const WEBHOOK_URL = import.meta.env.VITE_CONTRIBUTION_WEBHOOK_URL || ''

// ERC20 ABI for USDC
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
]

type PaymentMethod = 'USDC' | 'TFUEL'

type Props = {
  visible: boolean
  onClose: () => void
  walletAddress: string | null
  onConnectWallet: () => Promise<void>
  isMainnet?: boolean
}

type Tier = 'Standard' | 'Plus10' | 'Plus25'

/**
 * Early Believers contribution modal - Mainnet Ready
 * Features:
 * - Theta Wallet connect (mainnet enforced)
 * - Amount input (USD equivalent)
 * - Pay with USDC or TFUEL toggle
 * - Live tier calculation & display
 * - Send to multisig address
 * - Success screen with exact message
 * - Error handling: wrong network, insufficient balance, tx revert
 * - Auto-log: console.log + optional webhook
 */
export function EarlyBelieversModal({
  visible,
  onClose,
  walletAddress,
  onConnectWallet,
  isMainnet = true,
}: Props) {
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('USDC')
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<string>('0')
  const [tfuelBalance, setTfuelBalance] = useState<string>('0')
  const [usdcDecimals, setUsdcDecimals] = useState(6) // USDC typically has 6 decimals
  const [tfuelPrice, setTfuelPrice] = useState<number | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [currentNetwork, setCurrentNetwork] = useState<number | null>(null)
  const [networkError, setNetworkError] = useState<string | null>(null)

  // Check network only after wallet is connected
  useEffect(() => {
    if (!visible || !walletAddress) {
      // Reset network error when wallet is not connected
      setNetworkError(null)
      setCurrentNetwork(null)
      return
    }

    const checkNetwork = async () => {
      try {
        const provider = (window as any).theta || (window as any).ethereum
        if (!provider) {
          setNetworkError('Wallet provider not found')
          return
        }

        const ethersProvider = new ethers.BrowserProvider(provider)
        const network = await ethersProvider.getNetwork()
        const chainId = Number(network.chainId)
        setCurrentNetwork(chainId)

        // Compare chain IDs - ensure we're comparing numbers
        if (isMainnet && chainId !== THETA_MAINNET.chainId) {
          setNetworkError(`Please switch to Theta Mainnet (Chain ID: ${THETA_MAINNET.chainId})`)
        } else {
          setNetworkError(null)
        }
      } catch (error) {
        console.error('Network check error:', error)
        // Only set error if we can't check, but don't block if it's a temporary issue
        const provider = (window as any).theta || (window as any).ethereum
        if (provider) {
          // Provider exists but check failed - might be a temporary issue
          // Don't set error, just log it
          console.warn('Network check failed, but provider exists. Will retry on next check.')
        } else {
          setNetworkError('Wallet provider not found')
        }
      }
    }

    checkNetwork()

    // Listen for network changes and account changes
    const provider = (window as any).theta || (window as any).ethereum
    if (provider && provider.on) {
      const handleChainChanged = () => {
        // Small delay to ensure chain change is complete
        setTimeout(() => {
          checkNetwork()
        }, 100)
      }
      
      const handleAccountsChanged = () => {
        // Re-check network when account changes
        setTimeout(() => {
          checkNetwork()
        }, 100)
      }

      provider.on('chainChanged', handleChainChanged)
      provider.on('accountsChanged', handleAccountsChanged)

      return () => {
        if (provider && provider.removeListener) {
          provider.removeListener('chainChanged', handleChainChanged)
          provider.removeListener('accountsChanged', handleAccountsChanged)
        }
      }
    }
  }, [visible, walletAddress, isMainnet])

  // Fetch TFUEL price from CoinGecko
  useEffect(() => {
    const fetchTfuelPrice = async () => {
      setPriceLoading(true)
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=theta-fuel&vs_currencies=usd')
        const data = await response.json()
        if (data['theta-fuel']?.usd) {
          setTfuelPrice(data['theta-fuel'].usd)
        }
      } catch (error) {
        console.error('Error fetching TFUEL price:', error)
        setTfuelPrice(0.05) // Default fallback: $0.05 per TFUEL
      } finally {
        setPriceLoading(false)
      }
    }

    if (visible) {
      fetchTfuelPrice()
      const interval = setInterval(fetchTfuelPrice, 60000)
      return () => clearInterval(interval)
    }
  }, [visible])

  // Calculate USD value and tier
  const numericAmount = parseFloat(amount) || 0
  
  // Convert to USD: if TFUEL, multiply by price; if USDC, it's already in USD
  const usdValue = paymentMethod === 'TFUEL' 
    ? (tfuelPrice ? numericAmount * tfuelPrice : 0)
    : numericAmount
  
  // Tier calculation
  const getTier = (): Tier => {
    if (usdValue >= 100000) return 'Plus25'
    if (usdValue >= 50000) return 'Plus10'
    return 'Standard'
  }

  const tier = getTier()
  const tierBonus = tier === 'Plus25' ? 0.25 : tier === 'Plus10' ? 0.1 : 0
  const bonusAmount = usdValue * tierBonus
  const totalRXF = usdValue + bonusAmount

  const tierLabel = tier === 'Plus25' ? '+25% bonus rXF' : tier === 'Plus10' ? '+10% bonus rXF' : 'Standard'

  // Fetch balances
  useEffect(() => {
    if (!visible || !walletAddress || networkError) return

    const fetchBalances = async () => {
      try {
        const provider = (window as any).theta || (window as any).ethereum
        if (!provider) return

        const ethersProvider = new ethers.BrowserProvider(provider)

        // Fetch TFUEL balance
        const tfuelBal = await ethersProvider.getBalance(walletAddress)
        setTfuelBalance(ethers.formatEther(tfuelBal))

        // Fetch USDC balance if on mainnet
        if (isMainnet && USDC_ADDRESS_MAINNET !== '0x0000000000000000000000000000000000000000') {
          try {
            const usdcContract = new ethers.Contract(
              USDC_ADDRESS_MAINNET,
              ERC20_ABI,
              ethersProvider
            )
            const balance = await usdcContract.balanceOf(walletAddress)
            const decimals = await usdcContract.decimals()
            setUsdcDecimals(decimals)
            setUsdcBalance(ethers.formatUnits(balance, decimals))
          } catch (error) {
            console.error('Error fetching USDC balance:', error)
          }
        }
      } catch (error) {
        console.error('Error fetching balances:', error)
      }
    }

    fetchBalances()
  }, [visible, walletAddress, isMainnet, networkError])

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setAmount('')
      setStatus('idle')
      setStatusMessage('')
      setTxHash(null)
      setIsProcessing(false)
      setNetworkError(null)
    }
  }, [visible])

  // Helper function to wait for transaction receipt with retry logic
  const waitForTransactionReceipt = async (
    provider: ethers.BrowserProvider,
    txHash: string,
    maxRetries: number = 5,
    retryDelay: number = 2000
  ): Promise<ethers.TransactionReceipt | null> => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const receipt = await provider.getTransactionReceipt(txHash)
        if (receipt) {
          return receipt
        }
        // If receipt is null, transaction might still be pending
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      } catch (error: any) {
        // If it's an RPC error but not a critical one, retry
        if (error?.code === -32603 || error?.code === -32000) {
          console.warn(`Receipt fetch attempt ${attempt + 1} failed, retrying...`, error)
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue
          }
        }
        // For other errors, throw immediately
        throw error
      }
    }
    // If we've exhausted retries, return null (transaction might still be pending)
    return null
  }

  // Auto-log contribution
  const logContribution = async (wallet: string, amount: string, method: PaymentMethod, txHash?: string) => {
    try {
      const logData = {
        wallet,
        amount,
        paymentMethod: method,
        usdValue: usdValue,
        tfuelPrice: tfuelPrice,
        timestamp: new Date().toISOString(),
        txHash: txHash || null,
        tier: tier,
        tierBonus: tierBonus * 100,
        totalRXF,
        network: currentNetwork,
      }

      // Log to console
      console.log('📝 Early Believer Contribution:', logData)

      // Optionally send to webhook (Airtable/Google Sheet)
      if (WEBHOOK_URL) {
        try {
          await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(logData),
          })
        } catch (webhookError) {
          console.error('Webhook error (non-critical):', webhookError)
        }
      }
    } catch (error) {
      console.error('Error logging contribution:', error)
    }
  }

  // Switch to mainnet
  const switchToMainnet = async () => {
    try {
      const provider = (window as any).theta || (window as any).ethereum
      if (!provider) {
        throw new Error('Wallet provider not found')
      }

      // Clear previous error messages
      setStatusMessage('')
      setStatus('idle')

      // Try to switch to the chain
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: THETA_MAINNET.chainIdHex }],
        })
        
        // Wait a moment for the switch to complete, then re-check network
        setTimeout(async () => {
          try {
            const ethersProvider = new ethers.BrowserProvider(provider)
            const network = await ethersProvider.getNetwork()
            setCurrentNetwork(Number(network.chainId))
            
            if (Number(network.chainId) === THETA_MAINNET.chainId) {
              setNetworkError(null)
            } else {
              setNetworkError(`Please switch to Theta Mainnet (Chain ID: ${THETA_MAINNET.chainId})`)
            }
          } catch (error) {
            console.error('Error re-checking network after switch:', error)
          }
        }, 1000)
      } catch (switchError: any) {
        // If chain doesn't exist (error code 4902), try to add it
        if (switchError.code === 4902 || switchError.code === -32603) {
          try {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: THETA_MAINNET.chainIdHex,
                  chainName: THETA_MAINNET.name,
                  nativeCurrency: {
                    name: 'TFUEL',
                    symbol: 'TFUEL',
                    decimals: 18,
                  },
                  rpcUrls: [THETA_MAINNET.rpcUrl],
                  blockExplorerUrls: [THETA_MAINNET.explorerUrl],
                },
              ],
            })
            
            // After adding, wait and re-check network
            setTimeout(async () => {
              try {
                const ethersProvider = new ethers.BrowserProvider(provider)
                const network = await ethersProvider.getNetwork()
                setCurrentNetwork(Number(network.chainId))
                
                if (Number(network.chainId) === THETA_MAINNET.chainId) {
                  setNetworkError(null)
                } else {
                  setNetworkError(`Please switch to Theta Mainnet (Chain ID: ${THETA_MAINNET.chainId})`)
                }
              } catch (error) {
                console.error('Error re-checking network after add:', error)
              }
            }, 1000)
          } catch (addError: any) {
            console.error('Error adding chain:', addError)
            // Don't show error in status message if user rejected
            if (addError.code !== 4001 && addError.code !== 'ACTION_REJECTED') {
              setStatusMessage('Failed to add Theta Mainnet. Please add it manually in your wallet.')
              setStatus('error')
            }
          }
        } else if (switchError.code === 4001 || switchError.code === 'ACTION_REJECTED') {
          // User rejected the request - don't show error
          console.log('User rejected network switch')
        } else {
          console.error('Error switching chain:', switchError)
          setStatusMessage('Failed to switch network. Please switch to Theta Mainnet manually.')
          setStatus('error')
        }
      }
    } catch (error: any) {
      console.error('Unexpected error in switchToMainnet:', error)
      setStatusMessage('Failed to switch network. Please switch to Theta Mainnet manually.')
      setStatus('error')
    }
  }

  const handleContribute = async () => {
    if (!walletAddress) {
      await onConnectWallet()
      return
    }

    // Check network
    if (isMainnet && currentNetwork !== THETA_MAINNET.chainId) {
      setStatusMessage('Please switch to Theta Mainnet')
      setStatus('error')
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      setStatusMessage('Please enter a valid amount')
      setStatus('error')
      return
    }

    if (MULTISIG_ADDRESS === '[INSERT YOUR MULTISIG OR OWNER ADDRESS HERE]' || MULTISIG_ADDRESS === '0x0000000000000000000000000000000000000000') {
      setStatusMessage('Multisig address not configured')
      setStatus('error')
      return
    }

    setIsProcessing(true)
    setStatus('idle')
    setStatusMessage('')

    let transactionHash: string | null = null

    try {
      const provider = (window as any).theta || (window as any).ethereum
      if (!provider) {
        throw new Error('Wallet provider not found')
      }

      const ethersProvider = new ethers.BrowserProvider(provider)
      const signer = await ethersProvider.getSigner()

      if (paymentMethod === 'TFUEL') {
        // Check balance
        const balance = await ethersProvider.getBalance(walletAddress)
        const balanceEth = parseFloat(ethers.formatEther(balance))
        const amountNum = parseFloat(amount)
        
        if (balanceEth < amountNum + 0.01) { // Add buffer for gas
          throw new Error('Insufficient TFUEL balance. Please ensure you have enough for the transaction and gas fees.')
        }

        // Send TFUEL to multisig
        const amountWei = ethers.parseEther(amount)
        setStatusMessage('Sending transaction...')
        
        const tx = await signer.sendTransaction({
          to: MULTISIG_ADDRESS,
          value: amountWei,
          gasLimit: 21000,
        })

        transactionHash = tx.hash
        setTxHash(tx.hash)
        setStatusMessage('Transaction submitted. Waiting for confirmation...')

        try {
          // Try to wait for receipt with retry logic
          const receipt = await tx.wait()
          if (receipt) {
            setStatus('success')
            setStatusMessage('Contribution received! You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.')
            await logContribution(walletAddress, amount, 'TFUEL', tx.hash)
          }
        } catch (waitError: any) {
          // If waiting for receipt fails, try alternative method
          console.warn('tx.wait() failed, trying alternative receipt fetch:', waitError)
          try {
            const receipt = await waitForTransactionReceipt(ethersProvider, tx.hash)
            if (receipt) {
              setStatus('success')
              setStatusMessage('Contribution received! You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.')
              await logContribution(walletAddress, amount, 'TFUEL', tx.hash)
            } else {
              // Transaction was submitted but we can't confirm receipt yet
              // Still show success since transaction hash is valid
              setStatus('success')
              setStatusMessage(`Transaction submitted successfully! Hash: ${tx.hash.substring(0, 10)}...${tx.hash.substring(tx.hash.length - 8)}. Please check the explorer to confirm. You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.`)
              await logContribution(walletAddress, amount, 'TFUEL', tx.hash)
            }
          } catch (receiptError) {
            // Even if we can't get receipt, transaction was submitted
            // Show success with note to check explorer
            console.warn('Could not fetch receipt, but transaction was submitted:', receiptError)
            setStatus('success')
            setStatusMessage(`Transaction submitted successfully! Hash: ${tx.hash.substring(0, 10)}...${tx.hash.substring(tx.hash.length - 8)}. Please check the explorer to confirm. You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.`)
            await logContribution(walletAddress, amount, 'TFUEL', tx.hash)
          }
        }
      } else {
        // Send USDC to multisig
        if (USDC_ADDRESS_MAINNET === '0x0000000000000000000000000000000000000000') {
          throw new Error('USDC address not configured')
        }

        const usdcContract = new ethers.Contract(USDC_ADDRESS_MAINNET, ERC20_ABI, signer)
        const amountUnits = ethers.parseUnits(amount, usdcDecimals)

        // Check balance
        const balance = await usdcContract.balanceOf(walletAddress)
        if (balance < amountUnits) {
          throw new Error('Insufficient USDC balance')
        }

        // Check allowance
        const allowance = await usdcContract.allowance(walletAddress, MULTISIG_ADDRESS)
        if (allowance < amountUnits) {
          setStatusMessage('Approving USDC...')
          const approveTx = await usdcContract.approve(MULTISIG_ADDRESS, amountUnits)
          try {
            await approveTx.wait()
          } catch (approveWaitError) {
            // If approval receipt wait fails, try alternative method
            console.warn('Approval receipt wait failed, trying alternative:', approveWaitError)
            try {
              await waitForTransactionReceipt(ethersProvider, approveTx.hash)
            } catch (approveReceiptError) {
              console.warn('Could not fetch approval receipt, but transaction was submitted:', approveReceiptError)
              // Continue anyway - approval transaction was submitted
            }
          }
        }

        setStatusMessage('Sending USDC...')
        const tx = await usdcContract.transfer(MULTISIG_ADDRESS, amountUnits)
        transactionHash = tx.hash
        setTxHash(tx.hash)
        setStatusMessage('Transaction submitted. Waiting for confirmation...')

        try {
          // Try to wait for receipt with retry logic
          const receipt = await tx.wait()
          if (receipt) {
            setStatus('success')
            setStatusMessage('Contribution received! You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.')
            await logContribution(walletAddress, amount, 'USDC', tx.hash)
          }
        } catch (waitError: any) {
          // If waiting for receipt fails, try alternative method
          console.warn('tx.wait() failed, trying alternative receipt fetch:', waitError)
          try {
            const receipt = await waitForTransactionReceipt(ethersProvider, tx.hash)
            if (receipt) {
              setStatus('success')
              setStatusMessage('Contribution received! You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.')
              await logContribution(walletAddress, amount, 'USDC', tx.hash)
            } else {
              // Transaction was submitted but we can't confirm receipt yet
              // Still show success since transaction hash is valid
              setStatus('success')
              setStatusMessage(`Transaction submitted successfully! Hash: ${tx.hash.substring(0, 10)}...${tx.hash.substring(tx.hash.length - 8)}. Please check the explorer to confirm. You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.`)
              await logContribution(walletAddress, amount, 'USDC', tx.hash)
            }
          } catch (receiptError) {
            // Even if we can't get receipt, transaction was submitted
            // Show success with note to check explorer
            console.warn('Could not fetch receipt, but transaction was submitted:', receiptError)
            setStatus('success')
            setStatusMessage(`Transaction submitted successfully! Hash: ${tx.hash.substring(0, 10)}...${tx.hash.substring(tx.hash.length - 8)}. Please check the explorer to confirm. You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.`)
            await logContribution(walletAddress, amount, 'USDC', tx.hash)
          }
        }
      }
    } catch (error: any) {
      console.error('Contribution error:', error)
      setStatus('error')
      
      // Handle specific error cases
      let errorMessage = error?.message || 'Transaction failed'
      
      // Check for RPC errors
      if (error?.code === -32603 || error?.code === -32000 || errorMessage.includes('Internal JSON-RPC error') || errorMessage.includes('method handler crashed') || errorMessage.includes('could not coalesce')) {
        // If we have a transaction hash, the transaction was likely submitted
        if (transactionHash) {
          errorMessage = `Transaction was submitted successfully! Hash: ${transactionHash.substring(0, 10)}...${transactionHash.substring(transactionHash.length - 8)}. Please check the explorer to confirm. The transaction may still be processing.`
          // If we have a hash, treat it as success since transaction was submitted
          setStatus('success')
          await logContribution(walletAddress, amount, paymentMethod, transactionHash)
        } else {
          errorMessage = 'RPC error occurred. Please try again or check your network connection.'
        }
      } else if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance')) {
        errorMessage = 'Insufficient balance. Please check your wallet.'
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('User denied') || errorMessage.includes('rejected') || error?.code === 4001) {
        errorMessage = 'Transaction rejected by user'
      } else if (errorMessage.includes('network') || errorMessage.includes('Network')) {
        errorMessage = 'Network error. Please check your connection and ensure you are on Theta Mainnet.'
      } else if (errorMessage.includes('revert') || errorMessage.includes('execution reverted')) {
        errorMessage = 'Transaction reverted. Please check the amount and try again.'
      }
      
      setStatusMessage(errorMessage)
    } finally {
      setIsProcessing(false)
    }
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <GlassCard className="border-cyan-400/70 bg-gradient-to-br from-[rgba(56,189,248,0.35)] via-[rgba(168,85,247,0.28)] to-[rgba(236,72,153,0.25)] shadow-[0_0_80px_rgba(56,189,248,0.7),0_8px_32px_rgba(15,23,42,0.95)]">
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h2 className="mb-2 text-3xl font-bold text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.5)]">
                Early Believers Round — Mainnet Live
              </h2>
              <p className="text-sm text-slate-300/80">
                Contribute to receive rXF tokens with tier bonuses. Your contribution supports the XFUEL protocol launch.
              </p>
            </div>

            {/* Network Error */}
            {networkError && (
              <div className="rounded-xl border border-red-400/60 bg-red-500/10 p-4">
                <p className="mb-3 text-sm font-semibold text-red-300">{networkError}</p>
                {isMainnet && currentNetwork !== THETA_MAINNET.chainId && (
                  <NeonButton
                    label="Switch to Theta Mainnet"
                    onClick={switchToMainnet}
                    className="w-full"
                  />
                )}
              </div>
            )}

            {/* Wallet Connection */}
            {!walletAddress ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-cyan-400/30 bg-black/20 p-4 text-center">
                  <p className="mb-3 text-sm text-slate-300">Connect your Theta wallet to contribute</p>
                  <NeonButton
                    label="Connect Theta Wallet"
                    onClick={onConnectWallet}
                    className="w-full"
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Connected Wallet Info */}
                <div className="rounded-xl border border-cyan-400/30 bg-black/20 p-3">
                  <p className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-300/70">
                    Connected Wallet
                  </p>
                  <p className="font-mono text-sm text-cyan-300">
                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                    <span>TFUEL: {parseFloat(tfuelBalance).toFixed(4)}</span>
                    {isMainnet && USDC_ADDRESS_MAINNET !== '0x0000000000000000000000000000000000000000' && (
                      <span>USDC: {parseFloat(usdcBalance).toFixed(2)}</span>
                    )}
                    {tfuelPrice && (
                      <span className="text-cyan-300">
                        TFUEL Price: ${tfuelPrice.toFixed(4)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Amount Input */}
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-300/70">
                    Contribution Amount (USD equivalent)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step={paymentMethod === 'TFUEL' ? '0.0001' : '0.01'}
                    className="w-full rounded-xl border border-cyan-400/40 bg-black/30 px-4 py-3 font-mono text-lg text-white placeholder:text-slate-500 focus:border-cyan-400/80 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
                  />
                  {paymentMethod === 'TFUEL' && numericAmount > 0 && tfuelPrice && (
                    <p className="mt-2 text-xs text-cyan-300/80">
                      ≈ ${(numericAmount * tfuelPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    </p>
                  )}
                </div>

                {/* Payment Method Toggle */}
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-300/70">
                    Payment Method
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('USDC')}
                      className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                        paymentMethod === 'USDC'
                          ? 'border-cyan-400/80 bg-cyan-500/20 text-white shadow-[0_0_20px_rgba(56,189,248,0.5)]'
                          : 'border-cyan-400/30 bg-black/20 text-slate-300 hover:border-cyan-400/50'
                      }`}
                    >
                      USDC
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('TFUEL')}
                      className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                        paymentMethod === 'TFUEL'
                          ? 'border-cyan-400/80 bg-cyan-500/20 text-white shadow-[0_0_20px_rgba(56,189,248,0.5)]'
                          : 'border-cyan-400/30 bg-black/20 text-slate-300 hover:border-cyan-400/50'
                      }`}
                    >
                      TFUEL
                    </button>
                  </div>
                </div>

                {/* Tier Calculation & Display */}
                {numericAmount > 0 && (
                  <div className="rounded-xl border border-purple-400/40 bg-gradient-to-br from-purple-500/10 to-cyan-500/10 p-4">
                    <p className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-300/70">
                      Tier Calculation
                    </p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-300">Contribution ({paymentMethod}):</span>
                        <span className="font-semibold text-white">
                          {paymentMethod === 'TFUEL' 
                            ? `${numericAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} TFUEL`
                            : `${numericAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>USD Value:</span>
                        <span className="font-semibold text-white">
                          ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-300">Tier:</span>
                        <span className={`font-bold ${
                          tier === 'Plus25' ? 'text-pink-300' : tier === 'Plus10' ? 'text-cyan-300' : 'text-slate-300'
                        }`}>
                          {tierLabel}
                        </span>
                      </div>
                      {tierBonus > 0 && (
                        <div className="flex justify-between text-cyan-300">
                          <span>Bonus ({tierBonus * 100}%):</span>
                          <span className="font-semibold">+${bonusAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className="border-t border-purple-400/20 pt-2">
                        <div className="flex justify-between text-lg font-bold text-white">
                          <span>Total rXF (USD):</span>
                          <span className="text-cyan-300">${totalRXF.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>
                    {tier === 'Standard' && (
                      <p className="mt-3 text-xs text-slate-400">
                        💡 $50k-$99k: +10% bonus rXF | $100k+: +25% bonus rXF
                      </p>
                    )}
                  </div>
                )}

                {/* Multisig Address */}
                <div className="rounded-xl border border-slate-600/40 bg-black/20 p-3">
                  <p className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-300/70">
                    Sending To
                  </p>
                  <p className="font-mono text-xs text-slate-400 break-all">
                    {MULTISIG_ADDRESS === '[INSERT YOUR MULTISIG OR OWNER ADDRESS HERE]' || MULTISIG_ADDRESS === '0x0000000000000000000000000000000000000000'
                      ? 'Multisig address not configured'
                      : MULTISIG_ADDRESS}
                  </p>
                </div>

                {/* Status Message */}
                {statusMessage && (
                  <div
                    className={`rounded-xl border p-4 text-sm ${
                      status === 'success'
                        ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-300'
                        : status === 'error'
                        ? 'border-red-400/60 bg-red-500/10 text-red-300'
                        : 'border-cyan-400/60 bg-cyan-500/10 text-cyan-300'
                    }`}
                  >
                    {statusMessage}
                    {txHash && (
                      <div className="mt-2">
                        <a
                          href={`${THETA_MAINNET.explorerUrl}/tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline hover:text-cyan-200"
                        >
                          View on Explorer: {txHash.substring(0, 10)}...{txHash.substring(txHash.length - 8)}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Success Screen */}
                {status === 'success' && (
                  <div className="rounded-xl border border-emerald-400/60 bg-gradient-to-br from-emerald-500/15 to-cyan-500/10 p-6 text-center">
                    <div className="mb-4 text-5xl">✨</div>
                    <h3 className="mb-3 text-xl font-bold text-emerald-300">Contribution Received!</h3>
                    <p className="text-sm leading-relaxed text-slate-300">
                      You will receive full soulbound rXF day 1 at TGE with immediate yield, 4× governance votes, and priority spin-outs. Redeem transferable XF after 12 months. Thank you for believing.
                    </p>
                  </div>
                )}

                {/* Action Buttons */}
                {status !== 'success' && (
                  <div className="flex gap-3">
                    <NeonButton
                      label="Cancel"
                      variant="secondary"
                      onClick={onClose}
                      className="flex-1"
                      disabled={isProcessing}
                    />
                    <NeonButton
                      label={
                        isProcessing
                          ? 'Processing...'
                          : 'Contribute Now'
                      }
                      onClick={handleContribute}
                      className="flex-1"
                      disabled={isProcessing || !!networkError || numericAmount <= 0}
                    />
                  </div>
                )}

                {/* Disclaimer Footer */}
                <div className="border-t border-slate-600/40 pt-4">
                  <p className="text-[10px] leading-relaxed text-slate-500 text-center">
                    This is a contribution to support protocol development. rXF provides governance and utility within XFUEL. No promise of profit.
                  </p>
                </div>
              </>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

export default EarlyBelieversModal
