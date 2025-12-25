import { useState, useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createWalletConnectProvider } from '../utils/walletConnect'

interface ThetaWalletQRModalProps {
  isOpen: boolean
  onClose: () => void
  onConnect: (provider: any) => Promise<void> | void
}

export default function ThetaWalletQRModal({
  isOpen,
  onClose,
  onConnect,
}: ThetaWalletQRModalProps) {
  const [walletConnectUri, setWalletConnectUri] = useState<string | undefined>(undefined)
  const [showCopyToast, setShowCopyToast] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<any>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Stop polling function
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
      setIsPolling(false)
    }
  }

  // Poll for connection after QR is displayed
  useEffect(() => {
    if (isOpen && walletConnectUri && currentProvider && !isPolling) {
      setIsPolling(true)
      
      // Start polling for connection
      pollingIntervalRef.current = setInterval(async () => {
        try {
          // Check if provider has an active session
          if (currentProvider?.session) {
            console.log('WalletConnect session detected, connecting...')
            stopPolling()
            await onConnect(currentProvider)
            onClose()
          }
        } catch (error) {
          console.error('Error checking connection:', error)
        }
      }, 1000) // Poll every second
    }
    
    return () => {
      stopPolling()
    }
  }, [isOpen, walletConnectUri, currentProvider, isPolling, onConnect, onClose])

  // Initialize WalletConnect and generate URIs when modal opens
  useEffect(() => {
    if (isOpen) {
      let provider: any = null
      
      const initWalletConnect = async () => {
        try {
          console.log('ThetaWalletQRModal: Initializing WalletConnect...')
          setInitError(null)
          setIsConnecting(true)
          setWalletConnectUri(undefined)
          
          // Create a fresh provider for new connection attempts
          // This ensures we get a new URI even if a previous connection attempt failed
          console.log('ThetaWalletQRModal: Creating WalletConnect provider...')
          provider = await createWalletConnectProvider(true)
          setCurrentProvider(provider)
          console.log('ThetaWalletQRModal: Provider created successfully', { hasProvider: !!provider })
          
          // Check if already connected (shouldn't happen with forceNew=true, but check anyway)
          if (provider.session) {
            onConnect(provider)
            onClose()
            return
          }
          
          // Set up event listeners BEFORE calling connect
          // Listen for URI display - this event fires when URI is ready
          const handleDisplayUri = (uri: string) => {
            console.log('WalletConnect display_uri event:', uri)
            setWalletConnectUri(uri)
          }
          
          // Listen for session establishment
          const handleConnect = () => {
            console.log('WalletConnect connected')
            stopPolling()
            onConnect(provider)
            onClose()
          }
          
          provider.on('display_uri', handleDisplayUri)
          provider.on('connect', handleConnect)
          
          // Connect to get the URI
          // The URI should be available after connect() is called
          try {
            await provider.connect()
          } catch (connectError: any) {
            // If connect() throws, it might be because URI generation failed
            console.error('WalletConnect connect() error:', connectError)
            // Still try to get URI if available
          }
          
          // Check if URI is available directly (fallback if event didn't fire)
          // Use a local variable to track if we've set the URI
          let uriSet = false
          
          // Check if URI is available on the provider
          if (provider.uri) {
            console.log('WalletConnect URI found on provider.uri:', provider.uri)
            setWalletConnectUri(provider.uri)
            uriSet = true
          } else {
            console.log('WalletConnect URI not immediately available, waiting for display_uri event or delayed check...')
          }
          
          // Also check after a short delay in case URI is set asynchronously
          const timeoutId = setTimeout(() => {
            if (!uriSet) {
              // Try multiple ways to get the URI
              const possibleUri = provider?.uri || 
                                 (provider as any)?.signClient?.pairingTopic ||
                                 (provider as any)?.signClient?.session?.topic ||
                                 (provider as any)?._uri
              
              if (possibleUri && possibleUri.startsWith('wc:')) {
                console.log('WalletConnect URI (delayed check):', possibleUri)
                setWalletConnectUri(possibleUri)
              } else {
                console.warn('WalletConnect URI not available after connect(). Provider state:', {
                  hasUri: !!provider?.uri,
                  hasSession: !!provider?.session,
                  providerType: typeof provider,
                  providerKeys: provider ? Object.keys(provider).slice(0, 10) : [],
                  signClient: !!(provider as any)?.signClient,
                })
                console.warn('This might indicate a WalletConnect configuration issue. Check:')
                console.warn('1. VITE_WALLETCONNECT_PROJECT_ID is set correctly')
                console.warn('2. Network connectivity is working')
                console.warn('3. WalletConnect service is accessible')
                console.warn('4. Check browser console for CORS or network errors')
              }
            }
          }, 1000)
          
          // Store timeout ID for cleanup
          ;(provider as any)._uriTimeoutId = timeoutId
          
        } catch (error: any) {
          console.error('Failed to initialize WalletConnect:', error)
          const errorMessage = error?.message || error?.toString() || 'Unknown error'
          setInitError(`Failed to initialize WalletConnect: ${errorMessage}`)
          setIsConnecting(false)
          
          if (error?.message?.includes('User rejected') || error?.code === 4001) {
            onClose()
          }
        } finally {
          setIsConnecting(false)
        }
      }
      
      initWalletConnect()
      
      // Cleanup when closing modal
      return () => {
        stopPolling()
        if (provider) {
          // Clear any pending timeouts
          if ((provider as any)._uriTimeoutId) {
            clearTimeout((provider as any)._uriTimeoutId)
          }
          provider.removeAllListeners()
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Cleanup provider when modal closes
  useEffect(() => {
    if (!isOpen && currentProvider) {
      try {
        stopPolling()
        currentProvider.removeAllListeners()
        setCurrentProvider(null)
        setWalletConnectUri(undefined)
        setIsPolling(false)
      } catch (error) {
        console.error('Error cleaning up provider:', error)
      }
    }
  }, [isOpen, currentProvider])

  // Handle copy link - copy WalletConnect URI directly
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
                Scan with Theta Wallet mobile app (recommended)
              </p>
            </div>

            {/* Neon QR Code Card */}
            <div className="relative p-6 rounded-2xl border-2 border-purple-400/60 bg-gradient-to-br from-purple-500/20 via-purple-600/15 to-slate-900/60 backdrop-blur-xl shadow-[0_0_50px_rgba(168,85,247,0.7),0_0_80px_rgba(168,85,247,0.4),0_0_120px_rgba(168,85,247,0.3),inset_0_0_40px_rgba(168,85,247,0.2)]">
              <div className="text-center space-y-4">
                {/* QR Code with intense neon glow */}
                <div className="mx-auto w-64 h-64 rounded-3xl border-4 border-purple-400/80 bg-white p-6 shadow-[0_0_60px_rgba(168,85,247,0.9),0_0_100px_rgba(168,85,247,0.6),0_0_140px_rgba(168,85,247,0.4),0_0_180px_rgba(168,85,247,0.2),inset_0_0_30px_rgba(168,85,247,0.1)] relative overflow-hidden">
                  {/* Enhanced glow effect */}
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-400/20 via-transparent to-cyan-400/20 pointer-events-none" />
                  <div className="absolute -inset-4 bg-purple-400/20 blur-3xl pointer-events-none" />
                  <div className="absolute -inset-8 bg-purple-400/10 blur-[60px] pointer-events-none animate-pulse" />
                  
                  <div className="relative w-full h-full flex items-center justify-center bg-white rounded-2xl">
                    {initError ? (
                      <div className="flex flex-col items-center justify-center space-y-3 p-4">
                        <div className="text-red-500 text-4xl">⚠️</div>
                        <p className="text-xs text-red-600 font-semibold text-center">{initError}</p>
                        <button
                          onClick={() => {
                            setInitError(null)
                            setWalletConnectUri(undefined)
                            // Trigger re-initialization by toggling the modal
                            onClose()
                          }}
                          className="px-4 py-2 text-xs bg-purple-500 text-white rounded-lg hover:bg-purple-600"
                        >
                          Retry
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
                  <p className="text-base font-bold text-white">
                    Scan with Theta Wallet mobile app (recommended)
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
                </div>

                {/* Copy Link Button */}
                {walletConnectUri && (
                  <div className="space-y-3">
                    <button
                      onClick={handleCopyLink}
                      className="group relative px-6 py-3 rounded-xl border-2 border-cyan-400/70 bg-gradient-to-br from-cyan-500/30 via-cyan-600/25 to-slate-900/50 backdrop-blur-xl transition-all hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(6,182,212,0.8),inset_0_0_20px_rgba(6,182,212,0.3)] active:scale-[0.98]"
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
                    
                    {/* Fallback Note */}
                    <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/5 px-3 py-2">
                      <p className="text-xs text-cyan-300/90 text-center">
                        💡 Can't scan? Copy link and paste in Theta Wallet app
                      </p>
                    </div>
                    
                    {/* Having issues note */}
                    <div className="rounded-lg border border-purple-400/20 bg-purple-500/5 px-3 py-2 mt-2">
                      <p className="text-xs text-purple-300/80 text-center">
                        Having issues? Try MetaMask below
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
                🔒 Secure WalletConnect protocol • Your keys stay on your device
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

