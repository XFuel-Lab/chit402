/**
 * Theta Wallet Pro Integration for React Native
 * Zero-friction mobile experience with:
 * - WalletConnect v2 with thetawallet:// deep linking
 * - AsyncStorage session persistence (auto-reconnect)
 * - No QR flashes - direct deep link priority
 * - Theta chain ID 361 configuration
 * - Haptic feedback integration
 * - Error recovery with toasts
 */

import { ethers } from '@thetalabs/theta-js'
import { ThetaWalletConnect } from '@thetalabs/theta-wallet-connect'
import { Linking, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'
import Toast from 'react-native-toast-message'
import { THETA_MAINNET_RPC, THETA_MAINNET_CHAIN_ID, THETA_EXPLORER_URL, getAppExtra } from './appConfig'

export type WalletInfo = {
  isConnected: boolean
  addressShort: string | null
  addressFull: string | null
  balanceTfuel: number
  nonce: number // Security nonce for replay protection
}

// Storage keys for session persistence
const STORAGE_KEYS = {
  WALLET_SESSION: '@xfuel/wallet_session',
  WALLET_ADDRESS: '@xfuel/wallet_address',
  CONNECTION_TIMESTAMP: '@xfuel/connection_ts',
}

// Deep link schemes for Theta Wallet mobile app
const THETA_DEEP_LINK_SCHEMES = [
  'thetawallet://wc',
  'theta://wc',
  'wc:',
]

// Session timeout (24 hours)
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000

let walletConnect: ThetaWalletConnect | null = null
let provider: ethers.providers.JsonRpcProvider | null = null
let wcUri: string | null = null
let connectionNonce: number = 0
let autoDeepLinkAttempted = false

/**
 * Generate new security nonce
 */
function generateNonce(): number {
  return Math.floor(Math.random() * 1000000) + Date.now()
}

export function createDisconnectedWallet(): WalletInfo {
  return {
    isConnected: false,
    addressShort: null,
    addressFull: null,
    balanceTfuel: 0,
    nonce: 0,
  }
}

/**
 * Get WalletConnect URI for QR code display
 */
export function getWalletConnectUri(): string | null {
  return wcUri
}

/**
 * Open Theta Wallet mobile app via deep link with multiple fallback strategies
 * Priority: thetawallet:// > theta:// > wc: > app store
 */
export async function openThetaWalletApp(uri: string): Promise<boolean> {
  try {
    console.log('📱 Attempting to open Theta Wallet app...')
    
    // Haptic feedback for button press
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    
    // Try each scheme in priority order
    for (const scheme of THETA_DEEP_LINK_SCHEMES) {
      try {
        // Replace wc: with the target scheme
        const deepLinkUri = uri.startsWith('wc:') 
          ? uri.replace('wc:', scheme.replace('://', ':')) 
          : uri
        
        const canOpen = await Linking.canOpenURL(deepLinkUri)
        
        if (canOpen) {
          console.log(`✅ Opening via ${scheme} scheme`)
          await Linking.openURL(deepLinkUri)
          
          // Success haptic
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
          
          return true
        }
      } catch (err) {
        console.log(`⚠️ Scheme ${scheme} not supported, trying next...`)
      }
    }
    
    // All schemes failed - redirect to app store
    console.log('⚠️ Theta Wallet not installed, redirecting to store...')
    
    if (Platform.OS === 'ios') {
      const appStoreUrl = 'https://apps.apple.com/app/theta-wallet/id1451094550'
      await Linking.openURL(appStoreUrl)
    } else if (Platform.OS === 'android') {
      const playStoreUrl = 'https://play.google.com/store/apps/details?id=org.thetatoken.wallet'
      await Linking.openURL(playStoreUrl)
    }
    
    Toast.show({
      type: 'info',
      text1: 'Install Theta Wallet',
      text2: 'Opening app store...',
      position: 'top',
    })
    
    return false
  } catch (error) {
    console.error('❌ Error opening Theta Wallet app:', error)
    
    Toast.show({
      type: 'error',
      text1: 'Connection Error',
      text2: 'Could not open Theta Wallet',
      position: 'top',
    })
    
    return false
  }
}

/**
 * Save wallet session to AsyncStorage
 */
async function saveSession(address: string): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.WALLET_ADDRESS, address],
      [STORAGE_KEYS.CONNECTION_TIMESTAMP, Date.now().toString()],
    ])
    console.log('💾 Session saved to AsyncStorage')
  } catch (error) {
    console.error('❌ Failed to save session:', error)
  }
}

/**
 * Load wallet session from AsyncStorage
 */
