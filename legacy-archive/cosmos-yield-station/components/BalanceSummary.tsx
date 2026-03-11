import React from 'react'

interface BalanceSummaryProps {
  thetaWallet: {
    address: string | null
    balance: string
    isConnected: boolean
  }
  keplrWallet: {
    address: string | null
    isConnected: boolean
    lstBalances: {
      stkATOM: string
      stkTIA: string
    }
  }
  usdcBalance: string
  rxfBalance: string
}

/**
 * User Balances Summary (Theta + Keplr)
 */
export function BalanceSummary({
  thetaWallet,
  keplrWallet,
  usdcBalance,
  rxfBalance,
}: BalanceSummaryProps) {
  if (!thetaWallet.isConnected && !keplrWallet.isConnected) {
    return null
  }

  return (
    <div className="rounded-3xl border border-purple-400/60 bg-gradient-to-br from-[rgba(168,85,247,0.20)] via-[rgba(56,189,248,0.15)] to-[rgba(15,23,42,0.30)] p-5 backdrop-blur-xl shadow-[0_0_30px_rgba(168,85,247,0.3)]">
      <p className="mb-4 text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
        Your Balances
      </p>

      <div className="space-y-4">
        {/* Theta Wallet */}
        {thetaWallet.isConnected && (
          <div className="rounded-2xl border border-purple-400/40 bg-black/30 px-4 py-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                Theta Wallet
              </p>
              <span className="text-[10px] text-purple-300">● Connected</span>
            </div>
            <p className="text-xs font-mono text-slate-400">
              {thetaWallet.address ? `${thetaWallet.address.slice(0, 8)}...${thetaWallet.address.slice(-6)}` : '—'}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-lg font-bold text-purple-300">{thetaWallet.balance}</span>
              <span className="text-sm text-slate-300">TFUEL</span>
            </div>
            {(parseFloat(usdcBalance) > 0 || parseFloat(rxfBalance) > 0) && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-purple-400/30 pt-3">
                {parseFloat(usdcBalance) > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">USDC</p>
                    <p className="text-sm font-semibold text-cyan-300">
                      {parseFloat(usdcBalance).toFixed(2)}
                    </p>
                  </div>
                )}
                {parseFloat(rxfBalance) > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">rXF</p>
                    <p className="text-sm font-semibold text-purple-300">
                      {parseFloat(rxfBalance).toFixed(2)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Keplr Wallet */}
        {keplrWallet.isConnected && (
          <div className="rounded-2xl border border-cyan-400/40 bg-black/30 px-4 py-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400/80">
                Keplr Wallet
              </p>
              <span className="text-[10px] text-cyan-300">● Connected</span>
            </div>
            <p className="text-xs font-mono text-slate-400">
              {keplrWallet.address ? `${keplrWallet.address.slice(0, 12)}...${keplrWallet.address.slice(-8)}` : '—'}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">stkATOM</p>
                <p className="text-sm font-semibold text-cyan-300">
                  {parseFloat(keplrWallet.lstBalances.stkATOM) > 0
                    ? parseFloat(keplrWallet.lstBalances.stkATOM).toFixed(4)
                    : '0.0000'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400">stkTIA</p>
                <p className="text-sm font-semibold text-cyan-300">
                  {parseFloat(keplrWallet.lstBalances.stkTIA) > 0
                    ? parseFloat(keplrWallet.lstBalances.stkTIA).toFixed(4)
                    : '0.0000'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default BalanceSummary

