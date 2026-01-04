# XFUEL Governance & LP Flywheel - Quick Start Guide

## 🎯 What's New

### Governance Tab
Vote on quarterly LP revenue distribution (5-10% extras) using veXF-weighted voting power.

**Access**: Click "Governance" tab in main navigation

**Features**:
- Vote on polls (extra burns vs. LP funding vs. NFT airdrops)
- Earn 5% rXF bonus for voting
- View poll results in real-time
- Filter by active/ended polls
- Admin maintenance toggle

### LP Flywheel Tab
View and manage liquidity pools with auto-reinvestment.

**Access**: Click "LP Pools" tab in main navigation

**Features**:
- USDC/XPRT and TFUEL/XPRT pools
- 70% fee reinvestment into pools
- TVL, APY, and 24h volume display
- Add liquidity interface
- Claim rewards
- Recent rebalance activity

## 🚀 Running the App

```bash
# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## 📋 Component Overview

### New Components

#### `GovernanceTab.tsx`
```tsx
<GovernanceTab
  userAddress={string | null}
  veXFBalance={number}      // Vote-escrowed XF
  rXFBalance={number}        // Reward XF (4× boost)
  onVote={async (pollId, optionId) => {}}
  onToggleMaintenance={() => {}}
  isMaintenanceMode={boolean}
/>
```

**Props**:
- `veXFBalance`: User's locked XF voting power (decays over time)
- `rXFBalance`: Liquid reward tokens with 4× voting boost
- Total voting power = veXF + (rXF × 4)

**Mock Polls**:
- Q1 2026 LP Bonus Distribution
- Milestone Bonus: 100M TVL Achievement
- Q4 2025 Results (ended)

#### `LPFlywheelCard.tsx`
```tsx
<LPFlywheelCard
  userAddress={string | null}
  onAddLiquidity={async (poolId, amount) => {}}
  onClaimRewards={async (poolId) => {}}
/>
```

**Mock Pools**:
- USDC/XPRT: $2.4M TVL, 32.5% APY
- TFUEL/XPRT: $1.8M TVL, 28.7% APY
- USDC/ATOM: $3.1M TVL, 24.3% APY

## 🎨 UI Features

### Voting Interface
1. User sees their total voting power (veXF + rXF boost)
2. Active polls display with real-time percentages
3. Click option to select, then "Submit Vote"
4. Confetti animation on successful vote
5. Earn 5% rXF bonus (displayed in confirmation)

### LP Flywheel
1. View all pools with key metrics
2. Click "Add Liquidity" to deposit
3. Enter amount and confirm
4. "Claim Rewards" button appears when earnings > 0
5. Recent activity log shows rebalances

### Navigation
```
Swap → Yield Pump → Governance → LP Pools → Profile
 ↓         ↓            ↓           ↓          ↓
Live    APY Lanes     veXF      Flywheel    Wallet
```

## 🔧 Integration with Contracts

### Governance Contracts

**veXF.sol** - Vote-Escrowed XF
```solidity
// Lock XF for voting power
function createLock(uint256 amount, uint256 unlockTime)

// Check voting power
function votingPower(address account) view returns (uint256)

// Claim yield
function claimYield(address token, address user)
```

**rXF.sol** - Reward XF
```solidity
// Get voting boost (4× balance)
function getVotingBoost(address account) view returns (uint256)

// Get boosted voting power
function getBoostedVotingPower(address) view returns (uint256)
```

### LP Contracts

**LPRebalancer.sol**
```solidity
// Check if rebalance needed
function checkRebalanceNeeded(address pool) 
    returns (bool needsRebalance, bool zeroForOne, uint256 swapAmount)

// Execute rebalance
function rebalance(address pool) returns (bool success)

// Get pool ratio
function getPoolRatio(address pool) view returns (uint256 ratioBps)
```

**XFUELRouter.sol**
```solidity
// Fee split configuration
uint256 public constant VEXF_YIELD_BPS = 2500; // 25% to veXF
uint256 public constant BUYBACK_BPS = 6000;    // 60% buyback/burn
uint256 public constant TREASURY_BPS = 1500;   // 15% treasury
```

## 📊 Data Flow

### Governance Voting
```
User Action → Select Poll Option
     ↓
