/**
 * Cosmos LST Staking Integration
 * Handles real staking after successful Theta swap execution
 * Uses @cosmjs/stargate for Cosmos chain interactions
 */

import { SigningStargateClient, GasPrice, calculateFee } from '@cosmjs/stargate'
import type { Window as KeplrWindow } from '@keplr-wallet/types'

declare global {
  interface Window extends KeplrWindow {}
}

// Stride chain configuration for LST staking
export const STRIDE_CHAIN_ID = 'stride-1'
export const STRIDE_RPC = 'https://stride-rpc.polkachu.com'

// LST token configurations on Stride
export interface LSTConfig {
  symbol: string
  denom: string
  decimals: number
  chainId: string
  validatorAddress: string
}

// Stride validators (use official Stride validator addresses)
const STRIDE_LST_CONFIGS: Record<string, LSTConfig> = {
  stkTIA: {
    symbol: 'stkTIA',
    denom: 'stutia',
    decimals: 6,
    chainId: STRIDE_CHAIN_ID,
    validatorAddress: 'stridevaloper1u20df3trc2c2zdhm8qvh2hdjx9ewh00sv6eyy8', // Stride validator
  },
  stkATOM: {
    symbol: 'stkATOM',
    denom: 'stuatom',
    decimals: 6,
    chainId: STRIDE_CHAIN_ID,
    validatorAddress: 'stridevaloper1u20df3trc2c2zdhm8qvh2hdjx9ewh00sv6eyy8', // Stride validator
  },
  stkXPRT: {
    symbol: 'stkXPRT',
    denom: 'stuxprt',
    decimals: 6,
    chainId: STRIDE_CHAIN_ID,
    validatorAddress: 'stridevaloper1u20df3trc2c2zdhm8qvh2hdjx9ewh00sv6eyy8', // Stride validator
  },
  stkOSMO: {
    symbol: 'stkOSMO',
    denom: 'stuosmo',
    decimals: 6,
    chainId: STRIDE_CHAIN_ID,
    validatorAddress: 'stridevaloper1u20df3trc2c2zdhm8qvh2hdjx9ewh00sv6eyy8', // Stride validator
  },
}

/**
 * Check if Keplr wallet is installed
 */
export function isKeplrInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.keplr
}

/**
 * Connect to Keplr wallet and enable Stride chain
 */
export async function connectKeplrForStride(): Promise<string> {
  if (!isKeplrInstalled()) {
    throw new Error('Keplr wallet is not installed. Please install Keplr extension.')
  }

  try {
    // Enable Stride chain in Keplr
    await window.keplr!.enable(STRIDE_CHAIN_ID)

    // Get the offline signer
    const offlineSigner = window.keplr!.getOfflineSigner(STRIDE_CHAIN_ID)
    const accounts = await offlineSigner.getAccounts()

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found in Keplr wallet')
    }

    return accounts[0].address
  } catch (error: any) {
    console.error('Keplr connection error:', error)
    throw new Error(`Failed to connect Keplr: ${error.message}`)
  }
}

/**
 * Get Keplr LST token balance
 */
export async function getKeplrLSTBalance(
  lstSymbol: string,
  address: string
): Promise<number> {
  const config = STRIDE_LST_CONFIGS[lstSymbol]
  if (!config) {
    return 0
  }

  try {
    const response = await fetch(
      `https://stride-api.polkachu.com/cosmos/bank/v1beta1/balances/${address}`
    )

    if (!response.ok) {
      console.warn('Failed to fetch Keplr balance')
      return 0
    }

    const data = await response.json()
    const balance = data.balances?.find((b: any) => b.denom === config.denom)
    
    if (!balance) {
      return 0
    }

    // Convert from smallest unit to display unit
    return parseFloat(balance.amount) / Math.pow(10, config.decimals)
  } catch (error) {
    console.error('Error fetching Keplr balance:', error)
    return 0
  }
}

/**
 * Execute LST staking on Stride via Keplr
 * This triggers the Keplr signing popup for the delegate transaction
 */
