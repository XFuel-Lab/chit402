# XFuel Protocol - Core Modules Index

This document provides an overview of the extracted core modules and their relationships.

## Module Overview

### 1. ZK Module (`core-modules/zk/`)
**Purpose:** Zero-knowledge proof verification for cross-chain deposits

**Components:**
- `ZKVerifier.sol` - On-chain Groth16 verifier
- `proof-generator.js` - Off-chain proof generation service  
- `circuits/` - Circom circuit definitions and artifacts

**Dependencies:**
- Theta blockchain (source chain)
- Persistence blockchain (destination chain)
- IBC Channel-190
- snarkjs library

**Security Level:** 🔴 Critical

### 2. Ferrari Module (`core-modules/ferrari/`)
**Purpose:** Tokenomics engine for revenue distribution and governance

**Components:**
- `RevenueSplitter.sol` - Protocol revenue distribution (50/25/15/10 split)
- `veXF.sol` - Vote-escrowed governance token

**Dependencies:**
- `BuybackBurner.sol` (contracts/)
- `rXF.sol` (contracts/)
- `XFuelTimelock.sol` (security/)
- OpenZeppelin contracts (upgradeable, UUPS)

**Security Level:** 🔴 Critical

### 3. Security Module (`core-modules/security/`)
**Purpose:** Security infrastructure for protocol protection

**Components:**
- `XFuelTimelock.sol` - Timelock controller (48h delay)
- `MultiSigTreasury.sol` - Multi-signature treasury (M-of-N)
- `XFUELPool-pausable.sol` - Pausable pool contract
- `XFUELRouter-pausable.sol` - Pausable router contract

**Dependencies:**
- OpenZeppelin TimelockController
- Main contracts (IERC20, SafeERC20, etc.)

**Security Level:** 🔴 Critical

## Cross-Module Dependencies

```
┌─────────────────────────────────────────────────────────┐
│                    XFuel Protocol                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐      │
│  │    ZK    │      │ Ferrari  │      │ Security │      │
│  │  Module  │      │  Module  │      │  Module  │      │
│  └────┬─────┘      └────┬─────┘      └────┬─────┘      │
│       │                 │                  │            │
│       │    ┌────────────┴──────────┐       │            │
│       │    │                       │       │            │
│       ▼    ▼                       ▼       ▼            │
│  ┌─────────────────────────────────────────────┐       │
│  │         Main Contracts (contracts/)         │       │
│  │  - XFUELRouter, XFUELPool, Governance      │       │
│  │  - BuybackBurner, rXF, TipPool             │       │
│  └─────────────────────────────────────────────┘       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Integration Points

### ZK → Main Contracts
- `backend/theta-bridge/src/index.js` imports `proof-generator.js`
- Bridge contracts on Persistence call `ZKVerifier.verifyDepositProof()`

### Ferrari → Main Contracts
- `XFUELRouter` sends fees to `RevenueSplitter.splitRevenue()`
- `BuybackBurner` receives 25% for buyback operations
- `rXF` receives 15% for minting redeemable tokens
- Users lock XF in `veXF` for voting power and yield

### Security → All Modules
- `XFuelTimelock` protects critical operations (upgrades, parameter changes)
- `MultiSigTreasury` manages protocol funds
- Pausable contracts provide emergency stop mechanism
- All UUPS upgrades route through timelock + multi-sig

## Security Architecture

### Defense in Depth

1. **ZK Proofs** - Cryptographic validation of cross-chain deposits
2. **Timelock** - 48-hour delay for sensitive operations
3. **Multi-sig** - M-of-N approval for critical actions
4. **Pausable** - Emergency stop for incident response
5. **Rate Limiting** - Prevents abuse and DoS attacks
6. **Circuit Breaker** - Automatic pause on anomaly detection

### Trust Assumptions

- **ZK Module:** Trusted setup for Groth16 circuit, Oracle for Merkle roots
- **Ferrari Module:** Owner for upgrades (via timelock), RevenueSplitter parameters
- **Security Module:** Multi-sig signers, Timelock executors

## Deployment Order

1. **Security Module**
   ```bash
   # Deploy timelock first (48h delay)
   XFuelTimelock → MultiSigTreasury
   ```

2. **Ferrari Module**
   ```bash
   # Deploy tokenomics (UUPS proxies)
   veXF → RevenueSplitter
   # Connect to timelock
   ```

3. **ZK Module**
   ```bash
   # Setup circuits
   cd circuits && ./setup-groth16.sh
   # Deploy verifier
   ZKVerifier → Configure with timelock owner
   ```

4. **Main Contracts**
   ```bash
   # Deploy remaining protocol contracts
   XFUELRouter, XFUELPool, etc.
   # Set timelock as owner
   ```

## Maintenance

### Regular Tasks
- Monitor ZK verification failure rates (circuit breaker)
- Review pending timelock operations
- Audit multi-sig transaction queue
- Update Merkle root registry (ZK module)
- Monitor revenue splits (Ferrari module)

### Emergency Procedures
1. Detect incident (monitoring, alerts)
2. Trigger pause via multi-sig (instant)
3. Assess severity and root cause
4. Deploy fix via timelock + multi-sig (48h delay)
5. Resume operations after verification

## Testing

```bash
# Test ZK module
npm test -- zk

# Test Ferrari module  
npm test -- ferrari

# Test Security module
npm test -- security

# Integration tests
npm test -- integration
```

## Audit Status

- ✅ ZK Module: Enhanced security v1.0 (Jan 2026)
- ✅ Ferrari Module: Phase 2 tokenomics (Jan 2026)
- ✅ Security Module: Timelock + Multi-sig v1.0 (Jan 2026)

## Contact

- Security Team: security@xfuel.io
- Emergency Multi-sig: [Contact details in secure channel]
- Circuit Breaker Alerts: [Monitoring dashboard]

---

**Last Updated:** January 7, 2026  
**Protocol Version:** v3.1+  
**Extraction Date:** January 7, 2026

