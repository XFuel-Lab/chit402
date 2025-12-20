# XFUEL Tokenomics 3.1 Implementation Checklist

Quick reference for implementing each module. Use this alongside the main integration plan.

## Phase 1: Foundation Contracts

### ✅ XFUELToken.sol
- [ ] ERC20 with fixed supply (100M)
- [ ] No mint function (or only for initial distribution)
- [ ] Burnable
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ veXF.sol (Vote-Escrowed XF)
- [ ] UUPS upgradeable pattern
- [ ] Lock mechanism (1-4 years)
- [ ] Voting power calculation (time-weighted)
- [ ] Yield distribution (50% of revenue)
- [ ] rXF lock integration (4× multiplier)
- [ ] Theta Pulse multiplier integration
- [ ] Unit tests (100% coverage)
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ RevenueSplitter.sol
- [ ] Receives all protocol revenue
- [ ] 90/10 split logic
- [ ] Sub-split: 50% yield, 25% buyback, 15% rXF
- [ ] Integration with veXF, BuybackBurner, rXF, Treasury
- [ ] Unit tests (math verification)
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ CyberneticFeeSwitch.sol
- [ ] Governance-controlled toggle
- [ ] Fee multiplier (0-10000 bps)
- [ ] veXF-only access control
- [ ] Integration with pools
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

---

## Phase 2: Revenue Features

### ✅ rXF.sol (Revenue-Backed Receipts)
- [ ] ERC721 with soulbound (non-transferable)
- [ ] Mint function (revenue-triggered)
- [ ] Lock mechanism (365 days)
- [ ] Burn function
- [ ] Integration with veXF for multiplier
- [ ] Unit tests (soulbound enforcement)
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ rXFLocker.sol
- [ ] 365-day lock mechanism
- [ ] Integration with veXF (4× multiplier)
- [ ] Lock status tracking
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ BuybackBurner.sol
- [ ] Automated buyback logic
- [ ] DEX integration (or aggregator)
- [ ] Burn mechanism
- [ ] Integration with RevenueSplitter
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

---

## Phase 3: Theta Integration

### ✅ ThetaPulseProof.sol
- [ ] Signature verification (EIP-712)
- [ ] Proof storage
- [ ] Multiplier calculation (1×-3×)
- [ ] One-time verification per address
- [ ] Integration with veXF
- [ ] Unit tests (signature validation)
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ ThetaPulseMultiplier.sol
- [ ] Multiplier lookup
- [ ] Integration with veXF
- [ ] Earnings tier calculation
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ Backend: Theta Pulse Listener
- [ ] TPulse message listener
- [ ] Proof validation
- [ ] Database storage
- [ ] API endpoint for verification
- [ ] Integration tests

---

## Phase 4: Innovation Treasury

### ✅ InnovationTreasury.sol
- [ ] UUPS upgradeable pattern
- [ ] 3-vault system
- [ ] Governance integration (veXF)
- [ ] Proposal system
- [ ] Voting mechanism
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ BuilderVault.sol
- [ ] Micro-grants logic
- [ ] Proposal creation
- [ ] Grant execution
- [ ] Integration with Treasury
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ AcquisitionVault.sol
- [ ] Protocol acquisition logic
- [ ] Proposal creation
- [ ] Purchase execution
- [ ] Integration with Treasury
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ MoonshotVault.sol
- [ ] Experimental project funding
- [ ] Spin-out token tracking
- [ ] Airdrop mechanism (50% to veXF/rXF)
- [ ] Integration with Treasury
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

---

## Phase 5: Integration & Migration

### ✅ RevenueAdapter.sol
- [ ] Bridge between old router and new splitter
- [ ] Fee interception logic
- [ ] Non-breaking integration
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ XFUELRouterV2.sol (Optional)
- [ ] Upgrade of existing router
- [ ] Direct RevenueSplitter integration
- [ ] Backward compatibility
- [ ] Migration script
- [ ] Unit tests
- [ ] Deploy to testnet
- [ ] Verify on explorer

### ✅ Deployment Scripts
- [ ] `scripts/deploy-tokenomics-v2.cjs`
- [ ] `scripts/configure-tokenomics-v2.cjs`
- [ ] `scripts/migrate-fee-distribution.cjs`
- [ ] Test on testnet
- [ ] Dry-run on mainnet fork

