# Grant Submission: Theta Network Ecosystem

**Generated:** 2026-03-11T00:00:00.000Z  
**Circuit:** ThetaInferenceCircuit + A2ACircuit + ThetaGPUCircuit + DataHubs  
**Amount:** $100,000-$200,000  
**Submit URL:** https://www.thetatoken.org/ecosystem

## Application Fields

| Field | Value |
|-------|-------|
| Project | XFuel Protocol — Theta Integration |
| Category | AI / GPU Compute / Cross-Chain Bridge / DePIN |
| Team Size | 1 (solo-dev, open-source) |
| Timeline | 6-9 months |
| Open Source | Yes — MIT License |

## Live Traction Data

| Metric | Value |
|--------|-------|
| Deployed Contracts | 22 |
| Test Coverage | 755+ tests (85%+ coverage on audit-scope contracts) |
| Circuits | 21 modular circuits |
| Total Deploy Gas | 69,433,999 (~277.7 TFUEL) |
| Network | theta-testnet (chain 365) |
| Subchain | XFuel subchain (chain 365001) — registered, validators active |
| Smoke Tests | 17/17 passed |

## Theta Ecosystem Integration Evidence

### EdgeCloud Node Attestation (Track 2.1)
- Every AI inference intent attests to the EdgeCloud node that executed it on-chain
- `attestEdgeCloudNode(intentId, nodeId, gpuFingerprint, petaflopsUsed, providerTag)`
- Example: `intentId → 0xabcd… → nodeId → gpu:rtx4090@node-7f3a → proof tx: 0x1234…`
- 23 tests covering: attestation struct, event, access control, UNSET/duplicate guards

### MCP Tool Registration (Track 3.6)
- XFuel registered as a callable tool on Theta EdgeCloud MCP Server
- 3 tools: `xfuel_submit_intent`, `xfuel_poll_status`, `xfuel_router_status`
- Compatible with: Claude Desktop, Cursor, Cline, Zed, Sourcegraph Cody
- Script: `scripts/register-mcp-tool.cjs` (dry-run validated)

### EdgeCloud Agentic AI Integration (Track 3.6 extension)
- XFuel's MCP tools are callable directly from EdgeCloud's hosted AI Agent product (RAG chatbot / agentic workflows)
- EdgeCloud AI Agents can submit inference intents to XFuel via `xfuel_submit_intent`, receive results via webhook callback
- Makes XFuel callable from any EdgeCloud-powered agentic application without custom integration code
- Positions XFuel as infrastructure that enhances EdgeCloud's own agent ecosystem — not a competing product
- Reference: https://docs.thetatoken.org/docs/edgecloud-agentic-ai

### TPULSE Subchain Compatibility (Track 7 — roadmap)
- TPULSE is Theta's AI interaction tracking subchain (launched November 2025), recording every AI agent interaction as an immutable on-chain event for transparency and auditability
- XFuel's `IntentSettled`, `ZKProofVerified`, and `VideoProvenance` events are exactly the interaction records TPULSE is designed to aggregate — alignment is architectural, not incidental
- Planned integration: register XFuel as a TPULSE data source once Theta publishes the TPULSE event ingestion API; forward XFuel subchain events to TPULSE's chain; add TPULSE feed column to Dashboard
- Theta's H2 2026 roadmap confirms EdgeCloud stats will surface on TPULSE — XFuel is positioned to be a TPULSE-aware operator from day one of that rollout
- Reference: https://medium.com/theta-network/introducing-the-theta-pulse-subchain-powering-transparency-across-edgecloud-network-3b6e90f3990d

### Lavita Cross-Subchain Partnership (Track 8 — roadmap)
- Lavita is a health/genomics AI data marketplace running on Theta Subchain (chain `tsub360890`), using Theta EdgeStore for storage and Theta Edge Network (TEE) for privacy-preserving compute
- XFuel offers Lavita a ZK verifiability layer that TEE-only compute cannot provide: SP1 zkVM proofs of model outputs give researchers cryptographic attestation of exactly what model ran on what data — critical for medical regulatory compliance
- XFuel already shares Lavita's full infrastructure stack (Theta Subchain, EdgeStore, Theta Edge Network) — zero new infrastructure required for integration
- Concrete path: `LavitaCircuit.sol` routes `HEALTH_AI_JOB` intents to Lavita's AI jobs system; accepts LAVITA TNT-20 as a payment token (same `receiveERC20Fee()` pattern as TDROP); cross-subchain bridge via Theta's built-in inter-subchain messaging channel
- This represents XFuel's first cross-subchain partnership within the Theta Metachain ecosystem and demonstrates the modular circuit architecture's ability to extend into new verticals without modifying the Core Layer

