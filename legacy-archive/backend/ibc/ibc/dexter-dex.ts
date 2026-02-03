/**
 * Dexter DEX Integration
 * 
 * Swaps ibc/TFUEL → XPRT on Dexter DEX (Persistence chain)
 */

import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate'
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { IBC_CONFIG } from './config.js'
import { SwapResult } from './types.js'

let dexClient: SigningCosmWasmClient | null = null
let dexWallet: DirectSecp256k1HdWallet | null = null

/**
 * Initialize Dexter DEX client
 */
export async function initializeDexClient(mnemonic: string): Promise<void> {
  console.log('💱 [Dexter] Initializing Dexter DEX client...')

  // Create wallet
  dexWallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'persistence',
  })

  const accounts = await dexWallet.getAccounts()
  console.log(`✅ [Dexter] DEX wallet address: ${accounts[0].address}`)

  // Create CosmWasm signing client
  dexClient = await SigningCosmWasmClient.connectWithSigner(
    IBC_CONFIG.persistence.rpcUrl,
    dexWallet,
    {
      gasPrice: IBC_CONFIG.ibc.gasPrice,
    }
  )

  console.log('✅ [Dexter] DEX client initialized')
}

/**
 * Swap ibc/TFUEL → XPRT on Dexter
 */
export async function swapTfuelToXprt(
  tfuelAmount: string,
  minXprtOut?: string
): Promise<SwapResult> {
  if (!dexClient || !dexWallet) {
    return {
      success: false,
      error: 'DEX client not initialized',
    }
  }

  try {
    console.log(`💱 [Dexter] Initiating swap...`)
    console.log(`   Input: ${tfuelAmount} ibc/TFUEL`)
    console.log(`   Min Output: ${minXprtOut || 'calculated'} XPRT`)

    const accounts = await dexWallet.getAccounts()
    const senderAddress = accounts[0].address

    // Calculate minimum output with slippage
    if (!minXprtOut) {
      // Estimate output based on pool ratio
      const estimatedOut = await estimateSwapOutput(tfuelAmount)
      minXprtOut = (BigInt(estimatedOut) * BigInt(99) / BigInt(100)).toString() // 1% slippage
    }

    // Dexter swap message format
    const swapMsg = {
      swap: {
        offer_asset: {
          info: {
            native_token: {
              denom: IBC_CONFIG.ibc.tfuelIbcDenom,
            },
          },
          amount: tfuelAmount,
        },
        belief_price: undefined, // Let Dexter calculate
        max_spread: '0.01', // 1% max spread
        to: senderAddress,
      },
    }

    // Execute swap
    const result = await dexClient.execute(
      senderAddress,
      IBC_CONFIG.persistence.dexterRouterAddress,
      swapMsg,
      'auto',
      'XFUEL: ibc/TFUEL → XPRT swap',
      [
        {
          denom: IBC_CONFIG.ibc.tfuelIbcDenom,
          amount: tfuelAmount,
        },
      ]
    )

    if (result.code !== 0) {
      console.error(`❌ [Dexter] Swap failed: ${result.rawLog}`)
      return {
        success: false,
        error: result.rawLog || 'Swap failed',
      }
    }

    // Extract output amount from logs
    const returnAmount = extractReturnAmount(result.logs)

    console.log(`✅ [Dexter] Swap successful!`)
    console.log(`   Tx Hash: ${result.transactionHash}`)
    console.log(`   Output: ${returnAmount} XPRT`)

    return {
      success: true,
      txHash: result.transactionHash,
      amountOut: returnAmount,
    }
  } catch (error) {
    console.error('❌ [Dexter] Swap error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Estimate swap output (query pool without executing)
 */
async function estimateSwapOutput(tfuelAmount: string): Promise<string> {
  if (!dexClient) {
    throw new Error('DEX client not initialized')
  }

  try {
    // Query Dexter pool for simulation
    const simulationMsg = {
      simulation: {
        offer_asset: {
          info: {
            native_token: {
              denom: IBC_CONFIG.ibc.tfuelIbcDenom,
            },
          },
          amount: tfuelAmount,
        },
      },
    }

    const result = await dexClient.queryContractSmart(
      IBC_CONFIG.dexter.tfuelXprtPoolAddress,
      simulationMsg
    )

    return result.return_amount || '0'
  } catch (error) {
    console.error('❌ [Dexter] Estimation error:', error)
    // Fallback: assume 1:1 ratio (will be adjusted by slippage)
    return tfuelAmount
  }
}

/**
 * Extract return amount from transaction logs
 */
function extractReturnAmount(logs: any[]): string {
  try {
    for (const log of logs) {
      for (const event of log.events) {
        if (event.type === 'wasm') {
          const returnAmountAttr = event.attributes.find(
            (attr: any) => attr.key === 'return_amount'
          )
          if (returnAmountAttr) {
            return returnAmountAttr.value
          }
        }
      }
    }
    return '0'
  } catch {
    return '0'
  }
}

/**
 * Query current pool reserves
 */
export async function getPoolReserves(): Promise<{
  tfuelReserve: string
  xprtReserve: string
}> {
  if (!dexClient) {
    throw new Error('DEX client not initialized')
  }

  try {
    const poolMsg = { pool: {} }
    const result = await dexClient.queryContractSmart(
      IBC_CONFIG.dexter.tfuelXprtPoolAddress,
      poolMsg
    )

    return {
      tfuelReserve: result.assets[0].amount,
      xprtReserve: result.assets[1].amount,
    }
  } catch (error) {
    console.error('❌ [Dexter] Error querying pool reserves:', error)
    return {
      tfuelReserve: '0',
      xprtReserve: '0',
    }
  }
}

