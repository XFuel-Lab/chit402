# XFUEL Tokenomics 3.1 Integration Plan
**Version:** 1.0  
**Date:** December 2025  
**Status:** Planning Phase

## Executive Summary

This document outlines the safe integration of new tokenomics features from the whitepaper (v1.0) into the live XFUEL protocol (v1.0.0) without breaking existing swap rail, dashboard, lottery, or Theta Wallet flows.

**Core Principle:** Modular, non-breaking, upgradeable architecture with zero downtime.

---

## 1. Integration Roadmap

### 1.1 Contract Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    EXISTING CORE (v1.0.0)                    │
├─────────────────────────────────────────────────────────────┤
│ XFUELRouter      │ Fee collection & swap execution          │
│ XFUELPool        │ Concentrated liquidity pools              │
│ XFUELPoolFactory │ Pool creation                            │
│ TipPool          │ Lottery/revenue-share pools              │
│ TreasuryILBackstop│ IL coverage (8% threshold)              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              NEW TOKENOMICS MODULES (v2.0.0)                │
├─────────────────────────────────────────────────────────────┤
│ veXF            │ Vote-escrowed XF (governance + yield)     │
│ rXF             │ Revenue-backed soulbound receipts (ERC721)│
│ ThetaPulseProof │ Edge Node earnings verification           │
│ RevenueSplitter │ 90/10 revenue distribution engine          │
│ InnovationTreasury│ 3-vault governance system               │
│ CyberneticFeeSwitch│ Dynamic fee toggle                     │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Contract Deployment Order

**Phase 1: Foundation (Week 1)**
1. `XFUELToken.sol` - ERC20 token (if not exists)
2. `veXF.sol` - Vote-escrow contract (UUPS upgradeable)
3. `RevenueSplitter.sol` - Fee distribution engine
4. `CyberneticFeeSwitch.sol` - Dynamic fee controller

**Phase 2: Revenue Features (Week 2)**
5. `rXF.sol` - Soulbound receipt NFT (ERC721, non-transferable)
6. `rXFLocker.sol` - 365-day lock mechanism for 4× veXF boost
7. `BuybackBurner.sol` - Automated buyback & burn (25% of revenue)

**Phase 3: Theta Integration (Week 3)**
8. `ThetaPulseProof.sol` - Signature verification for Edge Node earnings
9. `ThetaPulseMultiplier.sol` - veXF multiplier logic (up to 3×)

**Phase 4: Innovation Treasury (Week 4)**
10. `InnovationTreasury.sol` - Main treasury contract (UUPS)
11. `BuilderVault.sol` - Micro-grants vault
12. `AcquisitionVault.sol` - Protocol acquisition vault
13. `MoonshotVault.sol` - Experimental projects vault

**Phase 5: Integration & Migration (Week 5)**
14. `XFUELRouterV2.sol` - Router upgrade (optional, or use adapter pattern)
15. `RevenueAdapter.sol` - Bridge between old router and new splitter
16. Migration scripts for existing fee flows

---

## 2. Contract Specifications

### 2.1 veXF (Vote-Escrowed XF)

**Purpose:** Governance token with time-weighted voting power and yield distribution.

**Key Features:**
- Lock XF for 1-4 years (max 4× multiplier)
- Non-transferable voting power
- Receives 50% of protocol revenue as stablecoin yield
- rXF lock bonus: +4× multiplier (requires 365-day rXF lock)
- Theta Pulse multiplier: up to 3× (permanent, based on Edge Node proof)

**Interface:**
```solidity
interface IVeXF {
    function createLock(uint256 amount, uint256 unlockTime) external;
    function increaseAmount(uint256 amount) external;
    function increaseUnlockTime(uint256 unlockTime) external;
    function withdraw() external;
    function balanceOf(address account) external view returns (uint256);
    function votingPower(address account) external view returns (uint256);
    function distributeYield(uint256 amount) external;
}
```