export async function stakeLSTOnStride(
  lstSymbol: string,
  amount: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  let userAddress: string | undefined

  try {
    // Validate LST configuration
    const config = STRIDE_LST_CONFIGS[lstSymbol]
    if (!config) {
      return {
        success: false,
        error: `LST token ${lstSymbol} is not supported for staking yet`,
      }
    }

    // Connect Keplr - CRITICAL: Null check
    try {
      userAddress = await connectKeplrForStride()
      
      if (!userAddress) {
        throw new Error('Failed to get Stride address from Keplr')
      }
    } catch (keplrError: any) {
      console.error('Keplr connection error:', keplrError)
      return {
        success: false,
        error: `❌ Keplr connection failed: ${keplrError.message || 'Please ensure Keplr is installed and unlocked'}`,
      }
    }

    // Get the offline signer for signing transactions
    const offlineSigner = window.keplr!.getOfflineSigner(STRIDE_CHAIN_ID)

    // Connect to Stride RPC
    const client = await SigningStargateClient.connectWithSigner(
      STRIDE_RPC,
      offlineSigner,
      {
        gasPrice: GasPrice.fromString('0.001ustrd'), // Stride gas price
      }
    )

    // Convert amount to smallest unit (micro units)
    const amountInMicroUnits = Math.floor(amount * Math.pow(10, config.decimals)).toString()

    // Create delegate message
    // Note: For liquid staking, we're using standard delegation
    // The LST tokens are received automatically after delegation
    const delegateMsg = {
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      value: {
        delegatorAddress: userAddress,
        validatorAddress: config.validatorAddress,
        amount: {
          denom: config.denom,
          amount: amountInMicroUnits,
        },
      },
    }

    // Calculate transaction fee
    const fee = calculateFee(200000, GasPrice.fromString('0.001ustrd'))

    // Sign and broadcast the transaction
    // This will trigger Keplr signing popup
    const result = await client.signAndBroadcast(
      userAddress,
      [delegateMsg],
      fee,
      `Stake ${amount} ${lstSymbol} via XFUEL Protocol`
    )

    // Check if transaction was successful
    if (result.code !== 0) {
      return {
        success: false,
        error: `Transaction failed: ${result.rawLog || 'Unknown error'}`,
      }
    }

    return {
      success: true,
      txHash: result.transactionHash,
    }
  } catch (error: any) {
    console.error('Staking error:', error)
    
    // Handle user rejection
    if (error.message?.includes('rejected') || error.message?.includes('denied')) {
      return {
        success: false,
        error: 'Transaction rejected by user',
      }
    }

    // Handle account not existing on chain - provide actionable guidance
    if (error.message?.includes('does not exist on chain') || 
        error.message?.includes('account not found') ||
        error.message?.includes('account does not exist')) {
      
      // Try to get address for error message (use cached userAddress if available)
      let shortAddr = 'your Stride address'
      if (userAddress) {
        shortAddr = `${userAddress.substring(0, 12)}...${userAddress.substring(userAddress.length - 6)}`
      } else {
        // Try one more time to get address for display
        try {
          const addr = await connectKeplrForStride()
          if (addr) {
            shortAddr = `${addr.substring(0, 12)}...${addr.substring(addr.length - 6)}`
          }
        } catch {
          // Use generic message if we can't get address
        }
      }
      
      return {
        success: false,
        error: `🚀 Stride Account Setup Required: Your Stride wallet (${shortAddr}) needs a one-time activation. Get 0.5 STRD (~$0.50) from Osmosis DEX to activate and cover ~50 future transactions. The guided setup modal will help you do this in <60 seconds.`,
      }
    }

    return {
      success: false,
      error: error.message || 'Failed to stake LST tokens',
    }
  }
}

/**
 * Auto-refresh Keplr balance after staking
 */
export async function refreshKeplrBalance(
  lstSymbol: string,
  address: string,
  onBalanceUpdate: (balance: number) => void
): Promise<void> {
  try {
    const balance = await getKeplrLSTBalance(lstSymbol, address)
    onBalanceUpdate(balance)
  } catch (error) {
    console.error('Failed to refresh Keplr balance:', error)
  }
}

/**
 * Format success message for LST staking
 */
export function formatStakingSuccessMessage(
  lstSymbol: string,
  amount: number,
  apy: number
): string {
  return `✅ ${amount.toFixed(4)} ${lstSymbol} received in Keplr — earning ${apy.toFixed(1)}% APY`
}

/**
 * Get Mintscan explorer URL for Stride transaction
 */
export function getStrideExplorerUrl(txHash: string): string {
  return `https://www.mintscan.io/stride/txs/${txHash}`
}

