// Keplr Wallet integration utilities

export interface KeplrWalletInfo {
  address: string
  chainId: string
  isConnected: boolean
}

// Chain info configurations for Keplr
export const COSMOS_CHAIN_INFOS = {
  celestia: {
    chainId: 'celestia',
    chainName: 'Celestia',
    rpc: 'https://rpc.celestia.pops.one',
    rest: 'https://api.celestia.pops.one',
    bip44: {
      coinType: 118,
    },
    bech32Config: {
      bech32PrefixAccAddr: 'celestia',
      bech32PrefixAccPub: 'celestiapub',
      bech32PrefixValAddr: 'celestiavaloper',
      bech32PrefixValPub: 'celestiavaloperpub',
      bech32PrefixConsAddr: 'celestiavalcons',
      bech32PrefixConsPub: 'celestiavalconspub',
    },
    currencies: [
      {
        coinDenom: 'TIA',
        coinMinimalDenom: 'utia',
        coinDecimals: 6,
        coinGeckoId: 'celestia',
      },
    ],
    feeCurrencies: [
      {
        coinDenom: 'TIA',
        coinMinimalDenom: 'utia',
        coinDecimals: 6,
        coinGeckoId: 'celestia',
        gasPriceStep: {
          low: 0.01,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    stakeCurrency: {
      coinDenom: 'TIA',
      coinMinimalDenom: 'utia',
      coinDecimals: 6,
      coinGeckoId: 'celestia',
    },
  },
  cosmoshub: {
    chainId: 'cosmoshub-4',
    chainName: 'Cosmos Hub',
    rpc: 'https://rpc.cosmos.network',
    rest: 'https://api.cosmos.network',
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
        gasPriceStep: {
          low: 0.01,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    stakeCurrency: {
      coinDenom: 'ATOM',
      coinMinimalDenom: 'uatom',
      coinDecimals: 6,
      coinGeckoId: 'cosmos',
    },
  },
  osmosis: {
    chainId: 'osmosis-1',
    chainName: 'Osmosis',
    rpc: 'https://rpc.osmosis.zone',
    rest: 'https://lcd.osmosis.zone',
    bip44: {
      coinType: 118,
    },
    bech32Config: {
      bech32PrefixAccAddr: 'osmo',
      bech32PrefixAccPub: 'osmopub',
      bech32PrefixValAddr: 'osmovaloper',
      bech32PrefixValPub: 'osmovaloperpub',
      bech32PrefixConsAddr: 'osmovalcons',
      bech32PrefixConsPub: 'osmovalconspub',
    },
    currencies: [
      {
        coinDenom: 'OSMO',
        coinMinimalDenom: 'uosmo',
        coinDecimals: 6,
        coinGeckoId: 'osmosis',
      },
    ],
    feeCurrencies: [
      {
        coinDenom: 'OSMO',
        coinMinimalDenom: 'uosmo',
        coinDecimals: 6,
        coinGeckoId: 'osmosis',
        gasPriceStep: {
          low: 0.01,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    stakeCurrency: {
      coinDenom: 'OSMO',
      coinMinimalDenom: 'uosmo',
      coinDecimals: 6,
      coinGeckoId: 'osmosis',
    },
  },
  persistence: {
    chainId: 'core-1',
    chainName: 'Persistence',
    rpc: 'https://rpc.core.persistence.one',
    rest: 'https://rest.core.persistence.one',
    bip44: {
      coinType: 118,
    },
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
        coinGeckoId: 'persistence',
      },
    ],
    feeCurrencies: [
      {
        coinDenom: 'XPRT',
        coinMinimalDenom: 'uxprt',
        coinDecimals: 6,
        coinGeckoId: 'persistence',
        gasPriceStep: {
          low: 0.01,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    stakeCurrency: {
      coinDenom: 'XPRT',
      coinMinimalDenom: 'uxprt',
      coinDecimals: 6,
      coinGeckoId: 'persistence',
    },
  },
}

declare global {
  interface Window {
    keplr?: any
    getOfflineSigner?: any
  }
}

/**
 * Check if Keplr extension is installed
 */
export function isKeplrInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.keplr
}

/**
 * Connect to Keplr wallet for a specific chain
 */
export async function connectKeplr(chainId: string): Promise<KeplrWalletInfo> {
  if (!isKeplrInstalled()) {
    throw new Error('Please install Keplr wallet extension')
  }

  try {
    const chainInfo = Object.values(COSMOS_CHAIN_INFOS).find(
      c => c.chainId === chainId
    )

    if (!chainInfo) {
      throw new Error(`Chain ${chainId} not supported`)
    }

    // Suggest chain to Keplr (adds if not present)
    await window.keplr.experimentalSuggestChain(chainInfo)

    // Request connection
    await window.keplr.enable(chainId)

    // Get offline signer
    const offlineSigner = window.getOfflineSigner(chainId)
    const accounts = await offlineSigner.getAccounts()

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found in Keplr')
    }

    return {
      address: accounts[0].address,
      chainId,
      isConnected: true,
    }
  } catch (error) {
    console.error('Keplr connection error:', error)
    throw error
  }
}

/**
 * Get Keplr balance for a specific token
 */
export async function getKeplrBalance(
  chainId: string,
  address: string,
  denom: string
): Promise<string> {
  try {
    const chainInfo = Object.values(COSMOS_CHAIN_INFOS).find(
      c => c.chainId === chainId
    )

    if (!chainInfo) {
      throw new Error(`Chain ${chainId} not supported`)
    }

    const response = await fetch(
      `${chainInfo.rest}/cosmos/bank/v1beta1/balances/${address}`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch balance')
    }

    const data = await response.json()
    const balance = data.balances.find((b: any) => b.denom === denom)

    return balance ? balance.amount : '0'
  } catch (error) {
    console.error('Error fetching Keplr balance:', error)
    return '0'
  }
}

/**
 * Sign and broadcast a transaction using Keplr
 */
export async function signAndBroadcast(
  chainId: string,
  messages: any[],
  fee: any,
  memo: string = ''
): Promise<string> {
  if (!isKeplrInstalled()) {
    throw new Error('Keplr wallet not installed')
  }

  try {
    const offlineSigner = window.getOfflineSigner(chainId)
    const accounts = await offlineSigner.getAccounts()

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found')
    }

    // Use Keplr's signAndBroadcast method
    const result = await window.keplr.signAndBroadcast(
      chainId,
      accounts[0].address,
      messages,
      fee,
      memo
    )

    return result.transactionHash
  } catch (error) {
    console.error('Transaction signing error:', error)
    throw error
  }
}

/**
 * Disconnect Keplr wallet
 */
export async function disconnectKeplr(): Promise<void> {
  // Keplr doesn't have a disconnect method, but we can clear local state
  // The extension will handle the connection state
  console.log('Keplr disconnection requested')
}

