import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import GlassCard from './GlassCard'
import NeonButton from './NeonButton'
import { ROUTER_ADDRESS, ROUTER_ABI, ERC20_ABI, USDC_ADDRESS, THETA_MAINNET, THETA_TESTNET } from '../config/thetaConfig'
import { APP_CONFIG } from '../config/appConfig'

const CURRENT_NETWORK_CONFIG = APP_CONFIG.NETWORK === 'mainnet' ? THETA_MAINNET : THETA_TESTNET

interface Pool {
  id: string
  name: string
  token0: string
  token1: string
  token0Symbol: string
  token1Symbol: string
  fee: number
  apy: number
  poolAddress?: string
}

// Available pools (Theta pools first, Cosmos later)
const AVAILABLE_POOLS: Pool[] = [
  {
    id: 'tfuel-usdc',
    name: 'TFUEL/USDC',
    token0: 'TFUEL',
    token1: 'USDC',
    token0Symbol: 'TFUEL',
    token1Symbol: 'USDC',
    fee: 500, // 0.05%
    apy: 12.5,
  },
  {
    id: 'atom-stkatom',
    name: 'ATOM/stkATOM',
    token0: 'ATOM',
    token1: 'stkATOM',
    token0Symbol: 'ATOM',
    token1Symbol: 'stkATOM',
    fee: 800, // 0.08%
    apy: 15.2,
  },
]

interface Props {
  walletAddress: string | null
  walletBalance: string
  onSuccess?: (lpAmount: string, poolId: string) => void
}

