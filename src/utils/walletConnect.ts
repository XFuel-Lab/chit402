import { EthereumProvider } from '@walletconnect/ethereum-provider'
import { THETA_MAINNET } from '../config/thetaConfig'

// WalletConnect v2 Project ID - get from https://cloud.walletconnect.com
// Set in environment variables: VITE_WALLETCONNECT_PROJECT_ID
// For local dev, create .env.local with: VITE_WALLETCONNECT_PROJECT_ID=your_project_id
// Fallback to production Project ID if env var not set
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'd132d658c164146b2546d5cd1ede0595'

// Warn if using fallback (should use env var in production)
if (!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID && import.meta.env.DEV) {
  console.warn('⚠️ WalletConnect: Using fallback Project ID. Set VITE_WALLETCONNECT_PROJECT_ID in .env.local')
}

// Deep link scheme for mobile Theta Wallet
const THETA_MOBILE_DEEP_LINK = 'theta://wc'

let walletConnectProvider: EthereumProvider | null = null

export async function createWalletConnectProvider(forceNew: boolean = false): Promise<EthereumProvider> {
  // If we have an existing provider with an active session, return it
  if (walletConnectProvider && !forceNew) {
    return walletConnectProvider
  }

  // If forcing new or provider doesn't exist, create a new one
  // First disconnect existing provider if it exists
  if (forceNew && walletConnectProvider) {
    try {
      walletConnectProvider.disconnect()
    } catch (error) {
      console.warn('Error disconnecting existing provider:', error)
    }
    walletConnectProvider = null
  }

  try {
    console.log('🔌 WalletConnect v2: Initializing...')
    console.log('   Project ID:', WALLETCONNECT_PROJECT_ID ? `${WALLETCONNECT_PROJECT_ID.substring(0, 8)}...` : 'NOT SET')
    console.log('   Chain ID:', THETA_MAINNET.chainId)
    console.log('   RPC URL:', THETA_MAINNET.rpcUrl)
    
    if (!WALLETCONNECT_PROJECT_ID) {
      throw new Error('WalletConnect Project ID is not configured. Set VITE_WALLETCONNECT_PROJECT_ID in environment variables.')
    }
    
    // Initialize WalletConnect v2 with Theta Network configuration
    walletConnectProvider = await EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [THETA_MAINNET.chainId],
      optionalChains: [],
      rpcMap: {
        [THETA_MAINNET.chainId]: THETA_MAINNET.rpcUrl,
      },
      metadata: {
        name: 'XFUEL Protocol',
        description: 'Convert Theta EdgeCloud revenue to auto-compounding Cosmos LSTs',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://xfuel.app',
        icons: [typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : 'https://xfuel.app/logo.png'],
      },
      showQrModal: true, // Use WalletConnect's built-in modal for better UX
      qrModalOptions: {
        themeMode: 'dark',
        themeVariables: {
          '--wcm-z-index': '9999',
        },
        explorerRecommendedWalletIds: [
          // Add Theta Wallet ID when available
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
      },
    })

    // Set up event listeners for connection status
    walletConnectProvider.on('display_uri', (uri: string) => {
      console.log('📱 WalletConnect URI generated:', uri.substring(0, 20) + '...')
      
      // On mobile, attempt to trigger deep link automatically
      if (isMobileDevice()) {
        const deepLink = uri.replace('wc:', THETA_MOBILE_DEEP_LINK)
        window.location.href = deepLink
      }
    })

    walletConnectProvider.on('connect', () => {
      console.log('✅ WalletConnect: Connected successfully')
    })

    walletConnectProvider.on('disconnect', () => {
      console.log('❌ WalletConnect: Disconnected')
    })

    console.log('✅ WalletConnect v2: Provider initialized successfully')
    return walletConnectProvider
  } catch (error) {
    console.error('❌ Failed to initialize WalletConnect:', error)
    throw error
  }
}

export function getWalletConnectProvider(): EthereumProvider | null {
  return walletConnectProvider
}

export function disconnectWalletConnect(): void {
  if (walletConnectProvider) {
    walletConnectProvider.disconnect()
    walletConnectProvider = null
  }
}

export function getWalletConnectUri(): string | undefined {
  return walletConnectProvider?.uri
}

/**
 * Check if running on mobile device
 */
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
}

/**
 * Check if WalletConnect is ready and has an active session
 */
export function isWalletConnectReady(): boolean {
  return !!(walletConnectProvider && walletConnectProvider.session)
}

