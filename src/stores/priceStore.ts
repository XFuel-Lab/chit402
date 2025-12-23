/**
 * Global Price & APY Store (Zustand)
 * Pre-fetches prices/APYs on app init, stores in global state
 * Parallel fetch all sources (DeFiLlama + Osmosis + CoinGecko)
 * Background refresh every 30s - UI never blocks, instant from cache
 */

import { create } from 'zustand'
import { getLSTPrices, type LSTPriceData, type LSTPriceAndAPYData, type TokenPrice } from '../utils/oracle'
import { getLSTAPYs, getBestYieldLST, type LSTAPY } from '../utils/apyFetcher'

/**
 * INSTANT FALLBACK PRICES
 * Used for immediate UI display while real prices load in background
 * Updated periodically to reflect recent market prices
 * Last updated: 2024-01-20
 */
const INSTANT_FALLBACK_PRICES: LSTPriceData = {
  TFUEL: {
    price: 0.062,
    source: 'fallback',
    timestamp: Date.now(),
    confidence: 'low',
  },
  USDC: {
    price: 1.0,
    source: 'fallback',
    timestamp: Date.now(),
    confidence: 'high', // USDC is always $1.00
  },
  stkTIA: {
    price: 4.85,
    source: 'fallback',
    timestamp: Date.now(),
    confidence: 'low',
  },
  stkATOM: {
    price: 6.42,
    source: 'fallback',
    timestamp: Date.now(),
    confidence: 'low',
  },
  stkXPRT: {
    price: 0.28,
    source: 'fallback',
    timestamp: Date.now(),
    confidence: 'low',
  },
  pSTAKEBTC: {
    price: 97800,
    source: 'fallback',
    timestamp: Date.now(),
    confidence: 'low',
  },
  stkOSMO: {
    price: 0.52,
    source: 'fallback',
    timestamp: Date.now(),
    confidence: 'low',
  },
}

// INSTANT FALLBACK APYs - Only for immediate display, replaced by real data from DeFiLlama
const INSTANT_FALLBACK_APYS: Record<string, LSTAPY> = {
  stkTIA: { name: 'stkTIA', apy: 0, source: 'hardcoded', timestamp: Date.now() },
  stkATOM: { name: 'stkATOM', apy: 0, source: 'hardcoded', timestamp: Date.now() },
  stkXPRT: { name: 'stkXPRT', apy: 0, source: 'hardcoded', timestamp: Date.now() },
  'pSTAKE BTC': { name: 'pSTAKE BTC', apy: 0, source: 'hardcoded', timestamp: Date.now() },
  stkOSMO: { name: 'stkOSMO', apy: 0, source: 'hardcoded', timestamp: Date.now() },
}

interface PriceStoreState {
  // Price data
  prices: LSTPriceData | null
  pricesLoading: boolean
  pricesError: string | null
  pricesLastUpdated: number | null
  isInitialLoad: boolean // Track if this is first load (show spinner only then)

  // APY data
  apys: Record<string, LSTAPY>
  bestYieldLST: string
  apysLoading: boolean
  apysError: string | null
  apysLastUpdated: number | null

  // Helpers
  isPriceStale: (maxAgeMs?: number) => boolean // Check if prices are getting old

  // Actions
  fetchPrices: (force?: boolean, background?: boolean) => Promise<void>
  fetchAPYs: (force?: boolean) => Promise<void>
  initialize: () => Promise<void>
}

