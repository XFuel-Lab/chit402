# Audit Phase 1 — Readiness

Gaps before handing auditors the Base production core. Scope: WHITEPAPER §11.5.

Fundraising context: [FUNDRAISING_STRUCTURE.md](./FUNDRAISING_STRUCTURE.md) (equity-first SAFE).  
Seed scaffold: [SEED_READINESS.md](./SEED_READINESS.md). Staging ops: [STAGING_SLA.md](./STAGING_SLA.md).

## Eng progress (Sprint 4)

| Item | Status |
|------|--------|
| Fee sink docs (X402_PAY_TO / Splits) | Documented — ADR 0001 + MAINNET_X402_CHECKLIST |
| Verifier address on Base mainnet | Live — RUNTIME_STATE |
| Public-values / payment binding layout | Documented — public-values.md; guest v2 activation pending |
| Receipt / auditor export | `?format=auditor` selective disclosure |
| Bug bounty page | Present — bug-bounty.md |
| Pinned manifest + git tag for audit commit | **Open — founder/ops** |
| Slither + NatSpec sweep | **Open** |
| Counsel / Terms | **Open — founder** |
| Prover image ref pinned in RUNTIME_STATE | Partial — update on next deploy |

## Scope freeze

- [ ] Pinned manifest under `deploy/manifests/` with exact addresses for `ZKVerifierSP1`, `veXFGovernance`, `ModelRegistry` / staking surfaces in Phase 1, and any proxy implementations
- [ ] Git ref (tag or commit) recorded in the manifest
- [ ] Explicit Phase 1 exclusions listed (e.g. Cosmos / IBC reverse bridge, retired sale contracts, out-of-wave circuits)

Excluded from Phase 1 by default: `contracts/legacy/`, retired sale contracts, CosmWasm yield paths (`npm run test:contracts:cosmos-yield` separately).

## Solidity and build

- [ ] `npx hardhat compile` clean on the pinned commit
- [ ] NatSpec on public/external functions for in-scope contracts
- [ ] Slither (or equivalent); critical/high triaged or documented
- [ ] Test summary for core + Phase 1 circuits (`npm run test:contracts:core`)

## Verifier and settlement path

- [ ] Program vkey and public-input layout documented for the SP1 settlement path
- [ ] `SP1ProofHooks` linkage to `ZKVerifierSP1` (nullifier, fee tagging) with no ambiguous dual entrypoints
- [ ] Mainnet deploy cannot leave test-only toggles enabled
- [ ] Fee sink documented: `X402_PAY_TO` / Splits on Base ([ADR 0001](./adr/0001-usdc-revenue-and-router-verifier-positioning.md))

## Off-chain / ops

- [ ] Prover version, image ref, mainnet env (no test keys) — [RUNTIME_STATE.md](./RUNTIME_STATE.md)
- [ ] Which service submits proofs; failure modes; no double-settlement
- [ ] Key custody: multisig signers, timelock if any, rotation

## Legal / communications

- [ ] [LEGAL_LAUNCH_CHECKLIST.md](./LEGAL_LAUNCH_CHECKLIST.md) with counsel
- [ ] Terms / Privacy staged for app URLs
- [ ] Bug bounty rules public — [bug-bounty.md](./bug-bounty.md)

## Handover package

1. Scope letter (this checklist + WHITEPAPER §11.5)
2. Manifest JSON + commit hash
3. Architecture note: task → proof → verifier → Base USDC sink
4. Test instructions + Hardhat network assumptions
5. Known issues list

After Phase 1: open Phase 2 circuit waves (TAO, Bridge, Data, …) with their own manifests.
