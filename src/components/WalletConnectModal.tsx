import { useState } from 'react'

interface WalletConnectModalProps {
  isOpen: boolean
  onClose: () => void
  onConnect: (provider: 'walletconnect' | 'metamask') => Promise<void> | void
}

export default function WalletConnectModal({
  isOpen,
  onClose,
  onConnect,
}: WalletConnectModalProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [showQR, setShowQR] = useState(false)

  // WalletConnect URI for Theta Wallet connection
  const walletConnectURI = 'https://wallet.thetatoken.org/connect'

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

              {/* Theta Wallet via WalletConnect/Web */}
              <button
                onClick={() => setShowQR(!showQR)}
                className="group relative w-full rounded-2xl border-2 border-purple-400/70 bg-gradient-to-br from-purple-500/25 via-purple-600/20 to-slate-900/40 px-6 py-5 text-left backdrop-blur-xl transition-all hover:border-purple-400 hover:shadow-[0_0_40px_rgba(168,85,247,0.8),inset_0_0_30px_rgba(168,85,247,0.3)] active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-purple-400/50 bg-gradient-to-br from-purple-500/40 to-purple-600/30 shadow-[0_0_25px_rgba(168,85,247,0.6)]">
                    <span className="text-3xl">⚡</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-xl font-bold text-white group-hover:text-purple-200 transition-colors">
                      Theta Wallet
                    </p>
                    <p className="text-xs text-slate-400 mt-1 group-hover:text-slate-300 transition-colors">
                      Use official Theta Wallet app for best experience
                    </p>
                  </div>
                  <svg
                    className="w-6 h-6 text-purple-400 transition-all"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                </div>
              </button>

              {/* QR Code / Connection Instructions */}
              {showQR && (
                <div className="p-6 rounded-2xl border-2 border-purple-400/60 bg-gradient-to-br from-purple-500/20 via-purple-600/15 to-slate-900/60 backdrop-blur-xl shadow-[0_0_40px_rgba(168,85,247,0.5),inset_0_0_30px_rgba(168,85,247,0.2)]">
                  <div className="text-center space-y-4">
                    {/* QR Code Placeholder */}
                    <div className="mx-auto w-48 h-48 rounded-2xl border-2 border-purple-400/50 bg-white p-4 shadow-[0_0_30px_rgba(168,85,247,0.6)]">
                      <div className="w-full h-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 rounded-xl flex items-center justify-center">
                        <div className="text-center">
                          <svg className="w-32 h-32 mx-auto text-purple-600" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm-2 14h8v-8H3v8zm2-6h4v4H5v-4zm8-10v8h8V3h-8zm6 6h-4V5h4v4zm-6 4h2v2h-2v-2zm2 2h2v2h-2v-2zm-2 2h2v2h-2v-2zm4-4h2v2h-2v-2zm2 2h2v2h-2v-2zm-2 2h2v2h-2v-2zm2-6h2v2h-2V9zm-4 0h2v2h-2V9z"/>
                          </svg>
                          <p className="text-xs text-purple-600 font-bold mt-2">QR CODE</p>
                        </div>
                      </div>
                    </div>

                    {/* Instructions */}
                    <div className="space-y-2">
                      <p className="text-sm font-bold text-white">Scan with Theta Wallet App</p>
                      <ol className="text-xs text-slate-300 space-y-1 text-left max-w-xs mx-auto">
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400 font-bold">1.</span>
                          <span>Open Theta Wallet app on your phone</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400 font-bold">2.</span>
                          <span>Tap "Scan QR" or "WalletConnect"</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-purple-400 font-bold">3.</span>
                          <span>Scan this QR code to connect</span>
                        </li>
                      </ol>
                    </div>

                    {/* Download Links */}
                    <div className="pt-4 border-t border-purple-400/30">
                      <p className="text-[10px] text-slate-400 mb-2">Don't have the app?</p>
                      <div className="flex gap-2 justify-center">
                        <a
                          href="https://wallet.thetatoken.org"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-purple-400/50 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 hover:border-purple-400 transition-all"
                        >
                          📱 Download App
                        </a>
                        <button
                          onClick={async () => {
                            setIsConnecting(true)
                            try {
                              await onConnect('walletconnect')
                            } finally {
                              setIsConnecting(false)
                            }
                          }}
                          disabled={isConnecting}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-cyan-400/50 bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 hover:border-cyan-400 transition-all disabled:opacity-50"
                        >
                          {isConnecting ? '⏳ Connecting...' : '🔗 WalletConnect'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Info Message */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                <div className="flex-shrink-0">
                  <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-xs text-cyan-300 font-semibold">
                    Use official Theta Wallet app for best TFUEL staking experience
                  </p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">or</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
            </div>

            {/* MetaMask Option (Fallback) */}
            <button
              onClick={async () => {
                const hasMetaMask = !!(window as any).ethereum?.isMetaMask
                if (hasMetaMask) {
                  setIsConnecting(true)
                  try {
                    await onConnect('metamask')
                  } catch (error) {
                    console.error('MetaMask connection error:', error)
                  } finally {
                    setIsConnecting(false)
                  }
                } else {
                  window.open('https://metamask.io/download/', '_blank')
                }
              }}
              disabled={isConnecting}
              className="group relative w-full rounded-2xl border-2 border-cyan-400/60 bg-gradient-to-br from-cyan-500/20 via-cyan-600/15 to-slate-900/40 px-6 py-5 text-left backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_40px_rgba(6,182,212,0.7),inset_0_0_30px_rgba(6,182,212,0.2)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-cyan-400/50 bg-gradient-to-br from-cyan-500/40 to-cyan-600/30 shadow-[0_0_25px_rgba(6,182,212,0.6)]">
                  <span className="text-3xl">🦊</span>
                </div>
                <div className="flex-1">
                  <p className="text-xl font-bold text-white group-hover:text-cyan-200 transition-colors">
                    {isConnecting ? 'Connecting...' : 'MetaMask'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 group-hover:text-slate-300 transition-colors">
                    Alternative browser extension wallet
                  </p>
                </div>
                <svg
                  className="w-6 h-6 text-cyan-400 transition-all"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
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

