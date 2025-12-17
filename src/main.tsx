import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import InstitutionsPortal from './InstitutionsPortal.tsx'
import './index.css'

const path = window.location.pathname
const isInstitutionsRoute = path === '/institutions' || path === '/institutions/'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isInstitutionsRoute ? <InstitutionsPortal /> : <App />}
  </React.StrictMode>,
)

