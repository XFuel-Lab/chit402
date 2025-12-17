import { ethers } from '@thetalabs/theta-js'
import { ThetaWalletConnect } from '@thetalabs/theta-wallet-connect'
import { getAppExtra } from './appConfig'

export type WalletInfo = {
  isConnected: boolean
  addressShort: string | null
  addressFull: string | null
  balanceTfuel: number
}

const THETA_TESTNET_RPC = 'https://eth-rpc-api-testnet.thetatoken.org/rpc'
const THETA_TESTNET_CHAIN_ID = 365
const THETA_TESTNET_EXPLORER = 'https://testnet-explorer.thetatoken.org'

let walletConnect: ThetaWalletConnect | null = null
let provider: ethers.providers.JsonRpcProvider | null = null

export function createDisconnectedWallet(): WalletInfo {
  return {
    isConnected: false,
    addressShort: null,
    addressFull: null,
    balanceTfuel: 0,
  }
}

export async function connectThetaWallet(): Promise<WalletInfo> {
  try {
    // Initialize WalletConnect if not already done
    if (!walletConnect) {
      walletConnect = new ThetaWalletConnect({
        chainId: THETA_TESTNET_CHAIN_ID,
        rpcUrl: THETA_TESTNET_RPC,
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
    provider = new ethers.providers.JsonRpcProvider(THETA_TESTNET_RPC)
    const balance = await provider.getBalance(address)
    const balanceTfuel = parseFloat(ethers.utils.formatEther(balance))

    return {
      isConnected: true,
      addressFull: address,
      addressShort,
      balanceTfuel,
    }
  } catch (error: any) {
    console.error('Wallet connection error:', error)
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
  return THETA_TESTNET_EXPLORER
}

export function disconnectWallet() {
  if (walletConnect) {
    walletConnect.disconnect()
    walletConnect = null
  }
  provider = null
}

