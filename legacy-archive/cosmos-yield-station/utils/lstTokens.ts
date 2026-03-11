/**
 * Comprehensive LST Token Configuration
 * All major Cosmos Liquid Staking Tokens with provider info
 */

export type LSTProvider = 'Stride' | 'MilkyWay' | 'Quicksilver' | 'Persistence' | 'pSTAKE' | 'Coming Soon'

export interface LSTTokenConfig {
  symbol: string
  name: string
  provider: LSTProvider
  apy: number
  apyTrend?: 'up' | 'down' | 'stable'
  riskLevel: 'low' | 'medium' | 'high'
  logo?: string
  denom?: string
  chainId?: string
  displayDenom?: string
  decimals?: number
  coingeckoId?: string
}

export const LST_TOKENS_CONFIG: LSTTokenConfig[] = [
  // Stride tokens
  {
    symbol: 'stkTIA',
    name: 'Stride Staked TIA',
    provider: 'Stride',
    apy: 38.2,
    apyTrend: 'up',
    riskLevel: 'low',
    denom: 'stutia',
    chainId: 'stride-1',
    displayDenom: 'stkTIA',
    decimals: 6,
    coingeckoId: 'stride-staked-tia',
  },
  {
    symbol: 'stkATOM',
    name: 'Stride Staked ATOM',
    provider: 'Stride',
    apy: 32.5,
    apyTrend: 'stable',
    riskLevel: 'low',
    denom: 'stuatom',
    chainId: 'stride-1',
    displayDenom: 'stkATOM',
    decimals: 6,
    coingeckoId: 'stride-staked-atom',
  },
  {
    symbol: 'stkOSMO',
    name: 'Stride Staked OSMO',
    provider: 'Stride',
    apy: 22.1,
    apyTrend: 'stable',
    riskLevel: 'low',
    denom: 'stuosmo',
    chainId: 'stride-1',
    displayDenom: 'stkOSMO',
    decimals: 6,
  },
  
  // MilkyWay tokens
  {
    symbol: 'milkTIA',
    name: 'MilkyWay Staked TIA',
    provider: 'MilkyWay',
    apy: 36.8,
    apyTrend: 'up',
    riskLevel: 'low',
    coingeckoId: 'milkyway-staked-tia',
  },
  
  // Quicksilver tokens
  {
    symbol: 'qTIA',
    name: 'Quicksilver Staked TIA',
    provider: 'Quicksilver',
    apy: 35.4,
    apyTrend: 'stable',
    riskLevel: 'medium',
    coingeckoId: 'quicksilver-staked-tia',
  },
  {
    symbol: 'qATOM',
    name: 'Quicksilver Staked ATOM',
    provider: 'Quicksilver',
    apy: 31.2,
    apyTrend: 'stable',
    riskLevel: 'medium',
    coingeckoId: 'quicksilver-staked-atom',
  },
  
  // Persistence (existing)
  {
    symbol: 'stkXPRT',
    name: 'Persistence Staked XPRT',
    provider: 'Persistence',
    apy: 28.7,
    apyTrend: 'stable',
    riskLevel: 'low',
    coingeckoId: 'persistence-staked-xprt',
  },
  
  // pSTAKE
  {
    symbol: 'pSTAKE BTC',
    name: 'pSTAKE Staked BTC',
    provider: 'pSTAKE',
    apy: 25.4,
    apyTrend: 'stable',
    riskLevel: 'medium',
    coingeckoId: 'pstake-staked-btc',
  },
  
  // Placeholders for future
  {
    symbol: 'stkINJ',
    name: 'Staked INJ',
    provider: 'Coming Soon',
    apy: 0,
    apyTrend: 'stable',
    riskLevel: 'low',
  },
  {
    symbol: 'stkDYDX',
    name: 'Staked DYDX',
    provider: 'Coming Soon',
    apy: 0,
    apyTrend: 'stable',
    riskLevel: 'low',
  },
]

export function getLSTBySymbol(symbol: string): LSTTokenConfig | undefined {
  return LST_TOKENS_CONFIG.find((token) => token.symbol === symbol)
}

export function getAllLSTSymbols(): string[] {
  return LST_TOKENS_CONFIG.map((token) => token.symbol)
}

export function getLSTsByProvider(provider: LSTProvider): LSTTokenConfig[] {
  return LST_TOKENS_CONFIG.filter((token) => token.provider === provider)
}

