/**
 * Theta Wallet Pro - Web Edition
 * Platform-aware wallet integration with:
 * - Smart connection detection (extension vs WalletConnect)
 * - Visual feedback via toasts
 * - Session persistence
 * - Error recovery
 * 
 * Tesla-smooth UX for web
 */

import { ethers } from 'ethers'
import { THETA_MAINNET } from '../config/thetaConfig'
import { 
  smartConnect, 
  clearWalletConnectSession, 
  disconnectWalletConnect,
  getConnectionHealth 
} from './walletConnectPro'

export interface WalletInfo {
  address: string | null
  fullAddress: string | null
  balance: string
  isConnected: boolean
  connectionMethod?: 'extension' | 'walletconnect'
}

// Session storage key
const SESSION_KEY = 'xfuel_theta_session'
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24 hours

let currentProvider: any = null
let connectionMethod: 'extension' | 'walletconnect' | null = null

/**
 * Platform detection
 */
export function getPlatformInfo() {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
  const hasMetaMask = !!(window as any).ethereum?.isMetaMask
  const hasThetaExtension = !!(window as any).ethereum?.isTheta || !!(window as any).ethereum?.theta
  
  return {
    isMobile,
    hasMetaMask,
    hasThetaExtension,
    recommendedMethod: hasThetaExtension ? 'extension' : isMobile ? 'mobile' : 'walletconnect'
  }
}

/**
 * Show toast notification (requires toast library integration)
 */
function showToast(type: 'success' | 'error' | 'info', title: string, message?: string) {
  console.log(`[${type.toUpperCase()}] ${title}${message ? ': ' + message : ''}`)
  
  // If you have a toast library, integrate here
  // Example: toast[type](message || title)
}

/**
 * Save session to localStorage
 */
function saveSession(address: string, method: 'extension' | 'walletconnect') {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      address,
      method,
      timestamp: Date.now(),
    }))
  } catch (error) {
    console.warn('Failed to save session:', error)
  }
}

/**
 * Load session from localStorage
 */
function loadSession(): { address: string; method: 'extension' | 'walletconnect' } | null {
  try {
    const data = localStorage.getItem(SESSION_KEY)
    if (!data) return null
    
    const session = JSON.parse(data)
    
    // Check if session expired
    if (Date.now() - session.timestamp > SESSION_TIMEOUT_MS) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    
    return session
  } catch (error) {
    console.warn('Failed to load session:', error)
    return null
  }
}

/**
 * Clear session
 */
function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch (error) {
    console.warn('Failed to clear session:', error)
  }
}

/**
 * Restore previous session
 */
export async function restoreSession(): Promise<WalletInfo | null> {
  try {
    const session = loadSession()
    if (!session) return null
    
    console.log('🔄 Attempting to restore session...')
    
    // Verify the wallet is still connected
    if (session.method === 'extension') {
      const ethereum = (window as any).ethereum
      if (!ethereum || (!ethereum.isTheta && !ethereum.theta)) {
        clearSession()
        return null
      }
      
      const accounts = await ethereum.request({ method: 'eth_accounts' })
      if (!accounts || accounts.length === 0 || accounts[0] !== session.address) {
        clearSession()
        return null
      }
      
      currentProvider = ethereum
      connectionMethod = 'extension'
      
      // Get balance
      const provider = new ethers.BrowserProvider(ethereum)
      const balance = await provider.getBalance(session.address)
      
      showToast('success', 'Welcome Back!', `Connected to ${session.address.substring(0, 6)}...${session.address.slice(-4)}`)
      
      return {
        address: `${session.address.substring(0, 6)}...${session.address.slice(-4)}`,
        fullAddress: session.address,
        balance: parseFloat(ethers.formatEther(balance)).toFixed(2),
        isConnected: true,
        connectionMethod: 'extension',
      }
    }
    
    // WalletConnect sessions are handled by the WC library itself
    clearSession()
    return null
  } catch (error) {
    console.error('Failed to restore session:', error)
    clearSession()
    return null
  }
}

/**
 * Connect Theta Wallet with smart method selection
 */
