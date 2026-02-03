/**
 * pStake Finance Staking Integration
 * 
 * Stakes XPRT → stkXPRT on Persistence chain via pStake
 */

import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { IBC_CONFIG } from './config.js'
import { StakeResult } from './types.js'

let stakeClient: SigningCosmWasmClient | null = null
let stakeWallet: DirectSecp256k1HdWallet | null = null

/**
 * Initialize pStake staking client
 */
export async function initializeStakeClient(mnemonic: string): Promise<void> {
  console.log('🔒 [pStake] Initializing pStake staking client...')

  // Create wallet
  stakeWallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'persistence',
  })

  const accounts = await stakeWallet.getAccounts()
  console.log(`✅ [pStake] Staking wallet address: ${accounts[0].address}`)

  // Create CosmWasm signing client
  stakeClient = await SigningCosmWasmClient.connectWithSigner(
    IBC_CONFIG.persistence.rpcUrl,
    stakeWallet,
    {
      gasPrice: IBC_CONFIG.ibc.gasPrice,
    }
  )

  console.log('✅ [pStake] Staking client initialized')
}

/**
 * Stake XPRT → stkXPRT via pStake Finance
 */
export async function stakeXprtToStkXprt(
  xprtAmount: string,
  recipientAddress: string
): Promise<StakeResult> {
  if (!stakeClient || !stakeWallet) {
    return {
      success: false,
      error: 'Staking client not initialized',
    }
  }

  try {
    console.log(`🔒 [pStake] Initiating staking...`)
    console.log(`   Input: ${xprtAmount} XPRT`)
    console.log(`   Recipient: ${recipientAddress}`)

    const accounts = await stakeWallet.getAccounts()
    const senderAddress = accounts[0].address

    // Check minimum amount
    const amountNum = parseInt(xprtAmount, 10)
    if (amountNum < IBC_CONFIG.pstake.minStakingAmount) {
      return {
        success: false,
        error: `Amount below minimum (${IBC_CONFIG.pstake.minStakingAmount} uxprt)`,
      }
    }

    // pStake liquid staking message
    const stakeMsg = {
      liquid_stake: {
        amount: xprtAmount,
        receiver: recipientAddress,
      },
    }

    // Execute staking transaction
    const result = await stakeClient.execute(
      senderAddress,
      IBC_CONFIG.persistence.pstakeStakingAddress,
      stakeMsg,
      'auto',
      'XFUEL: Stake XPRT → stkXPRT',
      [
        {
          denom: 'uxprt',
          amount: xprtAmount,
        },
      ]
    )

    if (result.code !== 0) {
      console.error(`❌ [pStake] Staking failed: ${result.rawLog}`)
      return {
        success: false,
        error: result.rawLog || 'Staking failed',
      }
    }

    // Extract stkXPRT amount from logs
    const stkXprtAmount = extractStkXprtAmount(result.logs, xprtAmount)

    console.log(`✅ [pStake] Staking successful!`)
    console.log(`   Tx Hash: ${result.transactionHash}`)
    console.log(`   Output: ${stkXprtAmount} stkXPRT`)
    console.log(`   Sent to: ${recipientAddress}`)

    return {
      success: true,
      txHash: result.transactionHash,
      stkXprtAmount,
    }
  } catch (error) {
    console.error('❌ [pStake] Staking error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Extract stkXPRT amount from transaction logs
 * 
 * pStake typically returns slightly less stkXPRT due to:
 * 1. Exchange rate (stkXPRT accrues value over time)
 * 2. Staking fee (0.1-0.3%)
 */
function extractStkXprtAmount(logs: any[], xprtAmount: string): string {
  try {
    for (const log of logs) {
      for (const event of log.events) {
        if (event.type === 'wasm' || event.type === 'liquid_stake') {
          const mintedAttr = event.attributes.find(
            (attr: any) => attr.key === 'minted_amount' || attr.key === 'stkxprt_amount'
          )
          if (mintedAttr) {
            return mintedAttr.value
          }
        }
      }
    }

    // Fallback: calculate based on exchange rate and fee
    const amountNum = BigInt(xprtAmount)
    const feeMultiplier = BigInt(Math.floor((1 - IBC_CONFIG.pstake.stakingFee) * 1000))
    const stkAmount = (amountNum * feeMultiplier) / BigInt(1000)
    return stkAmount.toString()
  } catch {
    // If we can't extract, return input amount minus fee
    const amountNum = BigInt(xprtAmount)
    const feeMultiplier = BigInt(Math.floor((1 - IBC_CONFIG.pstake.stakingFee) * 1000))
    const stkAmount = (amountNum * feeMultiplier) / BigInt(1000)
    return stkAmount.toString()
  }
}

/**
 * Query current XPRT:stkXPRT exchange rate
 */
export async function getExchangeRate(): Promise<number> {
  if (!stakeClient) {
    throw new Error('Staking client not initialized')
  }

  try {
    const stateMsg = { state: {} }
    const result = await stakeClient.queryContractSmart(
      IBC_CONFIG.persistence.pstakeStakingAddress,
      stateMsg
    )

    // Exchange rate = total_staked / total_supply
    const rate = parseFloat(result.exchange_rate || '1.0')
    console.log(`📊 [pStake] Current exchange rate: 1 XPRT = ${1/rate} stkXPRT`)
    return rate
  } catch (error) {
    console.error('❌ [pStake] Error querying exchange rate:', error)
    return 1.0
  }
}

/**
 * Check stkXPRT balance for an address
 */
export async function getStkXprtBalance(address: string): Promise<string> {
  if (!stakeClient) {
    throw new Error('Staking client not initialized')
  }

  try {
    const balanceMsg = {
      balance: { address },
    }

    const result = await stakeClient.queryContractSmart(
      IBC_CONFIG.persistence.pstakeStakingAddress,
      balanceMsg
    )

    return result.balance || '0'
  } catch (error) {
    console.error('❌ [pStake] Error querying balance:', error)
    return '0'
  }
}

/**
 * Unstake stkXPRT → XPRT (reverse operation)
 * Not used in the main flow but useful for testing
 */
export async function unstakeStkXprtToXprt(
  stkXprtAmount: string
): Promise<StakeResult> {
  if (!stakeClient || !stakeWallet) {
    return {
      success: false,
      error: 'Staking client not initialized',
    }
  }

  try {
    const accounts = await stakeWallet.getAccounts()
    const senderAddress = accounts[0].address

    const unstakeMsg = {
      liquid_unstake: {
        amount: stkXprtAmount,
      },
    }

    const result = await stakeClient.execute(
      senderAddress,
      IBC_CONFIG.persistence.pstakeStakingAddress,
      unstakeMsg,
      'auto',
      'Unstake stkXPRT → XPRT'
    )

    if (result.code !== 0) {
      return {
        success: false,
        error: result.rawLog || 'Unstaking failed',
      }
    }

    return {
      success: true,
      txHash: result.transactionHash,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

