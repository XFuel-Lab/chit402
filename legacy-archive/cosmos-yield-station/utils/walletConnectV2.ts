/**
 * WalletConnect v2 Integration for XFuel Protocol Web
 * 
 * Features:
 * - Persistent QR modals (no refresh on errors)
 * - Theta chain configuration (ID 361)
 * - Clear storage on errors with retry
 * - Session management
 * - Error recovery
 */

import { EthereumProvider } from '@walletconnect/ethereum-provider'

// WalletConnect v2 Project ID
// Get from https://cloud.walletconnect.com
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'd132d658c164146b2546d5cd1ede0595'

// Theta Network configuration
export const THETA_CHAIN_CONFIG = {
  chainId: 361,
  chainIdHex: '0x169',
  chainName: 'Theta Mainnet',
  rpcUrl: 'https://eth-rpc-api.thetatoken.org/rpc',
  blockExplorerUrl: 'https://explorer.thetatoken.org',
  nativeCurrency: {
    name: 'TFUEL',
    symbol: 'TFUEL',
    decimals: 18,
  },
}

// Deep link scheme for mobile Theta Wallet
const THETA_MOBILE_DEEP_LINK = 'thetawallet://wc'

let walletConnectProvider: EthereumProvider | null = null
let connectionAttempts = 0
const MAX_CONNECTION_ATTEMPTS = 3

/**
 * Check if running on mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
}

/**
 * Clear WalletConnect storage (use on errors for fresh start)
 */
export function clearWalletConnectStorage(): void {
  try {
    console.log('🗑️ Clearing WalletConnect storage...')
    
    // Clear localStorage keys used by WalletConnect
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith('wc@2:') || key.startsWith('walletconnect') || key.includes('WALLETCONNECT'))) {
        keysToRemove.push(key)
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key))
    
    console.log(`✅ Cleared ${keysToRemove.length} WalletConnect storage keys`)
  } catch (error) {
    console.warn('⚠️ Failed to clear WalletConnect storage:', error)
  }
}

/**
 * Create WalletConnect v2 provider with Theta chain configuration
 * Persistent and reliable - handles errors gracefully
 */
export async function createWalletConnectProvider(
  options: {
    forceNew?: boolean
    onDisplayUri?: (uri: string) => void
    onConnect?: () => void
    onDisconnect?: () => void
    showQrModal?: boolean
  } = {}
): Promise<EthereumProvider> {
  const {
    forceNew = false,
    onDisplayUri,
    onConnect,
    onDisconnect,
    showQrModal = true,
  } = options

  try {
    // If we have an existing provider and not forcing new, return it
    if (walletConnectProvider && !forceNew && walletConnectProvider.session) {
      console.log('✅ Reusing existing WalletConnect provider')
      return walletConnectProvider
    }

    // Disconnect existing provider if forcing new
    if (forceNew && walletConnectProvider) {
      try {
        await walletConnectProvider.disconnect()
      } catch (error) {
        console.warn('⚠️ Error disconnecting existing provider:', error)
      }
      walletConnectProvider = null
    }

    console.log('🔌 WalletConnect v2: Initializing...')
    console.log('   Project ID:', WALLETCONNECT_PROJECT_ID ? `${WALLETCONNECT_PROJECT_ID.substring(0, 8)}...` : 'NOT SET')
    console.log('   Chain ID:', THETA_CHAIN_CONFIG.chainId)
    console.log('   RPC URL:', THETA_CHAIN_CONFIG.rpcUrl)
    console.log('   Connection attempt:', connectionAttempts + 1, '/', MAX_CONNECTION_ATTEMPTS)

    if (!WALLETCONNECT_PROJECT_ID) {
      throw new Error('WalletConnect Project ID is not configured. Set VITE_WALLETCONNECT_PROJECT_ID in environment variables.')
    }

    // Initialize WalletConnect v2 with Theta Network configuration
    walletConnectProvider = await EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [THETA_CHAIN_CONFIG.chainId],
      optionalChains: [],
      rpcMap: {
        [THETA_CHAIN_CONFIG.chainId]: THETA_CHAIN_CONFIG.rpcUrl,
      },
      metadata: {
        name: 'XFUEL Protocol',
        description: 'Convert Theta EdgeCloud revenue to auto-compounding Cosmos LSTs',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://xfuel.app',
        icons: [typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : 'https://xfuel.app/logo.png'],
      },
      showQrModal,
      qrModalOptions: showQrModal ? {
        themeMode: 'dark',
        themeVariables: {
          '--wcm-z-index': '9999',
          '--wcm-accent-color': '#a855f7',
          '--wcm-background-color': '#0f172a',
        },
        explorerRecommendedWalletIds: [
          // Theta Wallet ID (when available from WalletConnect registry)
        ],
        mobileWallets: [
          {
            id: 'theta-wallet',
            name: 'Theta Wallet',
            links: {
              native: THETA_MOBILE_DEEP_LINK,
              universal: 'https://wallet.thetatoken.org',
            },
          },
        ],
      } : undefined,
    })

    // Set up event listeners
    walletConnectProvider.on('display_uri', (uri: string) => {
      console.log('📱 WalletConnect URI generated:', uri.substring(0, 20) + '...')
      
      // Call custom handler if provided
      if (onDisplayUri) {
        onDisplayUri(uri)
      }
      
      // On mobile, attempt to trigger deep link automatically
      if (isMobileDevice() && !showQrModal) {
        console.log('📱 Auto-triggering deep link for mobile...')
        const deepLink = uri.replace('wc:', 'thetawallet:')
        
        // Small delay to ensure state is ready
        setTimeout(() => {
          try {
            window.location.href = deepLink
          } catch (err) {
            console.warn('⚠️ Failed to open deep link:', err)
          }
        }, 100)
      }
    })

    walletConnectProvider.on('connect', (connectInfo) => {
      console.log('✅ WalletConnect: Connected successfully', connectInfo)
      connectionAttempts = 0 // Reset attempts on success
      
      if (onConnect) {
        onConnect()
      }
    })

    walletConnectProvider.on('disconnect', (error) => {
      console.log('❌ WalletConnect: Disconnected', error)
      
      if (onDisconnect) {
        onDisconnect()
      }
    })

    walletConnectProvider.on('chainChanged', (chainId: number) => {
      console.log('🔗 Chain changed:', chainId)
      
      // Ensure we're on Theta network
      if (chainId !== THETA_CHAIN_CONFIG.chainId) {
        console.warn('⚠️ Wrong network detected, please switch to Theta Mainnet')
      }
    })

    walletConnectProvider.on('accountsChanged', (accounts: string[]) => {
      console.log('👤 Accounts changed:', accounts)
    })

    console.log('✅ WalletConnect v2: Provider initialized successfully')
    connectionAttempts++
    
    return walletConnectProvider
  } catch (error: any) {
    console.error('❌ Failed to initialize WalletConnect:', error)
    connectionAttempts++
    
    // If we've hit max attempts, clear storage for next try
    if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
      console.log('🗑️ Max connection attempts reached, clearing storage...')
      clearWalletConnectStorage()
      connectionAttempts = 0
    }
    
    throw error
  }
}

