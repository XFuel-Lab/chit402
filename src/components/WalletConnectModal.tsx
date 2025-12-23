import { useState, useEffect } from 'react'

interface WalletConnectModalProps {
  isOpen: boolean
  onClose: () => void
  onConnect: (provider: 'theta' | 'metamask') => void
}

export default function WalletConnectModal({
  isOpen,
  onClose,
  onConnect,
}: WalletConnectModalProps) {
  const [thetaDetected, setThetaDetected] = useState(false)
  const [metamaskDetected, setMetamaskDetected] = useState(false)

  // Detect installed wallets
  useEffect(() => {
    if (isOpen) {
      const checkWallets = () => {
        const hasThetaWallet = !!(window as any).theta
        const hasMetaMask = !!(window as any).ethereum?.isMetaMask
        
        setThetaDetected(hasThetaWallet)
        setMetamaskDetected(hasMetaMask)
      }

      // Check immediately and after a short delay (wallets might initialize late)
      checkWallets()
      const timer = setTimeout(checkWallets, 500)
      
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="relative w-full max-w-lg rounded-3xl border-2 border-purple-400/60 bg-gradient-to-br from-[rgba(15,23,42,0.98)] via-[rgba(30,41,59,0.95)] to-[rgba(15,23,42,0.98)] backdrop-blur-2xl shadow-[0_0_80px_rgba(168,85,247,0.6),inset_0_0_60px_rgba(168,85,247,0.1)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-slate-600/50 bg-slate-800/50 text-slate-400 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300 hover:shadow-[0_0_15px_rgba(239,68,68,0.5)]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Content */}
          <div className="p-8 space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-purple-400/50 bg-gradient-to-br from-purple-500/30 to-cyan-500/20 shadow-[0_0_40px_rgba(168,85,247,0.6)]">
                  <span className="text-4xl">🔗</span>
                </div>
              </div>
              <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400">
                Connect Your Wallet
              </h2>
              <p className="text-sm text-slate-400">
                Choose your preferred wallet to start earning with XFUEL
              </p>
            </div>

            {/* Theta Wallet Option (Recommended) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                  ⭐ Recommended
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-purple-500/50 to-transparent" />
              </div>

              <button
                onClick={() => {
                  if (thetaDetected) {
                    onConnect('theta')
                  } else {
                    window.open('https://www.thetatoken.org/wallet', '_blank')
                  }
                }}
                className="group relative w-full rounded-2xl border-2 border-purple-400/70 bg-gradient-to-br from-purple-500/25 via-purple-600/20 to-slate-900/40 px-6 py-5 text-left backdrop-blur-xl transition-all hover:border-purple-400 hover:shadow-[0_0_40px_rgba(168,85,247,0.8),inset_0_0_30px_rgba(168,85,247,0.3)] active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-purple-400/50 bg-gradient-to-br from-purple-500/40 to-purple-600/30 shadow-[0_0_25px_rgba(168,85,247,0.6)]">
                    <span className="text-3xl">⚡</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold text-white group-hover:text-purple-200 transition-colors">
                        Theta Wallet
                      </p>
                      {thetaDetected && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
                            Detected
                          </span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 group-hover:text-slate-300 transition-colors">
                      {thetaDetected 
                        ? 'Best experience for TFUEL • Native Theta Network support'
                        : 'Install Theta Wallet for the best TFUEL experience'
                      }
                    </p>
                  </div>
                  <svg
                    className={`w-6 h-6 transition-all ${
                      thetaDetected 
                        ? 'text-purple-400 opacity-100' 
                        : 'text-cyan-400 opacity-60 group-hover:opacity-100'
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {thetaDetected ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    )}
                  </svg>
                </div>
              </button>

              {!thetaDetected && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                  <div className="flex-shrink-0">
                    <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-cyan-300 font-semibold">
                      Theta Wallet gives you the best experience for TFUEL staking and swaps
                    </p>
                    <a
                      href="https://www.thetatoken.org/wallet"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-cyan-400 underline hover:text-cyan-300 transition-colors"
                    >
                      Download for Chrome, Firefox, or Mobile →
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">or</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
            </div>

            {/* MetaMask Option */}
            <button
              onClick={() => {
                if (metamaskDetected) {
                  onConnect('metamask')
                } else {
                  window.open('https://metamask.io/download/', '_blank')
                }
              }}
              className="group relative w-full rounded-2xl border-2 border-cyan-400/60 bg-gradient-to-br from-cyan-500/20 via-cyan-600/15 to-slate-900/40 px-6 py-5 text-left backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_40px_rgba(6,182,212,0.7),inset_0_0_30px_rgba(6,182,212,0.2)] active:scale-[0.98]"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-cyan-400/50 bg-gradient-to-br from-cyan-500/40 to-cyan-600/30 shadow-[0_0_25px_rgba(6,182,212,0.6)]">
                  <span className="text-3xl">🦊</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-bold text-white group-hover:text-cyan-200 transition-colors">
                      MetaMask
                    </p>
                    {metamaskDetected && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
                          Detected
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 group-hover:text-slate-300 transition-colors">
                    {metamaskDetected
                      ? 'Popular Ethereum wallet • Works with Theta Network'
                      : 'Install MetaMask as an alternative option'
                    }
                  </p>
                </div>
                <svg
                  className={`w-6 h-6 transition-all ${
                    metamaskDetected 
                      ? 'text-cyan-400 opacity-100' 
                      : 'text-cyan-400 opacity-60 group-hover:opacity-100'
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {metamaskDetected ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  )}
                </svg>
              </div>
            </button>

            {/* Footer note */}
            <div className="text-center pt-2">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                🔒 Your wallet, your keys • We never store your private information
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

