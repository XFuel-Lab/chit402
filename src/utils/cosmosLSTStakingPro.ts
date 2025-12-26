/**
 * Cosmos LST Staking Pro Integration
 * Enhanced Keplr integration with:
 * - Automatic chain suggestion (stkXPRT, stkATOM, etc.)
 * - Proper Cosmos address handling (not ETH 0x)
 * - Keplr UI popup management
 * - IBC bridge integration for Theta->Cosmos
 * 
 * Handles real staking after successful Theta swap execution
 */

import { SigningStargateClient, GasPrice, calculateFee } from '@cosmjs/stargate'
import type { Window as KeplrWindow } from '@keplr-wallet/types'
import type { ChainInfo } from '@keplr-wallet/types'

declare global {
  interface Window extends KeplrWindow {}
}

// Stride chain configuration for LST staking
export const STRIDE_CHAIN_ID = 'stride-1'
export const STRIDE_RPC = 'https://stride-rpc.polkachu.com'
export const STRIDE_REST = 'https://stride-api.polkachu.com'

// Persistence chain configuration (for stkXPRT)
export const PERSISTENCE_CHAIN_ID = 'core-1'
export const PERSISTENCE_RPC = 'https://rpc.core.persistence.one'
export const PERSISTENCE_REST = 'https://rest.core.persistence.one'

// LST token configurations
export interface LSTConfig {
  symbol: string
  denom: string
  decimals: number
  chainId: string
  chainName: string
  rpc: string
  rest: string
  validatorAddress: string
  coinDenom: string
  coinMinimalDenom: string
}

// Chain configurations for Keplr
const CHAIN_CONFIGS: Record<string, ChainInfo> = {
  'stride-1': {
    chainId: 'stride-1',
    chainName: 'Stride',
    rpc: STRIDE_RPC,
    rest: STRIDE_REST,
    bip44: { coinType: 118 },
    bech32Config: {
      bech32PrefixAccAddr: 'stride',
      bech32PrefixAccPub: 'stridepub',
      bech32PrefixValAddr: 'stridevaloper',
      bech32PrefixValPub: 'stridevaloperpub',
      bech32PrefixConsAddr: 'stridevalcons',
      bech32PrefixConsPub: 'stridevalconspub',
    },
    currencies: [
      {
        coinDenom: 'STRD',
        coinMinimalDenom: 'ustrd',
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: 'STRD',
        coinMinimalDenom: 'ustrd',
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.0005,
          average: 0.001,
          high: 0.002,
        },
      },
    ],
    stakeCurrency: {
      coinDenom: 'STRD',
      coinMinimalDenom: 'ustrd',
      coinDecimals: 6,
    },
    features: ['ibc-transfer', 'ibc-go'],
  },
  'core-1': {
    chainId: 'core-1',
    chainName: 'Persistence',
    rpc: PERSISTENCE_RPC,
    rest: PERSISTENCE_REST,
    bip44: { coinType: 118 },
    bech32Config: {
      bech32PrefixAccAddr: 'persistence',
      bech32PrefixAccPub: 'persistencepub',
      bech32PrefixValAddr: 'persistencevaloper',
      bech32PrefixValPub: 'persistencevaloperpub',
      bech32PrefixConsAddr: 'persistencevalcons',
      bech32PrefixConsPub: 'persistencevalconspub',
    },
    currencies: [
      {
        coinDenom: 'XPRT',
        coinMinimalDenom: 'uxprt',
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: 'XPRT',
        coinMinimalDenom: 'uxprt',
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.0005,
          average: 0.001,
          high: 0.002,
        },
      },
    ],
    stakeCurrency: {
      coinDenom: 'XPRT',
      coinMinimalDenom: 'uxprt',
      coinDecimals: 6,
    },
    features: ['ibc-transfer', 'ibc-go'],
  },
}

