import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import ScreenBackground from './components/ScreenBackground'
import GlassCard from './components/GlassCard'
import NeonButton from './components/NeonButton'
import ApyOrb from './components/ApyOrb'
import YieldBubbleSelector, { type LSTOption } from './components/YieldBubbleSelector'
import NeonTabs, { type NeonTabId } from './components/NeonTabs'

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
            <div className="w-full max-w-[170px] sm:w-auto">
              <NeonButton
                label={isSignedIn ? 'Logged in' : 'Log in'}
                rightHint={isSignedIn ? undefined : 'wallet'}
                variant={isSignedIn ? 'secondary' : 'primary'}
                onClick={handleWalletSignIn}
              />
            </div>
          </div>
        </header>

        {/* Main layout: glass panels centered */}
        <main className="flex flex-1 flex-col items-center justify-center pb-10">
          <div className="w-full max-w-xl space-y-4 sm:space-y-6">
            <NeonTabs
              activeId={activeTab}
              onChange={setActiveTab}
              tabs={[
                { id: 'swap', label: 'Swap', pill: 'live' },
                { id: 'staking', label: 'Staking', pill: 'apy lanes' },
                { id: 'tip-pools', label: 'Tip Pools', pill: 'fans' },
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
                    tap once, stars feel it forever.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <GlassCard className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
                          Arena: Main Stage
                        </span>
                        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
                          LIVE
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        Real‑time tip stream flowing into {selectedLST.name} for the headliner.
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                        <span>24h tips</span>
                        <span className="font-mono text-emerald-300">12,430 XFUEL</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
                        <span>Fans on rail</span>
                        <span className="font-mono text-cyan-300">3,218</span>
                      </div>
                      <div className="mt-3">
                        <NeonButton label="Enter arena" rightHint="tip & stake" />
                      </div>
                    </GlassCard>

                    <GlassCard className="p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-200">
                          Creator pools
                        </span>
                        <span className="text-[11px] font-semibold text-purple-300">{selectedLST.apy.toFixed(1)}% APY</span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        Group tips per creator into shared pools that compound yield between drops,
                        tours, and streams.
                      </p>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                        <span>Active pools</span>
                        <span className="font-mono text-emerald-300">87</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
                        <span>Stars opted‑in</span>
                        <span className="font-mono text-cyan-300">146</span>
                      </div>
                      <div className="mt-3">
                        <NeonButton label="Preview fan map" rightHint="2026" variant="secondary" />
                      </div>
                    </GlassCard>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    This tab is your sticky arena UX — we&apos;ll wire in live arenas, creator
                    profiles, and fan badges next.
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
    </ScreenBackground>
  )
}

export default App

