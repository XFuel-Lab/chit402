/**
 * Price Oracle for LST Tokens (Mobile)
 * Fetches real-time prices + APYs from DeFiLlama (primary)
 * Same logic as web version for consistency
 */

export interface TokenPrice {
  price: number // Price in USD
  source: 'defillama' | 'osmosis' | 'coingecko' | 'fallback'
  timestamp: number
  confidence: 'high' | 'medium' | 'low'
}

export interface LSTPriceData {
  stkTIA: TokenPrice | null
  stkATOM: TokenPrice | null
  stkXPRT: TokenPrice | null
  pSTAKEBTC: TokenPrice | null
  stkOSMO: TokenPrice | null
  TFUEL: TokenPrice | null
  USDC: TokenPrice | null
}

export interface LSTPriceAndAPYData {
  prices: LSTPriceData
  apys: Partial<Record<keyof Omit<LSTPriceData, 'TFUEL' | 'USDC'>, number>>
}

// Cache prices + APYs for 60 seconds
const PRICE_CACHE_TTL = 60 * 1000
let priceCache: {
  data: LSTPriceAndAPYData | null
  timestamp: number
} = {
  data: null,
  timestamp: 0,
}

/**
 * DeFiLlama LST mapping
 */
const DEFILLAMA_LST_MAP: Record<
  keyof Omit<LSTPriceData, 'TFUEL' | 'USDC'>,
  {
    protocol: string
    symbol: string
    underlyingCoinGeckoId: string
  }
> = {
  stkTIA: {
    protocol: 'stride',
    symbol: 'stkTIA',
    underlyingCoinGeckoId: 'celestia',
  },
  stkATOM: {
    protocol: 'stride',
    symbol: 'stkATOM',
    underlyingCoinGeckoId: 'cosmos',
  },
  stkXPRT: {
    protocol: 'persistence',
    symbol: 'stkXPRT',
    underlyingCoinGeckoId: 'persistence',
  },
  pSTAKEBTC: {
    protocol: 'pstake-finance',
    symbol: 'pSTAKE BTC',
    underlyingCoinGeckoId: 'bitcoin',
  },
  stkOSMO: {
    protocol: 'stride',
    symbol: 'stkOSMO',
    underlyingCoinGeckoId: 'osmosis',
  },
}

/**
 * Fetch TFUEL price from CoinGecko
 */
async function fetchTfuelPrice(): Promise<number | null> {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=theta-fuel&vs_currencies=usd',
      { headers: { Accept: 'application/json' } }
    )

    if (!response.ok) {
      console.warn('⚠️ CoinGecko rate limit or error for TFUEL')
      return null
    }

    const data = await response.json()
    return data['theta-fuel']?.usd || null
  } catch (error) {
    console.error('❌ Error fetching TFUEL price:', error)
    return null
  }
}

/**
 * Fetch prices from Osmosis DEX (fallback)
 */
async function fetchOsmosisPrice(denom: string): Promise<number | null> {
  try {
    const tokenMap: Record<string, string> = {
      stktia: 'stTIA',
      stkatom: 'stATOM',
      stkxprt: 'stXPRT',
      stkosmo: 'stOSMO',
      pstakebtc: 'pSTAKE-BTC',
    }

    const tokenSymbol = tokenMap[denom.toLowerCase()] || denom

    const response = await fetch(
      `https://api-osmosis.imperator.co/tokens/v2/${tokenSymbol}`,
      { headers: { Accept: 'application/json' } }
    )

    if (response.ok) {
      const data = await response.json()
      if (data?.price) {
        return parseFloat(data.price)
      }
    }

    return null
  } catch (error) {
    console.error(`❌ Error fetching ${denom} from Osmosis:`, error)
    return null
  }
}

/**
 * Fetch underlying token price (CoinGecko) with 0.98 discount
 */
