# XFuel Protocol — Agent Reference

> This file is designed to be machine-readable. If you are an AI agent, LLM, or automated system
> reading this repository, this is the fastest way to understand what XFuel does and how to use it.

---

## What Is XFuel?

XFuel is a **ZK settlement and orchestration layer for AI compute across decentralized GPU networks (DePIN)**.

It lets any agent submit an AI compute task, routes it to the best available GPU provider, generates a cryptographic ZK proof that the work was done, and settles payment on-chain — with fees distributed automatically to stakeholders.

**Primary network:** Theta (chain 361/365). **Cross-chain:** Bittensor EVM (964/945), Cosmos IBC (pending governance).

---

## Core Contracts (Audit Scope)

| Contract | Address (Testnet 365) | Purpose |
|----------|-----------------------|---------|
| `ZKVerifierSP1` | See `deploy/manifests/` | SP1 Groth16/PLONK proof verification + Hyperlane relay |
| `CoreRevenueSplitter` | See `deploy/manifests/` | Fee collection + distribution (BBB/GET/Staker/Treasury) |
| `veXFGovernance` | See `deploy/manifests/` | Vote-escrowed governance (Curve-style, 3x max multiplier) |
| `SP1ProofHooks` | Library (no address) | Nullifier computation, fee commitment, public value encoding |

---

## How to Submit a Task (M2M API)

```bash
POST http://{host}:3002/task-request
Headers: X-API-Key: {key}
Body:
{
  "message_type": "inference_request",  // or compute_bid, data_attestation, capability_query
  "chain_id": "theta",                  // theta | bittensor | akash | osmosis | persistence
  "amount": "1000000",                  // gross task value in wei (min 10000)
  "sender": "0xYourAddress",
  "model_id": "llama-3-70b",            // required for inference_request
  "input_hash": "0xabc...",             // keccak256 of your input (required for inference)
  "theta_recipient": "0xOptional"       // settlement address on Theta
}

Response: { taskId, status, routedTo, estimatedGas }
```

Poll status: `GET /task-status/{taskId}`
Webhook: register via `PUT /webhook` with `{ url, secret }` — receives `TaskSettled` events

Full API: `docs/M2M_API.md`

---

## Compute Routing Priority

Tasks are routed through a 6-tier DePIN priority router (first available, lowest cost):

```
1. Theta EdgeCloud (ondemand.thetaedgecloud.com) — primary GPU backbone
2. RapidAPI inference                           — inference fallback
3. MCP (local)                                  — low-latency local
4. Akash Network                                — decentralized Cosmos GPU marketplace
5. Render Network                               — GPU marketplace (image/LLM)
6. AWS Bedrock                                  — centralized last resort
```

Configure tiers via `.env.local`. Leave a tier blank to skip it.

---

## ZK Proof Pipeline

1. Task intent submitted → fee tagged with `ProviderTag` (THETA_NATIVE=1, DEPIN_AKASH=3, etc.)
2. SP1 prover (CUDA, EdgeCloud Dedicated) generates Groth16 proof (~260 bytes, ~270K gas)
3. `AITaskPublicValues` committed: `(taskType, sourceChain, destChain, taskIdHash, senderHash, netAmount, feeAmount, feeBps, outputHash, blockHeight, timestamp, nonce)`
4. `ZKVerifierSP1.verifyProof(programVKey, publicValues, proofBytes)` called on-chain
5. Nullifier stored → replay protection
6. Fees distributed via `CoreRevenueSplitter.distribute()`

---

## Fee Distribution

Every settled task contributes fees distributed as:

| Bucket | Share | Destination |
|--------|-------|-------------|
| Buyback-Burn (BBB) | 30% | Buy XF on open market + burn |
| Growth & Expansion (GET) | 30% | Machine incentives (50%), LP boost (30%), Agent grants (20%) |
| Stakers (veXF) | 25% | Yield to XF token lockers |
| Treasury | 15% | Operations + Fee-to-Stake routing |

