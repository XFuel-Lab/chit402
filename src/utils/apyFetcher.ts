/**
 * APY Fetcher for LST Tokens
 * Fetches real-time APY from Stride API as fallback (DeFiLlama is primary in oracle.ts)
 * This serves as a secondary source when DeFiLlama APYs are unavailable
 */

export interface LSTAPY {
  name: string
  apy: number
  source: 'stride' | 'quicksilver' | 'hardcoded'
  timestamp: number
}

// Cache APY for 5 minutes
const APY_CACHE_TTL = 5 * 60 * 1000
let apyCache: {
  data: Record<string, LSTAPY> | null
  timestamp: number
} = {
  data: null,
  timestamp: 0,
}

/**
 * Fetch stkTIA APY from Stride API
 */
async function fetchStrideStkTIAAPY(): Promise<number | null> {
  try {
    // Stride API endpoint for stkTIA APY
    const response = await fetch('https://stride-api.polkachu.com/stride/stakeibc/host_zone', {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Stride API error: ${response.status}`)
    }

    const data = await response.json()
    // Find TIA host zone and extract APY
    const tiaZone = data.host_zone?.find((zone: any) => zone.chain_id === 'celestia')
    if (tiaZone?.redemption_rate) {
      // Convert redemption rate to approximate APY (simplified calculation)
      const rate = parseFloat(tiaZone.redemption_rate)
      // APY approximation: (rate - 1) * 365 * 100
      const apy = (rate - 1) * 365 * 100
      return Math.max(0, apy) // Ensure non-negative
    }
    return null
  } catch (error) {
    console.error('Error fetching stkTIA APY from Stride:', error)
    return null
  }
}

/**
 * Fetch stkATOM APY from Stride API
 */
async function fetchStrideStkATOMAPY(): Promise<number | null> {
  try {
    const response = await fetch('https://stride-api.polkachu.com/stride/stakeibc/host_zone', {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Stride API error: ${response.status}`)
    }

    const data = await response.json()
    // Find Cosmos Hub host zone
    const atomZone = data.host_zone?.find((zone: any) => zone.chain_id === 'cosmoshub-4')
    if (atomZone?.redemption_rate) {
      const rate = parseFloat(atomZone.redemption_rate)
      const apy = (rate - 1) * 365 * 100
      return Math.max(0, apy)
    }
    return null
  } catch (error) {
    console.error('Error fetching stkATOM APY from Stride:', error)
    return null
  }
}

/**
 * Get all LST APYs with fallbacks (secondary source)
 * Note: DeFiLlama yields API (primary) is fetched in oracle.ts
 * This provides Stride API as additional fallback + hardcoded values
 */
export async function getLSTAPYs(): Promise<Record<string, LSTAPY>> {
  // Check cache first
  const now = Date.now()
  if (apyCache.data && (now - apyCache.timestamp) < APY_CACHE_TTL) {
    console.log('⚡ Using cached APYs (apyFetcher fallback source)')
    return apyCache.data
  }

  console.log('🔄 Fetching APYs from Stride API (secondary source)...')

  // Fetch APYs in parallel
  const [stkTIAAPY, stkATOMAPY] = await Promise.all([
    fetchStrideStkTIAAPY(),
    fetchStrideStkATOMAPY(),
  ])

  // Hardcoded fallback APYs (used if all APIs fail)
  const hardcodedAPYs: Record<string, number> = {
    stkTIA: 38.2,
    stkATOM: 32.5,
    stkXPRT: 28.7,
    'pSTAKE BTC': 25.4,
    stkOSMO: 22.1,
  }

  console.log('✅ APY fetch complete (Stride API):', {
    stkTIA: stkTIAAPY || hardcodedAPYs.stkTIA,
    stkATOM: stkATOMAPY || hardcodedAPYs.stkATOM,
  })

  const apys: Record<string, LSTAPY> = {
    stkTIA: {
      name: 'stkTIA',
      apy: stkTIAAPY || hardcodedAPYs.stkTIA,
      source: stkTIAAPY ? 'stride' : 'hardcoded',
      timestamp: now,
    },
    stkATOM: {
      name: 'stkATOM',
      apy: stkATOMAPY || hardcodedAPYs.stkATOM,
      source: stkATOMAPY ? 'stride' : 'hardcoded',
      timestamp: now,
    },
    stkXPRT: {
      name: 'stkXPRT',
      apy: hardcodedAPYs.stkXPRT,
      source: 'hardcoded',
      timestamp: now,
    },
    'pSTAKE BTC': {
      name: 'pSTAKE BTC',
      apy: hardcodedAPYs['pSTAKE BTC'],
      source: 'hardcoded',
      timestamp: now,
    },
    stkOSMO: {
      name: 'stkOSMO',
      apy: hardcodedAPYs.stkOSMO,
      source: 'hardcoded',
      timestamp: now,
    },
  }

  // Update cache
  apyCache = {
    data: apys,
    timestamp: now,
  }

  return apys
}

/**
 * Get best yield LST option
 */
export async function getBestYieldLST(): Promise<string> {
  const apys = await getLSTAPYs()
  let bestLST = 'stkTIA'
  let bestAPY = 0

  for (const [name, data] of Object.entries(apys)) {
    if (data.apy > bestAPY) {
      bestAPY = data.apy
      bestLST = name
    }
  }

  return bestLST
}

