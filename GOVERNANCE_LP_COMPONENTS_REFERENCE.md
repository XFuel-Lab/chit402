# Governance & LP Flywheel Components Reference

## Quick Reference for @XFuelLab Hybrid dApp

### 🏛️ GovernanceTab Component

**Location**: `src/components/GovernanceTab.tsx`

**Props**:
```typescript
interface Props {
  userAddress: string | null         // User's wallet address
  veXFBalance: number                // veXF governance token balance
  rXFBalance: number                 // rXF reward token balance (4× voting boost)
  onVote: (pollId: number, optionId: number) => Promise<void>
  onToggleMaintenance?: () => void   // Optional admin function
  isMaintenanceMode?: boolean        // Maintenance state
}
```

**Features**:
- ✅ veXF-weighted voting (veXF + rXF * 4)
- ✅ Quarterly polls for 5-10% LP revenue extras
- ✅ Multiple poll categories:
  - **Bonus**: LP revenue distribution
  - **Treasury**: Protocol fund allocation
  - **Milestones**: Community achievement rewards
- ✅ Poll options examples:
  - Extra XF Burns (supply reduction)
  - Additional LP Funding (liquidity deepening)
  - NFT Airdrops (milestone rewards)
  - 2x rXF rewards (voter incentives)
  - Treasury buyback & burn
- ✅ Real-time results with percentages
- ✅ 5% rXF bonus for voting
- ✅ Vote history tracking
- ✅ Active/Ended poll filtering
- ✅ Confetti celebration on vote
- ✅ Maintenance toggle (admin only)

**Usage in App**:
```typescript
<GovernanceTab
  userAddress={wallet.fullAddress}
  veXFBalance={veXFBalance}
  rXFBalance={rXFBalance}
  onVote={async (pollId, optionId) => {
    // Call governance contract
    console.log('Vote submitted:', { pollId, optionId })
  }}
  onToggleMaintenance={() => {
    // Admin function to toggle maintenance mode
  }}
  isMaintenanceMode={false}
/>
```

**Sample Polls**:
1. **Q1 2026 LP Bonus Distribution**
   - Extra XF Burns (42.3%)
   - Additional LP Funding (33.1%)
   - NFT Airdrops (24.6%)
   
2. **Milestone Bonus: 100M TVL Achievement**
   - Legendary NFT Airdrop (51.2%)
   - 2x rXF rewards for 30 days (31.9%)
   - Treasury buyback & burn (16.9%)

3. **Q4 2025 Results - LP Reinvestment Rate** (Ended)
   - 70% LP Reinvestment ✅ (67.5%)
   - 50/50 split (22.1%)
   - 30% LP / 70% treasury (10.4%)

---

### 🔄 LPFlywheelCard Component

**Location**: `src/components/LPFlywheelCard.tsx`

**Props**:
```typescript
interface Props {
  userAddress: string | null
  onAddLiquidity: (poolId: string, amount: number) => Promise<void>
  onClaimRewards: (poolId: string) => Promise<void>
}
```

**Features**:
- ✅ Multiple LP pools display:
  - USDC/XPRT (32.5% APY, $2.4M TVL)
  - TFUEL/XPRT (28.7% APY, $1.8M TVL)
  - USDC/ATOM (24.3% APY, $3.1M TVL)
- ✅ 70% fee reinvestment (auto-compound)
- ✅ 30% treasury allocation
- ✅ TVL & 24h volume stats
- ✅ User liquidity tracking
- ✅ Earnings display & claim
- ✅ Add liquidity UI
- ✅ Rebalance history feed
- ✅ Educational "How it Works" section

**Usage in App**:
```typescript
<LPFlywheelCard
  userAddress={wallet.fullAddress}
  onAddLiquidity={async (poolId, amount) => {
    // Call LP deposit contract
    console.log('Add liquidity:', { poolId, amount })
  }}
  onClaimRewards={async (poolId) => {
    // Call LP rewards claim contract
    console.log('Claim rewards:', { poolId })
  }}
/>
```

**LP Pools Data**:
```typescript
const LP_POOLS = [
  {
    id: 'usdc-xprt',
    name: 'USDC/XPRT',
    tvl: 2_456_789,
    apy: 32.5,
    volume24h: 187_543
  },
  // ... more pools
]
```

**How LP Flywheel Works**:
1. Protocol collects 0.3% fees from swaps
2. 70% of fees auto-reinvested into LP pools
3. Deeper liquidity → lower slippage → more volume → more fees
4. 30% goes to treasury for ecosystem development

---

### 🗺️ Routing Structure

**Routes** (via React Router):
```
/               → Swap page (home)
/swap           → Swap page
/staking        → Yield Pump (single-sided TFUEL staking)
/governance     → Governance tab (veXF voting)
/liquidity      → LP Flywheel tab (liquidity pools)
/profile        → User profile
/institutions   → Institutions portal
/liquidity-dashboard → Liquidity dashboard
```

**Navigation in Components**:
```typescript
import { useNavigate } from 'react-router-dom'

const navigate = useNavigate()
navigate('/governance')  // Go to governance
navigate('/liquidity')   // Go to LP pools
```

---

### 🎨 UI Components Used

**Shared Components**:
- `GlassCard` - Glassmorphic card container
- `NeonButton` - Neon-styled action buttons
- `ApyOrb` - Animated APY display orb
- `NeonTabs` - Tab navigation bar

