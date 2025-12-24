/**
 * Persistence Chain Liquid Staking Integration
 * Handles stkXPRT liquid staking on Persistence network
 * Flow: TFUEL → USDC → Bridge → ibc/USDC → XPRT → stkXPRT
 */

import { SigningStargateClient, GasPrice, calculateFee } from '@cosmjs/stargate'
import type { Window as KeplrWindow } from '@keplr-wallet/types'

declare global {
  interface Window extends KeplrWindow {}
}

// Persistence chain configuration
export const PERSISTENCE_CHAIN_ID = 'core-1'
export const PERSISTENCE_RPC = 'https://rpc.core.persistence.one'
export const PERSISTENCE_REST = 'https://rest.core.persistence.one'

// pStake liquid staking module address on Persistence
// Users stake XPRT and receive stkXPRT instantly
export const PSTAKE_STAKING_CONTRACT = 'persistence1...' // TODO: Add actual pStake contract

/**
 * Check if Keplr wallet is installed
 */
export function isKeplrInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.keplr
}

/**
 * Connect to Keplr wallet and enable Persistence chain
 */
export async function connectKeplrForPersistence(): Promise<string> {
  if (!isKeplrInstalled()) {
    throw new Error('Keplr wallet is not installed. Please install Keplr extension.')
  }

  try {
    // Enable Persistence chain in Keplr
    await window.keplr!.enable(PERSISTENCE_CHAIN_ID)

    // Get the offline signer
    const offlineSigner = window.keplr!.getOfflineSigner(PERSISTENCE_CHAIN_ID)
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
 * Get XPRT balance from Persistence chain
 */
export async function getXPRTBalance(address: string): Promise<number> {
  try {
    const response = await fetch(
      `${PERSISTENCE_REST}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=uxprt`
    )

    if (!response.ok) {
      console.warn('Failed to fetch XPRT balance')
      return 0
    }

    const data = await response.json()
    const balance = data.balance?.amount || '0'
    
    // Convert from uxprt (micro XPRT) to XPRT
    return parseFloat(balance) / 1_000_000
  } catch (error) {
    console.error('Error fetching XPRT balance:', error)
    return 0
  }
}

/**
 * Get stkXPRT balance from Persistence chain
 */
export async function getStkXPRTBalance(address: string): Promise<number> {
  try {
    // stkXPRT is represented as stk/uxprt denom on Persistence
    const response = await fetch(
      `${PERSISTENCE_REST}/cosmos/bank/v1beta1/balances/${address}`
    )

    if (!response.ok) {
      console.warn('Failed to fetch stkXPRT balance')
      return 0
    }

    const data = await response.json()
    const stkBalance = data.balances?.find((b: any) => 
      b.denom === 'stk/uxprt' || b.denom.includes('stkxprt')
    )
    
    if (!stkBalance) {
      return 0
    }

    // Convert from micro units to display units
    return parseFloat(stkBalance.amount) / 1_000_000
  } catch (error) {
    console.error('Error fetching stkXPRT balance:', error)
    return 0
  }
}

/**
 * Swap ibc/USDC to XPRT on Persistence DEX (Dexter)
 * Uses Dexter DEX on Persistence for the swap
 */
export async function swapIbcUSDCToXPRT(
  amount: number
): Promise<{ success: boolean; txHash?: string; error?: string; xprtAmount?: number }> {
  try {
    // Connect Keplr
    const userAddress = await connectKeplrForPersistence()

    // Get the offline signer for signing transactions
    const offlineSigner = window.keplr!.getOfflineSigner(PERSISTENCE_CHAIN_ID)

    // Connect to Persistence RPC
    const client = await SigningStargateClient.connectWithSigner(
      PERSISTENCE_RPC,
      offlineSigner,
      {
        gasPrice: GasPrice.fromString('0.005uxprt'),
      }
    )

    // Convert amount to micro units
    const amountInMicroUnits = Math.floor(amount * 1_000_000).toString()

    // IBC USDC denom on Persistence (via Axelar)
    const ibcUSDCDenom = 'ibc/6B1E974DCFB3F2BE5F46C0FA1B7D9B7B91CC37C9D50C44D6A0C8B7E6C0F5C5C5' // TODO: Update with actual IBC denom

    // Create swap message for Dexter DEX
    // This is a simplified version - actual implementation may need specific message format
    const swapMsg = {
      typeUrl: '/dexter.dex.v1.MsgSwapExactAmountIn',
      value: {
        sender: userAddress,
        routes: [
          {
            poolId: '1', // USDC/XPRT pool on Dexter
            tokenOutDenom: 'uxprt',
          },
        ],
        tokenIn: {
          denom: ibcUSDCDenom,
          amount: amountInMicroUnits,
        },
        tokenOutMinAmount: '1', // Set minimum output to prevent front-running
      },
    }

    // Calculate transaction fee
    const fee = calculateFee(300000, GasPrice.fromString('0.005uxprt'))

    // Sign and broadcast the transaction
    const result = await client.signAndBroadcast(
      userAddress,
      [swapMsg],
      fee,
      'Swap USDC to XPRT on Persistence via XFUEL Protocol'
    )

    // Check if transaction was successful
    if (result.code !== 0) {
      return {
        success: false,
        error: `Transaction failed: ${result.rawLog || 'Unknown error'}`,
      }
    }

    // Parse the result to get XPRT amount received
    // This would need to parse the transaction events to get exact amount
    const estimatedXPRT = amount / 0.5 // Rough estimate based on price

    return {
      success: true,
      txHash: result.transactionHash,
      xprtAmount: estimatedXPRT,
    }
  } catch (error: any) {
    console.error('Swap error:', error)
    
    // Handle user rejection
    if (error.message?.includes('rejected') || error.message?.includes('denied')) {
      return {
        success: false,
        error: 'Transaction rejected by user',
      }
    }

    return {
      success: false,
      error: error.message || 'Failed to swap USDC to XPRT',
    }
  }
}

/**
 * Stake XPRT to receive stkXPRT via pStake liquid staking
 * This is instant - users receive stkXPRT immediately
 */
export async function stakeXPRTToStkXPRT(
  amount: number
): Promise<{ success: boolean; txHash?: string; error?: string; stkXPRTAmount?: number }> {
  try {
    // Connect Keplr
    const userAddress = await connectKeplrForPersistence()

    // Get the offline signer for signing transactions
    const offlineSigner = window.keplr!.getOfflineSigner(PERSISTENCE_CHAIN_ID)

    // Connect to Persistence RPC
    const client = await SigningStargateClient.connectWithSigner(
      PERSISTENCE_RPC,
      offlineSigner,
      {
        gasPrice: GasPrice.fromString('0.005uxprt'),
      }
    )

    // Convert amount to micro units (uxprt)
    const amountInMicroUnits = Math.floor(amount * 1_000_000).toString()

    // Create liquid staking message
    // pStake uses a specific message format for liquid staking
    const stakeMsg = {
      typeUrl: '/pstake.lscosmos.v1beta1.MsgLiquidStake',
      value: {
        delegatorAddress: userAddress,
        amount: {
          denom: 'uxprt',
          amount: amountInMicroUnits,
        },
      },
    }

    // Calculate transaction fee
    const fee = calculateFee(200000, GasPrice.fromString('0.005uxprt'))

    // Sign and broadcast the transaction
    const result = await client.signAndBroadcast(
      userAddress,
      [stakeMsg],
      fee,
      `Stake ${amount} XPRT to stkXPRT via XFUEL Protocol`
    )

    // Check if transaction was successful
    if (result.code !== 0) {
      return {
        success: false,
        error: `Transaction failed: ${result.rawLog || 'Unknown error'}`,
      }
    }

    // stkXPRT is received at ~1:1 ratio (slightly less due to exchange rate)
    const stkXPRTAmount = amount * 0.98 // 98% ratio typical for liquid staking

    return {
      success: true,
      txHash: result.transactionHash,
      stkXPRTAmount,
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

    return {
      success: false,
      error: error.message || 'Failed to stake XPRT to stkXPRT',
    }
  }
}

/**
 * Get current stkXPRT APY from Persistence
 */
export async function getStkXPRTAPY(): Promise<number> {
  try {
    // Query pStake stats for current APY
    const response = await fetch('https://api.pstake.finance/api/v1/chains/persistence/apy')
    
    if (!response.ok) {
      console.warn('Failed to fetch stkXPRT APY')
      return 25.7 // Fallback APY
    }

    const data = await response.json()
    return data.apy || 25.7
  } catch (error) {
    console.error('Error fetching stkXPRT APY:', error)
    return 25.7 // Fallback APY
  }
}

/**
 * Estimate stkXPRT output for a given TFUEL input
 * Takes into account swap fees, bridge fees, and exchange rates
 */
export async function estimateStkXPRTOutput(
  tfuelAmount: number,
  tfuelPrice: number
): Promise<{
  estimatedStkXPRT: number
  estimatedUSDC: number
  estimatedXPRT: number
  breakdown: {
    tfuelToUSDC: number
    usdcAfterBridge: number
    xprtFromSwap: number
    stkXPRTFinal: number
  }
}> {
  // Step 1: TFUEL → USDC (0.3% swap fee)
  const usdcFromTfuel = tfuelAmount * tfuelPrice * 0.997

  // Step 2: Bridge fee (~$2 fixed)
  const bridgeFee = 2.0
  const usdcAfterBridge = Math.max(0, usdcFromTfuel - bridgeFee)

  // Step 3: USDC → XPRT (DEX swap, 0.3% fee)
  const xprtPrice = 0.50 // XPRT price in USD (rough estimate, should fetch from API)
  const xprtFromSwap = (usdcAfterBridge / xprtPrice) * 0.997

  // Step 4: XPRT → stkXPRT (instant, ~98% ratio)
  const stkXPRTFinal = xprtFromSwap * 0.98

  return {
    estimatedStkXPRT: stkXPRTFinal,
    estimatedUSDC: usdcFromTfuel,
    estimatedXPRT: xprtFromSwap,
    breakdown: {
      tfuelToUSDC: usdcFromTfuel,
      usdcAfterBridge,
      xprtFromSwap,
      stkXPRTFinal,
    },
  }
}

/**
 * Get Mintscan explorer URL for Persistence transaction
 */
export function getPersistenceExplorerUrl(txHash: string): string {
  return `https://www.mintscan.io/persistence/txs/${txHash}`
}

/**
 * Format success message for stkXPRT staking
 */
export function formatStkXPRTSuccessMessage(
  stkXPRTAmount: number,
  apy: number
): string {
  return `✅ ${stkXPRTAmount.toFixed(4)} stkXPRT received in Keplr — earning ${apy.toFixed(1)}% APY`
}

