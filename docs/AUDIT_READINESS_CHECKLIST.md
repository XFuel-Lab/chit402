# Audit Phase 1 — readiness checklist

Tracks **gaps before handing auditors a clean “Theta production core” package**. Scope matches **WHITEPAPER.md §11.5** (Audit Phase 1).

**Believer / Angel deploy & testnet → mainnet:** [`FUNDING_ROUNDS_LAUNCH_RUNBOOK.md`](FUNDING_ROUNDS_LAUNCH_RUNBOOK.md) · `npm run test:believer`

## 1. Scope freeze (what auditors review)

- [ ] **Pinned manifest** — single JSON under `deploy/manifests/` with **exact addresses** for: `ZKVerifierSP1`, `CoreRevenueSplitter`, `veXFGovernance`, `ThetaInferenceCircuit`, `BelieverRound`, `AngelRound`, `CommunityEngagementDistributor` (if deployed), and any **proxy** implementations.
- [ ] **Git ref** — tag or commit hash recorded in manifest (e.g. `audit-2026-q2-core`).
- [ ] **Excluded from Phase 1** — list circuits **not** in scope so reviewers do not chase dead code paths. **Includes:** Cosmos / IBC reverse bridge (`contracts/legacy/VaultFactory`, `SubVault`) and `test/cosmos-yield/*` — tied to **YieldCircuit** + CosmWasm; run separately via `npm run test:contracts:cosmos-yield`, not the Phase 1 core matrix.

## 2. Solidity & build

- [ ] `npx hardhat compile` clean on pinned commit.
- [ ] **NatSpec** on public/external functions for in-scope contracts (admin paths, pausing, TGE, refunds).
- [ ] **Slither / static analysis** (or equivalent) run; **critical/high** issues triaged or documented.
- [ ] **Test summary** — `npx hardhat test` (or CI matrix) with counts for **BelieverRound**, **AngelRound**, **core** contracts.

## 3. Funding contracts (Believer / Angel / Engagement)

- [ ] **Constructor params** documented: `xfAllocationCap`, TFUEL `hardCap`, `minCommitment`, initial price num/den, `ADMIN` multisig.
- [ ] **Ops runbook** — `closeRound` → `triggerTGE` → XF `approve`/`transferFrom` amounts = `totalXFReserved` per contract.
- [ ] **UI alignment** — `xfuel-app` env addresses match manifest (see `xfuel-app/.env.example`).

## 4. Verifier & inference path

- [ ] **Program vkey** (or equivalent) and **public input layout** documented for the **ThetaInferenceCircuit** program path auditors should assume.
- [ ] **SP1ProofHooks** — documented linkage to `ZKVerifierSP1` (nullifier, fee tagging) with **no ambiguous dual entrypoints**.
- [ ] **Mock / test flags** — confirm **mainnet deploy** cannot leave test-only toggles enabled.

## 5. Off-chain & operational (gating, often out-of-firm scope but required for “production”)

- [ ] **Prover** — version, CUDA/docker image ref, env vars for **mainnet** (no test keys).
- [ ] **Listener / bridge** — which service submits proofs; failure modes; no double-settlement.
- [ ] **Key custody** — multisig signers, timelock if any, rotation procedure.

## 6. Legal & communications (parallel to technical audit)

- [ ] [`docs/LEGAL_LAUNCH_CHECKLIST.md`](LEGAL_LAUNCH_CHECKLIST.md) reviewed with counsel.
- [ ] **Terms / Privacy** published or staged for URLs referenced by the app.
- [ ] **Bug bounty** public rules — [`docs/bug-bounty.md`](bug-bounty.md).

## 7. Handover package (what you email the firm)

Suggested bundle:

1. Scope letter (this checklist + §11.5).
2. Manifest JSON + commit hash.
3. Architecture diagram (fee flow: task → proof → verifier → splitter).
4. Test instructions + `hardhat` network assumptions.
5. Known issues list (honest).

---

**After Audit Phase 1:** open **Audit Phase 2** tickets per circuit wave (TAO, Bridge, Data, …) with **their own** manifests and smaller diffs.
