/**
 * Global Price & APY Store (Zustand)
 * Pre-fetches prices/APYs on app init, stores in global state
 * Parallel fetch all sources (DeFiLlama + Osmosis + CoinGecko)
 * Background refresh every 30s - UI never blocks, instant from cache
 */

import { create } from 'zustand'
import { getLSTPrices, type LSTPriceData, type LSTPriceAndAPYData } from '../utils/oracle'
import { getLSTAPYs, getBestYieldLST, type LSTAPY } from '../utils/apyFetcher'

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

  // Actions
  fetchPrices: (force?: boolean, background?: boolean) => Promise<void>
  fetchAPYs: (force?: boolean) => Promise<void>
  initialize: () => Promise<void>
}

export const usePriceStore = create<PriceStoreState>((set, get) => {
  let refreshInterval: NodeJS.Timeout | null = null

  return {
    // Initial state
    prices: null,
    pricesLoading: false,
    pricesError: null,
    pricesLastUpdated: null,
    isInitialLoad: true, // First load

    apys: {},
    bestYieldLST: '',
    apysLoading: false,
    apysError: null,
    apysLastUpdated: null,

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
        
        set({
          prices,
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
          // Background refresh failed - just log, don't update UI state
          console.warn('⚠️ Background price refresh failed, using cached data')
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
    initialize: async () => {
      console.log('🚀 Initializing price store with parallel fetch...')
      
      // PARALLEL: Fire off both fetches simultaneously (don't block each other)
      // These return instantly from cache if available, fetch in parallel if not
      const startTime = Date.now()
      await Promise.all([
        get().fetchPrices(false), // Primary: DeFiLlama + Osmosis + CoinGecko (parallel)
        get().fetchAPYs(false),   // APY data from yields API
      ]).then(() => {
        const elapsed = Date.now() - startTime
        console.log(`✅ Price store initialized in ${elapsed}ms (instant from cache or fresh parallel fetch)`)
      }).catch((err) => {
        console.warn('⚠️ Price initialization partially failed, will retry in background:', err)
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

