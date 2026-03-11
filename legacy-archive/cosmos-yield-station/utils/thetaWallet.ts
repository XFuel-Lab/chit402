/**
 * Direct Theta Wallet integration - bypass WalletConnect bugs
 * 
 * Features:
 * - Mobile: deep link to theta://wc or QR fallback
 * - Desktop: open https://wallet.thetatoken.org/connect
 * - Polling for connection status
 * - Transaction signing via native Theta Wallet flow
 */

import { ethers } from 'ethers'
import { THETA_MAINNET } from '../config/thetaConfig'

// Deep link scheme for Theta Wallet mobile app
const THETA_DEEP_LINK = 'theta://wc'
const THETA_WEB_WALLET = 'https://wallet.thetatoken.org/connect'

// Connection polling configuration
const POLLING_INTERVAL = 1000 // 1 second
const MAX_POLLING_ATTEMPTS = 120 // 2 minutes max

// Store connection state
let connectionPollingInterval: NodeJS.Timeout | null = null
let connectionWindow: Window | null = null

/**
 * Detect if user is on mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
  
  // Check for mobile patterns
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
  return mobileRegex.test(userAgent)
}

/**
 * Detect if Theta Wallet extension is installed (desktop)
 */
export function isThetaWalletInstalled(): boolean {
  if (typeof window === 'undefined') return false
  
  // Check for Theta Wallet provider
  const ethereum = (window as any).ethereum
  if (!ethereum) return false
  
  // Theta Wallet identifies as isTheta or has theta property
  return !!(ethereum.isTheta || ethereum.theta || ethereum.isThetaWallet)
}

/**
 * Generate connection request URL with app metadata
 */
function generateConnectionUrl(callbackUrl?: string): string {
  const params = new URLSearchParams({
    dappName: 'XFUEL Protocol',
    dappUrl: window.location.origin,
    chainId: THETA_MAINNET.chainId.toString(),
    callback: callbackUrl || window.location.href,
  })
  
  return `${THETA_WEB_WALLET}?${params.toString()}`
}

/**
 * Connect to Theta Wallet on mobile via deep link
 * Falls back to WalletConnect QR if deep link fails
 */
export async function connectThetaWalletMobile(): Promise<{
  success: boolean
  provider?: any
  error?: string
}> {
  try {
    // Try deep link first
    const deepLinkUrl = `${THETA_DEEP_LINK}?${new URLSearchParams({
      dapp: 'xfuel',
      action: 'connect',
      chainId: THETA_MAINNET.chainId.toString(),
    }).toString()}`
    
    // Attempt to open deep link
    window.location.href = deepLinkUrl
    
    // Wait a moment to see if app opens
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    // Check if Theta provider is available (user came back from app)
    const ethereum = (window as any).ethereum
    if (ethereum && (ethereum.isTheta || ethereum.theta)) {
      return {
        success: true,
        provider: ethereum,
      }
    }
    
    // Deep link failed, return to trigger QR fallback
    return {
      success: false,
      error: 'deep_link_failed',
    }
  } catch (error: any) {
    console.error('Theta Wallet mobile connection error:', error)
    return {
      success: false,
      error: error.message || 'Unknown error',
    }
  }
}

/**
 * Connect to Theta Wallet on desktop
 * Opens wallet.thetatoken.org in new window and polls for connection
 */
export async function connectThetaWalletDesktop(): Promise<{
  success: boolean
  provider?: any
  address?: string
  error?: string
}> {
  try {
    // First check if extension is installed
    const ethereum = (window as any).ethereum
    if (ethereum && (ethereum.isTheta || ethereum.theta)) {
      // Extension detected, use direct connection
      try {
        const accounts = await ethereum.request({
          method: 'eth_requestAccounts',
        })
        
        if (accounts && accounts.length > 0) {
          return {
            success: true,
            provider: ethereum,
            address: accounts[0],
          }
        }
      } catch (error: any) {
        if (error.code === 4001) {
          return {
            success: false,
            error: 'User rejected connection',
          }
        }
        throw error
      }
    }
    
    // No extension, open web wallet in new window
    const walletUrl = generateConnectionUrl()
    connectionWindow = window.open(
      walletUrl,
      'ThetaWallet',
      'width=420,height=700,left=100,top=100'
    )
    
    if (!connectionWindow) {
      return {
        success: false,
        error: 'Failed to open wallet window. Please allow pop-ups.',
      }
    }
    
    // Start polling for connection
    return await pollForConnection()
  } catch (error: any) {
    console.error('Theta Wallet desktop connection error:', error)
    return {
      success: false,
      error: error.message || 'Unknown error',
    }
  }
}

