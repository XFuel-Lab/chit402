/**
 * MOCK WALLET - For Testing UI Without Blockchain Connection
 * 
 * This allows you to test all UI features without connecting to Theta network.
 * Replace with real thetaWalletPro.ts when ready for production.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Haptics from 'expo-haptics'

export type WalletInfo = {
  isConnected: boolean
  addressShort: string | null
  addressFull: string | null
  balanceTfuel: number
  balanceTheta: number
  nonce: number
  timestamp: number
  sessionId: string | null
}

const MOCK_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
const STORAGE_KEY = '@xfuel:mock_wallet'

export function createDisconnectedWallet(): WalletInfo {
  return {
    isConnected: false,
    addressShort: null,
    addressFull: null,
    balanceTfuel: 0,
    balanceTheta: 0,
    nonce: 0,
    timestamp: 0,
    sessionId: null,
  }
}

let currentWallet: WalletInfo = createDisconnectedWallet()

export function getCurrentWallet(): WalletInfo {
  return currentWallet
}

export async function connectSmart(): Promise<WalletInfo> {
  console.log('🤖 Mock Smart Connect: Simulating wallet connection...')
  
  // Simulate connection delay
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  const wallet: WalletInfo = {
    isConnected: true,
    addressFull: MOCK_ADDRESS,
    addressShort: `${MOCK_ADDRESS.slice(0, 6)}...${MOCK_ADDRESS.slice(-4)}`,
    balanceTfuel: 1000.5, // Mock balance
    balanceTheta: 50.25,
    nonce: Date.now(),
    timestamp: Date.now(),
    sessionId: `mock_${Date.now()}`,
  }
  
  currentWallet = wallet
  
  // Save to storage
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(wallet))
  
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  console.log('✅ Mock wallet connected:', wallet.addressShort)
  
  return wallet
}

export async function connectWalletConnect(): Promise<WalletInfo> {
  return connectSmart()
}

export async function autoReconnectOnLaunch(): Promise<WalletInfo | null> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY)
    if (saved) {
      const wallet = JSON.parse(saved)
      currentWallet = wallet
      console.log('✅ Mock session restored:', wallet.addressShort)
      return wallet
    }
  } catch (error) {
    console.warn('Failed to restore session:', error)
  }
  return null
}

export async function refreshBalance(address: string): Promise<{ tfuel: number; theta: number }> {
  // Simulate balance refresh with slight variation
  const tfuel = currentWallet.balanceTfuel + (Math.random() * 2 - 1)
  const theta = currentWallet.balanceTheta + (Math.random() * 0.5 - 0.25)
  
  currentWallet.balanceTfuel = tfuel
  currentWallet.balanceTheta = theta
  
  console.log('💰 Mock balance refreshed:', { tfuel: tfuel.toFixed(2), theta: theta.toFixed(2) })
  
  return { tfuel, theta }
}

export async function disconnect(): Promise<void> {
  currentWallet = createDisconnectedWallet()
  await AsyncStorage.removeItem(STORAGE_KEY)
  console.log('🔌 Mock wallet disconnected')
}

export async function getSigner(): Promise<any> {
  return null // Mock signer
}

export async function signMessageSecure(message: string): Promise<string> {
  return '0xmocksignature...'
}

export function getRouterAddress(): string {
  return '0xMockRouterAddress'
}

export function getExplorerUrl(): string {
  return 'https://explorer.thetatoken.org'
}

export function isConnected(): boolean {
  return currentWallet.isConnected
}

export function getWalletConnectUri(): string | null {
  return null
}