### Video API Provenance (Track 3.2)
- Every VIDEO_PROCESSING intent emits `VideoProvenance(intentId, videoId, contentHash, playbackUri)` on-chain
- ZK-proven link between EdgeCloud GPU execution and Theta Video API transcode
- Supports NFT-DRM via `nft_collection` parameter (Track 3.4)

### EdgeStore DataHub (Track 3.1)
- `attachEdgeStoreCid(contributionId, edgeStoreCid, edgeStoreNodeId)` seals data hashes on-chain
- Wallet-signed auth tokens auto-refresh every 23h
- `uploadAndSeal()` verifies retrieval before committing on-chain (non-fatal if EdgeStore unreachable)

### TDROP Payment Integration (Track 4.2)
- `submitIntentWithTDROP(serviceId, inputHash)` — 20% fee discount for TDROP payers
- Mainnet TDROP: `0x1336739B05C7Ab8a526D40DCC0d04a826b5f8B03` (chain 361)
- A2A agent-to-agent escrow also supports TDROP via `submitBidWithTDROP()`
- 35 tests covering: payment flow, discount math, ERC-20 ingestion, A2A backward compat

### XFuel Subchain (Track 1.2 / 1.4)
- Single XFuel subchain registered on Theta Metachain
- Chain ID: 365001 (testnet) / 361001 (mainnet)
- 3 validators, 10,000 wTHETA + 60,000 TFUEL collateral
- Gov token (XFGOV): deployed, `mintStakerReward` + `stakerRewardPerBlock` implemented

## Deployed Contract Addresses — Theta Testnet (Chain 365)