**Integration Points:**
- `XFUELRouter.collectAndDistributeFees()` → calls `RevenueSplitter.split()`
- `RevenueSplitter` → sends 50% to `veXF.distributeYield()`
- Frontend: New "Governance" tab for lock/unlock UI

**Breaking Changes:** ❌ None (new contract)

---

### 2.2 rXF (Revenue-Backed Soulbound Receipts)

**Purpose:** Non-transferable NFTs minted from protocol revenue, lockable for governance boosts.

**Key Features:**
- ERC721 with `soulbound` flag (transfer disabled)
- Minted when 15% revenue allocation triggers
- Lock for 365 days → 4× veXF voting power multiplier
- Priority airdrops for spin-out tokens
- Burnable (but not transferable)

**Interface:**
```solidity
interface IrXF {
    function mint(address to, uint256 revenueAmount) external;
    function lockForVeXF(uint256 tokenId, uint256 lockDuration) external;
    function getLockInfo(uint256 tokenId) external view returns (LockInfo memory);
    function burn(uint256 tokenId) external;
}
```

**Integration Points:**
- `RevenueSplitter` → mints rXF when 15% allocation triggers
- `veXF` → checks rXF lock status for multiplier
- Frontend: "Receipts" section in Governance tab

**Breaking Changes:** ❌ None (new contract)

---

### 2.3 Theta Pulse Proof Staking

**Purpose:** Verify Edge Node earnings via cryptographic proof, grant permanent veXF multiplier.

**Key Features:**
- Signature verification of TPulse messages
- Proof of earnings from Theta EdgeCloud
- Permanent veXF multiplier (1× to 3× based on earnings tier)
- One-time verification per address

**Interface:**
```solidity
interface IThetaPulseProof {
    function submitProof(
        bytes calldata signature,
        uint256 earningsAmount,
        uint256 timestamp
    ) external returns (uint256 multiplier);
    function getMultiplier(address account) external view returns (uint256);
    function verifySignature(
        address nodeAddress,
        bytes calldata message,
        bytes calldata signature
    ) external pure returns (bool);
}
```

**Integration Points:**
- Backend: Theta Pulse listener validates messages
- Frontend: "Theta Proof" section in Governance tab
- `veXF` → reads multiplier from `ThetaPulseProof`

**Breaking Changes:** ❌ None (new contract)

---

### 2.4 Revenue Splitter

**Purpose:** Centralized revenue distribution engine (90/10 split).

**Key Features:**
- Receives all protocol revenue (swaps, lottery rake, yield cuts)
- 90% → veXF holders:
  - 50% direct stablecoin yield
  - 25% buyback & burn XF
  - 15% mint rXF
- 10% → Innovation Treasury

**Interface:**
```solidity
interface IRevenueSplitter {
    function splitRevenue(uint256 totalRevenue) external;
    function setVeXF(address _veXF) external;
    function setBuybackBurner(address _buybackBurner) external;
    function setRXF(address _rXF) external;
    function setInnovationTreasury(address _treasury) external;
}
```

**Integration Points:**
- `XFUELRouter.collectAndDistributeFees()` → calls `RevenueSplitter.splitRevenue()`
- `TipPool` → sends rake to `RevenueSplitter` (new event)
- Frontend: Revenue dashboard shows split breakdown

**Breaking Changes:** ⚠️ Router fee distribution logic changes (adapter pattern recommended)

---

### 2.5 Innovation Treasury (3 Vaults)

**Purpose:** veXF-governed treasury with 3 specialized vaults.

**Key Features:**
- Main treasury receives 10% of all revenue
- 3 sub-vaults:
  - **Builder Vault:** Micro-grants for open-source tools
  - **Acquisition Vault:** Purchase revenue-generating protocols
  - **Moonshot Vault:** Fund experiments (ZK/AI); spin-outs airdrop 50% to veXF/rXF holders
- Governance via veXF voting

**Interface:**
```solidity
interface IInnovationTreasury {
    function allocateToVault(VaultType vault, uint256 amount) external;
    function proposeGrant(address recipient, uint256 amount, string memory description) external;
    function voteOnProposal(uint256 proposalId, bool support) external;
    function executeProposal(uint256 proposalId) external;
}
```

