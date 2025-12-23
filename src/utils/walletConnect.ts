import { EthereumProvider } from '@walletconnect/ethereum-provider'
import { THETA_MAINNET } from '../config/thetaConfig'

// WalletConnect Project ID - get from https://cloud.walletconnect.com
// For now using a placeholder - user should replace with their own Project ID
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID'

let walletConnectProvider: EthereumProvider | null = null

export async function createWalletConnectProvider(): Promise<EthereumProvider> {
  if (walletConnectProvider) {
    return walletConnectProvider
  }

  try {
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

