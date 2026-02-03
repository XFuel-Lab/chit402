/**
 * IBC Transfer Module
 * 
 * Handles IBC transfers from Theta to Persistence via channel-190
 */

import { SigningStargateClient, StargateClient } from '@cosmjs/stargate'
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { IBC_CONFIG, IBC_TRANSFER_PORT } from './config.js'
import { IbcTransferResult } from './types.js'

// Cosmos wallet for IBC operations
let ibcWallet: DirectSecp256k1HdWallet | null = null
let ibcClient: SigningStargateClient | null = null

/**
 * Initialize IBC client with mnemonic
 */
export async function initializeIbcClient(mnemonic: string): Promise<void> {
  console.log('🔐 [IBC] Initializing IBC client...')

  // Create wallet from mnemonic
  ibcWallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'persistence',
  })

  const accounts = await ibcWallet.getAccounts()
  console.log(`✅ [IBC] IBC wallet address: ${accounts[0].address}`)

  // Create signing client
  ibcClient = await SigningStargateClient.connectWithSigner(
    IBC_CONFIG.persistence.rpcUrl,
    ibcWallet,
    {
      gasPrice: IBC_CONFIG.ibc.gasPrice,
    }
  )

  console.log('✅ [IBC] IBC client initialized')
}

/**
 * Transfer TFUEL from Theta to Persistence via IBC channel-190
 * 
 * Note: This is a conceptual implementation. In reality, Theta doesn't have native IBC support.
 * This would require:
 * 1. A bridge contract on Theta that locks TFUEL
 * 2. A relayer that monitors the lock and mints wrapped TFUEL on Persistence
 * 3. IBC transfer of the wrapped TFUEL on Persistence
 * 
 * For production, you'd use Axelar GMP or a custom bridge implementation.
 */
export async function transferViaIbc(
  amount: string,
  recipientAddress: string,
  memo?: string
): Promise<IbcTransferResult> {
  if (!ibcClient || !ibcWallet) {
    return {
      success: false,
      error: 'IBC client not initialized',
    }
  }

  try {
    console.log(`🚀 [IBC] Initiating IBC transfer...`)
    console.log(`   Amount: ${amount} (wei)`)
    console.log(`   Recipient: ${recipientAddress}`)
    console.log(`   Channel: ${IBC_CONFIG.persistence.ibcChannel}`)

    const accounts = await ibcWallet.getAccounts()
    const senderAddress = accounts[0].address

    // Convert amount from wei to proper denomination
    // Note: This assumes a bridge has already converted TFUEL to wrapped TFUEL on Persistence
    const amountInDenom = {
      denom: IBC_CONFIG.ibc.tfuelIbcDenom,
      amount: amount,
    }

    // Calculate timeout timestamp (current time + timeout period)
    const timeoutTimestamp = BigInt(Date.now()) * BigInt(1_000_000) + IBC_CONFIG.ibc.timeoutTimestamp

    // Execute IBC transfer
    const result = await ibcClient.sendIbcTokens(
      senderAddress,
      recipientAddress,
      amountInDenom,
      IBC_TRANSFER_PORT,
      IBC_CONFIG.persistence.ibcChannel,
      IBC_CONFIG.ibc.timeoutHeight,
      timeoutTimestamp,
      IBC_CONFIG.ibc.gasLimit,
      memo
    )

    if (result.code !== 0) {
      console.error(`❌ [IBC] Transfer failed: ${result.rawLog}`)
      return {
        success: false,
        error: result.rawLog || 'IBC transfer failed',
      }
    }

    console.log(`✅ [IBC] Transfer successful!`)
    console.log(`   Tx Hash: ${result.transactionHash}`)
    console.log(`   Height: ${result.height}`)

    return {
      success: true,
      txHash: result.transactionHash,
    }
  } catch (error) {
    console.error('❌ [IBC] Transfer error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check if an IBC transfer has been received on the destination chain
 */
export async function checkIbcTransferStatus(txHash: string): Promise<{
  received: boolean
  error?: string
}> {
  try {
    if (!ibcClient) {
      return { received: false, error: 'IBC client not initialized' }
    }

    // Query transaction on Persistence
    const tx = await ibcClient.getTx(txHash)

    if (!tx) {
      return { received: false, error: 'Transaction not found' }
    }

    // Check for IBC acknowledgement
    // Look for "recv_packet" event in logs
    const recvPacketEvent = tx.events.find((e) => e.type === 'recv_packet')

    if (recvPacketEvent) {
      console.log('✅ [IBC] Transfer received on destination chain')
      return { received: true }
    }

    return { received: false, error: 'Transfer not yet received' }
  } catch (error) {
    console.error('❌ [IBC] Error checking transfer status:', error)
    return {
      received: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Query IBC balance on Persistence
 */
export async function getIbcBalance(address: string): Promise<string> {
  try {
    if (!ibcClient) {
      throw new Error('IBC client not initialized')
    }

    const balance = await ibcClient.getBalance(address, IBC_CONFIG.ibc.tfuelIbcDenom)
    return balance.amount
  } catch (error) {
    console.error('❌ [IBC] Error querying balance:', error)
    return '0'
  }
}

/**
 * Alternative: Use Axelar GMP for cross-chain transfer
 * This is more practical for Theta → Cosmos transfers
 */
export async function transferViaAxelar(
  amount: string,
  recipientAddress: string,
  memo?: string
): Promise<IbcTransferResult> {
  console.log('🌉 [Axelar] Initiating Axelar GMP transfer...')
  console.log('   This requires Axelar integration - see axelarBridge.ts for implementation')

  // TODO: Implement Axelar GMP integration
  // See src/utils/axelarBridge.ts for reference

  return {
    success: false,
    error: 'Axelar integration not yet implemented',
  }
}