/**
 * Get current WalletConnect provider instance
 */
export function getWalletConnectProvider(): EthereumProvider | null {
  return walletConnectProvider
}

/**
 * Connect to WalletConnect (displays QR or triggers deep link)
 */
export async function connectWalletConnect(): Promise<EthereumProvider> {
  try {
    const provider = await createWalletConnectProvider({ forceNew: false })
    
    // Enable the provider (requests accounts)
    await provider.enable()
    
    return provider
  } catch (error: any) {
    console.error('❌ WalletConnect connection error:', error)
    
    // Clear storage on connection errors
    if (error.message?.includes('User rejected') || error.code === 'ACTION_REJECTED') {
      console.log('User rejected connection')
    } else {
      console.log('Connection failed, clearing storage for retry...')
      clearWalletConnectStorage()
    }
    
    throw error
  }
}

/**
 * Disconnect WalletConnect and cleanup
 */
export async function disconnectWalletConnect(): Promise<void> {
  if (walletConnectProvider) {
    try {
      await walletConnectProvider.disconnect()
    } catch (error) {
      console.warn('⚠️ Error during disconnect:', error)
    }
    walletConnectProvider = null
  }
  
  // Clear storage
  clearWalletConnectStorage()
  connectionAttempts = 0
}

/**
 * Get WalletConnect URI for custom QR display
 */
export function getWalletConnectUri(): string | undefined {
  return walletConnectProvider?.uri
}

/**
 * Check if WalletConnect is ready and has an active session
 */
export function isWalletConnectReady(): boolean {
  return !!(walletConnectProvider && walletConnectProvider.session)
}

/**
 * Get current chain ID
 */
export function getChainId(): number | undefined {
  return walletConnectProvider?.chainId
}

/**
 * Switch to Theta network
 */
export async function switchToThetaNetwork(): Promise<boolean> {
  if (!walletConnectProvider) {
    return false
  }

  try {
    await walletConnectProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: THETA_CHAIN_CONFIG.chainIdHex }],
    })
    return true
  } catch (switchError: any) {
    // Chain not added, try to add it
    if (switchError.code === 4902) {
      try {
        await walletConnectProvider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: THETA_CHAIN_CONFIG.chainIdHex,
              chainName: THETA_CHAIN_CONFIG.chainName,
              nativeCurrency: THETA_CHAIN_CONFIG.nativeCurrency,
              rpcUrls: [THETA_CHAIN_CONFIG.rpcUrl],
              blockExplorerUrls: [THETA_CHAIN_CONFIG.blockExplorerUrl],
            },
          ],
        })
        return true
      } catch (addError) {
        console.error('Failed to add Theta network:', addError)
        return false
      }
    }
    console.error('Failed to switch to Theta network:', switchError)
    return false
  }
}

/**
 * Retry connection after error
 */
export async function retryConnection(): Promise<EthereumProvider> {
  console.log('🔄 Retrying WalletConnect connection...')
  
  // Clear storage before retry
  clearWalletConnectStorage()
  
  // Force new provider
  return await createWalletConnectProvider({ forceNew: true })
}

