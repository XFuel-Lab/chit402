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

interface ComplianceSnapshot {
  soc2Status: 'In progress' | 'Certified'
  soc2LastAudit: string
  chainalysisScore: number
  chainalysisLabel: string
  lastUpdated: string
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
  const [compliance] = useState<ComplianceSnapshot>({
    soc2Status: 'In progress',
    soc2LastAudit: '2025-10-01',
    chainalysisScore: 9,
    chainalysisLabel: 'Low risk',
    lastUpdated: '2025-12-15T08:00:00Z',
  })

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
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900">
        <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-2xl shadow-purple-500/10 backdrop-blur">
          <div className="mb-8 flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                XFUEL
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Institutional Access Portal
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Ultra‑low‑latency settlement rail, tailored limits, and compliance‑ready reporting for
                treasuries.
              </p>
            </div>
            <div className="rounded-2xl border border-purple-400/40 bg-slate-50 px-4 py-3 text-right shadow-[0_0_24px_rgba(168,85,247,0.35)]">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Access status
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {wallet.isConnected ? 'Wallet connected' : 'Wallet not connected'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="flex-1 space-y-4">
              <p className="text-sm text-slate-600">
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
              <p className="text-[11px] text-slate-500">
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
            <div className="w-full max-w-xs space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Snapshot
              </p>
              <div className="flex items-center justify-between">
                <span>Target clients</span>
                <span className="font-mono text-slate-900">Treasury · Funds</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Min. size</span>
                <span className="font-mono text-slate-900">$10M+</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Review time</span>
                <span className="font-mono text-slate-900">1–3 business days</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderPremiumView = () => {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
                XFUEL INSTITUTIONS
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Private Client Portal
              </h1>
            </div>
            <div className="flex flex-col items-end gap-3 sm:flex-row sm:items-center">
              <div className="rounded-full border border-purple-400/50 bg-white px-4 py-1.5 text-xs font-medium text-slate-900 shadow-[0_0_16px_rgba(168,85,247,0.3)]">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-purple-500 shadow-[0_0_6px_rgba(168,85,247,0.8)]" />
                Premium Client
                {tier ? ` · ${tier}` : null}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  Wallet
                </p>
                <p className="mt-1 font-mono text-sm text-slate-900">
                  {wallet.address ?? '—'}
                </p>
              </div>
            </div>
          </header>

          <main className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Limits */}
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  Transfer limits
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Daily</p>
                  <p className="text-xl font-semibold text-slate-900">
                    {formatCurrency(limits.daily, limits.currency)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Used today:{' '}
                    <span className="font-mono text-slate-900">
                      {formatCurrency(limits.usedToday, limits.currency)}
                    </span>
                  </p>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
                      style={{
                        width: `${Math.min(100, (limits.usedToday / limits.daily) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Remaining today:{' '}
                    <span className="font-mono text-slate-900">
                      {formatCurrency(dailyRemaining, limits.currency)}
                    </span>
                  </p>
                </div>
                <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Monthly</p>
                  <p className="text-xl font-semibold text-slate-900">
                    {formatCurrency(limits.monthly, limits.currency)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Used this month:{' '}
                    <span className="font-mono text-slate-900">
                      {formatCurrency(limits.usedThisMonth, limits.currency)}
                    </span>
                  </p>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
                      style={{
                        width: `${Math.min(100, (limits.usedThisMonth / limits.monthly) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Remaining this month:{' '}
                    <span className="font-mono text-slate-900">
                      {formatCurrency(monthlyRemaining, limits.currency)}
                    </span>
                  </p>
                </div>
              </div>
            </section>

            {/* Treasury support */}
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Treasury support
              </p>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  Account manager
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">Assigned contact</p>
              </div>
              <button
                type="button"
                className="inline-flex w-full items-center justify-center rounded-lg border border-purple-400/40 bg-white px-4 py-2 text-sm font-medium text-purple-700 shadow-sm transition hover:border-purple-400/60 hover:bg-purple-50"
              >
                Contact support
              </button>
            </section>

            {/* History */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
              <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Transaction history
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-purple-400/40 hover:text-purple-700"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-100">
                <div className="max-h-72 overflow-auto text-xs">
                  <table className="min-w-full border-collapse bg-white text-left">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Time (UTC)</th>
                        <th className="px-3 py-2">Asset</th>
                        <th className="px-3 py-2">Direction</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Policy</th>
                        <th className="px-3 py-2">Tx hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txHistory.map((tx) => (
                        <tr key={tx.id} className="border-t border-slate-100 text-xs text-slate-700">
                          <td className="px-3 py-2 align-top">
                            {new Date(tx.timestamp).toISOString().replace('T', ' ').replace('Z', '')}
                          </td>
                          <td className="px-3 py-2 align-top">{tx.asset}</td>
                          <td className="px-3 py-2 align-top">{tx.direction}</td>
                          <td className="px-3 py-2 align-top text-right">
                            {formatNumber(tx.amount)} {tx.currency}
                          </td>
                          <td className="px-3 py-2 align-top">
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
                          <td className="px-3 py-2 align-top">
                            <span
                              className={
                                tx.policyFlag === 'OK'
                                  ? 'rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700'
                                  : 'rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700'
                              }
                            >
                              {tx.policyFlag}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top font-mono text-[10px] text-slate-500">
                            {tx.txHash}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* Compliance */}
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Compliance
              </p>
              <div className="space-y-3 text-xs text-slate-600">
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">SOC 2</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {compliance.soc2Status === 'Certified'
                      ? 'SOC 2 Type II Certified'
                      : 'SOC 2 Type II in progress'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Last audit: {compliance.soc2LastAudit}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                    Chainalysis
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {compliance.chainalysisLabel}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Score {compliance.chainalysisScore}/100
                  </p>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    )
  }

  const renderApplyForm = () => {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <header>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              XFUEL INSTITUTIONS
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Apply for premium access
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Institutional access is currently invite‑only. Share a bit about your treasury and we&apos;ll
              respond quickly.
            </p>
          </header>

          <main className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <form className="grid grid-cols-1 gap-6 sm:grid-cols-2" onSubmit={handleApplySubmit}>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-700">Institution name</label>
                <input
                  required
                  type="text"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="Example Capital, LP"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Website</label>
                <input
                  required
                  type="url"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="https://"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Primary jurisdiction</label>
                <input
                  required
                  type="text"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="US, EU, SG, etc."
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Expected monthly volume (band)
                </label>
                <select
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                >
                  <option value="">Select range</option>
                  <option>$10M – $25M</option>
                  <option>$25M – $50M</option>
                  <option>$50M – $100M</option>
                  <option>$100M+</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Primary use case</label>
                <select
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                >
                  <option value="">Select use case</option>
                  <option>Treasury management</option>
                  <option>Trading / market making</option>
                  <option>Settlement rail</option>
                  <option>On / off‑ramp</option>
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-700">Contact name</label>
                <input
                  required
                  type="text"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Work email</label>
                <input
                  required
                  type="email"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="name@firm.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Desk phone (optional)</label>
                <input
                  type="tel"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                  placeholder="+1 555 000 0000"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-700">
                  Wallet(s) to be whitelisted
                </label>
                <textarea
                  required
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
                  placeholder={
                    wallet.fullAddress
                      ? `Include connected: ${wallet.fullAddress} and any additional treasury wallets`
                      : 'Paste one address per line'
                  }
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-slate-700">
                  Anything we should know about your setup? (optional)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-purple-500"
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
                <p className="mt-2 text-[11px] text-slate-500">
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