**Integration Points:**
- `RevenueSplitter` → sends 10% to `InnovationTreasury`
- Frontend: New "Treasury" tab with governance UI

**Breaking Changes:** ❌ None (new contract)

---

### 2.6 Cybernetic Fee Switch

**Purpose:** Governance-controlled fee toggle (growth vs. extraction modes).

**Key Features:**
- veXF can vote to enable/disable fees
- Growth mode: Lower fees to attract TVL
- Extraction mode: Higher fees for revenue
- Affects swap fees, lottery rake, yield cuts

**Interface:**
```solidity
interface ICyberneticFeeSwitch {
    function isFeesEnabled() external view returns (bool);
    function setFeesEnabled(bool enabled) external; // veXF only
    function getFeeMultiplier() external view returns (uint256); // 0-10000 bps
}
```

**Integration Points:**
- `XFUELPool` → checks `CyberneticFeeSwitch.isFeesEnabled()`
- `TipPool` → adjusts rake based on fee switch
- Frontend: Governance tab shows fee switch status

**Breaking Changes:** ⚠️ Requires pool/router to check fee switch (adapter pattern)

---

## 3. Modified Hardhat Deploy Scripts

### 3.1 Deployment Script Structure

```javascript
// scripts/deploy-tokenomics-v2.cjs

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🚀 Deploying XFUEL Tokenomics v2.0 modules...\n');
  
  const [deployer] = await hre.ethers.getSigners();
  console.log('📝 Deployer:', deployer.address);
  
  // Load existing v1.0 contracts
  const existingContracts = await loadExistingContracts();
  
  // Phase 1: Foundation
  const xfuelToken = await deployXFUELToken();
  const veXF = await deployVeXF(xfuelToken.address);
  const revenueSplitter = await deployRevenueSplitter();
  const feeSwitch = await deployCyberneticFeeSwitch(veXF.address);
  
  // Phase 2: Revenue Features
  const rXF = await deployRXF();
  const rXFLocker = await deployRXFLocker(veXF.address, rXF.address);
  const buybackBurner = await deployBuybackBurner(xfuelToken.address);
  
  // Phase 3: Theta Integration
  const thetaPulseProof = await deployThetaPulseProof();
  const thetaPulseMultiplier = await deployThetaPulseMultiplier(veXF.address, thetaPulseProof.address);
  
  // Phase 4: Innovation Treasury
  const innovationTreasury = await deployInnovationTreasury(veXF.address);
  const builderVault = await deployBuilderVault(innovationTreasury.address);
  const acquisitionVault = await deployAcquisitionVault(innovationTreasury.address);
  const moonshotVault = await deployMoonshotVault(innovationTreasury.address);
  
  // Phase 5: Integration
  const revenueAdapter = await deployRevenueAdapter(
    existingContracts.router,
    revenueSplitter.address
  );
  
  // Configure contracts
  await configureContracts({
    revenueSplitter,
    veXF,
    buybackBurner,
    rXF,
    innovationTreasury,
    feeSwitch,
    existingContracts
  });
  
  // Save addresses
  await saveDeploymentAddresses({
    // ... all addresses
  });
  
  console.log('✅ Tokenomics v2.0 deployment complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
```

### 3.2 Configuration Script

```javascript
// scripts/configure-tokenomics-v2.cjs

async function configureContracts(config) {
  const { revenueSplitter, veXF, buybackBurner, rXF, innovationTreasury, feeSwitch, existingContracts } = config;
  
  // Configure RevenueSplitter
  await revenueSplitter.setVeXF(veXF.address);
  await revenueSplitter.setBuybackBurner(buybackBurner.address);
  await revenueSplitter.setRXF(rXF.address);
  await revenueSplitter.setInnovationTreasury(innovationTreasury.address);
  
  // Configure veXF
  await veXF.setRXFLocker(rXFLocker.address);
  await veXF.setThetaPulseMultiplier(thetaPulseMultiplier.address);
  
  // Configure Router adapter (non-breaking)
  await existingContracts.router.setRevenueAdapter(revenueAdapter.address);
  
  // Transfer ownership to veXF (if needed)
  // await feeSwitch.transferOwnership(veXF.address);
  
  console.log('✅ Contracts configured');
}
```