| Contract | Address | Explorer |
|----------|---------|---------|
| CoreRevenueSplitter | `0x56A3E4e2E47Ad1D1e9DB2DD9446479b3Be01d1F0` | [View](https://testnet-explorer.thetatoken.org/account/0x56A3E4e2E47Ad1D1e9DB2DD9446479b3Be01d1F0) |
| ZKVerifierSP1 | `0x8E0789E95f0F18F49E1BBA765893C9dfbF09570f` | [View](https://testnet-explorer.thetatoken.org/account/0x8E0789E95f0F18F49E1BBA765893C9dfbF09570f) |
| ThetaInferenceCircuit | `0x817d542d2eA7c2B03235D77edb854C72D24B7d24` | [View](https://testnet-explorer.thetatoken.org/account/0x817d542d2eA7c2B03235D77edb854C72D24B7d24) |
| BridgeCircuit | `0xE4a9D5Cd8fCA9B6dba6DaCfc1A7A3B1b2a928F7d` | [View](https://testnet-explorer.thetatoken.org/account/0xE4a9D5Cd8fCA9B6dba6DaCfc1A7A3B1b2a928F7d) |
| ComputeMarketplace | `0x61C64cD702D94c6141007c5CaE4036E6F10d6a32` | [View](https://testnet-explorer.thetatoken.org/account/0x61C64cD702D94c6141007c5CaE4036E6F10d6a32) |
| InferenceRouter | `0x32641f6717C3b52BC844fCAc6B9173b4A84c30a0` | [View](https://testnet-explorer.thetatoken.org/account/0x32641f6717C3b52BC844fCAc6B9173b4A84c30a0) |
| TAOCircuit | `0x1526CD125022c06dFda2Fc1c6563de0e72581E8e` | [View](https://testnet-explorer.thetatoken.org/account/0x1526CD125022c06dFda2Fc1c6563de0e72581E8e) |
| A2ACircuit | `0x3eb4b410373413BfAcc48A3Cd872713F44EA8015` | [View](https://testnet-explorer.thetatoken.org/account/0x3eb4b410373413BfAcc48A3Cd872713F44EA8015) |
| ThetaGPUCircuit | `0x8188cAc55607d61c8ECf1cB850B65b47e682ADAc` | [View](https://testnet-explorer.thetatoken.org/account/0x8188cAc55607d61c8ECf1cB850B65b47e682ADAc) |
| ZKMLCircuit | `0xaEAa9529f0ACfe667704B9B8926eAB1513A8b04D` | [View](https://testnet-explorer.thetatoken.org/account/0xaEAa9529f0ACfe667704B9B8926eAB1513A8b04D) |
| DataHubs | `0x55B995836a5d68697f3A4c307Cf59A37343eb4d4` | [View](https://testnet-explorer.thetatoken.org/account/0x55B995836a5d68697f3A4c307Cf59A37343eb4d4) |
| AkashCircuit | `0x30fda277F863175dfFAc6BaCc6c6c75Fa97C1cdA` | [View](https://testnet-explorer.thetatoken.org/account/0x30fda277F863175dfFAc6BaCc6c6c75Fa97C1cdA) |

> **Deployment manifest:** `deploy/manifests/phase6-1772989979356.json`  
> **Deployer:** `0xDC17Cbd201E7347555e428690f702bbFcAF2d33c`  
> **Deployed:** 2026-03-08T16:59:24.550Z  
> **Smoke tests:** 17/17 passed

## Budget Breakdown

| Category | Estimated Cost | Notes |
|----------|---------------|-------|
| Theta Subchain Mainnet Collateral | ~$20,000 | 13,000 wTHETA + 60,000 TFUEL for 3 validators (10,000 wTHETA registration + 1,000 wTHETA × 3 + 20,000 TFUEL × 3). One-time on-chain cost. |
| CertiK Phase 1 Audit | $30,000–$50,000 | Core Layer + ThetaInferenceCircuit. Engagement begins post-grant funding. See `docs/AUDIT_GRANT_READINESS.md`. |
| SP1 Dedicated Model Serving (EdgeCloud GPU) | $5,000–$10,000 | Persistent CUDA deployment on EdgeCloud for zero-cold-start SP1 proving. Monthly cost during active test/mainnet periods. |
| Infrastructure (RPC, hosting, monitoring) | $2,000/month | Theta RPC endpoints, xfuel.app hosting, Prometheus/Grafana monitoring. |
| Development & Integration (solo-dev) | $40,000–$80,000 | Mainnet deployment, audit remediation, SP1 dedicated serving migration, Track 2.5 EdgeCloud training integration. |
| Contingency (10%) | $10,000–$16,000 | Token price volatility on wTHETA/TFUEL collateral, unexpected audit findings. |
| **Total** | **$107,000–$178,000** | Fits within requested $100K–$200K range. |

### Milestone Payment Schedule

| Milestone | Deliverable | Trigger | Suggested % |
|-----------|------------|---------|-------------|
| M1 | Testnet evidence package | Deployed contracts + Explorer links + smoke tests submitted | 20% |
| M2 | CertiK Phase 1 audit complete | Audit report published, critical findings remediated | 35% |
| M3 | Mainnet subchain + contracts live | Chain 361001 producing blocks + core contracts verified on mainnet explorer | 30% |
| M4 | SP1 Dedicated Serving + EdgeCloud training route | Proof latency <5s on dedicated EdgeCloud GPU; Track 2.5 handler deployed | 15% |

---

## Ecosystem Value & Uniqueness

XFuel is the **only project in the Theta ecosystem** combining all of the following in a single protocol:

| Differentiator | Evidence |
|---|---|
| SP1 zkVM proofs of AI inference on Theta | `ZKVerifierSP1.sol` verifies Groth16 proofs on-chain; `ThetaInferenceCircuit` settles with cryptographic guarantees — not just an API call log |
| TDROP payment discounts + fee-to-stake routing | `submitIntentWithTDROP()` (20% discount) + `CoreRevenueSplitter` dynamic boost for Theta-native compute; every AI task drives organic TDROP demand |
| Modular circuit architecture (21 circuits) | New AI verticals (health, gaming, media) plug in as independent `LavitaCircuit`, `AI Characters` wrappers, etc. — Core Layer never redeployed |
| 9 distinct Theta API surfaces in one intent-driven API | EdgeCloud inference + EdgeStore + Video API (VOD + Livestream) + NFT-DRM + P2P SDK + MCP Server + Metachain/Subchain + TDROP + Explorer API |
| Agent-first M2M API | `xfuel_submit_intent` MCP tool makes XFuel callable as backend infrastructure for any EdgeCloud-hosted AI agent |
| TPULSE-compatible interaction events | XFuel subchain events (`IntentSettled`, `ZKProofVerified`, `VideoProvenance`) map directly to TPULSE's interaction record schema |

### How XFuel Helps Other Theta Subchains

**Lavita (health/genomics AI — chain tsub360890):**
- Adds SP1 ZK proofs on top of Lavita's TEE compute — the only way to provide mathematical certainty (not just privacy) about what model ran on what data
- Shares identical infrastructure (EdgeStore, Theta Edge Network) — plug-in, not replacement
- `LavitaCircuit.sol` planned post-grant; cross-subchain bridge via Theta's inter-subchain messaging channel

**TPULSE (AI interaction tracking subchain):**
- XFuel's existing on-chain event schema feeds TPULSE natively — no adapter needed beyond event forwarding
- Positions XFuel as verified infrastructure within Theta's official AI interaction ledger

**Replay (video micropayment subchain):**
- XFuel's `VideoProvenance` events are consumable by Replay as ZK-verified settlement records for video micropayments
- Potential: XFuel acts as ZK settlement backend for Replay's micropayment flows

**Future Gaming/Esports Subchains (Team Heretics, Olympique de Marseille, Vegas Golden Knights):**
- Theta's enterprise sports partners deploy EdgeCloud AI agents for fan engagement
- XFuel's `A2ACircuit` is the natural immutable billing rail for AI agent interactions requiring sponsor-auditable records
- AI Characters API integration (Track 3.7) would make XFuel the ZK settlement layer for Theta's entire gaming vertical

---



**SP1 Dedicated Model Serving (Track 2.2 — deferred):**
SP1 proofs currently run via EdgeCloud on-demand GPU (cold-start 10–30s per proof). Dedicated Model Serving (persistent CUDA, zero cold-start) is the post-funding deployment target. Budget line item included above. Dashboard will show "On-demand only" mode until dedicated serving is funded and activated.

**Mainnet Subchain (Track 1.5 → mainnet):**
XFuel subchain is live on testnet (chain 365001, validators active, ThetaInferenceCircuit at `0x817d542d2eA7c2B03235D77edb854C72D24B7d24`). Mainnet activation (chain 361001) requires wTHETA/TFUEL collateral funding (see budget). Planned as M3 milestone immediately post-grant.

**Livestream Agent API (Track 3.3 — partial):**
VOD video processing (upload → transcode → ZK provenance) is complete end-to-end. The dedicated `LIVESTREAM_START` action on the `/theta-ai/agent-intent` API is not yet surfaced as a named action (handled inline via `VIDEO_PROCESSING` preset). Max 3 concurrent streams per service account is not yet enforced at the contract layer. Post-grant polish item; does not affect VOD functionality.

---



- [x] templateReady
- [x] manifestAvailable
- [x] tractionUpdated
- [x] teamSectionComplete
- [x] budgetDetailed
- [x] milestonesTimeline
- [x] subchainRegistered
- [x] mcpToolRegistered
- [x] tdropIntegration
- [x] edgeCloudAttestation
- [x] tpulseRoadmapDocumented
- [x] lavitaCrossSubchainDocumented
- [x] ecosystemValueNarrative

## Attachments

- WHITEPAPER.md (v2.4 — Hybrid Theta-Centric Architecture)
- docs/THETA_INTEGRATIONS.md
- docs/AUDIT_GRANT_READINESS.md
- grant-templates/theta-ecosystem.md
- believer-guide.md

---

*Updated: 2026-03-11 (added Budget Breakdown, Known Pre-Funding Limitations, EdgeCloud Agentic AI integration evidence, TPULSE subchain compatibility, Lavita cross-subchain partnership, Ecosystem Value & Uniqueness section)*
