/**
 * IBC Route Executor
 * 
 * Orchestrates the full flow: TFUEL → IBC Transfer → DEX Swap → Staking
 */

import { DepositTransaction, RouteExecutionResult, TransactionStatus } from './types.js'
import { updateTransaction, saveTransaction } from './database.js'
import { transferViaIbc, checkIbcTransferStatus } from './ibc-transfer.js'
import { swapTfuelToXprt } from './dexter-dex.js'
import { stakeXprtToStkXprt } from './pstake-staking.js'
import { IBC_CONFIG } from './config.js'

/**
 * Execute the complete IBC routing flow for a deposit
 */
export async function executeRoute(
  transaction: DepositTransaction
): Promise<RouteExecutionResult> {
  console.log(`\n🚀 [Router] Starting route execution for ${transaction.thetaTxHash}`)
  console.log(`   Amount: ${transaction.tfuelAmount} wei`)
  console.log(`   Recipient: ${transaction.recipientAddress}`)

  try {
    // Step 1: IBC Transfer (Theta → Persistence)
    const ibcResult = await executeIbcTransfer(transaction)
    if (!ibcResult.success) {
      return {
        success: false,
        transaction,
        error: `IBC transfer failed: ${ibcResult.error}`,
      }
    }

    // Step 2: Swap ibc/TFUEL → XPRT on Dexter
    const swapResult = await executeSwap(transaction)
    if (!swapResult.success) {
      return {
        success: false,
        transaction,
        error: `DEX swap failed: ${swapResult.error}`,
      }
    }

    // Step 3: Stake XPRT → stkXPRT on pStake
    const stakeResult = await executeStaking(transaction)
    if (!stakeResult.success) {
      return {
        success: false,
        transaction,
        error: `Staking failed: ${stakeResult.error}`,
      }
    }

    // Mark as complete
    transaction.status = 'complete'
    transaction.statusMessage = 'Route execution completed successfully'
    transaction.completedAt = Date.now()
    await updateTransaction(transaction)

    console.log(`✅ [Router] Route execution complete!`)
    console.log(`   Theta TX: ${transaction.thetaTxHash}`)
    console.log(`   IBC TX: ${transaction.ibcTxHash}`)
    console.log(`   Swap TX: ${transaction.swapTxHash}`)
    console.log(`   Stake TX: ${transaction.stakeTxHash}`)
    console.log(`   stkXPRT minted: ${transaction.stkXprtAmount}`)

    return {
      success: true,
      transaction,
    }
  } catch (error) {
    console.error(`❌ [Router] Route execution failed:`, error)

    transaction.status = 'failed'
    transaction.errorMessage = error instanceof Error ? error.message : 'Unknown error'
    transaction.statusMessage = 'Route execution failed'
    await updateTransaction(transaction)

    return {
      success: false,
      transaction,
      error: transaction.errorMessage,
    }
  }
}

/**
 * Step 1: Execute IBC transfer
 */
async function executeIbcTransfer(transaction: DepositTransaction): Promise<{
  success: boolean
  error?: string
}> {
  try {
    console.log(`\n📡 [Router] Step 1: IBC Transfer`)

    transaction.status = 'ibc_transfer'
    transaction.statusMessage = 'Initiating IBC transfer to Persistence...'
    await updateTransaction(transaction)

    // Execute IBC transfer
    const result = await transferViaIbc(
      transaction.tfuelAmount,
      transaction.recipientAddress,
      `XFUEL: ${transaction.thetaTxHash}`
    )

    if (!result.success) {
      throw new Error(result.error || 'IBC transfer failed')
    }

    transaction.ibcTxHash = result.txHash
    transaction.status = 'ibc_complete'
    transaction.statusMessage = 'IBC transfer completed'
    transaction.ibcCompletedAt = Date.now()
    await updateTransaction(transaction)

    // Wait for IBC transfer to be received
    console.log(`⏳ [Router] Waiting for IBC transfer confirmation...`)
    await waitForIbcConfirmation(result.txHash!)

    console.log(`✅ [Router] IBC transfer completed`)
    return { success: true }
  } catch (error) {
    console.error(`❌ [Router] IBC transfer failed:`, error)
    transaction.status = 'failed'
    transaction.errorMessage = error instanceof Error ? error.message : 'IBC transfer failed'
    await updateTransaction(transaction)
    return {
      success: false,
      error: transaction.errorMessage,
    }
  }
}