### 3.3 Migration Script (Optional)

```javascript
// scripts/migrate-fee-distribution.cjs

async function migrateFeeDistribution() {
  // Migrate existing fee collection to new RevenueSplitter
  // This is optional if using adapter pattern
  
  const oldRouter = await ethers.getContractAt('XFUELRouter', OLD_ROUTER_ADDRESS);
  const newAdapter = await ethers.getContractAt('RevenueAdapter', ADAPTER_ADDRESS);
  
  // Update router to use adapter (if router is upgradeable)
  // OR use adapter pattern to intercept fee collection
  
  console.log('✅ Fee distribution migrated');
}
```

---

## 4. Backend/Frontend Touchpoints

### 4.1 Frontend Components (New)

**New Tabs:**
1. **Governance Tab** (`src/components/GovernanceTab.tsx`)
   - veXF lock/unlock interface
   - Voting power display
   - rXF receipts viewer
   - Theta Pulse proof submission
   - Fee switch toggle (if veXF holder)

2. **Treasury Tab** (`src/components/TreasuryTab.tsx`)
   - 3-vault overview
   - Proposal creation/voting
   - Grant history
   - Moonshot experiment tracker

3. **Revenue Dashboard** (`src/components/RevenueDashboard.tsx`)
   - Real-time revenue split visualization
   - Historical yield distribution
   - Buyback/burn tracker
   - rXF mint history

**Modified Components:**
- `src/components/NeonTabs.tsx` - Add 'governance' and 'treasury' tabs
- `src/App.tsx` - Add new tab handlers and state management

### 4.2 Backend API Endpoints (New)

```javascript
// server/api/tokenomics.js

// veXF endpoints
GET  /api/vexf/balance/:address
GET  /api/vexf/voting-power/:address
POST /api/vexf/lock
POST /api/vexf/unlock

// rXF endpoints
GET  /api/rxf/receipts/:address
GET  /api/rxf/lock-info/:tokenId
POST /api/rxf/lock

// Theta Pulse endpoints
POST /api/theta-pulse/verify
GET  /api/theta-pulse/multiplier/:address

// Treasury endpoints
GET  /api/treasury/vaults
GET  /api/treasury/proposals
POST /api/treasury/propose
POST /api/treasury/vote

// Revenue endpoints
GET  /api/revenue/split
GET  /api/revenue/history
GET  /api/revenue/buyback-burn
```

### 4.3 Theta Pulse Listener (New)

```javascript
// backend/router/listener/theta-pulse-listener.js

// Listens to Theta TPulse messages
// Validates Edge Node earnings
// Stores proofs for on-chain verification

class ThetaPulseListener {
  async listen() {
    // Connect to Theta TPulse stream
    // Validate messages
    // Store proofs in DB
  }
  
  async verifyProof(address, message, signature) {
    // Verify cryptographic proof
    // Return multiplier tier
  }
}
```

### 4.4 Contract ABIs (New)

Create ABI files for all new contracts:
- `src/config/veXF.abi.json`
- `src/config/rXF.abi.json`
- `src/config/revenueSplitter.abi.json`
- `src/config/innovationTreasury.abi.json`
- `src/config/thetaPulseProof.abi.json`
- `src/config/cyberneticFeeSwitch.abi.json`

---

## 5. Risk Matrix

