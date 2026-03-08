# XFUEL Protocol — CertiK Phase 1 Audit Preparation Checklist

**Last Updated:** March 6, 2026  
**Status:** In Progress  
**Audit Provider:** CertiK  
**Scope:** Core Layer + Theta Working Circuit  
**Target Start:** Q2 2026

---

## Phase 1 Audit Scope

| Contract | Path | Risk | Lines |
|----------|------|------|-------|
| ZKVerifierSP1 | `core-layer/contracts/ZKVerifierSP1.sol` | CRITICAL | 620 |
| CoreRevenueSplitter | `core-layer/contracts/CoreRevenueSplitter.sol` | HIGH | 310 |
| veXFGovernance | `core-layer/contracts/veXFGovernance.sol` | HIGH | 320 |
| ThetaInferenceCircuit | `circuits/theta-inference/ThetaInferenceCircuit.sol` | HIGH | 637 |
| SP1ProofHooks | `core-layer/contracts/SP1ProofHooks.sol` | MEDIUM | 181 |

**CosmWasm (secondary):**
- `core-layer/wasm/zk-verifier/src/contract.rs` — Production ark-groth16 verifier
- `cosmwasm/zk-verifier/` — Dev-only mock (NOT for production)

**Full scope definition:** `docs/certik-phase1-scope.json` (v5.0.0)

---

## Pre-Audit Requirements

### Documentation
- [x] Audit scope document (`docs/certik-phase1-scope.json` v5.0.0)
- [x] Phase plan (Phase 1: Theta, Phase 2: Bittensor, Phase 3: Cross-chain)
- [x] Security design (`docs/security-design.md`)
- [x] Architecture docs (WHITEPAPER.md v2.4, README.md)
- [x] Bug bounty plan ($500K Immunefi, post-audit)
- [x] Formal verification candidates (3 contracts, 8 properties)
- [x] Audit & grant readiness tracker (`docs/AUDIT_GRANT_READINESS.md`)

### Smart Contract Security
- [x] Zero-address validation in CoreRevenueSplitter constructor
- [x] ReentrancyGuard on all state-changing functions with external calls
- [x] Pausable on critical contracts (CoreRevenueSplitter, ZKVerifierSP1)
- [x] AccessControl role hierarchy (DEFAULT_ADMIN → FEE_MANAGER → CIRCUIT → GOVERNANCE)
- [x] Nullifier-based replay protection (EVM + CosmWasm)
- [x] Circuit breaker at >5% failure rate (ZKVerifierSP1)
- [x] BridgeCircuit payload detection fixed (exact-length discriminator)
- [x] Jackpot removed from scope (regulatory + implementation concerns)
- [x] Placeholder TODOs annotated with phase scope (BuybackBurner, ZKVerifier, XFUELRouter)
- [x] Solidity version standardized to ^0.8.22 across audit scope
- [x] Magic numbers replaced with named constants (PROTOCOL_FEE_BPS)
- [x] Access control decisions documented (distribute(), updateOraclePrice())
- [x] updateStakeRoute emits totalStakeWeight in event

### NatSpec Documentation
- [x] ZKVerifierSP1 — All external/public functions documented
- [x] CoreRevenueSplitter — All functions documented
- [x] veXFGovernance — All functions documented
- [x] SP1ProofHooks — All library functions documented
- [x] BridgeCircuit — All functions documented
- [x] ThetaInferenceCircuit — All functions documented (existing)

### Test Coverage
- [x] 755+ tests across all suites
- [x] Reentrancy attack tests (5 tests with malicious callback contract)
- [x] Access control tests (9 tests — role enforcement, revocation, pause)
- [x] Boundary condition tests (12 tests — dust, rounding, BPS limits)
- [x] Theta inference circuit tests (36 tests)
- [x] Priority circuit tests (97 tests)
- [x] Core ZKVerifier tests (40+ tests)
- [x] Governance lifecycle tests (25+ tests)
- [x] Skipped tests fixed with mock RPC fallback
- [ ] Line coverage report generated (`npx hardhat coverage`)
- [ ] >85% coverage on Phase 1 primary contracts

### Test Scripts
- `npm run test:contracts` — Main test suite
- `npm run test:contracts:all` — All tests including circuits
- `npm run test:contracts:core` — Core Layer + security tests
- `npm run test:contracts:theta` — Theta circuit tests
- `npm run test:coverage` — Coverage report

### Deployment
- [x] Testnet deployment scripts (resumable, smoke-tested)
- [x] Deployment manifests with contract addresses
- [x] Admin transfer to multisig in deploy scripts
- [ ] `.env.deploy.example` with all required env vars

---

## Phase Plan

| Phase | Scope | Target | Status |
|-------|-------|--------|--------|
| Phase 1 | Core Layer + ThetaInferenceCircuit | Q2 2026 | In Progress |
| Phase 2 | InferenceRouter + TAOCircuit + BridgeCircuit | Q3 2026 | Planned |
| Phase 3 | ComputeMarketplace + ZKML + DataHubs + A2A | Q4 2026 | Planned |

---

## Remaining Items

- [ ] Generate coverage report and close gaps to >85%
- [ ] Create `.env.deploy.example`
- [ ] Run `npm audit` and fix high/critical vulnerabilities
- [ ] Final review of all NatSpec for accuracy

---

*This checklist aligns with `docs/certik-phase1-scope.json` v5.0.0 and `docs/AUDIT_GRANT_READINESS.md`.*
