import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App.tsx'
import InstitutionsPortal from './InstitutionsPortal.tsx'
import LiquidityDashboard from './LiquidityDashboard.tsx'
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

function AppWrapper() {
  // Pre-fetch global LST + TFUEL prices/APYs on app init.
  // This runs once when the wrapper mounts
  const initializePrices = usePriceStore((state) => state.initialize)

  useEffect(() => {
    void initializePrices()
  }, [initializePrices])

  return (
    <BrowserRouter>
      <Routes>
        {/* Main app routes with tab navigation */}
        <Route path="/" element={<App initialTab="swap" />} />
        <Route path="/swap" element={<App initialTab="swap" />} />
        <Route path="/staking" element={<App initialTab="staking" />} />
        <Route path="/governance" element={<App initialTab="governance" />} />
        <Route path="/liquidity" element={<App initialTab="liquidity" />} />
        <Route path="/profile" element={<App initialTab="profile" />} />
        
        {/* Special portal routes */}
        <Route path="/institutions" element={<InstitutionsPortal />} />
        <Route path="/liquidity-dashboard" element={<LiquidityDashboard />} />
        
        {/* Catch-all redirect to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>,
)

