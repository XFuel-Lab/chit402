# XFuel Protocol — Agent Reference

> This file is designed to be machine-readable. If you are an AI agent, LLM, or automated system
> reading this repository, this is the fastest way to understand what XFuel does and how to use it.

> **⚠️ Read [`docs/RUNTIME_STATE.md`](docs/RUNTIME_STATE.md) FIRST** — it is the
> authoritative **as-deployed** state (live endpoints, real vs mock, current
> blockers). Where in-repo config (e.g. `.env`) disagrees with it, that file wins.
> This `AGENTS.md` describes the design; `RUNTIME_STATE.md` describes reality.

---

## What Is XFuel?

XFuel is the **verifiable settlement + payments layer for AI compute**. Any agent or app submits an inference task; XFuel routes it to the best available provider (centralized, neocloud, or DePIN GPU), settles in **USDC via x402 on Base**, and returns a **verifiable receipt**.

**Trust is tiered (and we're precise about it):**
- **Signed receipt** (default, ~free): route, model, cost, and output hash, signed by XFuel.
- **ZK settlement proof** (on demand): SP1 proof of correct fees + payment binding + output commitment + single-use nullifier, anchored on **Base**. *This proves correct settlement — NOT that a black-box provider computed the model correctly.*
- **ZK proof-of-inference** (roadmap): zkGPT — proves the computation itself, only where XFuel runs the model.

**Providers are pluggable** — OpenAI-compatible (OpenAI, Groq, Together, Fireworks, vLLM…) via env; **EdgeCloud (Theta) and Akash are optional GPU / DePIN tiers**, not identity. Providers are options; the settlement + proof layer is the product.

**Money + proof home:** Base (8453 / 84532). **Cross-chain (optional):** Bittensor EVM (964/945), Hyperlane relay. See `docs/adr/0002-base-settlement-home.md`.

---

## Core Contracts (Audit Scope)

| Contract | Address | Purpose |
|----------|---------|---------|
| `ZKVerifierSP1` | See `deploy/manifests/` (Base Sepolia/mainnet go-forward; Theta testnet = archive) | SP1 Groth16/PLONK proof verification + Hyperlane relay |
| Protocol treasury / Splits | `X402_PAY_TO` / `REVENUE_SPLIT_ADDRESS` on Base | USDC fee sink (ADR 0001) — **not** `CoreRevenueSplitter` |
| `veXFGovernance` | Later on Base | Vote-escrowed governance (when token launches) |
| `SP1ProofHooks` | Library (no address) | Nullifier computation, fee commitment, public value encoding |

`CoreRevenueSplitter` is **deprecated** from the go-forward fee path (ADR 0001).

---

## How to Submit a Task (M2M API)

```bash
POST http://{host}:3002/task-request
Headers: X-API-Key: {key}
Body:
{
  "message_type": "inference_request",  // or compute_bid, data_attestation, capability_query
  "chain_id": "base",                   // base | bittensor | akash | … (settlement / routing hint)
  "amount": "1000000",                  // gross task value in wei (min 10000)
  "sender": "0xYourAddress",
  "model_id": "llama-3-70b",            // required for inference_request
  "input_hash": "0xabc...",             // keccak256 of your input (required for inference)
  "payment": { "rail": "usdc", "network": "base-sepolia" }  // use network from /task-quote (hosted testnet = base-sepolia; base mainnet facilitator not yet provisioned)
}

Response: { taskId, status, routedTo, estimatedGas }
```

**Payment rails:** USDC via **x402 on Base** is the default (`X402_DEFAULT_RAIL=usdc`).
Agent pays USDC against a 402 challenge; agent-side pluggable payer — no server keys.
Optional native rails (e.g. TFUEL) may exist for specific provider flows but are not
the product default. See `docs/X402_ADAPTER.md` and
`packages/agent-skills/_shared/reference/payments-x402.md`.

Poll status: `GET /task-status?task_id={taskId}`

Webhooks (two options):
- Global: register via `PUT /webhook` with `{ url, secret, events? }` (events default to all; currently `TaskSettled`, `A2ASettled`). List with `GET /webhook`, remove with `DELETE /webhook?id=` or `?url=`.
- Per-task: pass `callback_url` (and optional `callback_secret`) on `POST /task-request`.
- Deliveries are signed: `X-XFuel-Signature: sha256=<hmac>` where HMAC-SHA256 uses the webhook secret (or `WEBHOOK_SECRET`). Verify with `crypto.timingSafeEqual`.

Full API: `docs/M2M_API.md`

---

## OpenAI-Compatible Endpoint (drop-in)

Prefer standard tooling? XFuel serves the OpenAI surface on the same server:

```
GET  {host}:3002/v1/models
POST {host}:3002/v1/chat/completions   # streaming + non-streaming
GET  {host}:3002/llms.txt              # public agent-discovery manifest (no auth)
Auth: Authorization: Bearer {key}  (or X-API-Key: {key})
```

Point any OpenAI-compatible client's `baseURL` at `{host}:3002/v1`. Each response
carries a verifiable-compute receipt in `x-xfuel-*` headers and an `xfuel` body
field (`compute.real`, `proof.status`, `proof.attests`, links to `/prove-result`).
The proof attests settlement metadata + an output-hash commitment (not inference
correctness); the OpenAI path is unmetered in Phase 1 (use `/task-request` +
`payment.rail="usdc"` for x402). Full reference: `docs/OPENAI_COMPATIBLE_GATEWAY.md`.

---

## Compute Routing Priority

Tasks are routed through a configurable multi-tier router (first available, lowest cost).
Typical order (override via `.env.local`; leave a tier blank to skip):

```
1. Neocloud / OpenAI-compatible (Groq, OpenAI, Together, Fireworks, …)
2. EdgeCloud GPU (optional DePIN tier — ondemand.thetaedgecloud.com)
3. MCP (local)                                  — low-latency local
4. Akash Network                                — decentralized GPU marketplace
5. Render Network                               — GPU marketplace (image/LLM)
6. AWS Bedrock                                  — centralized last resort
```

EdgeCloud is a **GPU provider option**, not settlement home (ADR 0002).

---

## ZK Proof Pipeline

1. Task intent submitted → fee tagged with `ProviderTag` (THETA_NATIVE=1, DEPIN_AKASH=3, etc.)
2. SP1 prover (AWS ECS `xfuel-sp1-prover`, validated on Succinct, ~25s) generates Groth16 proof (~260 bytes, ~270K gas)
3. `AITaskPublicValues` committed: `(taskType, sourceChain, destChain, taskIdHash, senderHash, netAmount, feeAmount, feeBps, outputHash, blockHeight, timestamp, nonce)`. **Phase 2 (flag-gated, `X402_PROOF_BINDING`):** an optional 13th field `paymentCommitment` binds the x402 `payment_ref` so the proof attests payment + computation (`SP1ProofHooks.encodeAITaskPublicValuesV2`; surfaced as `payment_binding`). Activates on SP1 guest v2 rebuild (new `programVKey`).
4. `ZKVerifierSP1.verifyProof(programVKey, publicValues, proofBytes)` on **Base**
5. Nullifier stored → replay protection
6. Protocol USDC fee already at `X402_PAY_TO` / Splits (off hot path; ADR 0001)

---

## Fee Distribution

**Token-light (go-forward):** each task's USDC fee lands at **one address on Base**
(protocol Safe or Splits v2). Bucket fan-out is off the hot path and
governance-adjustable. There is **no** hardcoded 30/30/25/15 per-fee split and
**no** fixed staker yield entitlement. XF buyback-burn (when the token exists) is
downstream treasury policy on Base. See ADR 0001 / ADR 0002 and
`services/gateway/src/revenue-split.js`.

Legacy `CoreRevenueSplitter` (native TFUEL, 30/30/25/15) is deprecated from the
fee path; ignore it for new integrations.

---

## Agent-to-Agent (A2A) Communication

```
// Register your agent
A2ACircuit.registerAgent(identityHash, endpoint, capabilityFlags)

// Submit a bid for a task
A2ACircuit.submitBid(taskHash, capabilityRequired, deadline)  // with TFUEL escrow

// Accept a bid (as provider)
A2ACircuit.acceptBid(bidId, price)

// Settle with ZK proof of delivery
A2ACircuit.settleBid(bidId, resultHash, proofBytes, nullifier)

// Open a micropayment channel (x402-style)
CoreRevenueSplitter.createEscrow(payee, maxAmount, taskId, duration)
CoreRevenueSplitter.claimEscrow(escrowId, claimAmount)  // repeatable
```

Swarm lifecycle: `formSwarm → joinSwarm (up to 18 agents) → settleSwarmAgent → dissolveSwarm`

---

## Cross-Chain Proof Relay

```
// Verify locally and relay to Bittensor EVM
ZKVerifierSP1.relayProofCrossChain(
  circuitId, programVKey, publicValues, proofBytes, nullifier,
  destDomain,    // 964 = Bittensor Mainnet, 945 = Bittensor Testnet
  recipient      // TAOCircuit address on destination
)

// Bittensor: stake-gated verification
ZKVerifierSP1.verifyWithStakeCheck(circuitId, programVKey, publicValues, proofBytes, nullifier, minStake)
```

---

## Governance

Agents holding veXF can vote on protocol parameters:

```
veXFGovernance.lock(amount, unlockTime)         // lock XF → receive veXF
veXFGovernance.createProposal(type, circuit, description, data)
veXFGovernance.vote(proposalId, support)         // with ZK nullifier replay protection
```

| Proposal Type | Quorum | What it controls |
|---------------|--------|-----------------|
| CircuitPriority | 10% | Which circuits get priority routing |
| LPAllocation | 15% | GET sub-allocation weights |
| FeeStructure | 20% | Fee BPS and split ratios |
| TreasurySpend | 25% | Expenditures >$50K |
| EmergencyPause | 5% + 67% supermajority | Circuit breakers |

---

## SDK (JavaScript)

```bash
npm install xfuel-sdk  # live on npm @0.2.0 (Apache-2.0). On-chain module: import 'xfuel-sdk/onchain' (requires ethers peer dep). Quickstart: npm run example:quickstart (packages/sdk)
```

```javascript
import { XFuelClient } from 'xfuel-sdk';

const client = new XFuelClient({
  baseUrl: 'https://api-testnet.xfuel.app',   // live public gateway
  apiKey: process.env.XFUEL_API_KEY
});

const task = await client.submitInference({
  model: 'llama-3-70b',
  input: 'Explain ZK proofs in one sentence.',
  maxFee: '1000000'
});

const result = await client.waitForSettlement(task.taskId);
```

---

## Key Repository Paths

```
contracts/core/           — Core settlement (see WHITEPAPER §11.5 Audit Phase 1)
contracts/circuits/       — Circuits incl. ThetaInference + funding + ecosystem
docs/AUDIT_READINESS_CHECKLIST.md — Gap list before auditor handover
docs/LEGAL_LAUNCH_CHECKLIST.md    — Legal/compliance planning (not legal advice)
docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md — Testnet 365 + mainnet 361 steps, tests (`npm run test:believer`)
apps/web/.env.example    — All VITE_* vars; testnet 365 vs mainnet 361
core-layer/               — Settlement orchestration: AI listener, A2A orchestrator, CosmWasm WASM
services/gateway/         — Agent-facing API gateway: routing, payments, proving, receipts, M2M API, fee analytics
packages/sdk/             — JavaScript SDK (xfuel-sdk, live on npm @0.2.0) + runnable examples/ (quickstart, pay-with-usdc, pay-prove-verify, a2a-swarm, swarm-coordinate)
packages/mcp/             — First-party MCP server (live on npm @0.1.1: npx xfuel-mcp; MCP registry io.github.XFuel-Lab/xfuel-mcp): list_models, submit_inference, pay_with_usdc, get_task_status, get_proof, verify_proof, quote_task, get_health; stdio + streamable HTTP
packages/agent-skills/    — Agent Skills (front door for agents); start with packages/agent-skills/AGENT_PLAYBOOK.md
docs/M2M_API.md           — Full REST API reference
docs/THETA_INTEGRATION_PLAN.md — Theta deep integration tracker
docs/TAO_CIRCUIT_HYPERLANE_E2E.md — Bittensor cross-chain E2E guide
docs/ZK-RESEARCH-PIPELINE.md — ZK research pipeline (papers, tiers, product-fit)
docs/ZK-RESEARCH-UPGRADE-PACKAGE.md — Unified upgrade package (best per area, no overlap)
deploy/manifests/         — Timestamped deployment manifests (testnet addresses)
services/zkgpt-prover/    — Phase 1 zkGPT mock server + smoke test (E2E)
docs/PHASE1_KICKOFF.md    — Phase 1 status, run Phase 1 checks (npm run test:phase1), post-deploy checklist
```

**Core tests:** `npm run test:contracts:core` runs `test:contracts:core:listener` (`node:test`, `core-layer/test/ai-listener.test.js`) then `test:contracts:core:solidity` (Hardhat: `core-layer/test/*.cjs`, `test/phase3`, `test/security`). **Full contract matrix:** `npm run test:contracts:all` runs the same listener step then `test:contracts:all:hardhat`, implemented by `scripts/hardhat-test-all.cjs` (explicit file list — works on Windows; no shell glob). CI `test.yml` mirrors this with two steps before coverage. Believer or Angel rounds: `npm run test:believer`. For a narrower green gate (core + phase3 + security Hardhat only), use `npm run test:contracts:core:solidity`.

**zkLLM prover tests:** `cd services/zkllm-prover && cargo test` (self-owned ZK prover, Phase 5). CI runs this in the `zkLLM Prover Tests` job in `test.yml` (plus `cargo build --examples`). The RAM/time benchmark is hardware-gated — see `docs/ZKG5_BENCHMARK.md`.

---

## Committing (local git hooks)

This repo ships a `.git/hooks/pre-commit` that requires an interactive `YES` (read from `/dev/tty`), which a non-interactive agent shell cannot provide. **Do NOT use `git commit --no-verify`** to get around this — the hook has a built-in bypass for automation. Instead run:

```bash
GIT_COMMIT_CONFIRMED=YES git commit -F <msg-file>
```

This runs the hook and passes its check via its own escape hatch, so any future hook logic (lint/tests) still executes. The `pre-push` hook only blocks direct pushes to `main`/`master`/`develop`; always work on a feature branch and merge via PR (`gh`), which the hook allows. On PowerShell, set it inline as `$env:GIT_COMMIT_CONFIRMED='YES'; git commit -F <msg-file>` (multi-line messages: write to a temp file and use `-F`, since heredocs aren't supported).

---

## Security

- Bug bounty: up to $50,000 (Critical). See [`docs/bug-bounty.md`](docs/bug-bounty.md)
- Responsible disclosure: security@xfuel.app or [GitHub Security Advisory](https://github.com/XFuel-Lab/xfuel-protocol/security)
- **Audit waves:** See **WHITEPAPER.md §11.5** — **Audit Phase 1** = `contracts/core/` + `ThetaInferenceCircuit` + funding/engagement contracts + proof hooks; **Audit Phase 2** = remaining EVM circuits (TAO, Bridge, Data, M2M-facing, etc.) staggered post–Phase 1.

---

## Community Contribution Round (`BelieverRound`) — RETIRED

> **Status: retired as a fundraising vehicle.** Public UI redirects `/believers` and `/angels` home. Pre-seed/seed = equity-first SAFE ([`docs/FUNDRAISING_STRUCTURE.md`](docs/FUNDRAISING_STRUCTURE.md)). Historical contract params below are archive-only.

Single open community sale (no phased 4/12/24% tranches). **`xfAllocationCap`** enforces up to **150M XF** (15% of 1B) reserved. **`setTokenPrice`** while **Open** updates XF per TFUEL (multisig; see `docs/PRICING_TFUEL_XF.md`).

| Parameter | Value |
|-----------|-------|
| Contract | `contracts/circuits/BelieverRound.sol` |
| XF ceiling | `xfAllocationCap` (default deploy: 150M XF) |
| TFUEL hard cap | Env / deploy (e.g. `BELIEVER_HARD_CAP`) |
| Min commitment | Default **100 TFUEL** at deploy; override with `BELIEVER_MIN_COMMITMENT` (human TFUEL string, e.g. `1` for testnet) |
| Max per wallet | Env (`0` = none) |
| Base price (default deploy) | **5 XF per 1 TFUEL** (`BELIEVER_PRICE_NUM` / `DEN`) |
| Cliff / vesting | 90d cliff + 270d linear |
| Lock bonuses | Optional tiers 1–3: **+8% / +20% / +35%** on base XF (effective **5.4 / 6 / 6.75** XF per TFUEL at default base 5) |
| Admin | `0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257` (Gnosis Safe) |
| UI | `apps/web` route `/believers` |

**Commit (on-chain):**
```
BelieverRound.commit{ value: tfuelAmount }()
BelieverRound.commitWithLock{ value: tfuelAmount }(tier)
```

Refund if TGE not triggered within 180 days. Deploy: `believer/launch-round.cjs` · Env: `BELIEVER_XF_ALLOCATION_CAP` (human XF, default `150000000`). **Full launch flow:** [`docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md`](docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md) · Tests: `npm run test:believer`.

---

## Community Engagement Rewards (15%)

**`contracts/circuits/CommunityEngagementDistributor.sol`** — Merkle seasons, lifetime cap `maxLifetimeXF` (150M XF when matching full bucket). Docs: `docs/COMMUNITY_ENGAGEMENT_REWARDS.md`. Deploy helper: `believer/deploy-engagement-distributor.cjs`.

---

## Angel / Strategic Round (`AngelRound`)

Separate from community round: **no TFUEL refund**; **`withdrawToTreasury`** before TGE with memo. **`xfAllocationCap`** = **100M XF** (10%) at default deploy.

| Parameter | Typical default (env overrides) |
|-----------|----------------------------------|
| Deploy script | `believer/launch-angel-round.cjs` |
| XF ceiling | `ANGEL_XF_ALLOCATION_CAP` (default `100000000`) |
| Hard cap | `ANGEL_HARD_CAP` TFUEL |
| Min commitment | `ANGEL_MIN_COMMITMENT` (TFUEL) or `ANGEL_MIN_COMMITMENT_WEI` (raw wei, e.g. `1`) |
| Price | `ANGEL_PRICE_NUM` / `ANGEL_PRICE_DEN` (default deploy **8 XF per 1 TFUEL** — more XF per TFUEL than Believer base **5**) |
| Cliff / vesting | 90d + 270d linear |
| TGE | **Separate** `triggerTGE` from BelieverRound |

**veXF:** Lock XF in `veXFGovernance` after claim.

**apps/web:** `/angels`, env `VITE_ANGEL_ROUND_ADDRESS`. **Launch runbook:** [`docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md`](docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md).

---

## ZK Prover Research Track — Interstellar

XFuel's current ZK pipeline uses **SP1 (Succinct)** — STARK proving with Groth16/PLONK wrapping for on-chain settlement (~270K gas per proof). A first-party research upgrade has been published by Theta Labs:

**[Interstellar](https://eprint.iacr.org/2025/1294)** — GKR-based IVC folding scheme (Jieyi Long, Theta Labs, PKC 2026). Key properties:
- **1.59x–6.74x prover speedup** on matrix/transformer workloads (direct benefit to `inference_request` proving)
- **Collaborative folding** — multiple provers with disjoint private witnesses produce a single joint IVC proof (enables ZK-verified swarm tasks across `formSwarm`/`joinSwarm` agents)

**No on-chain changes required.** `ZKVerifierSP1.sol` verifies Groth16/PLONK — it is proof-system-agnostic. Interstellar is a prover-side upgrade only (`services/sp1-prover/` + a new `SP1_PROVER=interstellar` env option).

**Status:** Not yet integrated (pending SP1 toolchain support or Theta EdgeCloud dedicated prover). Tracked in `WHITEPAPER.md` Section 12 — Research Track.

---

## References & Research Credits

XFuel attributes and cites third-party research used in the protocol. Full citations, eprint links, and compliance: **[`docs/REFERENCES-AND-ATTRIBUTION.md`](docs/REFERENCES-AND-ATTRIBUTION.md)**.

| Integration | Source |
|-------------|--------|
| **zkGPT** (Phase 1) | [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184); implementation [github.com/security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt) |
| **Fair Exchange (PAS)** (Phase 1) | [eprint.iacr.org/2026/395](https://eprint.iacr.org/2026/395) — *Delegated Payments for AI Agents: Fair Exchange on Bitcoin/EVM* |
| **Interstellar** (research track) | [eprint.iacr.org/2025/1294](https://eprint.iacr.org/2025/1294) (Jieyi Long, Theta Labs; PKC 2026) |

**Phase 1 deploy (optional env):** `FAIR_EXCHANGE_PROXY_ADDRESS` (deploy-full/testnet → setFairExchangeProxy), `ZK_VERIFIER_ZKGPT` (theta-inference.cjs), `ZKGPT_PROVER_URL` (`services/gateway` + core-layer; Tier-3 zkGPT is roadmap/blocked on GPU — the `services/zkgpt-prover/` mock is dev-only, never a live path). See [docs/PHASE1_KICKOFF.md](docs/PHASE1_KICKOFF.md) post-deploy checklist.