Check Voting Power (veXF + rXF boost)
     ↓
Submit Vote Transaction
     ↓
Contract Records Vote
     ↓
Calculate rXF Bonus (5% of voting power)
     ↓
Mint rXF Reward
     ↓
Update Poll Results
```

### LP Flywheel
```
Swap Transaction → 0.3% Fee Collected
     ↓
Fee Split:
  - 70% → Reinvest in LP Pool
  - 30% → Treasury
     ↓
Deeper Liquidity → Lower Slippage
     ↓
More Volume → More Fees
     ↓
Cycle Continues (Flywheel Effect)
```

## 🧪 Testing Locally

### Test Governance
```typescript
// Simulate user with voting power
setVeXFBalance(15000)  // 15k veXF
setRXFBalance(5000)    // 5k rXF → 20k boost
// Total: 35,000 voting power

// Submit vote
await onVote(1, 2)  // Poll 1, Option 2
// Earns: 35,000 × 0.05 = 1,750 rXF
```

### Test LP Pools
```typescript
// Add liquidity
await onAddLiquidity('usdc-xprt', 1000)
// User deposited $1,000 into USDC/XPRT pool

// Claim rewards
await onClaimRewards('usdc-xprt')
// User claimed accumulated USDC rewards
```

## 🎯 Key Metrics Display

### Governance Tab
- Your Voting Power: `35,000` (veXF + rXF boost)
- Active Polls: `2`
- Voting Rewards: `5% rXF Bonus`
- Quarterly Polls: `5-10% Revenue`

### LP Flywheel Tab
- Total TVL: `$7.4M`
- 24h Volume: `$554K`
- Your Liquidity: `$0` (initially)
- Your Earnings: `$0` (initially)
- Auto-Compound: `70% Reinvest`

## 📱 Responsive Design

### Mobile View
- Stacked cards
- Collapsible sections
- Touch-friendly buttons
- Readable font sizes

### Desktop View
- Side-by-side layouts
- Grid displays (2-4 columns)
- Hover effects
- Expanded info cards

## 🎨 Theme & Styling

**Color Scheme**:
- Purple: `#a855f7` (primary, governance)
- Cyan: `#06b6d4` (secondary, pools)
- Pink: `#ec4899` (accents)
- Green: `#10b981` (success, active)
- Orange: `#f97316` (warnings, maintenance)

**Components**:
- Glass cards with backdrop blur
- Neon gradients on buttons
- Animated progress bars
- Particle effects on interactions

## 🔐 Security Considerations

1. **Vote Validation**: Check user has voting power before allowing vote
2. **Double-Vote Prevention**: Track votes locally and on-chain
3. **Input Sanitization**: Validate all numeric inputs
4. **Safe Math**: Use ethers.js for large number calculations
5. **Access Control**: Maintenance toggle restricted to admin

## 📚 Further Reading

- Contract docs: `contracts/veXF.sol`, `contracts/rXF.sol`
- LP rebalancer: `contracts/LPRebalancer.sol`
- Revenue splitter: `contracts/RevenueSplitter.sol`
- Main router: `contracts/XFUELRouter.sol`

## 🐛 Troubleshooting

### Voting Power Shows 0
- Check wallet is connected: `wallet.fullAddress`
- Verify veXF/rXF balance loaded in useEffect
- In production: Query contracts directly

### LP Pool Not Displaying
- Check mock data in `LPFlywheelCard.tsx`
- In production: Fetch from pool contracts
- Verify pool addresses configured

### Build Errors
```bash
# Clear cache and rebuild
rm -rf node_modules dist
npm install
npm run build
```

## 🚀 Deployment Checklist

- [ ] Replace mock governance data with contract queries
- [ ] Replace mock LP data with pool contracts
- [ ] Configure veXF contract address
- [ ] Configure rXF contract address
- [ ] Set up LP pool addresses
- [ ] Test voting on testnet
- [ ] Test LP deposits on testnet
- [ ] Configure admin addresses for maintenance
- [ ] Set up event listeners for real-time updates
- [ ] Enable analytics tracking

---

**Happy Building! 🎉**

For questions: xfuel.support@xfuel.app



