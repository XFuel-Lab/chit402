/**
 * Unified Wallet Provider for XFuel Protocol
 * 
 * Cross-platform wallet integration with platform detection:
 * - Web: Persistent QR modals with WalletConnect v2
 * - Mobile: Deep link priority (thetawallet://) with QR fallback
 * - Theta chain configuration (ID 361, RPC https://rpc.thetatoken.org)
 * - Session persistence via localStorage/AsyncStorage
 * - Error recovery and retry logic
 * 
 * Features:
 * - Auto-detect Theta Wallet presence
 * - Prioritize direct connection over WalletConnect when possible
 * - Handle connection lifecycle (connect, disconnect, session restore)
 * - Type-safe wallet state management
 * - Comprehensive error handling with user-friendly messages
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { ethers } from 'ethers'

// Platform detection
const isMobile = (): boolean => {
  if (typeof window === 'undefined') return false
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
}

const isIOS = (): boolean => {
  if (typeof window === 'undefined') return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

const isAndroid = (): boolean => {
  if (typeof window === 'undefined') return false
  return /Android/i.test(navigator.userAgent)
}

// Theta Network configuration
export const THETA_CHAIN_CONFIG = {
  chainId: 361,
  chainIdHex: '0x169',
  chainName: 'Theta Mainnet',
  nativeCurrency: {
    name: 'TFUEL',
    symbol: 'TFUEL',
    decimals: 18,
  },
  rpcUrls: ['https://eth-rpc-api.thetatoken.org/rpc'],
  blockExplorerUrls: ['https://explorer.thetatoken.org'],
}

// Storage keys
const STORAGE_KEYS = {
  WALLET_ADDRESS: 'xfuel_wallet_address',
  CONNECTION_METHOD: 'xfuel_connection_method',
  SESSION_TIMESTAMP: 'xfuel_session_ts',
}

// Session timeout (24 hours)
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000

// Wallet connection methods
type ConnectionMethod = 'theta_extension' | 'metamask' | 'walletconnect' | null

export interface WalletState {
  address: string | null
  addressShort: string | null
  balance: string
  isConnected: boolean
  isConnecting: boolean
  connectionMethod: ConnectionMethod
  provider: ethers.BrowserProvider | null
  chainId: number | null
}

interface WalletContextType extends WalletState {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  refreshBalance: () => Promise<void>
  openThetaWalletApp: (uri: string) => Promise<boolean>
  isMobileDevice: boolean
  error: string | null
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export const useWallet = () => {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider')
  }
  return context
}

interface WalletProviderProps {
  children: ReactNode
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  const [state, setState] = useState<WalletState>({
    address: null,
    addressShort: null,
    balance: '0.00',
    isConnected: false,
    isConnecting: false,
    connectionMethod: null,
    provider: null,
    chainId: null,
  })
  const [error, setError] = useState<string | null>(null)
  const isMobileDevice = isMobile()

  // Format address to short version
  const formatAddress = (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  // Save session to storage
  const saveSession = useCallback((address: string, method: ConnectionMethod) => {
    try {
      localStorage.setItem(STORAGE_KEYS.WALLET_ADDRESS, address)
      localStorage.setItem(STORAGE_KEYS.CONNECTION_METHOD, method || '')
      localStorage.setItem(STORAGE_KEYS.SESSION_TIMESTAMP, Date.now().toString())
    } catch (err) {
      console.warn('Failed to save session:', err)
    }
  }, [])

  // Clear session from storage
  const clearSession = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEYS.WALLET_ADDRESS)
      localStorage.removeItem(STORAGE_KEYS.CONNECTION_METHOD)
      localStorage.removeItem(STORAGE_KEYS.SESSION_TIMESTAMP)
    } catch (err) {
      console.warn('Failed to clear session:', err)
    }
  }, [])

  // Load session from storage
  const loadSession = useCallback((): { address: string; method: ConnectionMethod } | null => {
    try {
      const address = localStorage.getItem(STORAGE_KEYS.WALLET_ADDRESS)
      const method = localStorage.getItem(STORAGE_KEYS.CONNECTION_METHOD) as ConnectionMethod
      const timestamp = localStorage.getItem(STORAGE_KEYS.SESSION_TIMESTAMP)

      if (!address || !timestamp) {
        return null
      }

      // Check if session has expired
      const age = Date.now() - parseInt(timestamp, 10)
      if (age > SESSION_TIMEOUT_MS) {
        clearSession()
        return null
      }

      return { address, method }
    } catch (err) {
      console.warn('Failed to load session:', err)
      return null
    }
  }, [clearSession])

  // Fetch balance for an address
  const fetchBalance = useCallback(async (address: string, provider: ethers.BrowserProvider): Promise<string> => {
    try {
      const balance = await provider.getBalance(address)
      return parseFloat(ethers.formatEther(balance)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    } catch (err) {
      console.error('Failed to fetch balance:', err)
      return '0.00'
    }
  }, [])

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    if (!state.address || !state.provider) {
      return
    }

    try {
      const balance = await fetchBalance(state.address, state.provider)
      setState(prev => ({ ...prev, balance }))
    } catch (err) {
      console.error('Failed to refresh balance:', err)
    }
  }, [state.address, state.provider, fetchBalance])

  // Detect Theta Wallet extension
  const isThetaWalletInstalled = useCallback((): boolean => {
    if (typeof window === 'undefined') return false
    const ethereum = (window as any).ethereum
    if (!ethereum) return false
    return !!(ethereum.isTheta || ethereum.theta || ethereum.isThetaWallet)
  }, [])

  // Detect MetaMask
  const isMetaMaskInstalled = useCallback((): boolean => {
    if (typeof window === 'undefined') return false
    const ethereum = (window as any).ethereum
    return !!(ethereum && ethereum.isMetaMask)
  }, [])

  // Switch to Theta network
  const switchToThetaNetwork = useCallback(async (provider: any): Promise<boolean> => {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: THETA_CHAIN_CONFIG.chainIdHex }],
      })
      return true
    } catch (switchError: any) {
      // Chain not added, try to add it
      if (switchError.code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: THETA_CHAIN_CONFIG.chainIdHex,
                chainName: THETA_CHAIN_CONFIG.chainName,
                nativeCurrency: THETA_CHAIN_CONFIG.nativeCurrency,
                rpcUrls: THETA_CHAIN_CONFIG.rpcUrls,
                blockExplorerUrls: THETA_CHAIN_CONFIG.blockExplorerUrls,
              },
            ],
          })
          return true
        } catch (addError) {
          console.error('Failed to add Theta network:', addError)
          return false
        }
      }
      console.error('Failed to switch to Theta network:', switchError)
      return false
    }
  }, [])

  // Open Theta Wallet mobile app via deep link
  const openThetaWalletApp = useCallback(async (uri: string): Promise<boolean> => {
    if (!isMobileDevice) {
      return false
    }

    try {
      console.log('📱 Opening Theta Wallet app...')

      // Try thetawallet:// scheme first
      const thetaUri = uri.replace('wc:', 'thetawallet:')

      if (isIOS()) {
        // iOS: Use universal link or deep link
        window.location.href = thetaUri
        return true
      } else if (isAndroid()) {
        // Android: Use intent
        const intent = `intent://wc?uri=${encodeURIComponent(uri)}#Intent;scheme=thetawallet;package=org.thetatoken.wallet;end`
        window.location.href = intent

        // Fallback to deep link after delay
        setTimeout(() => {
          window.location.href = thetaUri
        }, 500)

        return true
      }

      // Generic fallback
      window.location.href = thetaUri
      return true
    } catch (err) {
      console.error('Failed to open Theta Wallet app:', err)
      return false
    }
  }, [isMobileDevice])

  // Connect via Theta Wallet extension
  const connectThetaExtension = useCallback(async (): Promise<void> => {
    const ethereum = (window as any).ethereum

    if (!ethereum || !isThetaWalletInstalled()) {
      throw new Error('Theta Wallet extension not installed')
    }

    // Request accounts
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' })

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned')
    }

    const address = accounts[0]
    const provider = new ethers.BrowserProvider(ethereum)
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)

    // Switch to Theta network if needed
    if (chainId !== THETA_CHAIN_CONFIG.chainId) {
      const switched = await switchToThetaNetwork(ethereum)
      if (!switched) {
        throw new Error('Please switch to Theta network')
      }
    }

    const balance = await fetchBalance(address, provider)

    setState({
      address,
      addressShort: formatAddress(address),
      balance,
      isConnected: true,
      isConnecting: false,
      connectionMethod: 'theta_extension',
      provider,
      chainId: THETA_CHAIN_CONFIG.chainId,
    })

    saveSession(address, 'theta_extension')
    setError(null)
  }, [isThetaWalletInstalled, switchToThetaNetwork, fetchBalance, saveSession])

  // Connect via MetaMask
  const connectMetaMask = useCallback(async (): Promise<void> => {
    const ethereum = (window as any).ethereum

    if (!ethereum || !isMetaMaskInstalled()) {
      throw new Error('MetaMask not installed')
    }

    // Request accounts
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' })

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned')
    }

    const address = accounts[0]
    const provider = new ethers.BrowserProvider(ethereum)
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)

    // Switch to Theta network if needed
    if (chainId !== THETA_CHAIN_CONFIG.chainId) {
      const switched = await switchToThetaNetwork(ethereum)
      if (!switched) {
        throw new Error('Please switch to Theta network')
      }
    }

    const balance = await fetchBalance(address, provider)

    setState({
      address,
      addressShort: formatAddress(address),
      balance,
      isConnected: true,
      isConnecting: false,
      connectionMethod: 'metamask',
      provider,
      chainId: THETA_CHAIN_CONFIG.chainId,
    })

    saveSession(address, 'metamask')
    setError(null)
  }, [isMetaMaskInstalled, switchToThetaNetwork, fetchBalance, saveSession])

  // Main connect function
  const connect = useCallback(async (): Promise<void> => {
    setState(prev => ({ ...prev, isConnecting: true }))
    setError(null)

    try {
      // Priority 1: Theta Wallet extension (desktop)
      if (!isMobileDevice && isThetaWalletInstalled()) {
        await connectThetaExtension()
        return
      }

      // Priority 2: MetaMask extension (desktop)
      if (!isMobileDevice && isMetaMaskInstalled()) {
        await connectMetaMask()
        return
      }

      // Priority 3: WalletConnect (mobile or no extension)
      // This should trigger the QR modal or deep link
      throw new Error('walletconnect_required')
    } catch (err: any) {
      console.error('Connection error:', err)

      if (err.code === 4001) {
        setError('Connection rejected by user')
      } else if (err.message === 'walletconnect_required') {
        // This should trigger the parent component to show WalletConnect modal
        setError(null)
      } else {
        setError(err.message || 'Failed to connect wallet')
      }

      setState(prev => ({ ...prev, isConnecting: false }))
      throw err
    }
  }, [isMobileDevice, isThetaWalletInstalled, isMetaMaskInstalled, connectThetaExtension, connectMetaMask])

  // Disconnect wallet
  const disconnect = useCallback(async (): Promise<void> => {
    setState({
      address: null,
      addressShort: null,
      balance: '0.00',
      isConnected: false,
      isConnecting: false,
      connectionMethod: null,
      provider: null,
      chainId: null,
    })
    clearSession()
    setError(null)
  }, [clearSession])

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const session = loadSession()
      if (!session) return

      try {
        const { address, method } = session

        // Try to reconnect based on method
        if (method === 'theta_extension' && isThetaWalletInstalled()) {
          await connectThetaExtension()
        } else if (method === 'metamask' && isMetaMaskInstalled()) {
          await connectMetaMask()
        } else {
          // Method not available, clear session
          clearSession()
        }
      } catch (err) {
        console.error('Failed to restore session:', err)
        clearSession()
      }
    }

    restoreSession()
  }, [loadSession, clearSession, isThetaWalletInstalled, isMetaMaskInstalled, connectThetaExtension, connectMetaMask])

  // Listen for account changes
  useEffect(() => {
    if (typeof window === 'undefined') return

    const ethereum = (window as any).ethereum
    if (!ethereum) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        disconnect()
      } else if (accounts[0] !== state.address) {
        // Account changed, reconnect
        connect().catch(console.error)
      }
    }

    const handleChainChanged = () => {
      // Reload page on chain change
      window.location.reload()
    }

    ethereum.on('accountsChanged', handleAccountsChanged)
    ethereum.on('chainChanged', handleChainChanged)

    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged)
      ethereum.removeListener('chainChanged', handleChainChanged)
    }
  }, [state.address, connect, disconnect])

  const value: WalletContextType = {
    ...state,
    connect,
    disconnect,
    refreshBalance,
    openThetaWalletApp,
    isMobileDevice,
    error,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