async function loadSession(): Promise<string | null> {
  try {
    const [[, address], [, timestamp]] = await AsyncStorage.multiGet([
      STORAGE_KEYS.WALLET_ADDRESS,
      STORAGE_KEYS.CONNECTION_TIMESTAMP,
    ])
    
    if (!address || !timestamp) {
      return null
    }
    
    // Check if session has expired
    const age = Date.now() - parseInt(timestamp, 10)
    if (age > SESSION_TIMEOUT_MS) {
      console.log('⚠️ Session expired, clearing...')
      await clearSession()
      return null
    }
    
    console.log('✅ Session loaded from AsyncStorage:', address.slice(0, 10) + '...')
    return address
  } catch (error) {
    console.error('❌ Failed to load session:', error)
    return null
  }
}

/**
 * Clear wallet session from AsyncStorage
 */
async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.WALLET_ADDRESS,
      STORAGE_KEYS.CONNECTION_TIMESTAMP,
    ])
    console.log('🗑️ Session cleared from AsyncStorage')
  } catch (error) {
    console.error('❌ Failed to clear session:', error)
  }
}

/**
 * Attempt to restore previous session
 */
export async function restoreSession(): Promise<WalletInfo | null> {
  try {
    const savedAddress = await loadSession()
    
    if (!savedAddress) {
      return null
    }
    
    // Check if WalletConnect session is still active
    if (walletConnect && walletConnect.connected) {
      console.log('✅ WalletConnect session still active')
      
      // Fetch balance
      if (!provider) {
        provider = new ethers.providers.JsonRpcProvider(THETA_MAINNET_RPC)
      }
      
      const balance = await provider.getBalance(savedAddress)
      const balanceTfuel = parseFloat(ethers.utils.formatEther(balance))
      
      connectionNonce = generateNonce()
      
      return {
        isConnected: true,
        addressFull: savedAddress,
        addressShort: `${savedAddress.slice(0, 6)}...${savedAddress.slice(-4)}`,
        balanceTfuel,
        nonce: connectionNonce,
      }
    }
    
    // Session exists but WC not connected - clear it
    await clearSession()
    return null
  } catch (error) {
    console.error('❌ Failed to restore session:', error)
    await clearSession()
    return null
  }
}

/**
 * Connect Theta Wallet via WalletConnect v2 (with QR + deep link)
 * Priority: Deep link > QR fallback
 * Returns wallet info on successful connection with security nonce
 */
export async function connectThetaWallet(suppressQR: boolean = true): Promise<WalletInfo> {
  try {
    console.log('🔌 Initializing Theta Wallet connection...')
    console.log('   Suppress QR:', suppressQR)
    
    // Try to restore previous session first
    const restored = await restoreSession()
    if (restored) {
      console.log('✅ Session restored successfully')
      
      Toast.show({
        type: 'success',
        text1: 'Welcome Back!',
        text2: `Connected to ${restored.addressShort}`,
        position: 'top',
      })
      
      return restored
    }
    
    // Initialize WalletConnect if not already done
    if (!walletConnect) {
      console.log('   Creating new WalletConnect instance...')
      walletConnect = new ThetaWalletConnect({
        chainId: THETA_MAINNET_CHAIN_ID,
        rpcUrl: THETA_MAINNET_RPC,
      })

      // Reset auto-deeplink flag
      autoDeepLinkAttempted = false

      // Listen for display_uri event to get QR code URI
      walletConnect.on('display_uri', (uri: string) => {
        console.log('📱 WalletConnect URI generated:', uri.substring(0, 30) + '...')
        wcUri = uri
        
        // Automatically attempt deep link ONCE on mobile platforms (suppress QR flash)
        if (!autoDeepLinkAttempted && suppressQR && (Platform.OS === 'ios' || Platform.OS === 'android')) {
          autoDeepLinkAttempted = true
          
          setTimeout(() => {
            openThetaWalletApp(uri).then(opened => {
              if (opened) {
                console.log('✅ Successfully auto-opened Theta Wallet app')
              } else {
                console.log('⚠️ Could not open app - QR fallback available')
              }
            }).catch(err => {
              console.warn('⚠️ Failed to auto-open wallet app:', err)
            })
          }, 100) // Small delay to ensure state is ready
        }
      })

      // Listen for connection events
      walletConnect.on('connect', () => {
        console.log('✅ WalletConnect: Connected')
        
        // Success haptic
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        
        Toast.show({
          type: 'success',
          text1: 'Wallet Connected!',
          text2: 'Ready to swap TFUEL',
          position: 'top',
        })
      })

      walletConnect.on('disconnect', () => {
        console.log('❌ WalletConnect: Disconnected')
        wcUri = null
        clearSession()
        
        Toast.show({
          type: 'info',
          text1: 'Wallet Disconnected',
          position: 'top',
        })
      })
    }

    // Request connection (this will trigger display_uri event)
    console.log('   Requesting account access...')
    const accounts = await walletConnect.enable()
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from wallet')
    }

    const address = accounts[0]
    const addressShort = `${address.slice(0, 6)}...${address.slice(-4)}`

    console.log('✅ Account connected:', addressShort)

    // Create provider and fetch balance
    if (!provider) {
      provider = new ethers.providers.JsonRpcProvider(THETA_MAINNET_RPC)
    }
    
    const balance = await provider.getBalance(address)
    const balanceTfuel = parseFloat(ethers.utils.formatEther(balance))

    console.log('💰 Balance:', balanceTfuel.toFixed(2), 'TFUEL')

    // Save session for auto-reconnect
    await saveSession(address)

    // Clear URI after successful connection
    wcUri = null

    // Generate security nonce
    connectionNonce = generateNonce()

    return {
      isConnected: true,
      addressFull: address,
      addressShort,
      balanceTfuel,
      nonce: connectionNonce,
    }
  } catch (error: any) {
    console.error('❌ Wallet connection error:', error)
    wcUri = null
    
    Toast.show({
      type: 'error',
      text1: 'Connection Failed',
      text2: error?.message || 'Unknown error',
      position: 'top',
    })
    
    throw new Error(error?.message || 'Failed to connect wallet')
  }
}

