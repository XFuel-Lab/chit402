// Token configuration for Theta and Cosmos chains

export type TokenType = 'native' | 'erc20' | 'ibc' | 'cw20'
export type ChainType = 'theta' | 'cosmos'

export interface Token {
  symbol: string
  name: string
  decimals: number
  type: TokenType
  chain: ChainType
  chainId: string // Theta: '361', Cosmos chains: 'celestia', 'cosmoshub-4', etc.
  address?: string // ERC20/CW20 address if applicable
  ibcDenom?: string // IBC denom for Cosmos tokens
  logo?: string
  isLST?: boolean // Liquid staking token
  underlyingAsset?: string // For LSTs: underlying token symbol
  coingeckoId?: string
}

// Theta Network Tokens
export const THETA_TOKENS: Token[] = [
  {
    symbol: 'TFUEL',
    name: 'Theta Fuel',
    decimals: 18,
    type: 'native',
    chain: 'theta',
    chainId: '361',
    coingeckoId: 'theta-fuel',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    type: 'erc20',
    chain: 'theta',
    chainId: '361',
    address: '0x...', // TODO: Add actual USDC contract address on Theta
    coingeckoId: 'usd-coin',
  },
]

// Cosmos LST Tokens
export const COSMOS_LST_TOKENS: Token[] = [
  {
    symbol: 'stkTIA',
    name: 'Staked TIA',
    decimals: 6,
    type: 'ibc',
    chain: 'cosmos',
    chainId: 'celestia',
    ibcDenom: 'ibc/...', // TODO: Add actual IBC denom
    isLST: true,
    underlyingAsset: 'TIA',
    coingeckoId: 'celestia',
  },
  {
    symbol: 'stkATOM',
    name: 'Staked ATOM',
    decimals: 6,
    type: 'ibc',
    chain: 'cosmos',
    chainId: 'cosmoshub-4',
    ibcDenom: 'ibc/...', // TODO: Add actual IBC denom
    isLST: true,
    underlyingAsset: 'ATOM',
    coingeckoId: 'cosmos',
  },
  {
    symbol: 'stkOSMO',
    name: 'Staked OSMO',
    decimals: 6,
    type: 'ibc',
    chain: 'cosmos',
    chainId: 'osmosis-1',
    ibcDenom: 'ibc/...', // TODO: Add actual IBC denom
    isLST: true,
    underlyingAsset: 'OSMO',
    coingeckoId: 'osmosis',
  },
  {
    symbol: 'milkTIA',
    name: 'MilkTIA',
    decimals: 6,
    type: 'ibc',
    chain: 'cosmos',
    chainId: 'celestia',
    ibcDenom: 'ibc/...', // TODO: Add actual IBC denom
    isLST: true,
    underlyingAsset: 'TIA',
    coingeckoId: 'celestia',
  },
  {
    symbol: 'qTIA',
    name: 'qTIA',
    decimals: 6,
    type: 'ibc',
    chain: 'cosmos',
    chainId: 'celestia',
    ibcDenom: 'ibc/...', // TODO: Add actual IBC denom
    isLST: true,
    underlyingAsset: 'TIA',
    coingeckoId: 'celestia',
  },
  {
    symbol: 'stkXPRT',
    name: 'Staked XPRT',
    decimals: 6,
    type: 'ibc',
    chain: 'cosmos',
    chainId: 'core-1',
    ibcDenom: 'ibc/...', // TODO: Add actual IBC denom
    isLST: true,
    underlyingAsset: 'XPRT',
    coingeckoId: 'persistence',
  },
]

// All tokens combined
export const ALL_TOKENS = [...THETA_TOKENS, ...COSMOS_LST_TOKENS]

// Helper functions
export function getTokenBySymbol(symbol: string): Token | undefined {
  return ALL_TOKENS.find(t => t.symbol === symbol)
}

export function getThetaTokens(): Token[] {
  return THETA_TOKENS
}

export function getCosmosTokens(): Token[] {
  return COSMOS_LST_TOKENS
}

export function isValidSwapPair(fromToken: Token, toToken: Token): boolean {
  // Can only swap between Theta <-> Cosmos, not same chain
  return fromToken.chain !== toToken.chain
}

// Axelar chain names mapping
export const AXELAR_CHAIN_NAMES: Record<string, string> = {
  '361': 'theta',
  'celestia': 'celestia',
  'cosmoshub-4': 'cosmoshub',
  'osmosis-1': 'osmosis',
  'core-1': 'persistence',
}

// Axelar GMP contract addresses
// Hardcoded gateway address for Theta network
// Axelar Gateway address with proper EIP-55 checksum
export const AXELAR_GATEWAY_ADDRESS = '0x4FFA5968857A6c7d8A9D2f9B8c8D1e813AC737A5'

export const AXELAR_GMP_ADDRESSES = {
  theta: AXELAR_GATEWAY_ADDRESS,
  celestia: import.meta.env.VITE_AXELAR_GATEWAY_CELESTIA || '',
  cosmoshub: import.meta.env.VITE_AXELAR_GATEWAY_COSMOS || '',
  osmosis: import.meta.env.VITE_AXELAR_GATEWAY_OSMOSIS || '',
  persistence: import.meta.env.VITE_AXELAR_GATEWAY_PERSISTENCE || '',
}