// LST configurations mapped to their chains
const STRIDE_LST_CONFIGS: Record<string, LSTConfig> = {
  stkTIA: {
    symbol: 'stkTIA',
    denom: 'stutia',
    decimals: 6,
    chainId: STRIDE_CHAIN_ID,
    chainName: 'Stride',
    rpc: STRIDE_RPC,
    rest: STRIDE_REST,
    validatorAddress: 'stridevaloper1u20df3trc2c2zdhm8qvh2hdjx9ewh00sv6eyy8',
    coinDenom: 'stTIA',
    coinMinimalDenom: 'stutia',
  },
  stkATOM: {
    symbol: 'stkATOM',
    denom: 'stuatom',
    decimals: 6,
    chainId: STRIDE_CHAIN_ID,
    chainName: 'Stride',
    rpc: STRIDE_RPC,
    rest: STRIDE_REST,
    validatorAddress: 'stridevaloper1u20df3trc2c2zdhm8qvh2hdjx9ewh00sv6eyy8',
    coinDenom: 'stATOM',
    coinMinimalDenom: 'stuatom',
  },
  stkXPRT: {
    symbol: 'stkXPRT',
    denom: 'stk/uxprt',
    decimals: 6,
    chainId: PERSISTENCE_CHAIN_ID,
    chainName: 'Persistence',
    rpc: PERSISTENCE_RPC,
    rest: PERSISTENCE_REST,
    validatorAddress: 'persistencevaloper1gghjut3ccd8ay0zduzj64hwre2fxs9ldlqnhv0',
    coinDenom: 'stkXPRT',
    coinMinimalDenom: 'stk/uxprt',
  },
  stkOSMO: {
    symbol: 'stkOSMO',
    denom: 'stuosmo',
    decimals: 6,
    chainId: STRIDE_CHAIN_ID,
    chainName: 'Stride',
    rpc: STRIDE_RPC,
    rest: STRIDE_REST,
    validatorAddress: 'stridevaloper1u20df3trc2c2zdhm8qvh2hdjx9ewh00sv6eyy8',
    coinDenom: 'stOSMO',
    coinMinimalDenom: 'stuosmo',
  },
}

/**
 * Check if Keplr wallet is installed
 */
export function isKeplrInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.keplr
}

/**
 * Get user-friendly error message
 */
function getKeplrErrorMessage(error: any): string {
  if (error.message?.includes('rejected') || error.message?.includes('denied')) {
    return 'Transaction rejected by user'
  }
  if (error.message?.includes('Not installed')) {
    return 'Keplr wallet not installed. Please install Keplr extension.'
  }
  if (error.message?.includes('chain')) {
    return 'Chain not supported or not added to Keplr'
  }
  return error.message || 'Unknown error'
}

/**
 * Suggest chain to Keplr (adds chain if not present)
 * This is KEY to making Keplr UI appear!
 */
async function suggestChainToKeplr(chainId: string): Promise<void> {
  if (!window.keplr) {
    throw new Error('Keplr wallet is not installed. Please install Keplr extension.')
  }

  const chainConfig = CHAIN_CONFIGS[chainId]
  if (!chainConfig) {
    throw new Error(`Chain configuration not found for ${chainId}`)
  }

  try {
    console.log(`📡 Suggesting chain to Keplr: ${chainConfig.chainName} (${chainId})`)
    
    // Try to suggest/add the chain
    // This will open Keplr UI to approve chain addition if not already added
    await window.keplr.experimentalSuggestChain(chainConfig)
    
    console.log(`✅ Chain ${chainConfig.chainName} suggested successfully`)
  } catch (error: any) {
    console.error(`❌ Failed to suggest chain ${chainConfig.chainName}:`, error)
    throw new Error(`Failed to add ${chainConfig.chainName} chain to Keplr: ${getKeplrErrorMessage(error)}`)
  }
}

/**
 * Connect to Keplr wallet and enable chain
 * This will show the Keplr UI popup!
 */
export async function connectKeplrForChain(chainId: string): Promise<string> {
  if (!isKeplrInstalled()) {
    throw new Error('Keplr wallet is not installed. Please install Keplr extension.')
  }

  try {
    console.log(`🔌 Connecting Keplr for chain: ${chainId}`)
    
    // First, suggest the chain (will add if not present)
    await suggestChainToKeplr(chainId)
    
    // Wait a moment for chain addition
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Enable the chain - THIS TRIGGERS KEPLR UI
    console.log(`🔓 Enabling chain ${chainId} in Keplr...`)
    await window.keplr!.enable(chainId)
    
    // Get the offline signer
    const offlineSigner = window.keplr!.getOfflineSigner(chainId)
    const accounts = await offlineSigner.getAccounts()

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found in Keplr wallet')
    }

    const cosmosAddress = accounts[0].address
    console.log(`✅ Keplr connected: ${cosmosAddress}`)
    
    // Verify it's a Cosmos address, not ETH 0x address
    if (cosmosAddress.startsWith('0x')) {
      throw new Error('Invalid address format - got ETH address instead of Cosmos address. Please reconnect Keplr.')
    }

    return cosmosAddress
  } catch (error: any) {
    console.error('Keplr connection error:', error)
    throw new Error(`Failed to connect Keplr: ${getKeplrErrorMessage(error)}`)
  }
}

/**
 * Connect Keplr specifically for Stride chain
 */
export async function connectKeplrForStride(): Promise<string> {
  return connectKeplrForChain(STRIDE_CHAIN_ID)
}

/**
 * Connect Keplr specifically for Persistence chain (stkXPRT)
 */
