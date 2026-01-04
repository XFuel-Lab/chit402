# XFUEL React Router Configuration

## Route Structure

```
/                     → App (Swap/Governance/LP Pools/Profile)
├── /governance       → App with governance tab active
├── /liquidity        → LiquidityDashboard (legacy)
└── /institutions     → InstitutionsPortal
```

## Router Implementation

### `src/main.tsx`
```tsx
function Router() {
  const [path, setPath] = useState(window.location.pathname)

  // Pre-fetch global LST + TFUEL prices/APYs on app init
  const initializePrices = usePriceStore((state) => state.initialize)

  useEffect(() => {
    void initializePrices()
  }, [initializePrices])

  useEffect(() => {
    const handleLocationChange = () => {
      setPath(window.location.pathname)
    }

    window.addEventListener('popstate', handleLocationChange)

    const checkPath = () => {
      if (window.location.pathname !== path) {
        setPath(window.location.pathname)
      }
    }

    const interval = setInterval(checkPath, 100)

    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      clearInterval(interval)
    }
  }, [path])

  const isInstitutionsRoute = path === '/institutions' || path === '/institutions/'
  const isLiquidityRoute = path === '/liquidity' || path === '/liquidity/'
  const isGovernanceRoute = path === '/governance' || path === '/governance/'

  return (
    <>
      <div>
        {isInstitutionsRoute ? (
          <InstitutionsPortal />
        ) : isLiquidityRoute ? (
          <LiquidityDashboard />
        ) : isGovernanceRoute ? (
          <App />  // Renders with governance tab
        ) : (
          <App />  // Renders with default (swap) tab
        )}
      </div>
    </>
  )
}
```

## Tab-Based Navigation (Within App)

### `src/App.tsx` Tab Configuration
```tsx
const tabs = [
  { id: 'swap', label: 'Swap', pill: 'live' },
  { id: 'staking', label: 'Yield Pump', pill: 'apy lanes' },
  { id: 'governance', label: 'Governance', pill: 'veXF' },      // NEW
  { id: 'liquidity', label: 'LP Pools', pill: 'flywheel' },    // NEW
  { id: 'profile', label: 'Profile', pill: 'wallet' },
]

const validTabs: NeonTabId[] = [
  'swap', 
  'staking', 
  'governance',   // NEW
  'liquidity',    // NEW
  'profile'
]
```

### Tab Content Mapping
```tsx
{activeTab === 'swap' && <SimpleSwapCard />}
{activeTab === 'staking' && <YieldPumpCard />}
{activeTab === 'governance' && <GovernanceTab />}     // NEW
{activeTab === 'liquidity' && <LPFlywheelCard />}    // NEW
{activeTab === 'profile' && <ProfileView />}
```

## Navigation Methods

### 1. URL-Based Navigation (Full Page Load)
```typescript
// Navigate to governance route
window.location.href = '/governance'

// Navigate to institutions portal
window.location.href = '/institutions'

// Navigate to legacy liquidity dashboard
window.location.href = '/liquidity'

// Navigate to main app
window.location.href = '/'
```

### 2. Tab-Based Navigation (Within App, No Reload)
```tsx
// Change active tab
setActiveTab('governance')
setActiveTab('liquidity')
setActiveTab('swap')
```

### 3. Programmatic Navigation
```tsx
// From any component
const navigate = (tabId: NeonTabId) => {
  setActiveTab(tabId)
}

// Example usage
<button onClick={() => navigate('governance')}>
  Go to Governance
</button>
```

## URL Handling

### Current Implementation
- **Custom Router**: Simple path-based routing with `window.location.pathname`
- **Tab State**: Managed by React state (`activeTab`)
- **Polling**: 100ms interval to detect path changes
- **PopState**: Handles browser back/forward buttons

### Benefits
- No external router dependency
- Lightweight and fast
- Easy to understand
- Works with server-side rendering

### Limitations
- No nested routes
- No route parameters
- No route guards
- Manual URL sync for tabs

## Upgrading to React Router (Future)

If you want to add React Router in the future:

### Install
```bash
npm install react-router-dom
```

### Update `main.tsx`
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'

function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/governance" element={<App defaultTab="governance" />} />
        <Route path="/liquidity" element={<LiquidityDashboard />} />
        <Route path="/institutions" element={<InstitutionsPortal />} />
      </Routes>
    </BrowserRouter>
  )
}
```

### Update `App.tsx` for URL Sync
```tsx
import { useSearchParams } from 'react-router-dom'