/**
 * Step 2: Execute DEX swap
 */
async function executeSwap(transaction: DepositTransaction): Promise<{
  success: boolean
  error?: string
}> {
  try {
    console.log(`\n💱 [Router] Step 2: DEX Swap`)

    transaction.status = 'swapping'
    transaction.statusMessage = 'Swapping ibc/TFUEL → XPRT on Dexter...'
    await updateTransaction(transaction)

    // Execute swap
    const result = await swapTfuelToXprt(transaction.tfuelAmount)

    if (!result.success) {
      throw new Error(result.error || 'DEX swap failed')
    }

    transaction.swapTxHash = result.txHash
    transaction.xprtAmount = result.amountOut
    transaction.status = 'swap_complete'
    transaction.statusMessage = 'DEX swap completed'
    transaction.swapCompletedAt = Date.now()
    await updateTransaction(transaction)

    console.log(`✅ [Router] DEX swap completed: ${result.amountOut} XPRT`)
    return { success: true }
  } catch (error) {
    console.error(`❌ [Router] DEX swap failed:`, error)
    transaction.status = 'failed'
    transaction.errorMessage = error instanceof Error ? error.message : 'DEX swap failed'
    await updateTransaction(transaction)
    return {
      success: false,
      error: transaction.errorMessage,
    }
  }
}

/**
 * Step 3: Execute staking
 */
async function executeStaking(transaction: DepositTransaction): Promise<{
  success: boolean
  error?: string
}> {
  try {
    console.log(`\n🔒 [Router] Step 3: Staking`)

    if (!transaction.xprtAmount) {
      throw new Error('No XPRT amount available for staking')
    }

    transaction.status = 'staking'
    transaction.statusMessage = 'Staking XPRT → stkXPRT...'
    await updateTransaction(transaction)

    // Execute staking
    const result = await stakeXprtToStkXprt(
      transaction.xprtAmount,
      transaction.recipientAddress
    )

    if (!result.success) {
      throw new Error(result.error || 'Staking failed')
    }

    transaction.stakeTxHash = result.txHash
    transaction.stkXprtAmount = result.stkXprtAmount
    transaction.stakeCompletedAt = Date.now()
    await updateTransaction(transaction)

    console.log(`✅ [Router] Staking completed: ${result.stkXprtAmount} stkXPRT`)
    return { success: true }
  } catch (error) {
    console.error(`❌ [Router] Staking failed:`, error)
    transaction.status = 'failed'
    transaction.errorMessage = error instanceof Error ? error.message : 'Staking failed'
    await updateTransaction(transaction)
    return {
      success: false,
      error: transaction.errorMessage,
    }
  }
}

/**
 * Wait for IBC transfer confirmation with timeout
 */
async function waitForIbcConfirmation(txHash: string): Promise<void> {
  const startTime = Date.now()
  const timeout = 5 * 60 * 1000 // 5 minutes

  while (Date.now() - startTime < timeout) {
    const status = await checkIbcTransferStatus(txHash)

    if (status.received) {
      return
    }

    if (status.error && !status.error.includes('not yet received')) {
      throw new Error(status.error)
    }

    // Wait 10 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 10000))
  }

  throw new Error('IBC transfer confirmation timeout')
}

/**
 * Retry failed transaction
 */
export async function retryTransaction(
  transaction: DepositTransaction
): Promise<RouteExecutionResult> {
  console.log(`🔄 [Router] Retrying transaction ${transaction.thetaTxHash}`)

  if (transaction.retryCount >= IBC_CONFIG.service.maxRetries) {
    return {
      success: false,
      transaction,
      error: 'Maximum retry attempts exceeded',
    }
  }

  transaction.retryCount++
  transaction.lastRetryAt = Date.now()
  transaction.status = 'confirmed'
  transaction.statusMessage = `Retrying (attempt ${transaction.retryCount}/${IBC_CONFIG.service.maxRetries})`
  await updateTransaction(transaction)

  // Wait before retrying (exponential backoff)
  const delay = IBC_CONFIG.service.retryDelayMs * Math.pow(2, transaction.retryCount - 1)
  await new Promise((resolve) => setTimeout(resolve, delay))

  return executeRoute(transaction)
}

