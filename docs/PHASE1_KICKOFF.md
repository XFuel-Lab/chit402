# Phase 1 Kickoff — zkGPT + Fair Exchange

> **Start here** for Phase 1 of the [ZK Research Upgrade Package](./ZK-RESEARCH-UPGRADE-PACKAGE.md). This doc tracks immediate next steps and links to research and implementation. Full plan: [PHASE1_INTEGRATION_PLAN.md](./PHASE1_INTEGRATION_PLAN.md).

**Status:** Phase 1 — zkGPT: memo, API, stub + `_verifyZkGPTProof` hook (ZKG-2 spec), ZKG-4 wired, ZKG-1 client + mock + **wrapper-template** (ZKGPT_PROVER_CMD for C++ prover); Fair Exchange: FE-1–FE-5 done (FE-2 N/A: PAS off-chain). Deploy, post-deploy checklist, integration tests: `npm run test:phase1`. **zkGPT mock E2E:** wrapper-template image deployed to Theta EdgeCloud; POST task-request with `proof_system: zkgpt` → prover → fee_collected (stub proof). Test script: `backend/theta-bridge/scripts/test-task-zkgpt.ps1`. Next: implement GKR+Lasso in `_verifyZkGPTProof` (ZKG-2); build upstream C++ prover and wire via wrapper-template for real proof tests.

---

## Run Phase 1 checks

From repo root, run contract tests and the zkGPT mock smoke test:

```bash
# Phase 1 contract tests (ZKVerifierZkGPT, ZKML + ThetaInference zkGPT integration, Theta circuit + handler)
npm run test:contracts:theta
# Or run only Phase 1 zkGPT contract tests:
# npx hardhat test test/phase1/ZKVerifierZkGPT.test.cjs test/phase1/ZKMLCircuitZkGPTIntegration.test.cjs test/phase1/ThetaInferenceCircuitZkGPTIntegration.test.cjs

# zkGPT mock API smoke test (spawns mock server, hits /health and /prove)
npm run test:zkgpt-mock

# Or both in one go
npm run test:phase1
```

**zkGPT E2E (live M2M):** With `npm run m2m-server` and `ZKGPT_PROVER_URL` (e.g. Theta EdgeCloud prover) set, run:

```powershell
cd backend/theta-bridge
.\scripts\test-task-zkgpt.ps1
```

Fair Exchange is covered by `circuits/a2a/test/A2ACircuit.test.cjs` (e.g. `settleBidFairExchange` with valid signature). Run with `npx hardhat test circuits/a2a/test/A2ACircuit.test.cjs` or as part of full contract tests.

---

## Order of Work (from integration plan)

1. **Research first** — Produce both memos before committing to full integration.
2. **zkGPT path** — ZKG-1 → ZKG-2 → ZKG-3 → ZKG-4 → ZKG-5 (after feasibility memo).
3. **Fair Exchange path** — FE-1 → FE-2 → FE-3; then FE-4, FE-5 (after design memo).
4. **Parallelization** — Research can run in parallel; implementation tracks are independent after research.

---

## Immediate Next Steps

### Research (do first)

| Task | Owner | Output | Doc |
|------|--------|--------|-----|
| zkGPT feasibility | — | 1–2 page memo: replace vs layer, verifier impact, implementation source, first milestone | [zkGPT feasibility memo](./research/zkGPT-feasibility-memo.md) ✅ filled |
| Fair Exchange design | — | 1–2 page memo: mapping to `settleBid`, contract/circuit changes, atomicity design | [Fair Exchange design memo template](./research/fair-exchange-design-memo.md) |

