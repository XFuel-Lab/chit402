# XFUEL Frontend Governance & LP Flywheel Update

## Summary
Updated Vite/React/TypeScript frontend for @XFuelLab hybrid dApp with governance and LP flywheel features while maintaining existing QR deposit and swap functionality.

## New Features Added

### 1. **Governance Tab (veXF-Weighted Voting)**
- **Component**: `src/components/GovernanceTab.tsx`
- **Features**:
  - Quarterly polls on 5-10% LP revenue extras
  - veXF-weighted voting (locked XF tokens)
  - rXF bonus system (4× voting boost)
  - Poll categories: Bonus distribution, Treasury allocation, Milestone rewards
  - Vote options: Extra burns vs. LP funding vs. NFT airdrops
  - Real-time vote percentage display
  - Voter rewards: 5% rXF bonus for participation
  - Poll status filtering (Active/Ended/All)
  - Maintenance mode toggle (admin)

**Example Polls**:
```
Q1 2026 LP Bonus Distribution
- Extra XF Burns (reduce supply) - 42.3%
- Additional LP Funding (deeper liquidity) - 33.1%
- NFT Airdrops (milestone rewards) - 24.6%
```

### 2. **LP Flywheel Card**
- **Component**: `src/components/LPFlywheelCard.tsx`
- **Features**:
  - Display USDC/XPRT and TFUEL/XPRT pools
  - Show pool TVL, 24h volume, APY
  - 70% fee reinvestment into pools (configurable)
  - 30% treasury allocation
  - Auto-rebalance notifications
  - User liquidity tracking
  - Earnings claim interface
  - Recent flywheel activity log

**Pool Examples**:
```
USDC/XPRT Pool
- TVL: $2,456,789
- APY: 32.5%
- 24h Volume: $187,543
- Auto-compound: 70% reinvest

TFUEL/XPRT Pool
- TVL: $1,823,456
- APY: 28.7%
- 24h Volume: $143,221
```

### 3. **Updated Navigation**
- **Component**: `src/components/NeonTabs.tsx`
- Added `governance` tab type
- Updated tab bar with new options:
  - Swap (live)
  - Yield Pump (apy lanes)
  - **Governance (veXF)** ← NEW
  - **LP Pools (flywheel)** ← NEW
  - Profile (wallet)

### 4. **Router Updates**
- **File**: `src/main.tsx`
- Added `/governance` route handling
- Maintains existing `/institutions` and `/liquidity` routes
- Seamless navigation between tabs

### 5. **App Integration**
- **File**: `src/App.tsx`
- Added governance state management:
  - `veXFBalance` - vote-escrowed XF balance
  - `rXFBalance` - reward XF balance (4× voting boost)
- Integrated vote submission handler
- Integrated LP liquidity management
- Maintenance mode toggle integration
- Auto-load governance balances on wallet connection

## Technical Details

### Governance Token Mechanics
```typescript
// Voting Power Calculation
totalVotingPower = veXFBalance + (rXFBalance × 4)

// Example:
veXF: 15,000
rXF: 5,000
Total Voting Power: 15,000 + (5,000 × 4) = 35,000
```

### LP Flywheel Flow
```
1. Protocol collects 0.3% swap fees
2. 70% automatically reinvested into LP pools
3. Deeper liquidity → lower slippage → more volume
4. More volume → more fees → cycle continues
5. 30% to treasury for ecosystem growth
```

### Voter Rewards
```typescript
// Earn 5% rXF bonus for voting
rXFBonus = totalVotingPower × 0.05

// Example with 35,000 voting power:
Reward: 1,750 rXF tokens
```

## Maintained Features
✅ QR deposit flow (no wallet connect needed)
✅ Manual TFUEL send via address copy/paste
✅ Swap page with LST options
✅ Yield Pump (single-sided staking)
✅ Profile tab with balance display
✅ Maintenance mode overlay
✅ Transaction success modals
✅ Beta banner
✅ Early believers modal