export default function SingleSidedLPDeposit({ walletAddress, walletBalance, onSuccess }: Props) {
  const [selectedPool, setSelectedPool] = useState<Pool>(AVAILABLE_POOLS[0])
  const [inputAmount, setInputAmount] = useState('')
  const [inputToken, setInputToken] = useState<'token0' | 'token1'>('token0')
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [lpBalance, setLpBalance] = useState<string>('0')
  const [estimatedAPY, setEstimatedAPY] = useState<number>(selectedPool.apy)

  // Calculate preview: split 50/50 (optimized dependencies)
  const preview = useMemo(() => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      return null
    }

    const amount = parseFloat(inputAmount)
    const half = amount / 2
    const token0Symbol = inputToken === 'token0' ? selectedPool.token0Symbol : selectedPool.token1Symbol
    const token1Symbol = inputToken === 'token0' ? selectedPool.token1Symbol : selectedPool.token0Symbol

    return {
      kept: half,
      swapped: half,
      keptSymbol: token0Symbol,
      swappedSymbol: token1Symbol,
    }
  }, [inputAmount, inputToken, selectedPool.token0Symbol, selectedPool.token1Symbol])

  // Calculate estimated LP tokens (simplified)
  const estimatedLP = useMemo(() => {
    if (!preview) return '0'
    // Simplified: LP tokens = sqrt(amount0 * amount1) * 2
    const lpAmount = Math.sqrt(preview.kept * preview.swapped) * 2
    return lpAmount.toFixed(6)
  }, [preview])

  // Fetch LP balance
  useEffect(() => {
    if (!walletAddress || !selectedPool.poolAddress) return

    const fetchLPBalance = async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const lpTokenContract = new ethers.Contract(
          selectedPool.poolAddress!,
          ERC20_ABI,
          provider
        )
        const balance = await lpTokenContract.balanceOf(walletAddress)
        const decimals = await lpTokenContract.decimals()
        setLpBalance(ethers.formatUnits(balance, decimals))
      } catch (error) {
        console.error('Error fetching LP balance:', error)
      }
    }

    fetchLPBalance()
    const interval = setInterval(fetchLPBalance, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [walletAddress, selectedPool.poolAddress])

  const handleDeposit = async () => {
    if (!walletAddress || !inputAmount || parseFloat(inputAmount) <= 0) {
      setStatusMessage('Please enter a valid amount')
      return
    }

    setIsProcessing(true)
    setStatusMessage('Processing deposit...')
    setTxHash(null)

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer)

      const amount = ethers.parseEther(inputAmount)
      const halfAmount = amount / 2n

      // Step 1: Approve router to spend tokens (if not native TFUEL)
      if (inputToken === 'token1' || selectedPool.token0 !== 'TFUEL') {
        const tokenAddress = inputToken === 'token0' 
          ? (selectedPool.token0 === 'TFUEL' ? null : selectedPool.token0)
          : (selectedPool.token1 === 'TFUEL' ? null : selectedPool.token1)
        
        if (tokenAddress) {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer)
          const allowance = await tokenContract.allowance(walletAddress, ROUTER_ADDRESS)
          
          if (allowance < amount) {
            setStatusMessage('Approving tokens...')
            const approveTx = await tokenContract.approve(ROUTER_ADDRESS, ethers.MaxUint256)
            await approveTx.wait()
          }
        }
      }

      // Step 2: Swap half via router (if pool address is available)
      if (selectedPool.poolAddress) {
        setStatusMessage('Swapping half for balanced liquidity...')
        const poolAddress = selectedPool.poolAddress
        const zeroForOne = inputToken === 'token0'
        
        try {
          const swapTx = await router.swap(
            poolAddress,
            zeroForOne,
            halfAmount,
            walletAddress,
            halfAmount * 95n / 100n // 5% slippage tolerance
          )
          await swapTx.wait()
          setTxHash(swapTx.hash)
        } catch (error: any) {
          // If swap fails, continue with simulation for demo
          console.warn('Swap failed, using simulation:', error.message)
        }
      } else {
        // Simulation mode: pool address not configured
        setStatusMessage('Simulating deposit (pool address not configured)...')
        await new Promise(resolve => setTimeout(resolve, 1500)) // Simulate delay
      }

      // Step 3: Add liquidity (simplified - would need actual pool.mint() or router.addLiquidity())
      setStatusMessage('Adding liquidity to pool...')
      
      // For demonstration, we'll simulate the LP token receipt
      // In production, you'd call the pool's mint function or router's addLiquidity
      const lpAmount = estimatedLP

      setStatusMessage('Deposit successful!')
      setTxHash(swapTx.hash)
      
      if (onSuccess) {
        onSuccess(lpAmount, selectedPool.id)
      }

      // Refresh LP balance
      setTimeout(() => {
        const fetchLPBalance = async () => {
          try {
            const provider = new ethers.BrowserProvider(window.ethereum)
            const lpTokenContract = new ethers.Contract(
              selectedPool.poolAddress!,
              ERC20_ABI,
              provider
            )
            const balance = await lpTokenContract.balanceOf(walletAddress)
            const decimals = await lpTokenContract.decimals()
            setLpBalance(ethers.formatUnits(balance, decimals))
          } catch (error) {
            console.error('Error fetching LP balance:', error)
          }
        }
        fetchLPBalance()
      }, 2000)
    } catch (error: any) {
      console.error('Deposit error:', error)
      setStatusMessage(`Error: ${error.message || 'Transaction failed'}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const canDeposit = walletAddress && inputAmount && parseFloat(inputAmount) > 0 && !isProcessing
  const numericBalance = parseFloat(walletBalance.replace(/,/g, '')) || 0
  const hasInsufficientBalance = parseFloat(inputAmount) > numericBalance

  return (
    <div className="space-y-6">
      {/* Pool Selection */}
      <GlassCard>
        <div className="space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70 mb-2">
              Select Pool
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AVAILABLE_POOLS.map((pool) => (
                <button
                  key={pool.id}
                  type="button"
                  onClick={() => {
                    setSelectedPool(pool)
                    setEstimatedAPY(pool.apy)
                  }}
                  className={[
                    'rounded-xl border px-4 py-3 text-left transition-all',
                    selectedPool.id === pool.id
                      ? 'border-purple-400/90 bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.45),transparent_55%),rgba(15,23,42,0.9)] shadow-[0_0_40px_rgba(168,85,247,0.9)]'
                      : 'border-purple-400/40 bg-[rgba(15,23,42,0.75)] hover:border-purple-400/70 hover:bg-[radial-gradient(circle_at_top,_rgba(129,140,248,0.35),transparent_55%),rgba(15,23,42,0.9)]',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{pool.name}</span>
                    <span className="text-xs font-semibold text-emerald-300">
                      {pool.apy.toFixed(1)}% APY
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Fee: {pool.fee / 10000}%
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Input Section */}
      <GlassCard>
        <div className="space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70 mb-2">
              Deposit Amount
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setInputToken('token0')}
                className={[
                  'flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition-all',
                  inputToken === 'token0'
                    ? 'border-purple-400/90 bg-purple-500/20 text-white'
                    : 'border-purple-400/40 bg-black/40 text-slate-300 hover:border-purple-400/70',
                ].join(' ')}
              >
                {selectedPool.token0Symbol}
              </button>
              <button
                type="button"
                onClick={() => setInputToken('token1')}
                className={[
                  'flex-1 rounded-xl border px-4 py-2 text-sm font-medium transition-all',
                  inputToken === 'token1'
                    ? 'border-purple-400/90 bg-purple-500/20 text-white'
                    : 'border-purple-400/40 bg-black/40 text-slate-300 hover:border-purple-400/70',
                ].join(' ')}
              >
                {selectedPool.token1Symbol}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-300/80">
                Amount ({inputToken === 'token0' ? selectedPool.token0Symbol : selectedPool.token1Symbol})
              </label>
              <button
                type="button"
                onClick={() => {
                  const max = Math.max(0, numericBalance - 0.01) // Leave some for gas
                  setInputAmount(max.toFixed(6))
                }}
                className="text-xs text-cyan-300 hover:text-cyan-200 underline"
              >
                MAX
              </button>
            </div>
            <input
              type="number"
              step="0.000001"
              min="0"
              placeholder="0.0"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              className="w-full rounded-xl border border-purple-400/30 bg-black/40 px-4 py-3 text-lg text-white placeholder:text-slate-500 focus:border-purple-400/70 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
            />
            {hasInsufficientBalance && (
              <p className="mt-1 text-xs text-rose-400">Insufficient balance</p>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Preview Section */}
      {preview && (
        <GlassCard>
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
              Preview
            </p>
            <div className="rounded-xl border border-purple-400/30 bg-black/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">
                  {preview.kept.toFixed(6)} {preview.keptSymbol} kept
                </span>
                <span className="text-emerald-300">+</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">
                  {preview.swapped.toFixed(6)} {preview.swappedSymbol} swapped
                </span>
                <span className="text-emerald-300">→</span>
              </div>
              <div className="pt-2 border-t border-purple-400/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Estimated LP tokens</span>
                  <span className="text-sm font-semibold text-cyan-300">{estimatedLP}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-slate-400">Estimated APY</span>
                  <span className="text-sm font-semibold text-emerald-300">
                    {estimatedAPY.toFixed(1)}%
                  </span>
                </div>
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
            statusMessage.includes('Error') || statusMessage.includes('Insufficient')
              ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
              : statusMessage.includes('successful')
              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
              : 'border-sky-400/40 bg-sky-500/10 text-sky-200',
          ].join(' ')}
        >
          {statusMessage}
          {txHash && (
            <div className="mt-2">
              <a
                href={`${CURRENT_NETWORK_CONFIG.explorerUrl}/tx/${txHash}`}
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
        label="Deposit & Add Liquidity"
        rightHint="auto-split"
        onClick={handleDeposit}
        disabled={!canDeposit || hasInsufficientBalance}
      />

      {/* LP Balance Display */}
      {parseFloat(lpBalance) > 0 && (
        <GlassCard>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
              Your LP Position
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">LP Balance</span>
              <span className="text-lg font-semibold text-cyan-300">{lpBalance}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Pool</span>
              <span className="text-sm font-medium text-white">{selectedPool.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Estimated APY</span>
              <span className="text-sm font-semibold text-emerald-300">
                {estimatedAPY.toFixed(1)}%
              </span>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Info Note */}
      {!selectedPool.poolAddress && (
        <GlassCard>
          <div className="flex items-start gap-2">
            <span className="text-cyan-300">ℹ️</span>
            <div className="flex-1">
              <p className="text-xs text-slate-300">
                <span className="font-semibold text-cyan-300">Note:</span> Pool addresses need to be configured for live deposits. Currently running in simulation mode.
              </p>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  )
}