/**
 * Refresh wallet balance
 */
export async function refreshBalance(address: string): Promise<number> {
  try {
    if (!provider) {
      provider = new ethers.providers.JsonRpcProvider(THETA_MAINNET_RPC)
    }
    const balance = await provider.getBalance(address)
    const balanceTfuel = parseFloat(ethers.utils.formatEther(balance))
    console.log('💰 Balance refreshed:', balanceTfuel.toFixed(2), 'TFUEL')
    return balanceTfuel
  } catch (error) {
    console.error('❌ Balance refresh error:', error)
    return 0
  }
}

/**
 * Sign message with nonce for security (replay attack prevention)
 */
export async function signMessageWithNonce(message: string): Promise<string> {
  try {
    if (!walletConnect) {
      throw new Error('Wallet not connected')
    }

    // Add nonce and timestamp to prevent replay attacks
    const messageWithNonce = `${message}\n\nNonce: ${connectionNonce}\nTimestamp: ${Date.now()}`
    
    // Get signer and sign message
    const signer = await getSigner()
    if (!signer) {
      throw new Error('Could not get signer')
    }

    const signature = await signer.signMessage(messageWithNonce)
    
    // Generate new nonce after signing
    connectionNonce = generateNonce()
    
    console.log('✅ Message signed successfully')
    
    Toast.show({
      type: 'success',
      text1: 'Message Signed',
      position: 'top',
    })
    
    return signature
  } catch (error: any) {
    console.error('❌ Sign message error:', error)
    
    Toast.show({
      type: 'error',
      text1: 'Signing Failed',
      text2: error?.message || 'Unknown error',
      position: 'top',
    })
    
    throw new Error(error?.message || 'Failed to sign message')
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

/**
 * Disconnect wallet and cleanup
 */
export async function disconnectWallet(): Promise<void> {
  console.log('🔌 Disconnecting wallet...')
  
  if (walletConnect) {
    try {
      walletConnect.disconnect()
    } catch (error) {
      console.warn('⚠️ Error during disconnect:', error)
    }
    walletConnect = null
  }
  
  provider = null
  wcUri = null
  connectionNonce = 0
  autoDeepLinkAttempted = false
  
  // Clear persisted session
  await clearSession()
  
  console.log('✅ Wallet disconnected')
  
  Toast.show({
    type: 'info',
    text1: 'Wallet Disconnected',
    position: 'top',
  })
}

/**
 * Check if wallet is currently connected
 */
export function isWalletConnected(): boolean {
  return !!(walletConnect && walletConnect.connected)
}

/**
 * Setup deep link listener for handling incoming WalletConnect URIs
 */
export function setupDeepLinkListener(onConnect: (walletInfo: WalletInfo) => void): () => void {
  const handleUrl = ({ url }: { url: string }) => {
    console.log('🔗 Deep link received:', url)
    
    // Handle WalletConnect deep link responses
    if (url.includes('wc:') || url.includes('thetawallet://')) {
      console.log('✅ WalletConnect response detected')
      
      // The connection should be handled automatically by WalletConnect
      // Just provide haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
    }
  }
  
  // Listen for URL events
  const subscription = Linking.addEventListener('url', handleUrl)
  
  // Check for initial URL (if app was opened via deep link)
  Linking.getInitialURL().then(url => {
    if (url) {
      handleUrl({ url })
    }
  })
  
  // Return cleanup function
  return () => {
    subscription.remove()
  }
}
