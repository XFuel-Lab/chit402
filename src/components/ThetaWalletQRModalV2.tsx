/**
 * Theta Wallet QR Modal v2 - Persistent & Reliable
 * 
 * Features:
 * - Persistent QR display (no flashing)
 * - Automatic retry on errors
 * - Clear storage on failures
 * - Session polling
 * - Mobile deep link support
 * - Error recovery with retry button
 */

import { useState, useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { 
  createWalletConnectProvider, 
  clearWalletConnectStorage,
  isMobileDevice,
  THETA_CHAIN_CONFIG 
} from '../utils/walletConnectV2'

interface ThetaWalletQRModalV2Props {
  isOpen: boolean
  onClose: () => void
  onConnect: (provider: any) => Promise<void> | void
}

export default function ThetaWalletQRModalV2({
  isOpen,
  onClose,
  onConnect,
}: ThetaWalletQRModalV2Props) {
  const [walletConnectUri, setWalletConnectUri] = useState<string | undefined>(undefined)
  const [showCopyToast, setShowCopyToast] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMobile = isMobileDevice()

  // Stop polling function
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      setIsPolling(false)
    }
  }

  // Handle retry
  const handleRetry = async () => {
    console.log('🔄 Retrying connection...')
    setError(null)
    setWalletConnectUri(undefined)
    setRetryCount(prev => prev + 1)
    
    // Clear storage before retry
    clearWalletConnectStorage()
    
    // Re-trigger initialization
    await initWalletConnect()
  }

  // Initialize WalletConnect
  const initWalletConnect = async () => {
    try {
      console.log('🔌 ThetaWalletQRModal: Initializing WalletConnect...')
      setError(null)
      setIsConnecting(true)
      setWalletConnectUri(undefined)

      // Create provider with custom URI handler
      const provider = await createWalletConnectProvider({
        forceNew: true,
        showQrModal: false, // Use custom modal
        onDisplayUri: (uri: string) => {
          console.log('✅ URI received:', uri.substring(0, 20) + '...')
          setWalletConnectUri(uri)
        },
        onConnect: () => {
          console.log('✅ Connected via WalletConnect')
          stopPolling()
          onConnect(provider)
          onClose()
        },
        onDisconnect: () => {
          console.log('❌ Disconnected')
        },
      })

      setCurrentProvider(provider)

      // Enable provider to trigger connection flow
      try {
        await provider.enable()
      } catch (enableError: any) {
        // Check if user rejected
        if (enableError.message?.includes('User rejected') || enableError.code === 'ACTION_REJECTED') {
          console.log('User rejected connection')
          onClose()
          return
        }
        
        // Other errors - let it continue, URI might still be available
        console.warn('Enable error (continuing):', enableError)
      }

      setIsConnecting(false)
    } catch (error: any) {
      console.error('❌ Failed to initialize WalletConnect:', error)
      
      const errorMessage = error?.message || error?.toString() || 'Unknown error'
      setError(`Connection failed: ${errorMessage}`)
      setIsConnecting(false)

      // If user rejected, close modal
      if (error?.message?.includes('User rejected') || error?.code === 4001) {
        onClose()
      }
    }
  }

  // Poll for connection after QR is displayed
  useEffect(() => {
    if (isOpen && walletConnectUri && currentProvider && !isPolling) {
      console.log('🔍 Starting connection polling...')
      setIsPolling(true)

      // Start polling for connection
      pollingIntervalRef.current = setInterval(async () => {
        try {
          // Check if provider has an active session
          if (currentProvider?.session) {
            console.log('✅ WalletConnect session detected, connecting...')
            stopPolling()
            await onConnect(currentProvider)
            onClose()
          }
        } catch (error) {
          console.error('⚠️ Error checking connection:', error)
        }
      }, 1000) // Poll every second
    }

    return () => {
      stopPolling()
    }
  }, [isOpen, walletConnectUri, currentProvider, isPolling, onConnect, onClose])

  // Initialize WalletConnect when modal opens
  useEffect(() => {
    if (isOpen) {
      initWalletConnect()
    }

    // Cleanup when closing modal
    return () => {
      stopPolling()
      if (currentProvider) {
        try {
          currentProvider.removeAllListeners()
        } catch (err) {
          console.warn('Error removing listeners:', err)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, retryCount])

  // Cleanup provider when modal closes
  useEffect(() => {
    if (!isOpen && currentProvider) {
      try {
        stopPolling()
        currentProvider.removeAllListeners()
        setCurrentProvider(null)
        setWalletConnectUri(undefined)
        setIsPolling(false)
        setError(null)
      } catch (error) {
        console.error('Error cleaning up provider:', error)
      }
    }
  }, [isOpen, currentProvider])

  // Handle copy link
  const handleCopyLink = async () => {
    if (!walletConnectUri) return

    try {
      await navigator.clipboard.writeText(walletConnectUri)
      setShowCopyToast(true)
      setTimeout(() => setShowCopyToast(false), 3000)
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
        setTimeout(() => setShowCopyToast(false), 3000)
      } catch (err) {
        console.error('Fallback copy failed:', err)
      }
      
      document.body.removeChild(textArea)
    }
  }

  // Handle deep link on mobile
  const handleOpenDeepLink = () => {
    if (!walletConnectUri) return

    const deepLink = walletConnectUri.replace('wc:', 'thetawallet:')
    window.location.href = deepLink
  }

  // Handle MetaMask connection
  const handleMetaMaskConnect = async () => {
    const hasMetaMask = !!(window as any).ethereum?.isMetaMask
    
    if (hasMetaMask) {
      setIsConnecting(true)
      try {
        const ethereum = (window as any).ethereum
        await ethereum.request({ method: 'eth_requestAccounts' })
        await onConnect(ethereum)
        onClose()
      } catch (error) {
        console.error('MetaMask connection error:', error)
        setError('MetaMask connection failed')
      } finally {
        setIsConnecting(false)
      }
    } else {
      window.open('https://metamask.io/download/', '_blank')
    }
  }

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
                  <span className="text-4xl">⚡</span>
                </div>
              </div>
              <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400">
                Connect Theta Wallet
              </h2>
              <p className="text-sm text-slate-400">
                {isMobile ? 'Tap to open Theta Wallet app' : 'Scan with Theta Wallet mobile app'}
              </p>
            </div>

            {/* QR Code Card */}
            <div className="relative p-6 rounded-2xl border-2 border-purple-400/60 bg-gradient-to-br from-purple-500/20 via-purple-600/15 to-slate-900/60 backdrop-blur-xl shadow-[0_0_50px_rgba(168,85,247,0.7),0_0_80px_rgba(168,85,247,0.4),0_0_120px_rgba(168,85,247,0.3),inset_0_0_40px_rgba(168,85,247,0.2)]">
              <div className="text-center space-y-4">
                {/* QR Code with neon glow */}
                <div className="mx-auto w-64 h-64 rounded-3xl border-4 border-purple-400/80 bg-white p-6 shadow-[0_0_60px_rgba(168,85,247,0.9),0_0_100px_rgba(168,85,247,0.6),0_0_140px_rgba(168,85,247,0.4)] relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-400/20 via-transparent to-cyan-400/20 pointer-events-none" />
                  <div className="absolute -inset-4 bg-purple-400/20 blur-3xl pointer-events-none" />
                  <div className="absolute -inset-8 bg-purple-400/10 blur-[60px] pointer-events-none animate-pulse" />

                  <div className="relative w-full h-full flex items-center justify-center bg-white rounded-2xl">
                    {error ? (
                      <div className="flex flex-col items-center justify-center space-y-3 p-4">
                        <div className="text-red-500 text-4xl">⚠️</div>
                        <p className="text-xs text-red-600 font-semibold text-center">{error}</p>
                        <button
                          onClick={handleRetry}
                          className="px-4 py-2 text-xs bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
                        >
                          Retry Connection
                        </button>
                      </div>
                    ) : walletConnectUri ? (
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
                        {isConnecting && (
                          <p className="text-xs text-purple-400">Connecting to WalletConnect...</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Instructions */}
                <div className="space-y-3">
                  {!error && (
                    <>
                      <p className="text-base font-bold text-white">
                        {isMobile ? 'Tap button below to open app' : 'Scan with Theta Wallet mobile app'}
                      </p>
                      {!walletConnectUri && (
                        <p className="text-xs text-slate-400 animate-pulse">
                          Generating secure connection...
                        </p>
                      )}
                      {isPolling && walletConnectUri && (
                        <p className="text-xs text-purple-400 animate-pulse">
                          Waiting for connection...
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* Action Buttons */}
                {walletConnectUri && !error && (
                  <div className="space-y-3">
                    {/* Mobile Deep Link Button */}
                    {isMobile && (
                      <button
                        onClick={handleOpenDeepLink}
                        className="w-full group relative px-6 py-3 rounded-xl border-2 border-purple-400/70 bg-gradient-to-br from-purple-500/30 via-purple-600/25 to-slate-900/50 backdrop-blur-xl transition-all hover:border-purple-400 hover:shadow-[0_0_30px_rgba(168,85,247,0.8),inset_0_0_20px_rgba(168,85,247,0.3)] active:scale-[0.98]"
                      >
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-2xl">⚡</span>
                          <span className="text-sm font-bold text-white group-hover:text-purple-200 transition-colors">
                            Open Theta Wallet
                          </span>
                        </div>
                      </button>
                    )}

                    {/* Copy Link Button */}
                    <button
                      onClick={handleCopyLink}
                      className="w-full group relative px-6 py-3 rounded-xl border-2 border-cyan-400/70 bg-gradient-to-br from-cyan-500/30 via-cyan-600/25 to-slate-900/50 backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(6,182,212,0.8),inset_0_0_20px_rgba(6,182,212,0.3)] active:scale-[0.98]"
                    >
                      <div className="flex items-center justify-center gap-2">
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

                    {/* Info Note */}
                    <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/5 px-3 py-2">
                      <p className="text-xs text-cyan-300/90 text-center">
                        💡 Can't scan? Copy link and paste in Theta Wallet app
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
              <span className="text-xs text-slate-500 uppercase tracking-wider">or use</span>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent" />
            </div>

            {/* MetaMask Option */}
            <button
              onClick={handleMetaMaskConnect}
              disabled={isConnecting}
              className="group relative w-full rounded-2xl border-2 border-cyan-400/60 bg-gradient-to-br from-cyan-500/20 via-cyan-600/15 to-slate-900/40 px-6 py-4 text-left backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_40px_rgba(6,182,212,0.7),inset_0_0_30px_rgba(6,182,212,0.2)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-cyan-400/50 bg-gradient-to-br from-cyan-500/40 to-cyan-600/30 shadow-[0_0_25px_rgba(6,182,212,0.6)]">
                  <span className="text-2xl">🦊</span>
                </div>
                <div className="flex-1">
                  <p className="text-lg font-bold text-white group-hover:text-cyan-200 transition-colors">
                    {isConnecting ? 'Connecting...' : 'MetaMask'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 group-hover:text-slate-300 transition-colors">
                    Browser extension wallet
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
                🔒 Secure WalletConnect v2 • Theta Chain ID {THETA_CHAIN_CONFIG.chainId}
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