/**
 * Poll for connection status after opening web wallet
 */
async function pollForConnection(): Promise<{
  success: boolean
  provider?: any
  address?: string
  error?: string
}> {
  return new Promise((resolve) => {
    let attempts = 0
    
    connectionPollingInterval = setInterval(async () => {
      attempts++
      
      // Check if window was closed
      if (connectionWindow && connectionWindow.closed) {
        stopPolling()
        resolve({
          success: false,
          error: 'Wallet window closed',
        })
        return
      }
      
      // Check if Theta provider is now available
      const ethereum = (window as any).ethereum
      if (ethereum && (ethereum.isTheta || ethereum.theta)) {
        try {
          // Request accounts
          const accounts = await ethereum.request({
            method: 'eth_accounts', // Use eth_accounts to check without prompting
          })
          
          if (accounts && accounts.length > 0) {
            stopPolling()
            if (connectionWindow) {
              connectionWindow.close()
            }
            
            resolve({
              success: true,
              provider: ethereum,
              address: accounts[0],
            })
            return
          }
        } catch (error) {
          console.error('Error checking Theta accounts:', error)
        }
      }
      
      // Max attempts reached
      if (attempts >= MAX_POLLING_ATTEMPTS) {
        stopPolling()
        if (connectionWindow) {
          connectionWindow.close()
        }
        
        resolve({
          success: false,
          error: 'Connection timeout',
        })
      }
    }, POLLING_INTERVAL)
  })
}

/**
 * Stop connection polling
 */
function stopPolling() {
  if (connectionPollingInterval) {
    clearInterval(connectionPollingInterval)
    connectionPollingInterval = null
  }
}

/**
 * Main entry point: Connect Theta Wallet (detects mobile/desktop)
 */
export async function connectThetaWallet(): Promise<{
  success: boolean
  provider?: any
  address?: string
  error?: string
}> {
  const isMobile = isMobileDevice()
  
  if (isMobile) {
    return await connectThetaWalletMobile()
  } else {
    return await connectThetaWalletDesktop()
  }
}

/**
 * Sign transaction with Theta Wallet
 */
export async function signTransactionWithThetaWallet(
  transaction: ethers.TransactionRequest
): Promise<{ success: boolean; signedTx?: string; error?: string }> {
  try {
    const ethereum = (window as any).ethereum
    if (!ethereum || (!ethereum.isTheta && !ethereum.theta)) {
      return {
        success: false,
        error: 'Theta Wallet not connected',
      }
    }
    
    const provider = new ethers.BrowserProvider(ethereum)
    const signer = await provider.getSigner()
    
    // Sign transaction
    const signedTx = await signer.signTransaction(transaction)
    
    return {
      success: true,
      signedTx,
    }
  } catch (error: any) {
    console.error('Error signing transaction:', error)
    return {
      success: false,
      error: error.message || 'Failed to sign transaction',
    }
  }
}

/**
 * Send transaction with Theta Wallet
 */
export async function sendTransactionWithThetaWallet(
  transaction: ethers.TransactionRequest
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const ethereum = (window as any).ethereum
    if (!ethereum || (!ethereum.isTheta && !ethereum.theta)) {
      return {
        success: false,
        error: 'Theta Wallet not connected',
      }
    }
    
    const provider = new ethers.BrowserProvider(ethereum)
    const signer = await provider.getSigner()
    
    // Send transaction
    const tx = await signer.sendTransaction(transaction)
    
    return {
      success: true,
      txHash: tx.hash,
    }
  } catch (error: any) {
    console.error('Error sending transaction:', error)
    
    // Handle user rejection
    if (error.code === 4001 || error.message?.includes('User rejected')) {
      return {
        success: false,
        error: 'User rejected transaction',
      }
    }
    
    return {
      success: false,
      error: error.message || 'Failed to send transaction',
    }
  }
}

/**
 * Disconnect Theta Wallet and cleanup
 */
export function disconnectThetaWallet(): void {
  stopPolling()
  
  if (connectionWindow && !connectionWindow.closed) {
    connectionWindow.close()
    connectionWindow = null
  }
}

/**
 * Check if currently connected to Theta Wallet
 */
export async function isConnectedToThetaWallet(): Promise<boolean> {
  try {
    const ethereum = (window as any).ethereum
    if (!ethereum || (!ethereum.isTheta && !ethereum.theta)) {
      return false
    }
    
    const accounts = await ethereum.request({ method: 'eth_accounts' })
    return accounts && accounts.length > 0
  } catch (error) {
    console.error('Error checking Theta Wallet connection:', error)
    return false
  }
}

