/**
 * Keplr Wallet Integration Utilities
 * Supports Cosmos Hub and Stride chains for LST staking
 */

import { ChainInfo } from '@keplr-wallet/types'
import {
  SigningStargateClient,
  GasPrice,
  calculateFee,
  defaultRegistry,
  DeliverTxResponse,
} from '@cosmjs/stargate'

// Chain configurations for Cosmos Hub and Stride
export const COSMOS_HUB_CHAIN_INFO: ChainInfo = {
  chainId: 'cosmoshub-4',
  chainName: 'Cosmos Hub',
  rpc: 'https://rpc.cosmos.network',
  rest: 'https://lcd.cosmos.network',
  bip44: {
    coinType: 118,
  },
  bech32Config: {
    bech32PrefixAccAddr: 'cosmos',
    bech32PrefixAccPub: 'cosmospub',
    bech32PrefixValAddr: 'cosmosvaloper',
    bech32PrefixValPub: 'cosmosvaloperpub',
    bech32PrefixConsAddr: 'cosmosvalcons',
    bech32PrefixConsPub: 'cosmosvalconspub',
  },
  currencies: [
    {
      coinDenom: 'ATOM',
      coinMinimalDenom: 'uatom',
      coinDecimals: 6,
      coinGeckoId: 'cosmos',
    },
  ],
  feeCurrencies: [
    {
      coinDenom: 'ATOM',
      coinMinimalDenom: 'uatom',
      coinDecimals: 6,
      coinGeckoId: 'cosmos',
    },
  ],
  stakeCurrency: {
    coinDenom: 'ATOM',
    coinMinimalDenom: 'uatom',
    coinDecimals: 6,
    coinGeckoId: 'cosmos',
  },
  coinType: 118,
  gasPriceStep: {
    low: 0.01,
    average: 0.025,
    high: 0.04,
  },
}

export const STRIDE_CHAIN_INFO: ChainInfo = {
  chainId: 'stride-1',
  chainName: 'Stride',
  rpc: 'https://stride-rpc.polkachu.com',
  rest: 'https://stride-api.polkachu.com',
  bip44: {
    coinType: 118,
  },
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
    {
      coinDenom: 'stkATOM',
      coinMinimalDenom: 'stuatom',
      coinDecimals: 6,
    },
    {
      coinDenom: 'stkTIA',
      coinMinimalDenom: 'stutia',
      coinDecimals: 6,
    },
  ],
  feeCurrencies: [
    {
      coinDenom: 'STRD',
      coinMinimalDenom: 'ustrd',
      coinDecimals: 6,
    },
  ],
  stakeCurrency: {
    coinDenom: 'STRD',
    coinMinimalDenom: 'ustrd',
    coinDecimals: 6,
  },
  coinType: 118,
  gasPriceStep: {
    low: 0.001,
    average: 0.0025,
    high: 0.004,
  },
}

// LST token configurations
export const LST_TOKENS = {
  stkATOM: {
    denom: 'stuatom',
    displayDenom: 'stkATOM',
    decimals: 6,
    chainId: 'stride-1',
    chainName: 'Stride',
  },
  stkTIA: {
    denom: 'stutia',
    displayDenom: 'stkTIA',
    decimals: 6,
    chainId: 'stride-1',
    chainName: 'Stride',
  },
} as const

export type LSTTokenType = keyof typeof LST_TOKENS

/**
 * Check if Keplr wallet is installed
 */
export async function checkKeplrInstalled(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  return typeof (window as any).keplr !== 'undefined'
}

/**
 * Get Keplr wallet instance
 */
export function getKeplr(): any {
  if (typeof window === 'undefined') {
    throw new Error('Window is not available')
  }
  const keplr = (window as any).keplr
  if (!keplr) {
    throw new Error('Keplr wallet is not installed')
  }
  return keplr
}

/**
 * Enable Keplr for a specific chain
 */
export async function enableKeplr(chainId: string): Promise<void> {
  const keplr = getKeplr()
  await keplr.enable(chainId)
}

/**
 * Suggest chain to Keplr (if not already added)
 */
export async function suggestChain(chainInfo: ChainInfo): Promise<void> {
  const keplr = getKeplr()
  try {
    await keplr.experimentalSuggestChain(chainInfo)
  } catch (error) {
    // Chain might already be added, ignore error
    console.log('Chain suggestion result:', error)
  }
}

/**
 * Get account address for a chain
 */
export async function getKeplrAddress(chainId: string): Promise<string> {
  const keplr = getKeplr()
  await enableKeplr(chainId)
  const offlineSigner = keplr.getOfflineSigner(chainId)
  const accounts = await offlineSigner.getAccounts()
  return accounts[0].address
}

/**
 * Get balance for a specific token on a chain
 */