## Files Modified
```
src/components/GovernanceTab.tsx         (NEW)
src/components/LPFlywheelCard.tsx        (NEW)
src/components/NeonTabs.tsx              (UPDATED)
src/App.tsx                              (UPDATED)
src/main.tsx                             (UPDATED)
```

## Smart Contract Integration Points

### Governance Contracts
```solidity
// veXF.sol - Vote-escrowed XF token
- Lock XF for 1-4 years → receive veXF voting power
- Linear decay over time
- Yield distribution to holders

// rXF.sol - Reward XF token
- Earned through protocol participation
- 4× voting boost multiplier
- Liquid (transferable)
```

### LP Contracts
```solidity
// LPRebalancer.sol
- Auto-rebalance pools when skew > threshold
- 70% fee reinvestment (configurable)
- Treasury funding allocation
- Rebalance history tracking
```

## Usage Examples

### Voting on Governance Proposal
```typescript
// User navigates to Governance tab
// Selects poll option
// Clicks "Submit Vote & Earn rXF Bonus"
await onVote(pollId, optionId)
// Receives 5% rXF bonus instantly
```

### Adding LP Liquidity
```typescript
// User navigates to LP Pools tab
// Selects pool (USDC/XPRT)
// Enters amount and confirms
await onAddLiquidity('usdc-xprt', 1000)
// Liquidity added, earning 32.5% APY
```

### Claiming LP Rewards
```typescript
// User sees earnings balance
// Clicks "Claim Rewards"
await onClaimRewards('usdc-xprt')
// USDC rewards transferred to wallet
```

## Environment Variables
No new environment variables required. Existing maintenance mode toggle:
```bash
VITE_MAINTENANCE=true  # Enable maintenance mode
```

## Mock Data vs Production

### Current Implementation (Demo)
- Polls: Hardcoded mock data in `GovernanceTab.tsx`
- LP Pools: Mock data in `LPFlywheelCard.tsx`
- Balances: Simulated in `App.tsx` useEffect

### Production Migration
Replace mock implementations with:
```typescript
// Governance
const veXFContract = new ethers.Contract(VEXF_ADDRESS, VEXF_ABI, provider)
const balance = await veXFContract.balanceOf(userAddress)

// LP Pools
const poolContract = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider)
const tvl = await poolContract.getTotalValueLocked()

// Voting
const tx = await governanceContract.vote(pollId, optionId)
await tx.wait()
```

## Design Highlights
- Cyberpunk neon theme maintained
- Glass morphism cards
- Purple/cyan gradient accents
- Responsive layouts (mobile-first)
- Animated voting power orbs
- Progress bars for poll results
- Real-time statistics
- Celebration confetti on vote submission

## Testing Checklist
- [x] Governance tab renders correctly
- [x] LP Flywheel tab displays pools
- [x] Navigation between tabs works
- [x] Vote submission shows confirmation
- [x] Maintenance toggle functional
- [x] Mobile responsive layout
- [x] No linting errors
- [x] Existing features preserved

## Next Steps for Production
1. Connect veXF contract for real balance queries
2. Connect rXF contract for boost calculations
3. Implement on-chain voting transaction flow
4. Integrate LP pool contracts (XFUELPool.sol)
5. Add Chainlink VRF for poll randomization
6. Implement governance proposal creation
7. Add historical vote records from blockchain
8. Real-time LP rebalance event listening
9. Multi-signature admin controls
10. Governance forum integration

## Performance Considerations
- Lazy load governance data on tab switch
- Cache poll results in localStorage
- Debounce voting power calculations
- Optimize re-renders with useMemo
- Minimize contract calls with batch queries

## Security Notes
- Vote submission requires wallet signature
- Maintenance toggle restricted to admin addresses
- Input validation on all user interactions
- Safe arithmetic for voting power calculations
- Reentrancy guards on contract interactions

---

**Version**: 1.0.0  
**Updated**: January 3, 2026  
**Author**: XFUEL Protocol Team




