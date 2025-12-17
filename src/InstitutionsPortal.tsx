import { useEffect, useMemo, useState } from 'react'

type PortalState = 'idle' | 'connecting' | 'checking' | 'whitelisted' | 'notWhitelisted' | 'error'

type Tier = 'Premium' | 'Strategic' | 'Founding'

interface WalletState {
  address: string | null
  fullAddress: string | null
  isConnected: boolean
}

interface Limits {
  daily: number
  monthly: number
  usedToday: number
  usedThisMonth: number
  currency: 'USD'
}

interface TxRow {
  id: string
  timestamp: string
  asset: string
  direction: 'In' | 'Out'
  amount: number
  currency: string
  status: 'Settled' | 'Pending'
  policyFlag: 'OK' | 'Review'
  txHash: string
}

interface FlowData {
  chain: string
  direction: 'In' | 'Out'
  volume: number
  percentage: number
}

interface VolumeData {
  timestamp: string
  value: number
}

// Mock "on-chain" whitelist – in production this would be a contract read
const MOCK_WHITELIST: Record<string, Tier> = {
  '0x1234567890123456789012345678901234567890': 'Strategic',
}

const formatCurrency = (value: number, currency: string = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)

const formatNumber = (value: number) =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value)

const InstitutionsPortal = () => {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    fullAddress: null,
    isConnected: false,
  })
  const [portalState, setPortalState] = useState<PortalState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
  const [volumePeriod, setVolumePeriod] = useState<'24h' | '7d' | '30d'>('24h')
  const [limits] = useState<Limits>({
    daily: 10_000_000,
    monthly: 120_000_000,
    usedToday: 2_300_000,
    usedThisMonth: 38_500_000,
    currency: 'USD',
  })
  const [txHistory] = useState<TxRow[]>([
    {
      id: '1',
      timestamp: '2025-12-17T09:22:13Z',
      asset: 'XFUEL',
      direction: 'Out',
      amount: 1_250_000,
      currency: 'USD',
      status: 'Settled',
      policyFlag: 'OK',
      txHash: '0xabc123...7890',
    },
    {
      id: '2',
      timestamp: '2025-12-16T17:03:44Z',
      asset: 'stkTIA',
      direction: 'In',
      amount: 760_000,
      currency: 'USD',
      status: 'Settled',
      policyFlag: 'OK',
      txHash: '0xdef456...1234',
    },
    {
      id: '3',
      timestamp: '2025-12-16T10:11:02Z',
      asset: 'USDC',
      direction: 'Out',
      amount: 3_200_000,
      currency: 'USD',
      status: 'Pending',
      policyFlag: 'Review',
      txHash: '0x987654...abcd',
    },
  ])

  // Mock data for flow analytics
  const [flowData] = useState<FlowData[]>([
    { chain: 'Theta', direction: 'In', volume: 45_200_000, percentage: 68 },
    { chain: 'Cosmos', direction: 'Out', volume: 28_500_000, percentage: 42 },
    { chain: 'Osmosis', direction: 'Out', volume: 18_300_000, percentage: 28 },
    { chain: 'Stargaze', direction: 'Out', volume: 12_100_000, percentage: 18 },
  ])

  // Mock volume chart data
  const [volumeData] = useState<VolumeData[]>([
    { timestamp: '00:00', value: 2.1 },
    { timestamp: '04:00', value: 3.4 },
    { timestamp: '08:00', value: 5.2 },
    { timestamp: '12:00', value: 6.8 },
    { timestamp: '16:00', value: 4.9 },
    { timestamp: '20:00', value: 3.7 },
  ])

  const totalTVL = 127_500_000 // Mock total bridged TVL
  const chainalysisScore = 100
  const sanctionedAlerts = 0 // Mock: none

  const normalizedAddress = useMemo(
    () => (wallet.fullAddress ? wallet.fullAddress.toLowerCase() : null),
    [wallet.fullAddress],
  )

  const dailyRemaining = limits.daily - limits.usedToday
  const monthlyRemaining = limits.monthly - limits.usedThisMonth

  const handleConnectWallet = async () => {
    setError(null)
    setPortalState('connecting')
    try {
      const anyWindow = window as any
      const provider = anyWindow.ethereum || anyWindow.theta
      if (!provider) {
        // Fallback demo wallet
        const demo = '0x1234567890123456789012345678901234567890'
        setWallet({
          address: `${demo.slice(0, 6)}...${demo.slice(-4)}`,
          fullAddress: demo,
          isConnected: true,
        })
        setPortalState('checking')
        return
      }

      const accounts: string[] = await provider.request({
        method: 'eth_requestAccounts',
      })
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts available')
      }
      const addr = accounts[0]

      setWallet({
        address: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
        fullAddress: addr,
        isConnected: true,
      })
      setPortalState('checking')
    } catch (e: any) {
      console.error('Institution wallet connect failed', e)
      setError(e?.message ?? 'Failed to connect wallet')
      setPortalState('error')
    }
  }

  useEffect(() => {
    const checkWhitelist = async () => {
      if (!normalizedAddress || portalState !== 'checking') return

      try {
        // Simulate a lightweight on-chain read
        await new Promise((resolve) => setTimeout(resolve, 600))

        const tierForAddress = MOCK_WHITELIST[normalizedAddress]
        if (tierForAddress) {
          setTier(tierForAddress)
          setPortalState('whitelisted')
        } else {
          setTier(null)
          setPortalState('notWhitelisted')
        }
      } catch (e: any) {
        console.error('Whitelist check failed', e)
        setError(e?.message ?? 'Failed to verify whitelist status')
        setPortalState('error')
      }
    }

    void checkWhitelist()
  }, [normalizedAddress, portalState])

  const handleExportCsv = () => {
    if (!txHistory.length) return

    const header = [
      'export_id',
      'exported_at',
      'institution_wallet',
      'tx_id',
      'timestamp',
      'asset',
      'direction',
      'amount',
      'currency',
      'status',
      'policy_flag',
      'tx_hash',
    ]

    const exportId = `xfuel-institution-export-${Date.now()}`
    const exportedAt = new Date().toISOString()
    const walletAddr = wallet.fullAddress ?? ''

    const rows = txHistory.map((tx) => [
      exportId,
      exportedAt,
      walletAddr,
      tx.id,
      tx.timestamp,
      tx.asset,
      tx.direction,
      tx.amount.toString(),
      tx.currency,
      tx.status,
      tx.policyFlag,
      tx.txHash,
    ])

    const csvLines = [header, ...rows]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csvLines], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `${exportId}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleApplySubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    // Placeholder: wire to backend application endpoint
    alert('Application submitted. Treasury will review and follow up.')
  }

  const renderGate = () => {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4 py-10 text-gray-900">
        <div className="w-full max-w-3xl rounded-3xl border border-gray-200 bg-white/90 p-8 shadow-2xl shadow-purple-500/10 backdrop-blur">
          <div className="mb-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-500">
                XFUEL
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
                Institutional Access Portal
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                Ultra‑low‑latency settlement rail, tailored limits, and compliance‑ready reporting for
                treasuries.
              </p>
            </div>
            <div className="rounded-2xl border border-purple-400/40 bg-gray-50 px-4 py-3 text-right shadow-[0_0_24px_rgba(168,85,247,0.35)]">
              <p className="text-[11px] uppercase tracking-[0.22em] text-gray-500">
                Access status
              </p>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {wallet.isConnected ? 'Wallet connected' : 'Wallet not connected'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="flex-1 space-y-4">
              <p className="text-sm text-gray-600">
                Connect a treasury wallet to verify premium eligibility on‑chain. Only approved addresses
                can access institutional limits and settlement lanes.
              </p>
              <button
                type="button"
                onClick={handleConnectWallet}
                disabled={portalState === 'connecting' || portalState === 'checking'}
                className="xfuel-tap-glow inline-flex items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/50 transition hover:shadow-purple-500/70 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {portalState === 'connecting'
                  ? 'Connecting…'
                  : portalState === 'checking'
                  ? 'Verifying eligibility…'
                  : wallet.isConnected
                  ? 'Re-check eligibility'
                  : 'Connect treasury wallet'}
              </button>
              {error && (
                <p className="text-xs text-rose-500">
                  {error}
                </p>
              )}
              <p className="text-[11px] text-gray-500">
                View public docs at{' '}
                <a
                  href="https://xfuel.app"
                  className="font-medium text-purple-600 underline-offset-4 hover:underline"
                >
                  xfuel.app
                </a>{' '}
                while your desk is being onboarded.
              </p>
            </div>
            <div className="w-full max-w-xs space-y-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-xs text-gray-600">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
                Snapshot
              </p>
              <div className="flex items-center justify-between">
                <span>Target clients</span>
                <span className="font-mono text-gray-900">Treasury · Funds</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Min. size</span>
                <span className="font-mono text-gray-900">$10M+</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Review time</span>
                <span className="font-mono text-gray-900">1–3 business days</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderPremiumView = () => {
    const maxVolume = Math.max(...volumeData.map((d) => d.value))

    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f5f5f5] to-[#e0e0e0] px-4 py-8 text-gray-900">
        <div className="mx-auto flex max-w-7xl flex-col gap-8">
          {/* Hero Section */}
          <header className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-400">
                XFUEL INSTITUTIONS
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
                XFUEL Institutional Portal
              </h1>
            </div>
            <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
              <div className="rounded-full border border-purple-400/50 bg-white px-4 py-1.5 text-xs font-medium text-gray-900 shadow-[0_0_16px_rgba(168,85,247,0.3)]">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-purple-500 shadow-[0_0_6px_rgba(168,85,247,0.8)]" />
                Premium Client
                {tier ? ` · ${tier}` : null}
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-600">
                <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">
                  Wallet
                </p>
                <p className="mt-1 font-mono text-sm text-gray-900">
                  {wallet.address ?? '—'}
                </p>
              </div>
            </div>
          </header>

          {/* TVL Gauge */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                  Total Bridged TVL
                </p>
                <p className="mt-2 text-4xl font-semibold text-gray-900">
                  {formatCurrency(totalTVL)}
                </p>
                <p className="mt-1 text-sm text-gray-500">Across all chains</p>
              </div>
              <div className="relative h-24 w-24">
                <svg className="h-24 w-24 transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth="8"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="none"
                    stroke="url(#purpleGradient)"
                    strokeWidth="8"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - 0.75)}`}
                    strokeLinecap="round"
                    className="transition-all duration-1000"
                  />
                  <defs>
                    <linearGradient id="purpleGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#a855f7" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-semibold text-gray-900">75%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 1: Real-time Flow Analytics */}
          <section className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                  Real-time Flow Analytics
                </p>
                <p className="mt-1 text-sm text-gray-600">Cross-chain volume and flow visualization</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Animated Flow Map */}
              <div className="space-y-4">
                <p className="text-xs font-medium text-gray-700">Flow Map (Volume-weighted)</p>
                <div className="relative h-64 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white p-4 overflow-hidden">
                  {/* Theta Source */}
                  <div className="absolute left-4 top-1/2 -translate-y-1/2">
                    <div className="rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white shadow-lg">
                      Theta
                    </div>
                  </div>

                  {/* Animated Particles */}
                  {flowData
                    .filter((f) => f.direction === 'Out')
                    .map((flow, idx) => {
                      const angle = (idx * 60 - 30) * (Math.PI / 180)
                      const distance = 80 + idx * 20
                      const x = 80 + Math.cos(angle) * distance
                      const y = 128 + Math.sin(angle) * distance

                      return (
                        <div key={flow.chain} className="absolute" style={{ left: `${x}px`, top: `${y}px` }}>
                          <div
                            className="absolute h-1 w-1 rounded-full bg-purple-500 animate-pulse"
                            style={{
                              animationDelay: `${idx * 0.2}s`,
                              animationDuration: '2s',
                            }}
                          />
                          <div
                            className="absolute h-1 w-1 rounded-full bg-fuchsia-500 animate-ping"
                            style={{
                              animationDelay: `${idx * 0.3}s`,
                              animationDuration: '1.5s',
                            }}
                          />
                          <div className="mt-4 rounded-lg bg-white border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-700 shadow-sm">
                            {flow.chain}
                          </div>
                        </div>
                      )
                    })}

                  {/* Flow Lines */}
                  <svg className="absolute inset-0 pointer-events-none">
                    {flowData
                      .filter((f) => f.direction === 'Out')
                      .map((flow, idx) => {
                        const angle = (idx * 60 - 30) * (Math.PI / 180)
                        const distance = 80 + idx * 20
                        const x1 = 80
                        const y1 = 128
                        const x2 = 80 + Math.cos(angle) * distance
                        const y2 = 128 + Math.sin(angle) * distance

                        return (
                          <line
                            key={flow.chain}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke="url(#flowGradient)"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            opacity={0.4}
                            className="animate-pulse"
                            style={{
                              animationDelay: `${idx * 0.2}s`,
                            }}
                          />
                        )
                      })}
                    <defs>
                      <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#ec4899" stopOpacity="0.6" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>

              {/* Volume Chart */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-700">Volume Chart</p>
                  <select
                    value={volumePeriod}
                    onChange={(e) => setVolumePeriod(e.target.value as '24h' | '7d' | '30d')}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 focus:border-purple-500 focus:outline-none"
                  >
                    <option value="24h">24h</option>
                    <option value="7d">7d</option>
                    <option value="30d">30d</option>
                  </select>
                </div>
                <div className="h-48 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white p-4">
                  <div className="flex h-full items-end justify-between gap-2">
                    {volumeData.map((data, idx) => (
                      <div key={idx} className="flex flex-1 flex-col items-center gap-2">
                        <div
                          className="w-full rounded-t transition-all duration-500 bg-gradient-to-t from-purple-500 to-fuchsia-500 hover:opacity-80"
                          style={{
                            height: `${(data.value / maxVolume) * 100}%`,
                            minHeight: '8px',
                          }}
                        />
                        <span className="text-[10px] text-gray-500">{data.timestamp}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Top Chains Table */}
            <div className="mt-6 space-y-3">
              <p className="text-xs font-medium text-gray-700">Top Chains</p>
              <div className="overflow-hidden rounded-xl border border-gray-100">
                <table className="min-w-full border-collapse bg-white text-left text-xs">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-[0.16em] text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Chain</th>
                      <th className="px-4 py-3">Direction</th>
                      <th className="px-4 py-3 text-right">Volume (24h)</th>
                      <th className="px-4 py-3 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowData.map((flow, idx) => (
                      <tr key={idx} className="border-t border-gray-100 text-gray-700 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{flow.chain}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              flow.direction === 'In'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {flow.direction === 'In' ? 'Theta Inflows' : 'Cosmos Outflows'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatCurrency(flow.volume)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-gray-200">
                              <div
                                className="h-1.5 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
                                style={{ width: `${flow.percentage}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500">{flow.percentage}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Section 2: Compliance & Risk */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                Compliance & Risk
              </p>
              <div className="space-y-3">
                {/* Chainalysis KYT Score */}
                <div className="rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">
                        Chainalysis KYT
                      </p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {chainalysisScore}/100
                      </p>
                    </div>
                    <div className="rounded-full bg-emerald-100 px-3 py-1.5">
                      <span className="text-xs font-semibold text-emerald-700">Perfect</span>
                    </div>
                  </div>
                </div>

                {/* Sanctioned Address Alerts */}
                <div className="rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">
                        Sanctioned Address Alerts
                      </p>
                      <p className="mt-1 text-sm font-medium text-gray-900">
                        {sanctionedAlerts === 0 ? 'None detected' : `${sanctionedAlerts} alert(s)`}
                      </p>
                    </div>
                    {sanctionedAlerts === 0 ? (
                      <div className="rounded-full bg-emerald-100 px-3 py-1.5">
                        <span className="text-xs font-semibold text-emerald-700">Clean</span>
                      </div>
                    ) : (
                      <div className="rounded-full bg-rose-100 px-3 py-1.5">
                        <span className="text-xs font-semibold text-rose-700">Alert</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* SOC 2 Status */}
                <div className="rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">SOC 2</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    Type I complete — Type II in progress
                  </p>
                  <p className="mt-1 text-[11px] text-gray-500">Last audit: 2025-10-01</p>
                </div>
              </div>
            </div>

            {/* Section 3: Treasury Tools */}
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                Treasury Tools
              </p>

              {/* Custom Transfer Limits */}
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">Daily Limit</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900">
                    {formatCurrency(limits.daily, limits.currency)}
                  </p>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
                      style={{
                        width: `${Math.min(100, (limits.usedToday / limits.daily) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Used: {formatCurrency(limits.usedToday)} · Remaining:{' '}
                    {formatCurrency(dailyRemaining)}
                  </p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400">Monthly Limit</p>
                  <p className="mt-1 text-xl font-semibold text-gray-900">
                    {formatCurrency(limits.monthly, limits.currency)}
                  </p>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
                      style={{
                        width: `${Math.min(100, (limits.usedThisMonth / limits.monthly) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Used: {formatCurrency(limits.usedThisMonth)} · Remaining:{' '}
                    {formatCurrency(monthlyRemaining)}
                  </p>
                </div>
              </div>

              {/* CSV Export */}
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-purple-400/40 hover:text-purple-700"
              >
                Export CSV
              </button>

              {/* Contact Treasury Support */}
              <button
                type="button"
                className="xfuel-tap-glow inline-flex w-full items-center justify-center rounded-lg border border-purple-400/40 bg-white px-4 py-2.5 text-sm font-medium text-purple-700 shadow-sm transition hover:border-purple-400/60 hover:bg-purple-50"
              >
                Contact Treasury Support
              </button>
            </div>
          </section>

          {/* Transaction History */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                  Transaction History
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-100">
              <div className="max-h-72 overflow-auto text-xs">
                <table className="min-w-full border-collapse bg-white text-left">
                  <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase tracking-[0.16em] text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Time (UTC)</th>
                      <th className="px-4 py-3">Asset</th>
                      <th className="px-4 py-3">Direction</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Policy</th>
                      <th className="px-4 py-3">Tx hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txHistory.map((tx) => (
                      <tr key={tx.id} className="border-t border-gray-100 text-xs text-gray-700 hover:bg-gray-50">
                        <td className="px-4 py-3 align-top">
                          {new Date(tx.timestamp).toISOString().replace('T', ' ').replace('Z', '')}
                        </td>
                        <td className="px-4 py-3 align-top font-medium">{tx.asset}</td>
                        <td className="px-4 py-3 align-top">{tx.direction}</td>
                        <td className="px-4 py-3 align-top text-right font-mono">
                          {formatNumber(tx.amount)} {tx.currency}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={
                              tx.status === 'Settled'
                                ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700'
                                : 'rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700'
                            }
                          >
                            {tx.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={
                              tx.policyFlag === 'OK'
                                ? 'rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700'
                                : 'rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700'
                            }
                          >
                            {tx.policyFlag}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-[10px] text-gray-500">
                          {tx.txHash}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  const renderApplyForm = () => {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f5f5f5] to-[#e0e0e0] px-4 py-8 text-gray-900">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <header>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gray-500">
              XFUEL INSTITUTIONS
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Apply for premium access
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Institutional access is currently invite‑only. Share a bit about your treasury and we&apos;ll
              respond quickly.
            </p>
          </header>

          <main className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <form className="grid grid-cols-1 gap-6 sm:grid-cols-2" onSubmit={handleApplySubmit}>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-700">Institution name</label>
                <input
                  required
                  type="text"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="Example Capital, LP"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Website</label>
                <input
                  required
                  type="url"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="https://"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Primary jurisdiction</label>
                <input
                  required
                  type="text"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="US, EU, SG, etc."
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">
                  Expected monthly volume (band)
                </label>
                <select
                  required
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                >
                  <option value="">Select range</option>
                  <option>$10M – $25M</option>
                  <option>$25M – $50M</option>
                  <option>$50M – $100M</option>
                  <option>$100M+</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Primary use case</label>
                <select
                  required
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                >
                  <option value="">Select use case</option>
                  <option>Treasury management</option>
                  <option>Trading / market making</option>
                  <option>Settlement rail</option>
                  <option>On / off‑ramp</option>
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-700">Contact name</label>
                <input
                  required
                  type="text"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Work email</label>
                <input
                  required
                  type="email"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="name@firm.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700">Desk phone (optional)</label>
                <input
                  type="tel"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="+1 555 000 0000"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-700">
                  Wallet(s) to be whitelisted
                </label>
                <textarea
                  required
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder={
                    wallet.fullAddress
                      ? `Include connected: ${wallet.fullAddress} and any additional treasury wallets`
                      : 'Paste one address per line'
                  }
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-700">
                  Anything we should know about your setup? (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="Custody, banking relationships, counterparties, etc."
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="xfuel-tap-glow inline-flex w-full items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/50 transition hover:shadow-purple-500/70"
                >
                  Submit application
                </button>
                <p className="mt-2 text-[11px] text-gray-500">
                  You&apos;ll receive a confirmation email with a reference ID. Typical review time is 1–3
                  business days.
                </p>
              </div>
            </form>
          </main>
        </div>
      </div>
    )
  }

  if (!wallet.isConnected || portalState === 'idle' || portalState === 'connecting' || portalState === 'checking') {
    return renderGate()
  }

  if (portalState === 'whitelisted') {
    return renderPremiumView()
  }

  if (portalState === 'notWhitelisted') {
    return renderApplyForm()
  }

  return renderGate()
}

export default InstitutionsPortal