### 5.1 Critical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Router fee distribution breaks** | 🔴 High | Medium | Use adapter pattern; keep old router functional |
| **veXF lock/unlock reentrancy** | 🔴 High | Low | Use ReentrancyGuard; follow checks-effects-interactions |
| **rXF soulbound bypass** | 🔴 High | Low | Override `transferFrom` to revert; use ERC721S (soulbound standard) |
| **Revenue split calculation error** | 🔴 High | Medium | Extensive unit tests; formal verification for math |
| **Theta Pulse signature spoofing** | 🟡 Medium | Medium | Use EIP-712 structured data; backend validation |
| **Treasury governance attack** | 🟡 Medium | Low | Time-locked proposals; quorum requirements |
| **Fee switch griefing** | 🟡 Medium | Low | Require veXF quorum; cooldown period |

### 5.2 Integration Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Existing swap flow breaks** | 🔴 High | Low | Zero changes to `XFUELRouter.swap()`; adapter only |
| **TipPool lottery breaks** | 🔴 High | Low | Keep TipPool unchanged; optional revenue hook |
| **Theta Wallet connection fails** | 🟡 Medium | Low | No changes to wallet integration |
| **Frontend state management conflicts** | 🟡 Medium | Medium | Isolate new features in separate components |
| **Gas costs increase** | 🟢 Low | Medium | Optimize new contracts; batch operations |

### 5.3 Economic Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Revenue split imbalance** | 🟡 Medium | Low | Hardcoded percentages; governance can adjust |
| **veXF whale dominance** | 🟡 Medium | Medium | Quadratic voting (optional); time-weighted locks |
| **rXF lock exploit** | 🟡 Medium | Low | 365-day minimum lock; non-transferable |
| **Buyback/burn price manipulation** | 🟡 Medium | Low | Use DEX aggregator; TWAP oracle |

### 5.4 Testing Strategy

**Unit Tests:**
- All new contracts (100% coverage target)
- Revenue split math (formal verification)
- veXF lock/unlock logic
- rXF soulbound enforcement

**Integration Tests:**
- Router → RevenueSplitter flow
- TipPool → RevenueSplitter flow
- veXF → rXF lock interaction
- Theta Pulse proof verification

**E2E Tests:**
- Full swap flow (unchanged)
- Lottery flow (unchanged)
- New governance flow
- Treasury proposal flow

**Fuzz Tests:**
- Revenue split edge cases
- veXF multiplier calculations
- Theta Pulse signature validation

---

## 6. Potential Conflicts & Fixes

### 6.1 Router Fee Distribution Conflict

**Issue:** Current router has hardcoded 60/25/15 split. New system needs 90/10 with sub-splits.

**Fix:** Use adapter pattern
```solidity
// contracts/RevenueAdapter.sol
contract RevenueAdapter {
    XFUELRouter public oldRouter;
    IRevenueSplitter public newSplitter;
    
    function collectAndDistributeFees(address pool) external {
        // Call old router's fee collection
        oldRouter.collectAndDistributeFees(pool);
        
        // Intercept and redirect to new splitter
        // (requires router modification or proxy pattern)
    }
}
```

**Alternative:** Deploy new router, migrate pools gradually.

---

### 6.2 TipPool Revenue Hook Conflict

**Issue:** TipPool doesn't send revenue to RevenueSplitter.

**Fix:** Add optional revenue hook (non-breaking)
```solidity
// contracts/TipPool.sol (modified)
address public revenueSplitter; // Optional, can be zero

function revealAndEndPool(uint256 poolId, uint256 reveal) external {
    // ... existing logic ...
    
    // Send creator cut
    if (creatorCut > 0) {
        (bool success, ) = payable(pool.creator).call{value: creatorCut}("");
        require(success, "TipPool: creator transfer failed");
    }
    
    // Send winner prize
    if (winnerPrize > 0) {
        (bool success, ) = payable(winner).call{value: winnerPrize}("");
        require(success, "TipPool: winner transfer failed");
    }
    
    // NEW: Optional revenue split (if configured)
    if (revenueSplitter != address(0)) {
        uint256 protocolRake = (pool.totalTips * PROTOCOL_RAKE_BPS) / 10000;
        if (protocolRake > 0) {
            (bool success, ) = payable(revenueSplitter).call{value: protocolRake}("");
            if (success) {
                emit RevenueSent(revenueSplitter, protocolRake);
            }
        }
    }
}
```