export async function connectThetaWallet(): Promise<WalletInfo> {
  try {
    console.log('🔌 Connecting Theta Wallet...')
    
    // Try to restore session first
    const restored = await restoreSession()
    if (restored) {
      return restored
    }
    
    // Get platform info for optimal connection method
    const platform = getPlatformInfo()
    console.log('📱 Platform:', platform)
    
    // Use smart connect (WalletConnect with direct fallback)
    const result = await smartConnect()
    
    currentProvider = result.provider
    connectionMethod = result.method === 'direct' ? 'extension' : 'walletconnect'
    
    // Get balance
    const provider = result.method === 'direct' 
      ? new ethers.BrowserProvider(result.provider)
      : new ethers.BrowserProvider(result.provider)
    
    const balance = await provider.getBalance(result.address)
    const balanceFormatted = parseFloat(ethers.formatEther(balance)).toFixed(2)
    
    // Save session
    saveSession(result.address, connectionMethod)
    
    showToast('success', 'Wallet Connected!', `${result.address.substring(0, 6)}...${result.address.slice(-4)}`)
    
    return {
      address: `${result.address.substring(0, 6)}...${result.address.slice(-4)}`,
      fullAddress: result.address,
      balance: balanceFormatted,
      isConnected: true,
      connectionMethod,
    }
  } catch (error: any) {
    console.error('❌ Connection error:', error)
    
    // Get health status for debugging
    const health = getConnectionHealth()
    console.log('🏥 Connection health:', health)
    
    // Show user-friendly error
    let errorMessage = error.message || 'Unknown error'
    
    if (error.message?.includes('user rejected') || error.code === 4001) {
      errorMessage = 'Connection rejected by user'
    } else if (error.message?.includes('approve disabled')) {
      errorMessage = 'Approve button disabled. Try clearing Theta Wallet cache.'
      
      // Show suggestions
      if (health.suggestions.length > 0) {
        console.log('💡 Suggestions:')
        health.suggestions.forEach((s, i) => console.log(`   ${i + 1}. ${s}`))
      }
    }
    
    showToast('error', 'Connection Failed', errorMessage)
    
    throw new Error(errorMessage)
  }
}

/**
 * Disconnect wallet
 */
export async function disconnectThetaWallet(): Promise<void> {
  console.log('🔌 Disconnecting wallet...')
  
  try {
    if (connectionMethod === 'walletconnect') {
      await disconnectWalletConnect()
    }
    
    currentProvider = null
    connectionMethod = null
    clearSession()
    
    showToast('info', 'Wallet Disconnected')
  } catch (error) {
    console.error('Error disconnecting:', error)
  }
}

/**
 * Get current provider
 */
export function getProvider(): any {
  return currentProvider
}

/**
 * Check if connected
 */
export function isConnected(): boolean {
  return !!currentProvider
}

/**
 * Get connection method
 */
export function getConnectionMethod(): 'extension' | 'walletconnect' | null {
  return connectionMethod
}

/**
 * Refresh wallet balance
 */
export async function refreshBalance(address: string): Promise<string> {
  try {
    if (!currentProvider) {
      throw new Error('Wallet not connected')
    }
    
    const provider = new ethers.BrowserProvider(currentProvider)
    const balance = await provider.getBalance(address)
    return parseFloat(ethers.formatEther(balance)).toFixed(2)
  } catch (error) {
    console.error('Failed to refresh balance:', error)
    throw error
  }
}

/**
 * Sign transaction
 */
export async function signTransaction(tx: ethers.TransactionRequest): Promise<string> {
  try {
    if (!currentProvider) {
      throw new Error('Wallet not connected')
    }
    
    const provider = new ethers.BrowserProvider(currentProvider)
    const signer = await provider.getSigner()
    
    const signedTx = await signer.signTransaction(tx)
    
    showToast('success', 'Transaction Signed')
    
    return signedTx
  } catch (error: any) {
    console.error('Failed to sign transaction:', error)
    
    if (error.code === 4001) {
      showToast('info', 'Transaction Rejected')
      throw new Error('User rejected transaction')
    }
    
    showToast('error', 'Signing Failed', error.message)
    throw error
  }
}

/**
 * Send transaction
 */
export async function sendTransaction(tx: ethers.TransactionRequest): Promise<string> {
  try {
    if (!currentProvider) {
      throw new Error('Wallet not connected')
    }
    
    const provider = new ethers.BrowserProvider(currentProvider)
    const signer = await provider.getSigner()
    
    const txResponse = await signer.sendTransaction(tx)
    
    showToast('success', 'Transaction Sent', `Hash: ${txResponse.hash.substring(0, 10)}...`)
    
    return txResponse.hash
  } catch (error: any) {
    console.error('Failed to send transaction:', error)
    
    if (error.code === 4001) {
      showToast('info', 'Transaction Rejected')
      throw new Error('User rejected transaction')
    }
    
    showToast('error', 'Transaction Failed', error.message)
    throw error
  }
}

/**
 * Clear all session data (emergency reset)
 */
export async function emergencyReset(): Promise<void> {
  console.log('🚨 Emergency reset initiated...')
  
  try {
    // Clear local session
    clearSession()
    
    // Clear WalletConnect session
    await clearWalletConnectSession()
    
    // Reset state
    currentProvider = null
    connectionMethod = null
    
    showToast('success', 'Session Reset', 'All wallet data cleared. Try connecting again.')
    
    console.log('✅ Emergency reset complete')
  } catch (error) {
    console.error('Emergency reset error:', error)
    showToast('error', 'Reset Failed', 'Please refresh the page')
  }
}

/**
 * Get diagnostic info for debugging
 */
export function getDiagnostics() {
  const platform = getPlatformInfo()
  const health = getConnectionHealth()
  const session = loadSession()
  
  return {
    platform,
    health,
    session,
    currentProvider: !!currentProvider,
    connectionMethod,
    timestamp: new Date().toISOString(),
  }
}

