/**
 * WalletConnect v2 Pro Integration for XFuel Protocol
 * Tesla-smooth wallet experience with:
 * - Session clearing on connection errors
 * - Automatic retry logic (3 attempts, 5s delay)
 * - Direct theta-js fallback if WalletConnect fails
 * - Platform-aware connection strategies
 * 
 * Inspired by ChainSafe/web3.unity and Theta web wallet patterns
 */

import { EthereumProvider } from '@walletconnect/ethereum-provider'
import { ethers } from 'ethers'
import { THETA_MAINNET } from '../config/thetaConfig'

// WalletConnect v2 Project ID
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'd132d658c164146b2546d5cd1ede0595'

// Deep link scheme for mobile Theta Wallet
const THETA_MOBILE_DEEP_LINK = 'thetawallet://wc'

// Retry configuration
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAY_MS = 5000

// Session storage keys
const STORAGE_KEYS = {
  WC_SESSION: 'xfuel_wc_session',
  WC_PAIRING: 'xfuel_wc_pairing',
  WC_LAST_ERROR: 'xfuel_wc_last_error',
  WC_ERROR_COUNT: 'xfuel_wc_error_count',
}

let walletConnectProvider: EthereumProvider | null = null
let retryCount = 0

/**
 * Clear all WalletConnect session data from localStorage
 * Call this when connection errors occur or approve button is disabled
 */