function App({ defaultTab = 'swap' }: { defaultTab?: NeonTabId }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlTab = searchParams.get('tab') as NeonTabId | null
  const [activeTab, setActiveTab] = useState<NeonTabId>(urlTab || defaultTab)

  const handleTabChange = (id: NeonTabId) => {
    setActiveTab(id)
    setSearchParams({ tab: id })
  }

  // ... rest of component
}
```

## Deep Linking Examples

### With Current Router
```
https://xfuel.app/                    → Swap tab
https://xfuel.app/governance          → Main app (governance URL)
https://xfuel.app/institutions        → Institutions portal
https://xfuel.app/liquidity           → Legacy liquidity dashboard
```

### With React Router (Future)
```
https://xfuel.app/?tab=swap           → Swap tab
https://xfuel.app/?tab=governance     → Governance tab
https://xfuel.app/?tab=liquidity      → LP Pools tab
https://xfuel.app/institutions        → Institutions portal
```

## State Management

### Global State (Zustand)
```tsx
// src/stores/priceStore.ts
- prices: Record<string, PriceData>
- apys: Record<string, number>
- initialize: () => Promise<void>
```

### Local State (App.tsx)
```tsx
- activeTab: NeonTabId
- wallet: WalletInfo
- veXFBalance: number
- rXFBalance: number
- selectedLST: LSTOption
// ... etc
```

### Component State
```tsx
// GovernanceTab.tsx
- selectedPollId: number | null
- voteHistory: VoteRecord[]
- filterStatus: 'all' | 'active' | 'ended'

// LPFlywheelCard.tsx
- selectedPool: string | null
- depositAmount: string
- rebalanceHistory: RebalanceRecord[]
```

## Browser History

### Back Button Support
```tsx
// Handled by popstate listener
window.addEventListener('popstate', handleLocationChange)

// User clicks back
// → Path changes
// → Router detects change
// → Renders appropriate component
```

### Forward Button Support
Same as back button - handled by popstate

### Refresh Behavior
- Current path preserved
- State resets (no persistence)
- Prices refetched via Zustand store

## SEO Considerations

### Meta Tags (index.html)
```html
<meta name="description" content="XFUEL Protocol - Governance & LP Pools" />
<meta property="og:title" content="XFUEL - veXF Governance" />
<meta property="og:url" content="https://xfuel.app/governance" />
```

### Dynamic Meta Tags (Future)
Use React Helmet or similar to update meta tags per route

## Performance

### Code Splitting
```tsx
// Lazy load routes (future optimization)
import { lazy, Suspense } from 'react'

const GovernanceTab = lazy(() => import('./components/GovernanceTab'))
const LPFlywheelCard = lazy(() => import('./components/LPFlywheelCard'))

// In component
<Suspense fallback={<LoadingSkeleton />}>
  {activeTab === 'governance' && <GovernanceTab />}
</Suspense>
```

### Route Prefetching
```tsx
// Prefetch governance data when hovering over tab
<button
  onMouseEnter={() => prefetchGovernanceData()}
  onClick={() => setActiveTab('governance')}
>
  Governance
</button>
```

## Testing Routes

### Manual Testing
1. Navigate to `/governance` → Should show App with governance content
2. Click tabs → Should switch content without page reload
3. Refresh on governance tab → Should stay on governance
4. Browser back/forward → Should navigate correctly

### Automated Testing (Cypress)
```typescript
// cypress/e2e/governance-routing.cy.ts
describe('Governance Routing', () => {
  it('should navigate to governance page', () => {
    cy.visit('/governance')
    cy.contains('veXF Governance').should('be.visible')
  })

  it('should switch to governance tab', () => {
    cy.visit('/')
    cy.contains('Governance').click()
    cy.url().should('include', '/')
    cy.contains('Your Voting Power').should('be.visible')
  })
})
```

---

## Summary

✅ **Current Router**: Simple, custom implementation  
✅ **Tab Navigation**: React state-based  
✅ **URL Paths**: `/`, `/governance`, `/liquidity`, `/institutions`  
✅ **Browser History**: Supported via popstate  
✅ **Performance**: Fast, no external dependencies  

🔮 **Future Upgrades**: Consider React Router for advanced routing needs

For questions: xfuel.support@xfuel.app



