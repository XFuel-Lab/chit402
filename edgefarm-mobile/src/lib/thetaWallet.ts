import { ethers } from '@thetalabs/theta-js'
import { ThetaWalletConnect } from '@thetalabs/theta-wallet-connect'
import { Linking, Platform } from 'react-native'
import { THETA_MAINNET_RPC, THETA_MAINNET_CHAIN_ID, THETA_EXPLORER_URL, getAppExtra } from './appConfig'

export type WalletInfo = {
  isConnected: boolean
  addressShort: string | null
  addressFull: string | null
  balanceTfuel: number
}

// Deep link for Theta Wallet mobile app
const THETA_DEEP_LINK_SCHEME = 'theta://wc'

let walletConnect: ThetaWalletConnect | null = null
let provider: ethers.providers.JsonRpcProvider | null = null
let wcUri: string | null = null

export function createDisconnectedWallet(): WalletInfo {
  return {
    isConnected: false,
    addressShort: null,
    addressFull: null,
    balanceTfuel: 0,
  }
}

/**
 * Get WalletConnect URI for QR code display
 */
export function getWalletConnectUri(): string | null {
  return wcUri
}

/**
 * Open Theta Wallet mobile app via deep link
 */
export async function openThetaWalletApp(uri: string): Promise<boolean> {
  try {
    // Try theta:// scheme first
    const thetaUri = uri.replace('wc:', THETA_DEEP_LINK_SCHEME)
    const supported = await Linking.canOpenURL(thetaUri)
    
    if (supported) {
      await Linking.openURL(thetaUri)
      return true
    }
    
    // Fallback: Try opening with wc: directly (some wallets support this)
    const wcSupported = await Linking.canOpenURL(uri)
    if (wcSupported) {
      await Linking.openURL(uri)
      return true
    }
    
    return false
  } catch (error) {
    console.error('Error opening Theta Wallet app:', error)
    return false
  }
}

/**
 * Connect Theta Wallet via WalletConnect (with QR + deep link)
 * Returns wallet info on successful connection
 */
export async function connectThetaWallet(): Promise<WalletInfo> {
  try {
    // Initialize WalletConnect if not already done
    if (!walletConnect) {
      walletConnect = new ThetaWalletConnect({
        chainId: THETA_MAINNET_CHAIN_ID,
        rpcUrl: THETA_MAINNET_RPC,
      })

      // Listen for display_uri event to get QR code URI
      walletConnect.on('display_uri', (uri: string) => {
        console.log('📱 WalletConnect URI:', uri)
        wcUri = uri
        
        // Try to open mobile app automatically on mobile
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
          openThetaWalletApp(uri).catch(err => {
            console.warn('Failed to auto-open wallet app:', err)
          })
        }
      })
    }

    // Request connection
    const accounts = await walletConnect.enable()
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from wallet')
    }

    const address = accounts[0]
    const addressShort = `${address.slice(0, 6)}...${address.slice(-4)}`

    // Create provider and fetch balance
    provider = new ethers.providers.JsonRpcProvider(THETA_MAINNET_RPC)
    const balance = await provider.getBalance(address)
    const balanceTfuel = parseFloat(ethers.utils.formatEther(balance))

    // Clear URI after successful connection
    wcUri = null

    return {
      isConnected: true,
      addressFull: address,
      addressShort,
      balanceTfuel,
    }
  } catch (error: any) {
    console.error('Wallet connection error:', error)
    wcUri = null
    throw new Error(error?.message || 'Failed to connect wallet')
  }
}

export async function refreshBalance(address: string): Promise<number> {
  try {
    if (!provider) {
      provider = new ethers.providers.JsonRpcProvider(THETA_TESTNET_RPC)
    }
    const balance = await provider.getBalance(address)
    return parseFloat(ethers.utils.formatEther(balance))
  } catch (error) {
    console.error('Balance refresh error:', error)
    return 0
  }
}

export async function getSigner(): Promise<ethers.Signer | null> {
  if (!walletConnect) {
    return null
  }
  
  try {
    // Get the provider from WalletConnect
    const wcProvider = walletConnect.getProvider()
    if (!wcProvider) {
      return null
    }
    
    // Create ethers provider from WalletConnect provider
    const ethersProvider = new ethers.providers.Web3Provider(wcProvider as any)
    return ethersProvider.getSigner()
  } catch (error) {
    console.error('Error getting signer:', error)
    return null
  }
}

export function getRouterAddress(): string {
  const config = getAppExtra()
  return config.routerAddress || ''
}

export function getExplorerUrl(): string {
  return THETA_EXPLORER_URL
}

export function disconnectWallet() {
  if (walletConnect) {
    walletConnect.disconnect()
    walletConnect = null
  }
  provider = null
  wcUri = null
}


