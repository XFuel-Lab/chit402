# XFUEL Protocol — CertiK Phase 1 Audit Preparation Checklist

**Last Updated:** March 8, 2026  
**Status:** Testnet Deployed — Grant Application Ready  
**Audit Provider:** CertiK  
**Scope:** Core Layer + Theta Working Circuit  
**Target Start:** Q2 2026 (post-grant funding)

---

## Testnet Deployment — COMPLETE ✓

| Contract | Testnet Address (Theta 365) |
|----------|-----------------------------|
| CoreRevenueSplitter | `0x56A3E4e2E47Ad1D1e9DB2DD9446479b3Be01d1F0` |
| ZKVerifierSP1 | `0x8E0789E95f0F18F49E1BBA765893C9dfbF09570f` |
| A2ACircuit | `0x3eb4b410373413BfAcc48A3Cd872713F44EA8015` |
| ThetaGPUCircuit | `0x8188cAc55607d61c8ECf1cB850B65b47e682ADAc` |
| TAOCircuit | `0x1526CD125022c06dFda2Fc1c6563de0e72581E8e` |
| BridgeCircuit | `0xE4a9D5Cd8fCA9B6dba6DaCfc1A7A3B1b2a928F7d` |

**Smoke tests:** 17/17 passed · **Manifest:** `deploy/manifests/phase6-1772989979356.json`  
**Explorer:** https://testnet-explorer.thetatoken.org

---

## Phase 1 Audit Scope

| Contract | Path | Risk | Lines |
|----------|------|------|-------|
| ZKVerifierSP1 | `contracts/core/ZKVerifierSP1.sol` | CRITICAL | 620 |
| CoreRevenueSplitter | `contracts/core/CoreRevenueSplitter.sol` | HIGH | 1067 |
| veXFGovernance | `contracts/core/veXFGovernance.sol` | HIGH | 320 |
| ThetaInferenceCircuit | `contracts/circuits/ThetaInferenceCircuit.sol` | HIGH | 637 |
| SP1ProofHooks | `contracts/core/SP1ProofHooks.sol` | MEDIUM | 181 |

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
- [x] Line coverage report generated (`npx hardhat coverage`) — 449 tests, coverage written to `./coverage/`
- [x] >85% coverage on Phase 1 primary contracts — CoreRevenueSplitter 98.22%, ZKVerifierSP1 85.82%, veXFGovernance 92.86%, SP1ProofHooks 100%, ThetaInferenceCircuit 94.44%, Core aggregate 92.84%

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
- [x] `.env.deploy.example` with all required env vars

---

## Phase Plan

| Phase | Scope | Target | Status |
|-------|-------|--------|--------|
| Phase 1 | Core Layer + ThetaInferenceCircuit | Q2 2026 | In Progress |
| Phase 2 | InferenceRouter + TAOCircuit + BridgeCircuit | Q3 2026 | Planned |
| Phase 3 | ComputeMarketplace + ZKML + DataHubs + A2A | Q4 2026 | Planned |

---

## Remaining Items

- [x] Generate coverage report and close gaps to >85% — Core aggregate at 92.84% stmts
- [x] Create `.env.deploy.example`
- [x] Run `npm audit` — 65 vulnerabilities remain, all in transitive dev deps requiring breaking changes; no deployed contract code affected
- [x] npm audit full sweep (March 8, 2026) — Tier 1 fixes applied, reduced from 65 to 59 vulns:
  - Vite 5 → 7.3.1 (`esbuild` moderate fixed)
  - `@cosmjs/*` aligned to 0.33.1 (`@cosmjs/stargate` was mismatched 0.37.0 → 0.33.1)
  - `jest-environment-jsdom` 29 → 30 (`@tootallnate/once` low fixed)
  - `@nomicfoundation/hardhat-chai-matchers` 1 → 2 + `hardhat-toolbox` 2 → 3 (enables ethers v6 custom error matching; 138 tests pass)
  - Remaining 59 vulns: all blocked by Hardhat 3 migration (`@openzeppelin/hardhat-upgrades` incompatibility, tracked in `hardhat.config.cjs`), `@thetalabs/theta-js` lodash (no upstream fix), or `@hyperlane-xyz/sdk` chain (SDK not imported; downgrade from 25.x → 19.x would be regression)
- [x] Final review of all NatSpec for accuracy — distribute() docs updated for GET sub-split, claimGrant @dev fixed, voteGrant @dev added

---

*This checklist aligns with `docs/certik-phase1-scope.json` v5.0.0 and `docs/AUDIT_GRANT_READINESS.md`.*