export const usePriceStore = create<PriceStoreState>((set, get) => {
  let refreshInterval: NodeJS.Timeout | null = null

  return {
    // Initial state - INSTANT DISPLAY with hardcoded fallbacks
    prices: INSTANT_FALLBACK_PRICES,
    pricesLoading: false,
    pricesError: null,
    pricesLastUpdated: Date.now(),
    isInitialLoad: true, // First load

    apys: INSTANT_FALLBACK_APYS,
    bestYieldLST: 'stkTIA',
    apysLoading: false,
    apysError: null,
    apysLastUpdated: Date.now(),

    // Helper to check if prices are stale (default: 2 minutes)
    isPriceStale: (maxAgeMs = 120000) => {
      const state = get()
      if (!state.pricesLastUpdated) return false
      return Date.now() - state.pricesLastUpdated > maxAgeMs
    },

    // Fetch prices + APYs (instant from cache, refresh in background)
    fetchPrices: async (force = false, background = false) => {
      const state = get()
      
      // Return cached data instantly if available and not forcing refresh
      if (!force && state.prices && state.pricesLastUpdated) {
        const age = Date.now() - state.pricesLastUpdated
        // If cache is fresh (<30s), return immediately and refresh in background if >10s
        if (age < 30000) {
          if (age > 10000) {
            // Background refresh (fire and forget) - mark as background to prevent loading state
            get().fetchPrices(true, true).catch(() => {})
          }
          return // Instant return from cache
        }
      }

      // Only set loading state if NOT a background refresh (prevents UI flicker)
      if (!background) {
        set({ pricesLoading: true, pricesError: null })
      }

      try {
        const data = await getLSTPrices(force)
        
        // Extract prices and APYs from oracle response (APYs from DeFiLlama)
        const prices = data.prices
        const defiLlamaApys = data.apys
        
        // Merge DeFiLlama APYs with existing APY data (if any)
        // DeFiLlama APYs take priority over hardcoded ones
        const currentApys = get().apys
        const mergedApys: Record<string, LSTAPY> = { ...currentApys }
        
        if (defiLlamaApys.stkTIA) {
          mergedApys['stkTIA'] = {
            name: 'stkTIA',
            apy: defiLlamaApys.stkTIA,
            source: 'stride',
            timestamp: Date.now(),
          }
        }
        if (defiLlamaApys.stkATOM) {
          mergedApys['stkATOM'] = {
            name: 'stkATOM',
            apy: defiLlamaApys.stkATOM,
            source: 'stride',
            timestamp: Date.now(),
          }
        }
        if (defiLlamaApys.stkXPRT) {
          mergedApys['stkXPRT'] = {
            name: 'stkXPRT',
            apy: defiLlamaApys.stkXPRT,
            source: 'stride',
            timestamp: Date.now(),
          }
        }
        if (defiLlamaApys.stkOSMO) {
          mergedApys['stkOSMO'] = {
            name: 'stkOSMO',
            apy: defiLlamaApys.stkOSMO,
            source: 'stride',
            timestamp: Date.now(),
          }
        }
        if (defiLlamaApys.pSTAKEBTC) {
          mergedApys['pSTAKE BTC'] = {
            name: 'pSTAKE BTC',
            apy: defiLlamaApys.pSTAKEBTC,
            source: 'stride',
            timestamp: Date.now(),
          }
        }
        
        // MERGE prices: Keep last known good prices for any failed fetches
        // This prevents UI from showing "unavailable" during background refresh
        // Top swaps (Uniswap, 1inch) use this pattern
        const currentPrices = get().prices
        const mergedPrices: LSTPriceData = {
          TFUEL: prices.TFUEL || currentPrices?.TFUEL || INSTANT_FALLBACK_PRICES.TFUEL,
          USDC: prices.USDC || currentPrices?.USDC || INSTANT_FALLBACK_PRICES.USDC,
          stkTIA: prices.stkTIA || currentPrices?.stkTIA || INSTANT_FALLBACK_PRICES.stkTIA,
          stkATOM: prices.stkATOM || currentPrices?.stkATOM || INSTANT_FALLBACK_PRICES.stkATOM,
          stkXPRT: prices.stkXPRT || currentPrices?.stkXPRT || INSTANT_FALLBACK_PRICES.stkXPRT,
          pSTAKEBTC: prices.pSTAKEBTC || currentPrices?.pSTAKEBTC || INSTANT_FALLBACK_PRICES.pSTAKEBTC,
          stkOSMO: prices.stkOSMO || currentPrices?.stkOSMO || INSTANT_FALLBACK_PRICES.stkOSMO,
        }
        
        set({
          prices: mergedPrices, // Use merged prices (never null)
          apys: mergedApys,
          pricesLoading: false,
          pricesError: null,
          pricesLastUpdated: Date.now(),
          isInitialLoad: false, // No longer initial load after first successful fetch
          // Also update APY timestamp if we got APYs from oracle
          ...(Object.keys(defiLlamaApys).length > 0 && { apysLastUpdated: Date.now() }),
        })
      } catch (error) {
        console.error('❌ Error fetching prices:', error)
        // Only update loading state if not background refresh
        if (!background) {
          set({
            pricesLoading: false,
            pricesError: error instanceof Error ? error.message : 'Failed to fetch prices',
            isInitialLoad: false,
          })
        } else {
          // Background refresh failed - keep existing prices, don't touch UI
          console.warn('⚠️ Background price refresh failed, keeping last known good prices visible')
        }
      }
    },

    // Fetch APYs
    fetchAPYs: async (force = false) => {
      const state = get()
      
      // Return cached data instantly if available
      if (!force && Object.keys(state.apys).length > 0 && state.apysLastUpdated) {
        const age = Date.now() - state.apysLastUpdated
        if (age < 300000) { // 5 minutes cache for APYs
          return // Instant return from cache
        }
      }

      set({ apysLoading: true, apysError: null })

      try {
        const [apys, bestYield] = await Promise.all([
          getLSTAPYs(),
          getBestYieldLST(),
        ])

        set({
          apys,
          bestYieldLST: bestYield,
          apysLoading: false,
          apysError: null,
          apysLastUpdated: Date.now(),
        })
      } catch (error) {
        console.error('❌ Error fetching APYs:', error)
        set({
          apysLoading: false,
          apysError: error instanceof Error ? error.message : 'Failed to fetch APYs',
        })
      }
    },

    // Initialize store (pre-fetch on app init)
    // UI displays INSTANTLY with hardcoded fallbacks, then updates with real data
    initialize: async () => {
      console.log('⚡ UI ready with instant fallback prices, fetching live data in background...')
      
      // NON-BLOCKING: Fire and forget - UI already has fallback prices
      // Use allSettled to prevent any slow API from blocking others
      const startTime = Date.now()
      
      // Don't await - let UI be instant, update in background
      Promise.allSettled([
        get().fetchPrices(true, true), // Force refresh, background mode
        get().fetchAPYs(true),          // APY data from yields API
      ]).then((results) => {
        const elapsed = Date.now() - startTime
        const pricesResult = results[0]
        const apysResult = results[1]
        
        if (pricesResult.status === 'fulfilled') {
          console.log(`✅ Live prices loaded in ${elapsed}ms (updated from oracles)`)
        } else {
          console.warn(`⚠️ Price fetch failed, using fallback: ${pricesResult.reason}`)
        }
        
        if (apysResult.status === 'rejected') {
          console.warn(`⚠️ APY fetch failed, using fallback: ${apysResult.reason}`)
        }
      })

      // Set up background refresh every 30s (non-blocking)
      if (refreshInterval) {
        clearInterval(refreshInterval)
      }

      refreshInterval = setInterval(() => {
        // Background refresh - fire and forget, UI stays instant
        // Pass background=true to prevent loading state
        get().fetchPrices(true, true).catch(() => {})
        // APYs refresh every 5 minutes (less frequent updates)
        const state = get()
        if (!state.apysLastUpdated || Date.now() - state.apysLastUpdated > 300000) {
          get().fetchAPYs(true).catch(() => {})
        }
      }, 30000) // 30 seconds - reliable background refresh
    },
  }
})