export async function getTokenBalance(
  chainId: string,
  address: string,
  denom: string,
  restEndpoint: string,
): Promise<string> {
  try {
    const response = await fetch(`${restEndpoint}/cosmos/bank/v1beta1/balances/${address}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch balance: ${response.statusText}`)
    }
    const data = await response.json()
    const balance = data.balances?.find((b: any) => b.denom === denom)
    return balance?.amount || '0'
  } catch (error) {
    console.error('Error fetching token balance:', error)
    return '0'
  }
}

/**
 * Format balance with decimals
 */
export function formatBalance(amount: string, decimals: number): string {
  const num = BigInt(amount)
  const divisor = BigInt(10 ** decimals)
  const whole = num / divisor
  const fraction = num % divisor
  const fractionStr = fraction.toString().padStart(decimals, '0')
  const trimmed = fractionStr.replace(/0+$/, '')
  if (trimmed === '') {
    return whole.toString()
  }
  return `${whole}.${trimmed}`
}

/**
 * Get Stargate signing client with Keplr signer
 */
async function getStargateClient(chainId: string): Promise<SigningStargateClient> {
  const keplr = getKeplr()
  await enableKeplr(chainId)
  const chainInfo = chainId === 'stride-1' ? STRIDE_CHAIN_INFO : COSMOS_HUB_CHAIN_INFO
  const offlineSigner = keplr.getOfflineSigner(chainId)

  // Create gas price from chain info
  const gasPrice = GasPrice.fromString(
    `${chainInfo.gasPriceStep?.average || 0.025}${chainInfo.feeCurrencies[0].coinDenom}`,
  )

  const client = await SigningStargateClient.connectWithSigner(chainInfo.rpc, offlineSigner, {
    gasPrice,
    registry: defaultRegistry,
  })

  return client
}

/**
 * Get a validator address for delegation
 * In production, you should fetch active validators from the chain
 * or allow users to select a validator
 * 
 * NOTE: These are example validator addresses. In production, you should:
 * 1. Query the chain for active validators
 * 2. Let users select a validator
 * 3. Or use a well-known validator address
 */
function getDefaultValidator(chainId: string): string {
  if (chainId === 'stride-1') {
    // Example Stride validator - replace with actual validator in production
    // You can query validators via: GET /cosmos/staking/v1beta1/validators
    return 'stridevaloper1n8mureaneram8xe7gye3s9h9nq6f7j2vq0q5j3'
  } else if (chainId === 'cosmoshub-4') {
    // Example Cosmos Hub validator - replace with actual validator in production
    return 'cosmosvaloper1sjllsnramtg3ewxqwwrwjxfgc4n4ef9u0lcluj'
  }
  throw new Error(`No default validator for chain ${chainId}`)
}

/**
 * Sign and broadcast a delegate transaction for LST tokens
 * This delegates stkATOM or stkTIA to a validator on Stride
 */
export async function signStakeTransaction(
  chainId: string,
  address: string,
  amount: string,
  denom: string,
  lstType: LSTTokenType,
  memo?: string,
): Promise<{ txHash: string }> {
  const client = await getStargateClient(chainId)
  const validatorAddress = getDefaultValidator(chainId)

  // Create delegate message
  const delegateMsg = {
    typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
    value: {
      delegatorAddress: address,
      validatorAddress: validatorAddress,
      amount: {
        denom: denom,
        amount: amount,
      },
    },
  }

  // Calculate fee (using average gas price)
  const chainInfo = chainId === 'stride-1' ? STRIDE_CHAIN_INFO : COSMOS_HUB_CHAIN_INFO
  const gasPrice = GasPrice.fromString(
    `${chainInfo.gasPriceStep?.average || 0.025}${chainInfo.feeCurrencies[0].coinDenom}`,
  )
  
  // Estimate gas (delegate operations typically need ~200k gas)
  const gasEstimate = 200000
  const fee = calculateFee(gasEstimate, gasPrice)

  try {
    // Sign and broadcast the transaction
    const result: DeliverTxResponse = await client.signAndBroadcast(
      address,
      [delegateMsg],
      fee,
      memo || `Delegate ${LST_TOKENS[lstType].displayDenom} via XFUEL`,
    )

    return {
      txHash: result.transactionHash,
    }
  } catch (error: any) {
    console.error('Staking transaction error:', error)
    throw new Error(error.message || 'Failed to broadcast staking transaction')
  }
}

/**
 * Stake LST tokens by delegating them to a validator
 * This is the main function used by the UI
 */
export async function stakeLST(
  chainId: string,
  amount: string,
  lstType: LSTTokenType,
  memo?: string,
): Promise<{ txHash: string }> {
  const keplr = getKeplr()
  await enableKeplr(chainId)
  
  // Get user's address
  const address = await getKeplrAddress(chainId)
  
  // Get the denom for the LST token
  const lstConfig = LST_TOKENS[lstType]
  
  // Convert amount to smallest unit (already should be in smallest unit, but ensure it's a string)
  const amountInSmallestUnit = amount

  // Sign and broadcast the delegate transaction
  return await signStakeTransaction(
    chainId,
    address,
    amountInSmallestUnit,
    lstConfig.denom,
    lstType,
    memo,
  )
}