async function fetchUnderlyingDiscountedPrice(underlyingId: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(underlyingId)}&vs_currencies=usd`,
      { headers: { Accept: 'application/json' } }
    )

    if (!response.ok) return null

    const data = await response.json()
    const price = data?.[underlyingId]?.usd as number | undefined
    if (!price || price <= 0) return null

    return price * 0.98
  } catch (error) {
    return null
  }
}

/**
 * DeFiLlama yields data (both price and APY)
 */
export interface DefiLlamaYieldData {
  prices: Partial<Record<keyof LSTPriceData, number>>
  apys: Partial<Record<keyof LSTPriceData, number>>
}

/**
 * Primary DeFiLlama yields API fetch
 */
async function fetchDefiLlamaLSTData(): Promise<DefiLlamaYieldData> {
  try {
    const response = await fetch('https://yields.llama.fi/pools', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`DeFiLlama API error: ${response.status}`)
    }

    const data = await response.json()
    const pools: any[] = Array.isArray(data?.data) ? data.data : []

    const prices: Partial<Record<keyof LSTPriceData, number>> = {}
    const apys: Partial<Record<keyof LSTPriceData, number>> = {}

    ;(Object.entries(DEFILLAMA_LST_MAP) as [keyof typeof DEFILLAMA_LST_MAP, (typeof DEFILLAMA_LST_MAP)[keyof typeof DEFILLAMA_LST_MAP]][])
      .forEach(([lstKey, cfg]) => {
        const pool = pools.find(
          (p: any) =>
            typeof p?.project === 'string' &&
            typeof p?.symbol === 'string' &&
            p.project.toLowerCase() === cfg.protocol.toLowerCase() &&
            p.symbol.toLowerCase().includes(cfg.symbol.toLowerCase())
        )

        if (!pool) return

        // Extract price
        const possiblePriceFields = ['price', 'priceUsd', 'underlyingPrice', 'underlyingPriceUsd']
        let price: number | null = null

        for (const field of possiblePriceFields) {
          if (typeof pool[field] === 'number' && pool[field] > 0) {
            price = pool[field]
            break
          }
        }

        if (!price && typeof pool.tvlUsd === 'number' && typeof pool.totalSupplyUsd === 'number' && pool.totalSupplyUsd > 0) {
          price = pool.tvlUsd / pool.totalSupplyUsd
        }

        if (price && price > 0) {
          prices[lstKey as keyof LSTPriceData] = price
          console.log(`✅ DeFiLlama price for ${lstKey}: $${price.toFixed(4)}`)
        }

        // Extract APY
        const possibleApyFields = ['apy', 'apyBase', 'apyReward', 'apyMean7d']
        let apy: number | null = null

        for (const field of possibleApyFields) {
          if (typeof pool[field] === 'number' && pool[field] > 0) {
            apy = pool[field]
            break
          }
        }

        // Sum apyBase + apyReward for total
        if (typeof pool.apyBase === 'number' && typeof pool.apyReward === 'number') {
          apy = pool.apyBase + pool.apyReward
        }

        if (apy && apy > 0) {
          apys[lstKey as keyof LSTPriceData] = apy
          console.log(`✅ DeFiLlama APY for ${lstKey}: ${apy.toFixed(2)}%`)
        }
      })

    return { prices, apys }
  } catch (error) {
    console.error('❌ Error fetching DeFiLlama data:', error)
    return { prices: {}, apys: {} }
  }
}

/**
 * Get all LST prices + APYs from multiple sources
 * Primary: DeFiLlama | Fallback: Osmosis | Final: CoinGecko underlying × 0.98
 */
export async function getLSTPrices(bypassCache: boolean = false): Promise<LSTPriceAndAPYData> {
  const now = Date.now()

  // Return cached if available
  if (!bypassCache && priceCache.data && (now - priceCache.timestamp) < PRICE_CACHE_TTL) {
    console.log('⚡ Using cached prices')
    return priceCache.data
  }

  console.log('🔄 Fetching fresh prices from DeFiLlama + fallbacks...')

  // PARALLEL FETCH ALL SOURCES
  const [
    defiLlamaData,
    tfuelPrice,
    osmoStkTia,
    osmoStkAtom,
    osmoStkXprt,
    osmoStkOsmo,
    osmoPstakeBtc,
    underlyingStkTia,
    underlyingStkAtom,
    underlyingStkXprt,
    underlyingStkOsmo,
    underlyingPstakeBtc,
  ] = await Promise.all([
    fetchDefiLlamaLSTData(),
    fetchTfuelPrice(),
    fetchOsmosisPrice('stktia'),
    fetchOsmosisPrice('stkatom'),
    fetchOsmosisPrice('stkxprt'),
    fetchOsmosisPrice('stkosmo'),
    fetchOsmosisPrice('pstakebtc'),
    fetchUnderlyingDiscountedPrice(DEFILLAMA_LST_MAP.stkTIA.underlyingCoinGeckoId),
    fetchUnderlyingDiscountedPrice(DEFILLAMA_LST_MAP.stkATOM.underlyingCoinGeckoId),
    fetchUnderlyingDiscountedPrice(DEFILLAMA_LST_MAP.stkXPRT.underlyingCoinGeckoId),
    fetchUnderlyingDiscountedPrice(DEFILLAMA_LST_MAP.stkOSMO.underlyingCoinGeckoId),
    fetchUnderlyingDiscountedPrice(DEFILLAMA_LST_MAP.pSTAKEBTC.underlyingCoinGeckoId),
  ])

  const defiLlamaPrices = defiLlamaData.prices
  const defiLlamaApys = defiLlamaData.apys

  // stkTIA resolution
  let stkTiaPriceFinal: number | null = null
  let stkTiaSource: TokenPrice['source'] = 'fallback'

  if (defiLlamaPrices.stkTIA && defiLlamaPrices.stkTIA > 0) {
    stkTiaPriceFinal = defiLlamaPrices.stkTIA
    stkTiaSource = 'defillama'
  } else if (osmoStkTia && osmoStkTia > 0) {
    stkTiaPriceFinal = osmoStkTia
    stkTiaSource = 'osmosis'
  } else if (underlyingStkTia && underlyingStkTia > 0) {
    stkTiaPriceFinal = underlyingStkTia
    stkTiaSource = 'coingecko'
  }

  // stkATOM resolution
  let stkAtomPriceFinal: number | null = null
  let stkAtomSource: TokenPrice['source'] = 'fallback'

  if (defiLlamaPrices.stkATOM && defiLlamaPrices.stkATOM > 0) {
    stkAtomPriceFinal = defiLlamaPrices.stkATOM
    stkAtomSource = 'defillama'
  } else if (osmoStkAtom && osmoStkAtom > 0) {
    stkAtomPriceFinal = osmoStkAtom
    stkAtomSource = 'osmosis'
  } else if (underlyingStkAtom && underlyingStkAtom > 0) {
    stkAtomPriceFinal = underlyingStkAtom
    stkAtomSource = 'coingecko'
  }

  // stkXPRT resolution
  let stkXprtPriceFinal: number | null = null
  let stkXprtSource: TokenPrice['source'] = 'fallback'

  if (defiLlamaPrices.stkXPRT && defiLlamaPrices.stkXPRT > 0) {
    stkXprtPriceFinal = defiLlamaPrices.stkXPRT
    stkXprtSource = 'defillama'
  } else if (osmoStkXprt && osmoStkXprt > 0) {
    stkXprtPriceFinal = osmoStkXprt
    stkXprtSource = 'osmosis'
  } else if (underlyingStkXprt && underlyingStkXprt > 0) {
    stkXprtPriceFinal = underlyingStkXprt
    stkXprtSource = 'coingecko'
  }

  // stkOSMO resolution
  let stkOsmoPriceFinal: number | null = null
  let stkOsmoSource: TokenPrice['source'] = 'fallback'

  if (defiLlamaPrices.stkOSMO && defiLlamaPrices.stkOSMO > 0) {
    stkOsmoPriceFinal = defiLlamaPrices.stkOSMO
    stkOsmoSource = 'defillama'
  } else if (osmoStkOsmo && osmoStkOsmo > 0) {
    stkOsmoPriceFinal = osmoStkOsmo
    stkOsmoSource = 'osmosis'
  } else if (underlyingStkOsmo && underlyingStkOsmo > 0) {
    stkOsmoPriceFinal = underlyingStkOsmo
    stkOsmoSource = 'coingecko'
  }

  // pSTAKE BTC resolution
  let pstakeBtcPriceFinal: number | null = null
  let pstakeBtcSource: TokenPrice['source'] = 'fallback'

  if (defiLlamaPrices.pSTAKEBTC && defiLlamaPrices.pSTAKEBTC > 0) {
    pstakeBtcPriceFinal = defiLlamaPrices.pSTAKEBTC
    pstakeBtcSource = 'defillama'
  } else if (osmoPstakeBtc && osmoPstakeBtc > 0) {
    pstakeBtcPriceFinal = osmoPstakeBtc
    pstakeBtcSource = 'osmosis'
  } else if (underlyingPstakeBtc && underlyingPstakeBtc > 0) {
    pstakeBtcPriceFinal = underlyingPstakeBtc
    pstakeBtcSource = 'coingecko'
  }

  const prices: LSTPriceData = {
    TFUEL: tfuelPrice && tfuelPrice > 0
      ? {
          price: tfuelPrice,
          source: 'coingecko',
          timestamp: now,
          confidence: 'high',
        }
      : null,
    USDC: {
      price: 1.0,
      source: 'coingecko',
      timestamp: now,
      confidence: 'high',
    },
    stkTIA: stkTiaPriceFinal && stkTiaPriceFinal > 0
      ? {
          price: stkTiaPriceFinal,
          source: stkTiaSource,
          timestamp: now,
          confidence: stkTiaSource === 'defillama' || stkTiaSource === 'coingecko' ? 'high' : stkTiaSource === 'osmosis' ? 'medium' : 'low',
        }
      : null,
    stkATOM: stkAtomPriceFinal && stkAtomPriceFinal > 0
      ? {
          price: stkAtomPriceFinal,
          source: stkAtomSource,
          timestamp: now,
          confidence: stkAtomSource === 'defillama' || stkAtomSource === 'coingecko' ? 'high' : stkAtomSource === 'osmosis' ? 'medium' : 'low',
        }
      : null,
    stkXPRT: stkXprtPriceFinal && stkXprtPriceFinal > 0
      ? {
          price: stkXprtPriceFinal,
          source: stkXprtSource,
          timestamp: now,
          confidence: stkXprtSource === 'defillama' || stkXprtSource === 'coingecko' ? 'high' : stkXprtSource === 'osmosis' ? 'medium' : 'low',
        }
      : null,
    stkOSMO: stkOsmoPriceFinal && stkOsmoPriceFinal > 0
      ? {
          price: stkOsmoPriceFinal,
          source: stkOsmoSource,
          timestamp: now,
          confidence: stkOsmoSource === 'defillama' || stkOsmoSource === 'coingecko' ? 'high' : stkOsmoSource === 'osmosis' ? 'medium' : 'low',
        }
      : null,
    pSTAKEBTC: pstakeBtcPriceFinal && pstakeBtcPriceFinal > 0
      ? {
          price: pstakeBtcPriceFinal,
          source: pstakeBtcSource,
          timestamp: now,
          confidence: pstakeBtcSource === 'defillama' || pstakeBtcSource === 'coingecko' ? 'high' : pstakeBtcSource === 'osmosis' ? 'medium' : 'low',
        }
      : null,
  }

  // Compile APY data from DeFiLlama
  const apys: Partial<Record<keyof Omit<LSTPriceData, 'TFUEL' | 'USDC'>, number>> = {
    ...(defiLlamaApys.stkTIA && { stkTIA: defiLlamaApys.stkTIA }),
    ...(defiLlamaApys.stkATOM && { stkATOM: defiLlamaApys.stkATOM }),
    ...(defiLlamaApys.stkXPRT && { stkXPRT: defiLlamaApys.stkXPRT }),
    ...(defiLlamaApys.stkOSMO && { stkOSMO: defiLlamaApys.stkOSMO }),
    ...(defiLlamaApys.pSTAKEBTC && { pSTAKEBTC: defiLlamaApys.pSTAKEBTC }),
  }

  const result: LSTPriceAndAPYData = { prices, apys }

  // Update cache
  priceCache = {
    data: result,
    timestamp: now,
  }

  console.log('✅ Prices + APYs fetched and cached')

  return result
}

/**
 * Calculate swap output based on real prices
 */
export async function calculateSwapOutput(
  tfuelAmount: number,
  targetLST: 'stkTIA' | 'stkATOM' | 'stkXPRT' | 'pSTAKE BTC' | 'stkOSMO',
  feePercent: number = 5
): Promise<number> {
  try {
    const data = await getLSTPrices(true) // Force fresh prices
    const prices = data.prices

    const tfuelPrice = prices.TFUEL?.price
    const lstPrice = targetLST === 'stkTIA'
      ? prices.stkTIA?.price
      : targetLST === 'stkATOM'
      ? prices.stkATOM?.price
      : targetLST === 'stkXPRT'
      ? prices.stkXPRT?.price
      : targetLST === 'stkOSMO'
      ? prices.stkOSMO?.price
      : prices.pSTAKEBTC?.price

    if (!tfuelPrice || tfuelPrice <= 0 || !lstPrice || lstPrice <= 0) {
      throw new Error('Price data unavailable')
    }

    const usdValue = tfuelAmount * tfuelPrice
    const lstAmount = (usdValue / lstPrice) * (1 - feePercent / 100)

    return lstAmount
  } catch (error) {
    console.error('❌ Error calculating swap output:', error)
    throw error
  }
}