export async function clearWalletConnectSession(): Promise<void> {
  try {
    console.log('🧹 Clearing WalletConnect session data...')
    
    // Clear our custom storage
    Object.values(STORAGE_KEYS).forEach(key => {
      try {
        localStorage.removeItem(key)
      } catch (e) {
        // Ignore
      }
    })
    
    // Clear WalletConnect v2 storage (they use multiple keys)
    const wcKeys = Object.keys(localStorage).filter(key => 
      key.startsWith('wc@2:') || 
      key.startsWith('walletconnect') ||
      key.includes('WALLETCONNECT')
    )
    
    wcKeys.forEach(key => {
      try {
        localStorage.removeItem(key)
      } catch (e) {
        // Ignore
      }
    })
    
    // Disconnect existing provider
    if (walletConnectProvider) {
      try {
        await walletConnectProvider.disconnect()
      } catch (e) {
        console.warn('Error disconnecting provider:', e)
      }
      walletConnectProvider = null
    }
    
    console.log('✅ Session cleared successfully')
  } catch (error) {
    console.error('❌ Error clearing session:', error)
  }
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
 * Create WalletConnect provider with retry logic
 */
async function createProviderWithRetry(attempt: number = 1): Promise<EthereumProvider> {
  try {
    console.log(`🔌 WalletConnect v2: Creating provider (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})...`)
    
    if (!WALLETCONNECT_PROJECT_ID) {
      throw new Error('WalletConnect Project ID is not configured. Set VITE_WALLETCONNECT_PROJECT_ID in environment variables.')
    }
    
    // Initialize WalletConnect v2 with Theta Network configuration
    const provider = await EthereumProvider.init({
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
        explorerRecommendedWalletIds: [],
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

    console.log('✅ WalletConnect v2: Provider created successfully')
    return provider
  } catch (error: any) {
    console.error(`❌ Failed to create provider (attempt ${attempt}):`, error)
    
    // Track error count
    localStorage.setItem(STORAGE_KEYS.WC_ERROR_COUNT, attempt.toString())
    localStorage.setItem(STORAGE_KEYS.WC_LAST_ERROR, error.message || 'Unknown error')
    
    // Retry logic
    if (attempt < MAX_RETRY_ATTEMPTS) {
      console.log(`⏳ Retrying in ${RETRY_DELAY_MS / 1000} seconds...`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      
      // Clear session before retry
      await clearWalletConnectSession()
      
      return createProviderWithRetry(attempt + 1)
    }
    
    throw new Error(`Failed to initialize WalletConnect after ${MAX_RETRY_ATTEMPTS} attempts: ${error.message}`)
  }
}

/**
 * Create WalletConnect provider with enhanced error handling
 */
export async function createWalletConnectProvider(forceNew: boolean = false): Promise<EthereumProvider> {
  // If we have an existing provider with an active session, return it
  if (walletConnectProvider && !forceNew) {
    // Verify session is still valid
    try {
      if (walletConnectProvider.session) {
        console.log('✅ Reusing existing WalletConnect session')
        return walletConnectProvider
      }
    } catch (e) {
      console.warn('Existing session invalid, creating new one')
    }
  }

  // If forcing new or provider doesn't exist, clear and create new
  if (forceNew) {
    await clearWalletConnectSession()
  }

  try {
    // Reset retry count
    retryCount = 0
    
    // Create provider with retry logic
    walletConnectProvider = await createProviderWithRetry()
    
    // Set up event listeners for connection status
    walletConnectProvider.on('display_uri', (uri: string) => {
      console.log('📱 WalletConnect URI generated:', uri.substring(0, 20) + '...')
      
      // On mobile, attempt to trigger deep link automatically
      if (isMobileDevice()) {
        const deepLink = uri.replace('wc:', THETA_MOBILE_DEEP_LINK.replace('://', ':'))
        setTimeout(() => {
          window.location.href = deepLink
        }, 500)
      }
    })

    walletConnectProvider.on('connect', () => {
      console.log('✅ WalletConnect: Connected successfully')
      // Clear error tracking
      localStorage.removeItem(STORAGE_KEYS.WC_LAST_ERROR)
      localStorage.removeItem(STORAGE_KEYS.WC_ERROR_COUNT)
    })

    walletConnectProvider.on('disconnect', () => {
      console.log('❌ WalletConnect: Disconnected')
    })
    
    walletConnectProvider.on('session_delete', () => {
      console.log('🗑️ WalletConnect: Session deleted')
      clearWalletConnectSession()
    })

    return walletConnectProvider
  } catch (error: any) {
    console.error('❌ Failed to initialize WalletConnect:', error)
    
    // Show user-friendly error message
    const errorCount = parseInt(localStorage.getItem(STORAGE_KEYS.WC_ERROR_COUNT) || '0')
    if (errorCount >= MAX_RETRY_ATTEMPTS) {
      throw new Error(
        'WalletConnect connection failed after multiple attempts. ' +
        'Please try: 1) Clear Theta Wallet app cache, 2) Restart Theta Wallet, 3) Use direct wallet connection'
      )
    }
    
    throw error
  }
}

/**
 * Connect with WalletConnect and handle errors gracefully
 */
export async function connectWithWalletConnect(): Promise<{ provider: any; address: string }> {
  try {
    const provider = await createWalletConnectProvider(false)
    
    // Enable connection
    const accounts = await provider.enable()
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from wallet. Please approve the connection in Theta Wallet.')
    }
    
    return {
      provider,
      address: accounts[0],
    }
  } catch (error: any) {
    console.error('❌ WalletConnect connection error:', error)
    
    // If error mentions "user rejected" or "approve disabled", clear session and suggest fix
    if (error.message?.includes('rejected') || error.message?.includes('User') || error.code === 4001) {
      await clearWalletConnectSession()
      throw new Error(
        'Connection rejected or approve button disabled. ' +
        'Try: 1) Clear Theta Wallet app cache in Settings, 2) Restart the app, 3) Try again'
      )
    }
    
    throw error
  }
}

/**
 * Direct theta-js fallback connection (bypass WalletConnect)
 * Use this if WalletConnect consistently fails
 */
export async function connectWithDirectThetaJS(): Promise<{ provider: any; address: string }> {
  try {
    console.log('🔌 Attempting direct Theta Wallet connection (bypass WalletConnect)...')
    
    // Check if Theta Wallet extension is available
    const ethereum = (window as any).ethereum
    if (!ethereum || (!ethereum.isTheta && !ethereum.theta)) {
      throw new Error('Theta Wallet extension not detected. Please install Theta Wallet.')
    }
    
    // Request accounts directly
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from Theta Wallet')
    }
    
    console.log('✅ Direct connection successful:', accounts[0].substring(0, 10) + '...')
    
    return {
      provider: ethereum,
      address: accounts[0],
    }
  } catch (error: any) {
    console.error('❌ Direct Theta connection error:', error)
    throw error
  }
}

/**
 * Smart connect: Try WalletConnect first, fallback to direct if it fails
 */
export async function smartConnect(): Promise<{ provider: any; address: string; method: 'walletconnect' | 'direct' }> {
  // Check if we're on desktop with Theta extension - prefer direct connection
  if (!isMobileDevice() && (window as any).ethereum?.isTheta) {
    try {
      console.log('🎯 Desktop with Theta extension detected - using direct connection')
      const result = await connectWithDirectThetaJS()
      return { ...result, method: 'direct' }
    } catch (error) {
      console.warn('Direct connection failed, falling back to WalletConnect:', error)
    }
  }
  
  // Try WalletConnect
  try {
    const result = await connectWithWalletConnect()
    return { ...result, method: 'walletconnect' }
  } catch (error: any) {
    console.error('WalletConnect failed:', error)
    
    // On desktop, try direct as fallback
    if (!isMobileDevice()) {
      try {
        console.log('🔄 Falling back to direct Theta connection...')
        const result = await connectWithDirectThetaJS()
        return { ...result, method: 'direct' }
      } catch (directError) {
        console.error('Direct connection also failed:', directError)
      }
    }
    
    throw error
  }
}

export function getWalletConnectProvider(): EthereumProvider | null {
  return walletConnectProvider
}

export async function disconnectWalletConnect(): Promise<void> {
  await clearWalletConnectSession()
}

export function getWalletConnectUri(): string | undefined {
  return walletConnectProvider?.uri
}

export function isWalletConnectReady(): boolean {
  return !!(walletConnectProvider && walletConnectProvider.session)
}

/**
 * Get connection health status and debugging info
 */
export function getConnectionHealth(): {
  hasProvider: boolean
  hasSession: boolean
  lastError: string | null
  errorCount: number
  suggestions: string[]
} {
  const lastError = localStorage.getItem(STORAGE_KEYS.WC_LAST_ERROR)
  const errorCount = parseInt(localStorage.getItem(STORAGE_KEYS.WC_ERROR_COUNT) || '0')
  
  const suggestions: string[] = []
  
  if (errorCount > 0) {
    suggestions.push('Clear Theta Wallet app cache in Settings')
    suggestions.push('Restart Theta Wallet app')
    suggestions.push('Try direct wallet connection (desktop)')
  }
  
  if (!walletConnectProvider) {
    suggestions.push('Initialize WalletConnect provider first')
  }
  
  if (walletConnectProvider && !walletConnectProvider.session) {
    suggestions.push('Complete connection approval in Theta Wallet')
  }
  
  return {
    hasProvider: !!walletConnectProvider,
    hasSession: !!(walletConnectProvider?.session),
    lastError,
    errorCount,
    suggestions,
  }
}