**Tab Navigation**:
```typescript
<NeonTabs
  activeId={activeTab}
  onChange={(id) => navigate(id === 'swap' ? '/' : `/${id}`)}
  tabs={[
    { id: 'swap', label: 'Swap', pill: 'live' },
    { id: 'staking', label: 'Yield Pump', pill: 'apy lanes' },
    { id: 'governance', label: 'Governance', pill: 'veXF' },
    { id: 'liquidity', label: 'LP Pools', pill: 'flywheel' },
    { id: 'profile', label: 'Profile', pill: 'wallet' },
  ]}
/>
```

---

### 📊 State Management

**Governance State** (in App.tsx):
```typescript
const [veXFBalance, setVeXFBalance] = useState<number>(0)
const [rXFBalance, setRXFBalance] = useState<number>(0)

// Load balances when wallet connects
useEffect(() => {
  if (wallet.fullAddress) {
    // In production: fetch from governance contract
    // Mock: setVeXFBalance(10000), setRXFBalance(5000)
  }
}, [wallet.fullAddress])
```

**Voting Power Calculation**:
```typescript
const totalVotingPower = veXFBalance + rXFBalance * 4
// Example: 10,000 veXF + 5,000 rXF * 4 = 30,000 voting power
```

---

### 🔐 Contract Integration Points

**Governance Contract Calls**:
```typescript
// Vote on poll
onVote={async (pollId, optionId) => {
  const governanceContract = new ethers.Contract(
    GOVERNANCE_ADDRESS,
    GOVERNANCE_ABI,
    signer
  )
  await governanceContract.vote(pollId, optionId)
}}
```

**LP Contract Calls**:
```typescript
// Add liquidity
onAddLiquidity={async (poolId, amount) => {
  const lpContract = new ethers.Contract(
    LP_POOL_ADDRESS,
    LP_POOL_ABI,
    signer
  )
  await lpContract.addLiquidity(poolId, amount)
}}

// Claim rewards
onClaimRewards={async (poolId) => {
  const lpContract = new ethers.Contract(
    LP_POOL_ADDRESS,
    LP_POOL_ABI,
    signer
  )
  await lpContract.claimRewards(poolId)
}}
```

---

### 🎯 Key Features Summary

| Feature | Component | Status |
|---------|-----------|--------|
| veXF-weighted voting | GovernanceTab | ✅ Implemented |
| Quarterly polls (5-10% LP rev) | GovernanceTab | ✅ Implemented |
| Poll options (burns/funding/NFTs) | GovernanceTab | ✅ Implemented |
| Results display | GovernanceTab | ✅ Implemented |
| rXF bonuses for voters | GovernanceTab | ✅ Implemented |
| Milestone rewards | GovernanceTab | ✅ Implemented |
| USDC/XPRT pools | LPFlywheelCard | ✅ Implemented |
| 70% reinvestment | LPFlywheelCard | ✅ Implemented |
| LP flywheel display | LPFlywheelCard | ✅ Implemented |
| React Router integration | App.tsx | ✅ Implemented |
| QR deposits | SimpleSwapCard | ✅ Preserved |
| Swap page | SimpleSwapCard | ✅ Preserved |
| Maintenance toggle | GovernanceTab | ✅ Implemented |

---

### 🚀 Deployment Ready

**Build Command**:
```bash
npm run build
# ✓ Built in 43.90s
# dist/index.html (5.52 kB)
# dist/assets/index.css (145.26 kB)
# dist/assets/index.js (2,355.64 kB)
```

**Dev Server**:
```bash
npm run dev
# Vite dev server running at http://localhost:5173
```

**Test Routes**:
- http://localhost:5173/
- http://localhost:5173/governance
- http://localhost:5173/liquidity
- http://localhost:5173/staking
- http://localhost:5173/profile

---

### 📱 Mobile Responsive

All components are fully responsive:
- Governance polls: Stack on mobile
- LP pools: Grid → vertical stack
- Tab navigation: Horizontal scroll on mobile
- QR codes: Optimized for mobile scanning

---

### 🎨 Theme & Styling

**Color Scheme**:
- Purple gradient: `from-purple-500 to-pink-500` (governance)
- Cyan gradient: `from-cyan-500 to-blue-500` (treasury)
- Orange gradient: `from-yellow-500 to-orange-500` (milestones)
- Green: Success states, active polls
- Slate: Text, borders

**Glassmorphism**:
- Background: `bg-black/40 backdrop-blur-xl`
- Borders: `border-white/10`
- Shadows: `shadow-[0_0_30px_rgba(...)]`

---

### ✅ Testing Checklist

- [x] Build passes
- [x] Routes defined
- [x] Tab navigation works
- [x] Governance features verified
- [x] LP Flywheel features verified
- [x] Components responsive
- [x] QR deposits preserved
- [ ] E2E navigation test
- [ ] Contract integration test (production)

---

### 📝 Notes

- Governance polls currently use mock data (GOVERNANCE_POLLS constant)
- LP pools use mock data (LP_POOLS constant)
- In production, fetch from contracts or backend API
- Vote submission requires wallet connection
- rXF bonus calculated as 5% of voting power
- Maintenance toggle only visible with `onToggleMaintenance` prop



