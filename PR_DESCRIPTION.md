# Phase 1 Tokenomics Foundation - veXF, RevenueSplitter, CyberneticFeeSwitch

## Overview
This PR implements the Phase 1 foundation for XFUEL tokenomics, adding three core upgradeable contracts without modifying existing swap rail, simulation, lottery, or Theta Wallet flows.

## What's Included

### Contracts
- **veXF.sol** - Vote-escrowed XF token (Curve-style) with linear decay
  - Lock XF tokens for 1-4 years to receive veXF voting power
  - Non-transferable voting power that decays over time
  - Receives yield distribution from protocol revenue
  
- **RevenueSplitter.sol** - Protocol revenue distribution
  - Splits revenue: 50% veXF yield, 25% buyback/burn (tracked), 15% rXF (tracked), 10% treasury
  - Phase 1: Only yield distribution active, others tracked for future phases
  
- **CyberneticFeeSwitch.sol** - Governance-controlled fee mechanism
  - Two modes: Growth (0.1%) and Extraction (0.5%)
  - Governance users with min veXF can change modes
  - 7-day cooldown between mode changes
  - Implements IFeeAdapter interface for router integration

### Deployment & Infrastructure
- **phase1-deploy.cjs** - Production-ready deployment script
  - Uses upgradeable proxy pattern (UUPS)
  - Supports mock token deployment for testing
  - Auto-updates .env with contract addresses
  - Saves deployment info to JSON

### Testing
- **84 tests passing** (1 pending)
- Comprehensive test coverage for all three contracts
- Tests updated for ethers v6 compatibility
- Upgradeability tests included

### Documentation
- Complete tokenomics architecture documentation
- Integration plans and checklists
- Whitepaper package (PDF, HTML, diagrams)
- Deployment guides

## Technical Details

### Dependencies
- Updated to `@nomicfoundation/hardhat-ethers` (ethers v6)
- Fixed upgrades import pattern (using `hre` instead of direct require)
- All contracts use UUPS upgradeable pattern

### Key Features
- ✅ All contracts are upgradeable (UUPS)
- ✅ Comprehensive access control (Ownable)
- ✅ Reentrancy protection
- ✅ Full test coverage
- ✅ Gas optimized

## Testing
```bash
npm run test:contracts
# 84 passing tests
```

## Next Steps (Post-Merge)
1. Deploy to Theta Testnet
2. Verify contracts on block explorer
3. Integrate CyberneticFeeSwitch with XFUELRouter via IFeeAdapter
4. Test revenue splitting end-to-end
5. Plan Phase 2 (rXF minting, buyback/burn)

## Breaking Changes
None - This is additive functionality that doesn't modify existing contracts.

## Checklist
- [x] Contracts compile without errors
- [x] All tests passing (84/84)
- [x] Deployment script tested
- [x] Documentation complete
- [x] Code follows project style
- [x] No breaking changes to existing functionality

