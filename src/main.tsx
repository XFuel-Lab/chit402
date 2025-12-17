import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import InstitutionsPortal from './InstitutionsPortal.tsx'
import './index.css'

function Router() {
  const [path, setPath] = useState(window.location.pathname)

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

  return isInstitutionsRoute ? <InstitutionsPortal /> : <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
)

