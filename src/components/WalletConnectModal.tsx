import { useState, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createWalletConnectProvider, getWalletConnectUri } from '../utils/walletConnect'
import { isMobileDevice } from '../utils/thetaWallet'

interface WalletConnectModalProps {
  isOpen: boolean
  onClose: () => void
  onConnect: (provider: 'theta' | 'walletconnect' | 'metamask') => Promise<void> | void
}

export default function WalletConnectModal({
  isOpen,
  onClose,
  onConnect,
}: WalletConnectModalProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [showThetaQR, setShowThetaQR] = useState(false) // Show QR modal for Theta Wallet
  const [walletConnectUri, setWalletConnectUri] = useState<string | undefined>(undefined)
  const [showCopyToast, setShowCopyToast] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<any>(null) // Track active provider for cleanup

  // Initialize WalletConnect and get QR URI when showing QR modal
  useEffect(() => {
    if (showThetaQR && isOpen) {
      let provider: any = null
      
      const initWalletConnect = async () => {
        try {
          provider = await createWalletConnectProvider()
          setCurrentProvider(provider) // Store for cleanup
          
          // Check if already connected
          if (provider.session) {
            // Already connected, close modal and trigger connection handler
            setShowThetaQR(false)
            onConnect('walletconnect')
            return
          }
          
          // Listen for URI display
          provider.on('display_uri', (uri: string) => {
            setWalletConnectUri(uri)
          })
          
          // Listen for session establishment
          provider.on('connect', () => {
            setShowThetaQR(false)
            onConnect('walletconnect')
          })
          
          // Connect to get the URI (this will trigger display_uri event)
          // This will show QR code that user can scan
          await provider.connect()
        } catch (error: any) {
          console.error('Failed to initialize WalletConnect:', error)
          if (error?.message?.includes('User rejected') || error?.code === 4001) {
            // User cancelled, just close QR modal
            setShowThetaQR(false)
          }
        }
      }
      
      initWalletConnect()
      
      // Cleanup when closing QR modal
      return () => {
        if (provider) {
          provider.removeAllListeners()
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showThetaQR, isOpen])

  // Cleanup provider when modal closes
  useEffect(() => {
    if (!isOpen && currentProvider) {
      // Clean up any pending connections
      try {
        currentProvider.removeAllListeners()
        setCurrentProvider(null)
        setWalletConnectUri(undefined)
        setShowThetaQR(false)
      } catch (error) {
        console.error('Error cleaning up provider:', error)
      }
    }
  }, [isOpen, currentProvider])

  if (!isOpen) return null

  return (
    <>
      {/* Success Toast */}
      {showCopyToast && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-[fadeInDown_0.3s_ease-out]">
          <div className="px-6 py-4 rounded-xl border-2 border-cyan-400/80 bg-gradient-to-br from-cyan-500/30 via-cyan-600/25 to-slate-900/80 backdrop-blur-xl shadow-[0_0_40px_rgba(6,182,212,0.8),inset_0_0_20px_rgba(6,182,212,0.3)]">
            <div className="flex items-center gap-3">
              <svg
                className="w-5 h-5 text-cyan-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <p className="text-sm font-bold text-white">
                Link copied — paste in Theta Wallet app
              </p>
            </div>
          </div>
        </div>
      )}

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

              {/* Direct Theta Wallet - Native Connection */}
              <button
                onClick={async () => {
                  setIsConnecting(true)
                  try {
                    await onConnect('theta')
                  } catch (error) {
                    console.error('Theta Wallet connection error:', error)
                  } finally {
                    setIsConnecting(false)
                  }
                }}
                disabled={isConnecting}
                className="group relative w-full rounded-2xl border-2 border-purple-400/70 bg-gradient-to-br from-purple-500/25 via-purple-600/20 to-slate-900/40 px-6 py-5 text-left backdrop-blur-xl transition-all hover:border-purple-400 hover:shadow-[0_0_40px_rgba(168,85,247,0.8),inset_0_0_30px_rgba(168,85,247,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-purple-400/50 bg-gradient-to-br from-purple-500/40 to-purple-600/30 shadow-[0_0_25px_rgba(168,85,247,0.6)]">
                    <span className="text-3xl">⚡</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-xl font-bold text-white group-hover:text-purple-200 transition-colors">
                      {isConnecting ? 'Connecting...' : 'Connect Theta Wallet'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 group-hover:text-slate-300 transition-colors">
                      {isMobileDevice() ? 'Deep link or QR code' : 'Desktop wallet connection'}
                    </p>
                  </div>
                  <svg
                    className="w-6 h-6 text-purple-400 transition-all"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* WalletConnect QR Fallback - Button to show QR modal */}
              <button
                onClick={() => setShowThetaQR(true)}
                className="group relative w-full rounded-2xl border-2 border-cyan-400/60 bg-gradient-to-br from-cyan-500/20 via-cyan-600/15 to-slate-900/40 px-6 py-5 text-left backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_40px_rgba(6,182,212,0.7),inset_0_0_30px_rgba(6,182,212,0.2)] active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-cyan-400/50 bg-gradient-to-br from-cyan-500/40 to-cyan-600/30 shadow-[0_0_25px_rgba(6,182,212,0.6)]">
                    <span className="text-3xl">📱</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-xl font-bold text-white group-hover:text-cyan-200 transition-colors">
                      WalletConnect (Fallback)
                    </p>
                    <p className="text-xs text-slate-400 mt-1 group-hover:text-slate-300 transition-colors">
                      QR code for mobile wallet apps
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

              {/* QR Code Modal for Theta Wallet */}
              {showThetaQR && (
                <div className="relative p-6 rounded-2xl border-2 border-purple-400/60 bg-gradient-to-br from-purple-500/20 via-purple-600/15 to-slate-900/60 backdrop-blur-xl shadow-[0_0_50px_rgba(168,85,247,0.7),0_0_80px_rgba(168,85,247,0.4),inset_0_0_40px_rgba(168,85,247,0.2)]">
                  <button
                    onClick={() => {
                      setShowThetaQR(false)
                      onClose() // Also close the parent modal to prevent black screen
                    }}
                    className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-purple-400/50 bg-purple-500/20 text-purple-300 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  
                  <div className="text-center space-y-4">
                    {/* Neon QR Code Card */}
                    <div className="mx-auto w-64 h-64 rounded-3xl border-4 border-purple-400/80 bg-white p-6 shadow-[0_0_60px_rgba(168,85,247,0.8),0_0_100px_rgba(168,85,247,0.4),inset_0_0_30px_rgba(168,85,247,0.1)] relative overflow-hidden">
                      {/* Glow effect */}
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-400/20 via-transparent to-cyan-400/20 pointer-events-none" />
                      <div className="relative w-full h-full flex items-center justify-center bg-white rounded-2xl">
                        {walletConnectUri ? (
                          <QRCodeSVG
                            value={walletConnectUri}
                            size={200}
                            level="H"
                            includeMargin={false}
                            fgColor="#000000"
                            bgColor="#ffffff"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center space-y-2">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
                            <p className="text-xs text-purple-600 font-semibold">Loading QR...</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Manual Connect Fallback */}
                    {walletConnectUri && (
                      <div className="space-y-3">
                        {/* Copy Link Button */}
                        <div className="flex justify-center">
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(walletConnectUri)
                                setShowCopyToast(true)
                                setTimeout(() => {
                                  setShowCopyToast(false)
                                }, 3000)
                              } catch (error) {
                                console.error('Failed to copy link:', error)
                                // Fallback for older browsers
                                const textArea = document.createElement('textarea')
                                textArea.value = walletConnectUri
                                textArea.style.position = 'fixed'
                                textArea.style.opacity = '0'
                                document.body.appendChild(textArea)
                                textArea.select()
                                try {
                                  document.execCommand('copy')
                                  setShowCopyToast(true)
                                  setTimeout(() => {
                                    setShowCopyToast(false)
                                  }, 3000)
                                } catch (err) {
                                  console.error('Fallback copy failed:', err)
                                }
                                document.body.removeChild(textArea)
                              }
                            }}
                            className="group relative px-6 py-3 rounded-xl border-2 border-cyan-400/70 bg-gradient-to-br from-cyan-500/30 via-cyan-600/25 to-slate-900/50 backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(6,182,212,0.8),inset_0_0_20px_rgba(6,182,212,0.3)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <div className="flex items-center gap-2">
                              <svg
                                className="w-5 h-5 text-cyan-300 group-hover:text-cyan-200 transition-colors"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                              <span className="text-sm font-bold text-white group-hover:text-cyan-200 transition-colors">
                                Copy Link
                              </span>
                            </div>
                          </button>
                        </div>
                        
                        {/* Fallback Note */}
                        <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/5 px-3 py-2">
                          <p className="text-xs text-cyan-300/90 text-center">
                            💡 <span className="font-semibold">Can't scan QR?</span> Copy link and paste in Theta Wallet app
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Instructions */}
                    <div className="space-y-3">
                      <p className="text-base font-bold text-white">
                        Scan with Theta Wallet app for best experience
                      </p>
                      {!walletConnectUri && (
                        <p className="text-xs text-slate-400 animate-pulse">
                          Initializing WalletConnect...
                        </p>
                      )}
                      <ol className="text-xs text-slate-300 space-y-2 text-left max-w-sm mx-auto">
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

