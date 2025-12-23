import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import InstitutionsPortal from './InstitutionsPortal.tsx'
import LiquidityDashboard from './LiquidityDashboard.tsx'
import './index.css'
import { usePriceStore } from './stores/priceStore'

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

  if (isInstitutionsRoute) return <InstitutionsPortal />
  if (isLiquidityRoute) return <LiquidityDashboard />
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
)