---

### 6.3 Pool Fee Switch Integration Conflict

**Issue:** XFUELPool doesn't check fee switch.

**Fix:** Add optional fee switch check (non-breaking)
```solidity
// contracts/XFUELPool.sol (modified)
ICyberneticFeeSwitch public feeSwitch; // Optional

function swap(...) external {
    // Check fee switch if configured
    uint256 effectiveFee = fee;
    if (address(feeSwitch) != address(0)) {
        if (!feeSwitch.isFeesEnabled()) {
            effectiveFee = 0; // No fees in growth mode
        } else {
            effectiveFee = (fee * feeSwitch.getFeeMultiplier()) / 10000;
        }
    }
    
    // Use effectiveFee in swap calculation
    // ... rest of swap logic unchanged ...
}
```

---

### 6.4 Frontend State Management Conflict

**Issue:** New governance/treasury state may conflict with existing swap/lottery state.

**Fix:** Isolate state in separate contexts
```typescript
// src/contexts/GovernanceContext.tsx
export const GovernanceProvider = ({ children }) => {
  const [veXFBalance, setVeXFBalance] = useState(0);
  const [votingPower, setVotingPower] = useState(0);
  // ... isolated state
};

// src/contexts/TreasuryContext.tsx
export const TreasuryProvider = ({ children }) => {
  const [proposals, setProposals] = useState([]);
  // ... isolated state
};
```

---

## 7. Deployment Checklist

### Pre-Deployment
- [ ] All contracts audited (or scheduled)
- [ ] Unit tests passing (100% coverage)
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Gas optimization review
- [ ] Formal verification (revenue split math)

### Deployment
- [ ] Deploy Phase 1 contracts (Foundation)
- [ ] Deploy Phase 2 contracts (Revenue)
- [ ] Deploy Phase 3 contracts (Theta)
- [ ] Deploy Phase 4 contracts (Treasury)
- [ ] Deploy Phase 5 contracts (Integration)
- [ ] Configure all contracts
- [ ] Verify contract addresses on explorer
- [ ] Update .env files

### Post-Deployment
- [ ] Test swap flow (unchanged)
- [ ] Test lottery flow (unchanged)
- [ ] Test governance flow (new)
- [ ] Test treasury flow (new)
- [ ] Monitor for 24 hours
- [ ] Update frontend with new contract addresses
- [ ] Deploy frontend updates
- [ ] Announce to community

---

## 8. Rollback Plan

If critical issues arise:

1. **Immediate:** Disable new features via feature flags
2. **Short-term:** Route fees back to old router logic
3. **Long-term:** Deploy fixed contracts, migrate users

**Rollback Triggers:**
- Swap flow breaks
- Lottery flow breaks
- Revenue split calculation error
- veXF lock/unlock exploit

---

## 9. Next Steps

1. **Review this plan** with team
2. **Create detailed contract specs** for each module
3. **Implement contracts** (separate tasks)
4. **Write tests** (unit + integration)
5. **Deploy to testnet** and verify
6. **Audit** (if budget allows)
7. **Deploy to mainnet** (phased rollout)

---

## 10. Appendix

### A. Contract Addresses (To Be Filled)

```
XFUELToken:         0x...
veXF:               0x...
rXF:                0x...
RevenueSplitter:    0x...
InnovationTreasury:  0x...
BuilderVault:       0x...
AcquisitionVault:   0x...
MoonshotVault:      0x...
ThetaPulseProof:    0x...
CyberneticFeeSwitch: 0x...
RevenueAdapter:     0x...
```

### B. References

- Whitepaper: `docs/whitepaper/whitepaper-content.md`
- Existing contracts: `contracts/`
- Deployment scripts: `scripts/deploy.cjs`

---

**Document Status:** ✅ Ready for Implementation  
**Last Updated:** December 2025  
**Next Review:** After Phase 1 deployment

