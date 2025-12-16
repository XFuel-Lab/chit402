import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import ScreenBackground from './components/ScreenBackground'
import GlassCard from './components/GlassCard'
import NeonButton from './components/NeonButton'
import ApyOrb from './components/ApyOrb'
import YieldBubbleSelector, { type LSTOption } from './components/YieldBubbleSelector'

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
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [selectedLST, setSelectedLST] = useState<LSTOption>(LST_OPTIONS[0])

  const numericBalance = useMemo(
    () => parseFloat(wallet.balance.replace(/,/g, '')) || 0,
    [wallet.balance],
  )

  const liveApyText = useMemo(() => `${selectedLST.apy.toFixed(1)}%`, [selectedLST.apy])

  // Mock Theta Wallet connection
  const connectWallet = async () => {
    try {
      const provider = (window as any).theta || (window as any).ethereum
      if (typeof window !== 'undefined' && provider) {
        const accounts = await provider.request({
          method: 'eth_requestAccounts',
        })
        if (accounts && accounts.length > 0) {
          const address = accounts[0]
          const balance = '1,234.56'
          setWallet({
            address: `${address.slice(0, 6)}...${address.slice(-4)}`,
            fullAddress: address,
            balance,
            isConnected: true,
          })
        }
      } else {
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
    if (wallet.isConnected && numericBalance > 0) {
      setTfuelAmount(numericBalance.toFixed(2))
    }
  }

  const handleSwapFlow = async () => {
    if (!wallet.isConnected || !wallet.fullAddress || !tfuelAmount) {
      setStatusMessage('Connect wallet and enter TFUEL amount')
      setSwapStatus('error')
      return
    }

    const amount = parseFloat(tfuelAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatusMessage('Enter a valid TFUEL amount')
      setSwapStatus('error')
      return
    }

    // Combined "Approve → Swap & Stake" flow to match mobile single-button UX
    try {
      setSwapStatus('approving')
      setStatusMessage('Approving TFUEL…')

      await new Promise((resolve) => setTimeout(resolve, 1400))

      setSwapStatus('swapping')
      setStatusMessage('Getting test TFUEL from faucet…')

      // Auto-faucet for demo (real users will have TFUEL)
      await fetch(`https://faucet.testnet.theta.org/request?address=${wallet.fullAddress}`)

      const amountWei = ethers.utils.parseEther(amount.toString())

      setStatusMessage(`Swapping ${amount.toFixed(2)} TFUEL → ${selectedLST.name}…`)

      const provider = new ethers.providers.Web3Provider(
        (window as any).ethereum || (window as any).theta,
      )
      const signer = provider.getSigner()

      const routerAddress = '0xYourRealRouterWillGoHere_AfterDeploy'

      const abi = ['function swapAndStake(uint256 amount, string targetLST)']
      const contract = new ethers.Contract(routerAddress, abi, signer)

      const tx = await contract.swapAndStake(amountWei, selectedLST.name)
      setStatusMessage(`Transaction sent! ${tx.hash.substring(0, 10)}…`)

      await tx.wait()
      setStatusMessage(
        `Done! You now hold yield-bearing ${selectedLST.name} on Theta with ~${selectedLST.apy.toFixed(
          1,
        )}% APY`,
      )
      setSwapStatus('success')
      setTfuelAmount('')

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 5000)
    } catch (e: any) {
      setStatusMessage(`Failed: ${e?.message ?? 'Unexpected error'}`)
      setSwapStatus('error')

      setTimeout(() => {
        setSwapStatus('idle')
        setStatusMessage('')
      }, 5000)
    }
  }

  // Auto-connect on mount (demo mode)
  useEffect(() => {
    // connectWallet()
  }, [])

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

          <div className="w-full max-w-[180px] sm:max-w-none">
            <ApyOrb apyText={liveApyText} label="live blended APY" />
          </div>
        </header>

        {/* Main layout: glass swap panel centered */}
        <main className="flex flex-1 flex-col items-center justify-center pb-10">
          <div className="w-full max-w-xl space-y-6 sm:space-y-7">
            <GlassCard>
              {/* Wallet row */}
              <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Theta wallet
                  </p>
                  {wallet.isConnected ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-mono text-emerald-300">
                        {wallet.address}
                      </span>
                      <span className="text-sm text-slate-200">
                        {wallet.balance}{' '}
                        <span className="text-xs text-slate-400">TFUEL</span>
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      Connect to simulate Theta EdgeCloud revenue streaming into Cosmos yield.
                    </p>
                  )}
                </div>

                {!wallet.isConnected && (
                  <div className="w-full min-w-[180px] sm:w-auto sm:min-w-[200px]">
                    <NeonButton
                      label="Connect Theta Wallet"
                      onClick={connectWallet}
                      rightHint="mock"
                    />
                  </div>
                )}
              </div>

              {/* Divider glow */}
              <div className="mb-5 h-px w-full bg-gradient-to-r from-transparent via-purple-400/50 to-transparent opacity-70" />

              {/* Swap input */}
              <div className="mb-5 space-y-2 sm:mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                    Amount
                  </span>
                  {wallet.isConnected && (
                    <button
                      type="button"
                      onClick={handleMaxClick}
                      className="text-[11px] font-medium uppercase tracking-[0.18em] text-purple-300/90 hover:text-purple-200"
                    >
                      Use max
                    </button>
                  )}
                </div>
                <div className="relative flex items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={tfuelAmount}
                      onChange={(e) => setTfuelAmount(e.target.value)}
                      placeholder="0.00"
                      disabled={!wallet.isConnected}
                      className="w-full rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.82)] px-4 py-3 pr-16 text-base text-slate-50 shadow-[0_0_24px_rgba(15,23,42,0.9)] outline-none transition-[border,box-shadow,background] duration-200 placeholder:text-slate-500 focus:border-purple-400/80 focus:bg-[rgba(15,23,42,0.96)] focus:shadow-[0_0_32px_rgba(168,85,247,0.75)] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                      TFUEL
                    </span>
                  </div>
                </div>
              </div>

              {/* Live indicators */}
              <div className="mb-4 grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4 sm:text-xs">
                <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                    Finality
                  </p>
                  <p className="mt-1 font-mono text-emerald-300">2.8 s</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                    Gas
                  </p>
                  <p className="mt-1 text-[11px] text-cyan-300">Paid by treasury</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                    Price impact
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-300">&lt;0.01%</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                    Chainalysis
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-300">100/100 safe</p>
                </div>
              </div>

              {/* Status pill */}
              {statusMessage && (
                <div
                  className={[
                    'mb-4 rounded-2xl border px-3 py-2 text-xs text-center',
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
                </div>
              )}

              {/* Single Swap & Stake button */}
              <div className="pt-1">
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
                    !tfuelAmount ||
                    swapStatus === 'approving' ||
                    swapStatus === 'swapping'
                  }
                  onClick={handleSwapFlow}
                />
              </div>
            </GlassCard>

            {/* Yield bubble selector */}
            <YieldBubbleSelector
              options={LST_OPTIONS}
              selected={selectedLST}
              onSelect={setSelectedLST}
            />

            {/* Footer tagline */}
            <p className="pt-2 text-center text-[11px] text-slate-400/80 sm:text-xs">
              Theta EdgeCloud GPU / video revenue → auto-compounding Cosmos LSTs in one tap.
            </p>
          </div>
        </main>
      </div>
    </ScreenBackground>
  )
}

export default App