export async function connectKeplrForPersistence(): Promise<string> {
  return connectKeplrForChain(PERSISTENCE_CHAIN_ID)
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
      `${config.rest}/cosmos/bank/v1beta1/balances/${address}`
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
 * Execute LST staking on Cosmos chain via Keplr
 * This triggers the Keplr signing popup for the delegate transaction
 */
export async function stakeLSTOnStride(
  lstSymbol: string,
  amount: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Validate LST configuration
    const config = STRIDE_LST_CONFIGS[lstSymbol]
    if (!config) {
      return {
        success: false,
        error: `LST token ${lstSymbol} is not supported for staking yet`,
      }
    }

    console.log(`🎯 Staking ${amount} ${lstSymbol} on ${config.chainName}...`)

    // Connect Keplr and enable chain (triggers UI)
    const userAddress = await connectKeplrForChain(config.chainId)
    
    console.log(`👤 User address: ${userAddress}`)

    // Verify address format
    if (userAddress.startsWith('0x')) {
      return {
        success: false,
        error: 'Invalid Cosmos address - showing ETH address instead. Please reconnect Keplr and approve chain addition.',
      }
    }

    // Get the offline signer for signing transactions
    const offlineSigner = window.keplr!.getOfflineSigner(config.chainId)

    // Connect to chain RPC
    console.log(`🔗 Connecting to ${config.chainName} RPC...`)
    const client = await SigningStargateClient.connectWithSigner(
      config.rpc,
      offlineSigner,
      {
        gasPrice: GasPrice.fromString(`0.001${config.coinMinimalDenom}`),
      }
    )

    // Convert amount to smallest unit (micro units)
    const amountInMicroUnits = Math.floor(amount * Math.pow(10, config.decimals)).toString()

    // Create delegate message
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

    console.log(`📝 Creating delegation transaction...`)
    console.log(`   Amount: ${amountInMicroUnits} ${config.denom}`)
    console.log(`   Validator: ${config.validatorAddress}`)

    // Calculate transaction fee
    const fee = calculateFee(200000, GasPrice.fromString(`0.001${config.coinMinimalDenom}`))

    // Sign and broadcast the transaction
    // THIS WILL TRIGGER KEPLR SIGNING POPUP
    console.log(`✍️ Requesting signature from Keplr...`)
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

    console.log(`✅ Staking successful! TX: ${result.transactionHash}`)

    return {
      success: true,
      txHash: result.transactionHash,
    }
  } catch (error: any) {
    console.error('Staking error:', error)
    
    const errorMessage = getKeplrErrorMessage(error)

    return {
      success: false,
      error: errorMessage,
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
 * Get Mintscan explorer URL for transaction
 */
export function getExplorerUrl(lstSymbol: string, txHash: string): string {
  const config = STRIDE_LST_CONFIGS[lstSymbol]
  
  if (config.chainId === STRIDE_CHAIN_ID) {
    return `https://www.mintscan.io/stride/txs/${txHash}`
  } else if (config.chainId === PERSISTENCE_CHAIN_ID) {
    return `https://www.mintscan.io/persistence/txs/${txHash}`
  }
  
  return `https://www.mintscan.io/cosmos/txs/${txHash}`
}

/**
 * Alias for backwards compatibility
 */
export function getStrideExplorerUrl(txHash: string): string {
  return `https://www.mintscan.io/stride/txs/${txHash}`
}

/**
 * Check if user has Keplr and guide them through setup
 */
export async function ensureKeplrSetup(lstSymbol: string): Promise<{
  ready: boolean
  address?: string
  error?: string
}> {
  try {
    // 1. Check if Keplr is installed
    if (!isKeplrInstalled()) {
      return {
        ready: false,
        error: 'Keplr wallet not installed. Install from https://keplr.app',
      }
    }

    // 2. Get chain config
    const config = STRIDE_LST_CONFIGS[lstSymbol]
    if (!config) {
      return {
        ready: false,
        error: `Chain configuration not found for ${lstSymbol}`,
      }
    }

    // 3. Suggest chain (adds if not present, triggers UI)
    await suggestChainToKeplr(config.chainId)

    // 4. Enable chain (triggers UI)
    await window.keplr!.enable(config.chainId)

    // 5. Get address
    const offlineSigner = window.keplr!.getOfflineSigner(config.chainId)
    const accounts = await offlineSigner.getAccounts()

    if (!accounts || accounts.length === 0) {
      return {
        ready: false,
        error: 'No accounts found in Keplr',
      }
    }

    const address = accounts[0].address

    // 6. Verify it's a Cosmos address
    if (address.startsWith('0x')) {
      return {
        ready: false,
        error: 'Invalid address format - reconnect Keplr and approve chain',
      }
    }

    return {
      ready: true,
      address,
    }
  } catch (error: any) {
    return {
      ready: false,
      error: getKeplrErrorMessage(error),
    }
  }
}

