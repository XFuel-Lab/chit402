import { EthereumProvider } from '@walletconnect/ethereum-provider'
import { THETA_MAINNET } from '../config/thetaConfig'

// WalletConnect Project ID - get from https://cloud.walletconnect.com
// Set in Vercel environment variables: VITE_WALLETCONNECT_PROJECT_ID
// For local dev, create .env.local with: VITE_WALLETCONNECT_PROJECT_ID=your_project_id
// Fallback to production Project ID if env var not set
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'd132d658c164146b2546d5cd1ede0595'

// Warn if using fallback (should use env var in production)
if (!import.meta.env.VITE_WALLETCONNECT_PROJECT_ID && import.meta.env.DEV) {
  console.warn('WalletConnect: Using fallback Project ID. Set VITE_WALLETCONNECT_PROJECT_ID in .env.local for local development.')
}

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
    console.log('WalletConnect: Initializing with Project ID:', WALLETCONNECT_PROJECT_ID ? `${WALLETCONNECT_PROJECT_ID.substring(0, 8)}...` : 'NOT SET')
    console.log('WalletConnect: Chain ID:', THETA_MAINNET.chainId)
    console.log('WalletConnect: RPC URL:', THETA_MAINNET.rpcUrl)
    
    if (!WALLETCONNECT_PROJECT_ID) {
      throw new Error('WalletConnect Project ID is not configured. Set VITE_WALLETCONNECT_PROJECT_ID in .env.local')
    }
    
    walletConnectProvider = await EthereumProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [THETA_MAINNET.chainId],
      optionalChains: [],
      rpcMap: {
        [THETA_MAINNET.chainId]: THETA_MAINNET.rpcUrl,
      },
      metadata: {
        name: 'XFUEL Protocol',
        description: 'XFUEL Protocol - Theta Network DeFi',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://xfuel.app',
        icons: ['https://xfuel.app/logo.png'],
      },
      showQrModal: false, // We'll show our own custom modal
    })

    console.log('WalletConnect: Provider initialized successfully')
    return walletConnectProvider
  } catch (error) {
    console.error('Failed to initialize WalletConnect:', error)
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

