/**
 * Unified Theta Wallet Integration for React Native
 * 
 * Features:
 * - WalletConnect v2 with deep linking
 * - Automatic mobile app detection
 * - QR code fallback
 * - Nonce-based security
 * - Type-safe wallet info
 */

import { ethers } from '@thetalabs/theta-js'
import { ThetaWalletConnect } from '@thetalabs/theta-wallet-connect'
import { Linking, Platform } from 'react-native'
import { THETA_MAINNET_RPC, THETA_MAINNET_CHAIN_ID, THETA_EXPLORER_URL, getAppExtra } from './appConfig'

export type WalletInfo = {
  isConnected: boolean
  addressShort: string | null
  addressFull: string | null
  balanceTfuel: number
  nonce: number // Security nonce for replay protection
}

// Deep link schemes for Theta Wallet mobile app
const THETA_DEEP_LINK_SCHEME = 'theta://wc'
const THETA_WC_SCHEME = 'wc:'

let walletConnect: ThetaWalletConnect | null = null
let provider: ethers.providers.JsonRpcProvider | null = null
let wcUri: string | null = null
let connectionNonce: number = 0

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
 */
export async function openThetaWalletApp(uri: string): Promise<boolean> {
  try {
    console.log('📱 Attempting to open Theta Wallet app...')
    
    // Strategy 1: Try theta:// deep link scheme (preferred)
    const thetaUri = uri.replace(THETA_WC_SCHEME, THETA_DEEP_LINK_SCHEME)
    const thetaSupported = await Linking.canOpenURL(thetaUri)
    
    if (thetaSupported) {
      console.log('✅ Opening via theta:// scheme')
      await Linking.openURL(thetaUri)
      return true
    }
    
    // Strategy 2: Try wc: scheme directly (universal WalletConnect)
    const wcSupported = await Linking.canOpenURL(uri)
    if (wcSupported) {
      console.log('✅ Opening via wc: scheme')
      await Linking.openURL(uri)
      return true
    }
    
    // Strategy 3: Platform-specific app store links
    if (Platform.OS === 'ios') {
      const appStoreUrl = 'https://apps.apple.com/app/theta-wallet/id1451094550'
      const canOpen = await Linking.canOpenURL(appStoreUrl)
      if (canOpen) {
        console.log('⚠️ Theta Wallet not installed, opening App Store...')
        await Linking.openURL(appStoreUrl)
        return false
      }
    } else if (Platform.OS === 'android') {
      const playStoreUrl = 'https://play.google.com/store/apps/details?id=org.thetatoken.wallet'
      const canOpen = await Linking.canOpenURL(playStoreUrl)
      if (canOpen) {
        console.log('⚠️ Theta Wallet not installed, opening Play Store...')
        await Linking.openURL(playStoreUrl)
        return false
      }
    }
    
    console.log('❌ Could not open Theta Wallet app')
    return false
  } catch (error) {
    console.error('❌ Error opening Theta Wallet app:', error)
    return false
  }
}

/**
 * Connect Theta Wallet via WalletConnect v2 (with QR + deep link)
 * Returns wallet info on successful connection with security nonce
 */
export async function connectThetaWallet(): Promise<WalletInfo> {
  try {
    console.log('🔌 Initializing Theta Wallet connection...')
    
    // Initialize WalletConnect if not already done
    if (!walletConnect) {
      console.log('   Creating new WalletConnect instance...')
      walletConnect = new ThetaWalletConnect({
        chainId: THETA_MAINNET_CHAIN_ID,
        rpcUrl: THETA_MAINNET_RPC,
      })

      // Listen for display_uri event to get QR code URI
      walletConnect.on('display_uri', (uri: string) => {
        console.log('📱 WalletConnect URI generated:', uri.substring(0, 30) + '...')
        wcUri = uri
        
        // Automatically attempt deep link on mobile platforms
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
          setTimeout(() => {
            openThetaWalletApp(uri).then(opened => {
              if (opened) {
                console.log('✅ Successfully opened Theta Wallet app')
              } else {
                console.log('⚠️ Could not open app - user may need to scan QR')
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
      })

      walletConnect.on('disconnect', () => {
        console.log('❌ WalletConnect: Disconnected')
        wcUri = null
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
    return signature
  } catch (error: any) {
    console.error('❌ Sign message error:', error)
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
export function disconnectWallet() {
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
  
  console.log('✅ Wallet disconnected')
}

/**
 * Check if wallet is currently connected
 */
export function isWalletConnected(): boolean {
  return !!(walletConnect && walletConnect.connected)
}