Fee-to-Stake (15–25% of Treasury) routes to chain validators:
- Theta (chain 361): wTHETA/TFUEL staking
- Bittensor EVM (chain 964): dTAO via precompile `0x0805`
- Cosmos (osmosis-1): IBC relay → native staking (pending governance)

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
npm install xfuel-sdk  # (publishing in progress — see sdk/js/)
```

```javascript
import { XFuelClient } from 'xfuel-sdk';

const client = new XFuelClient({
  rpc: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
  chainId: 365,
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
test/cosmos-yield/        — IBC reverse bridge + legacy VaultFactory tests (YieldCircuit / Cosmos track; not Phase 1 core audit). `npm run test:contracts:cosmos-yield`
docs/AUDIT_READINESS_CHECKLIST.md — Gap list before auditor handover
docs/LEGAL_LAUNCH_CHECKLIST.md    — Legal/compliance planning (not legal advice)
docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md — Testnet 365 + mainnet 361 steps, tests (`npm run test:believer`)
xfuel-app/.env.example   — All VITE_* vars; testnet 365 vs mainnet 361
core-layer/               — AI listener, A2A orchestrator, CosmWasm WASM
backend/theta-bridge/     — Bridge service, M2M API server, fee analytics
sdk/js/                   — JavaScript SDK (xfuel-sdk)
docs/M2M_API.md           — Full REST API reference
docs/THETA_INTEGRATION_PLAN.md — Theta deep integration tracker
docs/TAO_CIRCUIT_HYPERLANE_E2E.md — Bittensor cross-chain E2E guide
docs/ZK-RESEARCH-PIPELINE.md — ZK research pipeline (papers, tiers, product-fit)
docs/ZK-RESEARCH-UPGRADE-PACKAGE.md — Unified upgrade package (best per area, no overlap)
deploy/manifests/         — Timestamped deployment manifests (testnet addresses)
zkgpt-prover/             — Phase 1 zkGPT mock server + smoke test (E2E)
docs/PHASE1_KICKOFF.md    — Phase 1 status, run Phase 1 checks (npm run test:phase1), post-deploy checklist
```

**Core tests:** `npm run test:contracts:core` runs `test:contracts:core:listener` (`node:test`, `core-layer/test/ai-listener.test.js`) then `test:contracts:core:solidity` (Hardhat: `core-layer/test/*.cjs`, `test/phase3`, `test/security`). **Full contract matrix:** `npm run test:contracts:all` runs the same listener step then `test:contracts:all:hardhat`, implemented by `scripts/hardhat-test-all.cjs` (explicit file list — works on Windows; no shell glob). CI `test.yml` mirrors this with two steps before coverage. Believer or Angel rounds: `npm run test:believer`. For a narrower green gate (core + phase3 + security Hardhat only), use `npm run test:contracts:core:solidity`.

---

## Security

- Bug bounty: up to $50,000 (Critical). See [`docs/bug-bounty.md`](docs/bug-bounty.md)
- Responsible disclosure: security@xfuel.app or [GitHub Security Advisory](https://github.com/XFuel-Lab/xfuel-protocol/security)
- **Audit waves:** See **WHITEPAPER.md §11.5** — **Audit Phase 1** = `contracts/core/` + `ThetaInferenceCircuit` + funding/engagement contracts + proof hooks; **Audit Phase 2** = remaining EVM circuits (TAO, Bridge, Data, M2M-facing, etc.) staggered post–Phase 1.

---

## Community Contribution Round (`BelieverRound`)

Single open community sale (no phased 4/12/24% tranches). **`xfAllocationCap`** enforces up to **150M XF** (15% of 1B) reserved. **`setTokenPrice`** while **Open** updates XF per TFUEL (multisig; see `docs/PRICING_TFUEL_XF.md`).

| Parameter | Value |
|-----------|-------|
| Contract | `contracts/circuits/BelieverRound.sol` |
| XF ceiling | `xfAllocationCap` (default deploy: 150M XF) |
| TFUEL hard cap | Env / deploy (e.g. `BELIEVER_HARD_CAP`) |
| Min commitment | 100 TFUEL (on-chain constant unless contract variant) |
| Max per wallet | Env (`0` = none) |
| Base price (default deploy) | **5 XF per 1 TFUEL** (`BELIEVER_PRICE_NUM` / `DEN`) |
| Cliff / vesting | 90d cliff + 270d linear |
| Lock bonuses | Optional tiers 1–3: **+8% / +20% / +35%** on base XF (effective **5.4 / 6 / 6.75** XF per TFUEL at default base 5) |
| Admin | `0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257` (Gnosis Safe) |
| UI | `xfuel-app` route `/believers` |

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
| Min commitment | `ANGEL_MIN_COMMITMENT` |
| Price | `ANGEL_PRICE_NUM` / `ANGEL_PRICE_DEN` (default deploy **8 XF per 1 TFUEL** — more XF per TFUEL than Believer base **5**) |
| Cliff / vesting | 90d + 270d linear |
| TGE | **Separate** `triggerTGE` from BelieverRound |

**veXF:** Lock XF in `veXFGovernance` after claim.

**xfuel-app:** `/angels`, env `VITE_ANGEL_ROUND_ADDRESS`. **Launch runbook:** [`docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md`](docs/FUNDING_ROUNDS_LAUNCH_RUNBOOK.md).

---

## ZK Prover Research Track — Interstellar

XFuel's current ZK pipeline uses **SP1 (Succinct)** — STARK proving with Groth16/PLONK wrapping for on-chain settlement (~270K gas per proof). A first-party research upgrade has been published by Theta Labs:

**[Interstellar](https://eprint.iacr.org/2025/1294)** — GKR-based IVC folding scheme (Jieyi Long, Theta Labs, PKC 2026). Key properties:
- **1.59x–6.74x prover speedup** on matrix/transformer workloads (direct benefit to `inference_request` proving)
- **Collaborative folding** — multiple provers with disjoint private witnesses produce a single joint IVC proof (enables ZK-verified swarm tasks across `formSwarm`/`joinSwarm` agents)

**No on-chain changes required.** `ZKVerifierSP1.sol` verifies Groth16/PLONK — it is proof-system-agnostic. Interstellar is a prover-side upgrade only (`sp1-prover/` + a new `SP1_PROVER=interstellar` env option).

**Status:** Not yet integrated (pending SP1 toolchain support or Theta EdgeCloud dedicated prover). Tracked in `WHITEPAPER.md` Section 12 — Research Track.

---

## References & Research Credits

XFuel attributes and cites third-party research used in the protocol. Full citations, eprint links, and compliance: **[`docs/REFERENCES-AND-ATTRIBUTION.md`](docs/REFERENCES-AND-ATTRIBUTION.md)**.

| Integration | Source |
|-------------|--------|
| **zkGPT** (Phase 1) | [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184); implementation [github.com/security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt) |
| **Fair Exchange (PAS)** (Phase 1) | [eprint.iacr.org/2026/395](https://eprint.iacr.org/2026/395) — *Delegated Payments for AI Agents: Fair Exchange on Bitcoin/EVM* |
| **Interstellar** (research track) | [eprint.iacr.org/2025/1294](https://eprint.iacr.org/2025/1294) (Jieyi Long, Theta Labs; PKC 2026) |

**Phase 1 deploy (optional env):** `FAIR_EXCHANGE_PROXY_ADDRESS` (deploy-full/testnet → setFairExchangeProxy), `ZK_VERIFIER_ZKGPT` (theta-inference.cjs), `ZKGPT_PROVER_URL` (backend + core-layer). See [docs/PHASE1_KICKOFF.md](docs/PHASE1_KICKOFF.md) post-deploy checklist.
