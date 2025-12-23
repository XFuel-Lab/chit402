import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import InstitutionsPortal from './InstitutionsPortal.tsx'
import LiquidityDashboard from './LiquidityDashboard.tsx'
import MainnetBanner from './components/MainnetBanner.tsx'
import './index.css'
import { usePriceStore } from './stores/priceStore'
import { suppressCrossOriginErrors } from './utils/consoleErrorSuppression'
import { logProductionCheck } from './utils/productionCheck'
import { initWebVitals, logWebVitals } from './utils/webVitals'

// Suppress console errors from cross-origin windows and MetaMask deprecation warnings
// This prevents CORS errors from Theta Wallet website and MetaMask warnings from cluttering the console
suppressCrossOriginErrors()

// Run production readiness check (only in development)
if (import.meta.env.DEV) {
  logProductionCheck()
}

// Initialize Web Vitals tracking
initWebVitals((metric) => {
  // Custom callback for analytics integration
  console.log('Web Vital:', metric.name, metric.value, metric.rating)
})

// Log Web Vitals summary on page unload (development only)
if (import.meta.env.DEV) {
  window.addEventListener('beforeunload', () => {
    logWebVitals()
  })
}

function Router() {
  const [path, setPath] = useState(window.location.pathname)

  // Pre-fetch global LST + TFUEL prices/APYs on app init.
  // This runs once when the router mounts (homepage, swap, institutions, etc.)
  const initializePrices = usePriceStore((state) => state.initialize)

  useEffect(() => {
    void initializePrices()
  }, [initializePrices])

  useEffect(() => {
    const handleLocationChange = () => {
      setPath(window.location.pathname)
    }

    // Listen for popstate (back/forward buttons)
    window.addEventListener('popstate', handleLocationChange)

    // Check pathname on mount and when it changes
    const checkPath = () => {
      if (window.location.pathname !== path) {
        setPath(window.location.pathname)
      }
    }

    // Check periodically (for programmatic navigation)
    const interval = setInterval(checkPath, 100)

    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      clearInterval(interval)
    }
  }, [path])

  const isInstitutionsRoute = path === '/institutions' || path === '/institutions/'
  const isLiquidityRoute = path === '/liquidity' || path === '/liquidity/'

  return (
    <>
      <MainnetBanner />
      <div className="pt-[52px] sm:pt-[56px]">
        {isInstitutionsRoute ? (
          <InstitutionsPortal />
        ) : isLiquidityRoute ? (
          <LiquidityDashboard />
        ) : (
          <App />
        )}
      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
)