---

## Frontend Implementation

### ✅ New Components
- [ ] `src/components/GovernanceTab.tsx`
- [ ] `src/components/TreasuryTab.tsx`
- [ ] `src/components/RevenueDashboard.tsx`
- [ ] `src/components/VeXFLockInterface.tsx`
- [ ] `src/components/RXFReceipts.tsx`
- [ ] `src/components/ThetaPulseProof.tsx`
- [ ] `src/components/TreasuryProposals.tsx`

### ✅ Modified Components
- [ ] `src/components/NeonTabs.tsx` (add tabs)
- [ ] `src/App.tsx` (add handlers)
- [ ] `src/config/thetaConfig.ts` (add ABIs)

### ✅ New Contexts
- [ ] `src/contexts/GovernanceContext.tsx`
- [ ] `src/contexts/TreasuryContext.tsx`
- [ ] `src/contexts/RevenueContext.tsx`

### ✅ Contract ABIs
- [ ] `src/config/veXF.abi.json`
- [ ] `src/config/rXF.abi.json`
- [ ] `src/config/revenueSplitter.abi.json`
- [ ] `src/config/innovationTreasury.abi.json`
- [ ] `src/config/thetaPulseProof.abi.json`
- [ ] `src/config/cyberneticFeeSwitch.abi.json`

---

## Backend Implementation

### ✅ New API Endpoints
- [ ] `server/api/tokenomics.js`
- [ ] `server/api/vexf.js`
- [ ] `server/api/rxf.js`
- [ ] `server/api/theta-pulse.js`
- [ ] `server/api/treasury.js`
- [ ] `server/api/revenue.js`

### ✅ Theta Pulse Listener
- [ ] `backend/router/listener/theta-pulse-listener.js`
- [ ] Database schema for proofs
- [ ] Validation logic
- [ ] Integration tests

---

## Testing

### ✅ Unit Tests
- [ ] All new contracts (100% coverage)
- [ ] Revenue split math (formal verification)
- [ ] veXF lock/unlock
- [ ] rXF soulbound
- [ ] Theta Pulse signature verification

### ✅ Integration Tests
- [ ] Router → RevenueSplitter
- [ ] TipPool → RevenueSplitter
- [ ] veXF → rXF lock
- [ ] Theta Pulse proof flow

### ✅ E2E Tests
- [ ] Swap flow (unchanged)
- [ ] Lottery flow (unchanged)
- [ ] Governance flow (new)
- [ ] Treasury flow (new)

### ✅ Fuzz Tests
- [ ] Revenue split edge cases
- [ ] veXF multiplier calculations
- [ ] Theta Pulse signature validation

---

## Deployment

### ✅ Pre-Deployment
- [ ] All tests passing
- [ ] Gas optimization review
- [ ] Security audit (if applicable)
- [ ] Documentation updated

### ✅ Testnet Deployment
- [ ] Deploy all contracts
- [ ] Configure contracts
- [ ] Verify on explorer
- [ ] Test all flows
- [ ] Monitor for 24 hours

### ✅ Mainnet Deployment
- [ ] Deploy Phase 1
- [ ] Deploy Phase 2
- [ ] Deploy Phase 3
- [ ] Deploy Phase 4
- [ ] Deploy Phase 5
- [ ] Configure all contracts
- [ ] Update frontend
- [ ] Announce to community

---

## Monitoring

### ✅ Post-Deployment
- [ ] Monitor swap flow (24h)
- [ ] Monitor lottery flow (24h)
- [ ] Monitor governance flow (24h)
- [ ] Monitor treasury flow (24h)
- [ ] Check for errors in logs
- [ ] Verify revenue distribution
- [ ] Check gas costs

---

## Documentation

### ✅ Technical Docs
- [ ] Contract specifications
- [ ] API documentation
- [ ] Integration guide
- [ ] Deployment guide

### ✅ User Docs
- [ ] Governance guide
- [ ] Treasury guide
- [ ] Theta Pulse proof guide
- [ ] rXF receipts guide

---

**Status:** 📋 Planning Complete  
**Next:** Begin Phase 1 implementation


