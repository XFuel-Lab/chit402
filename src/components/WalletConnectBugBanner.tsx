/**
 * WalletConnect Bug Warning Banner
 * 
 * Prominently warns users about Theta Wallet QR issues and recommends MetaMask
 */

import { useState } from 'react'

interface WalletConnectBugBannerProps {
  onMetaMaskClick: () => void
}

export default function WalletConnectBugBanner({ onMetaMaskClick }: WalletConnectBugBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    // Check if user dismissed this banner in the last 7 days
    const dismissedUntil = localStorage.getItem('xfuel-wc-banner-dismissed')
    if (dismissedUntil) {
      const dismissedTime = parseInt(dismissedUntil)
      const weekInMs = 7 * 24 * 60 * 60 * 1000
      if (Date.now() < dismissedTime + weekInMs) {
        return true
      }
    }
    return false
  })

  const handleDismiss = () => {
    localStorage.setItem('xfuel-wc-banner-dismissed', Date.now().toString())
    setDismissed(true)
  }

  if (dismissed) return null

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-500/20 via-orange-500/15 to-slate-900/60 p-6 backdrop-blur-xl shadow-[0_0_40px_rgba(251,191,36,0.5),inset_0_0_30px_rgba(251,191,36,0.1)] mb-6">
      {/* Close button */}
      <button
        onClick={handleDismiss}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-slate-600/50 bg-slate-800/50 text-slate-400 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Content */}
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-amber-400/60 bg-gradient-to-br from-amber-500/40 to-orange-500/30 shadow-[0_0_25px_rgba(251,191,36,0.6)]">
            <span className="text-2xl">⚡</span>
          </div>
        </div>

        <div className="flex-1 pr-8">
          <h3 className="text-lg font-bold text-amber-200 mb-2">
            Having wallet connection issues?
          </h3>
          <p className="text-sm text-slate-300 mb-3">
            Some users experience <span className="font-semibold text-amber-300">QR code approval bugs</span> with Theta Wallet WalletConnect. 
            For <span className="font-semibold text-cyan-300">instant, zero-friction connection</span>, use MetaMask instead.
          </p>

          <button
            onClick={onMetaMaskClick}
            className="group relative inline-flex items-center gap-2 rounded-xl border-2 border-cyan-400/70 bg-gradient-to-br from-cyan-500/30 via-cyan-600/25 to-slate-900/50 px-4 py-2 backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(6,182,212,0.8),inset_0_0_20px_rgba(6,182,212,0.3)] active:scale-[0.98]"
          >
            <span className="text-2xl">🦊</span>
            <span className="text-sm font-bold text-white group-hover:text-cyan-200 transition-colors">
              Connect with MetaMask (Instant)
            </span>
            <svg
              className="w-4 h-4 text-cyan-400 transition-all"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>

          <p className="text-xs text-slate-500 mt-3">
            💡 MetaMask works with Theta Network RPC. We'll auto-switch you to the correct network.
          </p>
        </div>
      </div>
    </div>
  )
}