**References (full attribution: [REFERENCES-AND-ATTRIBUTION.md](./REFERENCES-AND-ATTRIBUTION.md)):**
- **zkGPT:** [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184); author GitHub: jiahengzhang; code: [security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt). Use the **zkGPT whitepaper PDF** as reference (e.g. local: `C:\Users\seeha\Downloads\zkGPT whitepaper.pdf`). Summary: GKR + Lasso; 101 KB proof; non-interactive; BN254; GPT-2 in &lt;25 s — see [research/zkGPT-feasibility-memo.md](./research/zkGPT-feasibility-memo.md).
- **Fair Exchange:** [eprint.iacr.org/2026/395](https://eprint.iacr.org/2026/395) — “Delegated Payments for AI Agents: Fair Exchange on Bitcoin/EVM.”

### Implementation (after research)

**zkGPT (second verifier path):**

| Step | Description | Status |
|------|-------------|--------|
| ZKG-1 | Integrate zkGPT prover (e.g. upstream repo); single block or GPT-2-small | 🔶 Client + backend + core-layer wiring done; **mock server** `zkgpt-prover/mock-server.cjs` + **smoke test** `zkgpt-prover/smoke-test.cjs` for E2E. Real prover: build from [security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt) and expose same HTTP API. |
| ZKG-2 | Implement and deploy `ZKVerifierZkGPT`; inference with `proof_system: zkgpt` calls this verifier | 🔶 Spec + input validation + internal `_verifyZkGPTProof(publicValues, proofBytes)` hook; implement GKR+Lasso in that function per [ZKG2_VERIFIER_SPEC.md](./ZKG2_VERIFIER_SPEC.md) |
| ZKG-3 | Add `proof_system: zkgpt` to task request and backend routing | ✅ (server.js + M2M_API.md) |
| ZKG-4 | Wire ZKMLCircuit/ThetaInferenceCircuit to zkGPT path (same events, fee path) | ✅ (circuits + handlers pass useZkGPT) |
| ZKG-5 | Benchmark: zkGPT prover time and verification gas; document | 🔶 Scaffold: [ZKG5_BENCHMARK.md](./ZKG5_BENCHMARK.md) — fill when E2E ready |

**Fair Exchange:**

| Step | Description | Status |
|------|-------------|--------|
| FE-1 | Design atomic flow (provider result commitment + requester payment release) | ✅ (design memo) |
| FE-2 | Implement circuit/commitment logic per paper if needed | ✅ N/A (PAS off-chain; contract verifies σ only; see [fair-exchange-design-memo](./research/fair-exchange-design-memo.md)) |
| FE-3 | Extend A2ACircuit: e.g. `settleBidFairExchange(...)` or new params; keep backward compat | ✅ (settleBidFairExchange + setFairExchangeProxy) |
| FE-4 | Relayer/backend: submit Fair Exchange flow when enabled | ✅ (POST /a2a-settle-fair-exchange; A2A_CIRCUIT_ADDRESS + optional RELAYER_PRIVATE_KEY) |
| FE-5 | SDK: `client.settleWithFairExchange(bidId, result)` | ✅ (XFuelClient.settleWithFairExchange(params)) |

---

## Code Touchpoints (Phase 1)

| Area | Files | Change |
|------|--------|--------|
| **zkGPT verifier** | `contracts/core/ZKVerifierZkGPT.sol`, `contracts/interfaces/IZKVerifierZkGPT.sol` | Stub + input validation (length bounds); implementation spec: [ZKG2_VERIFIER_SPEC.md](./ZKG2_VERIFIER_SPEC.md). |
| **Inference circuit** | `contracts/circuits/ZKMLCircuit.sol`, `contracts/circuits/ThetaInferenceCircuit.sol` | Optional: zkVerifierZkGPT address, route by proof type. |
| **Task routing** | `backend/theta-bridge/src/server.js`, `core-layer/ai-listener.js` | Accept `proof_system` in task request; route zkgpt to zkGPT prover + verifier. |
| **zkGPT mock (E2E)** | `zkgpt-prover/mock-server.cjs`, `zkgpt-prover/wrapper-template.cjs`, `zkgpt-prover/smoke-test.cjs` | Mock: `node mock-server.cjs`. Wrapper: set `ZKGPT_PROVER_CMD` to wrap C++ prover (stdin/stdout JSON); else mock. Smoke: `node smoke-test.cjs`. |
| **A2A settle** | `contracts/circuits/A2ACircuit.sol` | Fair Exchange: new state or `settleBidFairExchange`; relayer + SDK. |
| **API** | `docs/M2M_API.md` | Document `proof_system` (optional, e.g. `sp1` \| `zkgpt`) for inference. |
| **Benchmarks** | `docs/ZKG5_BENCHMARK.md` | Prover time + verification gas (fill when E2E ready). |
| **Deploy** | `deploy/deploy-core.cjs`, `deploy-full.cjs`, `testnet.cjs`, `theta-inference.cjs` | ZKVerifierZkGPT deployed; deploy-full/testnet call `setZKVerifierZkGPT` on ZKMLCircuit; optional `FAIR_EXCHANGE_PROXY_ADDRESS` → `setFairExchangeProxy` (Phase 3c); theta-inference supports optional `ZK_VERIFIER_ZKGPT`. See [post-deploy checklist](#phase-1-post-deploy-checklist). |
| **Tests** | `test/phase1/*.test.cjs` | ZKVerifierZkGPT stub; ZKML + ThetaInference zkGPT integration (verifyInference/settleIntent with useZkGPT=true → ProofFailed while stub). |

---

## Phase 1 post-deploy checklist

After deploying Core Layer and/or circuits, complete these steps if using Phase 1 features:

| Step | When | Action |
|------|------|--------|
| **ZKMLCircuit** | After deploy-full or testnet | `setZKVerifierZkGPT(manifest.contracts.ZKVerifierZkGPT)` is called automatically by the deploy script. |
| **ThetaInferenceCircuit** | After theta-inference.cjs deploy | Set env `ZK_VERIFIER_ZKGPT` to the ZKVerifierZkGPT address before running, or call `setZKVerifierZkGPT(addr)` manually after deploy. |
| **A2A Fair Exchange** | When using Fair Exchange flow | Call `A2ACircuit.setFairExchangeProxy(proxyAddress)` (admin). Configure `RELAYER_PRIVATE_KEY` and `A2A_CIRCUIT_ADDRESS` in backend if the API should submit settle tx. |
| **zkGPT prover** | When using proof_system: zkgpt | Set `ZKGPT_PROVER_URL` (backend theta-bridge and/or core-layer when run standalone) and optionally `ZKGPT_PROVER_TIMEOUT_MS`. |
| **Fair Exchange proxy** | When using Fair Exchange flow | Set `FAIR_EXCHANGE_PROXY_ADDRESS` before running deploy-full or testnet to have the script call `A2ACircuit.setFairExchangeProxy(addr)`; otherwise set manually after deploy. |

---

## Success Criteria (Phase 1)

- **zkGPT:** At least one inference request (e.g. single block or small model) is proven with zkGPT and verified on-chain; proof time and gas documented.
- **Fair Exchange:** At least one A2A bid is settled using the atomic Fair Exchange flow.
- **No regression:** Existing `inference_request` and `settleBid` flows still work (unchanged or behind feature flag).

---

## Stub / Scaffolding in Repo

- **Interface:** `contracts/interfaces/IZKVerifierZkGPT.sol` — same `verifyProof(circuitId, publicValues, proofBytes, nullifier)` pattern as SP1 so circuits can swap verifier address.
- **Stub contract:** `contracts/core/ZKVerifierZkGPT.sol` — validates proof/publicValues length; calls internal `_verifyZkGPTProof(publicValues, proofBytes)` (returns false until ZKG-2). Implement GKR+Lasso inside `_verifyZkGPTProof` per [ZKG2_VERIFIER_SPEC.md](./ZKG2_VERIFIER_SPEC.md).
- **Prover wrapper:** `zkgpt-prover/wrapper-template.cjs` — HTTP server with same API as mock; set `ZKGPT_PROVER_CMD` to run a real prover (stdin/stdout JSON).
- **Research templates:** `docs/research/zkGPT-feasibility-memo.md`, `docs/research/fair-exchange-design-memo.md` — fill these first.

---

*Last updated: March 2026. See [PHASE1_INTEGRATION_PLAN.md](./PHASE1_INTEGRATION_PLAN.md) for full research tasks and [ZK-RESEARCH-UPGRADE-PACKAGE.md](./ZK-RESEARCH-UPGRADE-PACKAGE.md) for phase overview.*
