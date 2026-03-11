# XFuel Protocol — Theta Integration Master Plan

**Created:** 2026-03-09  
**Owner:** XFuel Core Team  
**Status:** Active — Working Document  
**Purpose:** Track all Theta-focused integration tracks, research findings, and completion status.

> Check off items as completed. This document is the single source of truth for Theta integration work.
> Architecture principle: **One XFuel subchain, multiple circuits, branch-ready.**

---

## Table of Contents

- [Architecture Decisions](#architecture-decisions)
- [Track 1 — Subchain Foundation](#track-1--subchain-foundation)
- [Track 2 — EdgeCloud Deep Integration](#track-2--edgecloud-deep-integration)
- [Track 3 — Theta Feature Hooks](#track-3--theta-feature-hooks)
- [Track 4 — TDROP Integration](#track-4--tdrop-integration)
- [Track 5 — Webhooks and Event Layer](#track-5--webhooks-and-event-layer)
- [Track 6 — Dashboard and Grant](#track-6--dashboard-and-grant)
- [Roadmap Items (Future)](#roadmap-items-future)
- [Theta API Reference Summary](#theta-api-reference-summary)
- [TDROP Deep Dive](#tdrop-deep-dive)
- [Webhook and Event Layer Deep Dive](#webhook-and-event-layer-deep-dive)

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Subchain count (launch) | **1 shared XFuel subchain** | Budget-conscious; circuit isolation is Solidity-layer, not chain-layer; branch when volume demands it |
| Subchain circuits at launch | ThetaInferenceCircuit + A2ACircuit + ThetaGPUCircuit + DataHubs | Core value props; covers EdgeCloud inference, agent economy, raw compute, and storage provenance |
| Subchain testing order | **Privatenet → Testnet (365001) → Mainnet (361001)** | Privatenet has short dynasty (~400 blocks vs 10K) for fast validator activation; no token cost |
| Subchain tooling | **Metachain CLI + direct ethers.js calls to ChainRegistrarOnMainchain** | No npm SDK exists; genesis snapshot requires Go binary (`subchain_generate_genesis`) |
| Bittensor circuits | **Preserve in-place, no new development** | Existing contracts remain; focus shifts to Theta-native integrations |
| SP1 prover deployment | **Dedicated Model Serving (not on-demand)** | Prover needs CUDA persistence; on-demand cold-start adds 10-30s per proof |
| TDROP integration | **Phase in via GET sub-bucket routing** | Route Machine & Agent Incentives portion of GET to TDROP stakers contributing EdgeCloud compute |

---

## Track 1 — Subchain Foundation

> Goal: Privatenet validation → Testnet subchain live with 4 circuits deployed

### Prerequisite Research (Complete)
- [x] Understand Theta Metachain CLI flow (ChainRegistrarOnMainchain, depositCollateral, depositStake)
- [x] Confirm subchain registration costs: **10,000 wTHETA** per subchain + **1,000 wTHETA + 20,000 TFUEL** per validator
- [x] Confirm dynasty timing: ~400 blocks privatenet, ~10,000 blocks testnet/mainnet
- [x] Confirm genesis snapshot requires `subchain_generate_genesis` Go binary (not JS-automatable)
- [x] Identify single-subchain multi-circuit architecture as correct approach
- [x] Identify privatenet-first as correct testing order
- [x] Confirmed privatenet uses **MockWrappedTheta** (free minting, no real THETA needed)
- [x] Confirmed privatenet contract addresses from snapshot (ChainRegistrar: `0x08425D9Df219f93d5763c3e85204cb5B4cE33aAa`, MockWTHETA: `0x7d73424a8256C0b2BA245e5d5a3De8820E45F390`)
- [x] Confirmed privatenet ETH RPC adaptor ports: main chain `18888`, subchain `19888`
- [x] Confirmed subchain ETH RPC adaptor must be started BEFORE subchain validator
- [x] Confirmed: wait 100 subchain blocks after genesis before testing cross-chain transfers

### 1.1 — Privatenet Setup
- [x] Build binaries from source (WSL2 Ubuntu, Go 1.21.13 + gcc 13.3):
  - `theta-protocol-ledger` (branch: `sc-privatenet`) → installs `theta` + `thetacli`
  - `theta-eth-rpc-adaptor` (branch: `main`) → installs `theta-eth-rpc-adaptor`
  - `theta-protocol-subchain` (branch: `privatenet`) → installs `thetasubchain` + `thetasubcli`
  - `subchain_generate_genesis` → built from `integration/tools/subchain_generate_genesis`
  - All 6 binaries confirmed in `$GOPATH/bin`
- [x] Clone `theta-metachain-guide` and run `npm install` in `sdk/js` (Linux node required — Windows node blocked in WSL PATH)
- [x] Copy privatenet configs to `~/metachain_playground/privatenet/` (mainchain + subchain dirs confirmed)
- [x] Validator key confirmed at `~/.thetacli/keys/encrypted/2E833968E5bB786Ae419c4d13189fB081Cc43bab`
- [x] Start main chain validator: `theta start --config=../mainchain/validator --password=qwertyuiop`
- [x] Start main chain ETH RPC adaptor (after first block): `theta-eth-rpc-adaptor start --config=../mainchain/ethrpc` — running on `127.0.0.1:18888` (HTTP) + `18889` (WS)
- [x] Run `subchain_generate_genesis` for XFuel subchain (chainID `tsub360777`)
  - Genesis hash: `0xe883870893085fdde7afc17192ae0995b22fe93913721bcaba8a7eb3361ddd11`
  - Token Banks recorded in `.env.local` (ChainRegistrar, TFuel, TNT20, TNT721, TNT1155, BalanceChecker)
  - `config.yaml` genesis.hash updated
- [x] Start subchain ETH RPC adaptor: `theta-eth-rpc-adaptor start --config=../subchain/ethrpc` — running on `127.0.0.1:19888` (HTTP) + `19889` (WS)
- [x] Start subchain validator: `thetasubchain start --config=../subchain/validator --password=qwertyuiop`
- [x] Confirm block production on subchain (`Notified finalized block, height=18` ✓)
- [x] Register subchain via Theta guide SDK (`registerSubchain.js` + `depositStake.js`) — completed, see Track 1.2 for tx hashes

### 1.2 — Subchain Registration Script
- [x] Create `scripts/theta-subchain-init.cjs`
  - Direct `ethers.js` calls to `ChainRegistrarOnMainchain` (no npm SDK)
  - Steps: approve wTHETA → `registerSubchain(chainId, govTokenAddr, wThetaAmount, genesisHash)`
  - Steps: `depositCollateral(chainId, validatorAddr, wThetaAmount)` × 3 validators
  - Steps: `depositStake(chainId, validatorAddr, govTokenAmount)` × 3 validators
  - Output to `deploy/manifests/subchain-<network>.json`
  - Supports `--network privatenet | testnet | mainnet`, `--step mintmock | register | collateral | stake`, `--dry-run`
  - Full collateral constants, dynasty timing warnings, next-steps output
- [x] Updated script with correct privatenet addresses from Theta docs:
  - `MockWrappedTheta: 0x7d73424a8256C0b2BA245e5d5a3De8820E45F390` (pre-deployed in privatenet snapshot)
  - `ChainRegistrarOnMainchain: 0x08425D9Df219f93d5763c3e85204cb5B4cE33aAa` (privatenet)
  - Token banks and mock TNT20/721/1155 addresses from snapshot included in manifest
  - Added `--step mintmock` to call `MockWrappedTheta.mint()` (50,000 tokens, covers 13,000 needed)
  - Privatenet uses chain ID 366 (main), subchain ID 360777 (matches official guide default)
  - Correct RPC port: `localhost:18888/rpc` (main chain ETH RPC adaptor), `localhost:19888/rpc` (subchain)
  - Gov token stake default corrected to 100,000 (matching guide's INIT_VALIDATOR_SET.json example)
  - Cross-chain note: wait 100 subchain blocks before testing transfers
- [x] Test end-to-end on privatenet
  - Mint MockWrappedTheta: tx `0x0899841d7abe8010041be236c363585e6e8ce89c86d5eacde4092e832716161d`
  - Gov token deployed: `0x7ad6cea2bc3162e30a3c98d84f821b3233c22647` (XFGOV, 500M supply)
  - registerSubchain tx: `0x5c8e6044748453e261e51cbbf7baf3b1636080bc8084bcc641266d749d34a261`
  - depositCollateral tx: `0xb366389562d592c4af6fd9ba9ebb2b8332c6062322c9eaa80561edd7cf7b6b2c`
  - depositStake tx: `0x0652c7abb391b70eb4694a7845e54a054ec50e7f78c42be48e5ea79f666e5426`
  - ValidatorSet for dynasty 4: `0x2E833968...` shareAmount: `100000000000000000000000` ✓
  - Waiting for dynasty 4 boundary (~400 main chain blocks) for validator activation

### 1.3 — TNT20 Governance Token
- [x] Deploy XFuel subchain governance token (TNT20) on Theta main chain
  - Privatenet: deployed via `deployGovToken.js` → `0x7ad6cea2bc3162e30a3c98d84f821b3233c22647` (XFGOV)
  - Proper contract: `contracts/governance/XFuelSubchainGovToken.sol` — compiles clean ✓
  - Implements `mintStakerReward(address, uint256)` for validator rewards ✓
  - Implements `stakerRewardPerBlock()` view function ✓
  - 1B XFGOV hard cap, 500M initial supply, 2 XFGOV/block reward rate
  - `updateMinter()` admin function — call with VSM address after deployment
  - VSM address (privatenet): `0xA826bA8Fa8998E324757c6BCB544f0Cdba3eb4AB`
- [x] `THETA_GOV_TOKEN_ADDRESS` set in `.env.local`

### 1.4 — Deploy/Full.cjs Subchain Update
- [x] Updated `deploy/full.cjs` Phase 9 to single-subchain architecture
  - Removed 6-subchain loop; single `xfuel-core` subchain config
  - Network-aware subchain IDs: privatenet `360777`, testnet `365001`, mainnet `361001`
  - Circuits listed: ThetaInferenceCircuit, A2ACircuit, ThetaGPUCircuit, DataHubs
  - Delegates on-chain registration to `scripts/theta-subchain-init.cjs`
  - Smoke tests verify env vars, circuit deployments, collateral config
  - `manifest.subchains` backward-compat alias preserved
- [x] Updated `src/config/thetaConfig.ts` with subchain configs
  - Added `XFUEL_SUBCHAIN_PRIVATENET` (360777, localhost:19888)
  - Added `XFUEL_SUBCHAIN_TESTNET` (365001, env-var driven)
  - Added `XFUEL_SUBCHAIN_MAINNET` (361001, env-var driven)
  - Added `XFUEL_SUBCHAIN` active selector via `VITE_SUBCHAIN_NETWORK`
  - Added `wsUrl` to both `THETA_TESTNET` and `THETA_MAINNET`
- [x] Update `test/phase4/SubchainDeploy.test.cjs` to match new architecture
  - 24 tests passing ✓
  - Tests single-subchain IDs (privatenet 360777, testnet 365001, mainnet 361001)
  - Tests correct collateral totals (13,000 wTHETA + 60,000 TFUEL for 3 validators)
  - Tests full XFuelSubchainGovToken interface (mintStakerReward, stakerRewardPerBlock, admin)
  - Tests 4-circuit registration in ZKVerifierSP1 on shared subchain

### 1.5 — Testnet Deployment
- [ ] Run privatenet-validated flow on Theta Testnet (chain 365)
- [ ] Submit `ChainRegistrarOnMainchain.registerSubchain()` on testnet
- [ ] Activate 3 validators — wait for dynasty boundary
- [ ] Confirm subchain 365001 producing blocks
- [ ] Deploy ThetaInferenceCircuit, A2ACircuit, ThetaGPUCircuit, DataHubs to subchain
- [ ] Run smoke tests against subchain contracts
- [ ] Record addresses in `deploy/manifests/subchain-testnet.json`

---

## Track 2 — EdgeCloud Deep Integration

> Goal: On-chain proof of which EdgeCloud node executed each job; SP1 prover on Dedicated deployment

### Prerequisite Research (Complete)
- [x] Confirmed EdgeCloud On-Demand API: Flux, Llama 3.1, Whisper, Stable Diffusion (20+ models)
- [x] Confirmed EdgeCloud has Dedicated Model Serving (separate from on-demand) for persistent deployments
- [x] Confirmed EdgeCloud Client RPC APIs: GetStatus, SetPrice, GetDeployments, GetJobs
- [x] Confirmed EdgeCloud API Key management: per-project, shown once, programmatic deployment control
- [x] Identified SP1 prover should use Dedicated (not on-demand) deployment for CUDA persistence

### 2.1 — EdgeCloud Node Attestation
- [x] Add `ProviderTag` enum to `ThetaInferenceCircuit.sol` (`UNSET`, `THETA_NATIVE`, `HYBRID_FALLBACK`)
- [x] Add `EdgeCloudAttestation` struct (`nodeId`, `gpuFingerprint`, `petaflopsUsed`, `attestedAt`, `providerTag`)
- [x] Add `attestEdgeCloudNode()` function (RELAYER_ROLE only)
  - Guards: IntentNotFound, IntentNotCompleted, AlreadyAttested, ProviderTagUnset
- [x] Add `EdgeCloudNodeAttested` event
- [x] Add `emitVideoProvenance()` stub for Track 3.2 (VIDEO_PROCESSING intents only)
- [x] Add `getAttestation()` and `getAttestationCount()` view functions
- [x] 23 tests passing — `test/track2/EdgeCloudAttestation.test.cjs`
  - ProviderTag enum values correct (UNSET=0, THETA_NATIVE=1, HYBRID_FALLBACK=2)
  - All struct fields stored and retrievable
  - EdgeCloudNodeAttested event emitted with all args
  - Access control, duplicate attest, wrong status, UNSET tag all revert correctly
  - Full flow: completeIntent → attest → settleIntent works end-to-end
  - Settlement works with and without attestation (attestation is advisory, not enforced)
  - VideoProvenance emits correctly; rejects non-video intents
- [x] Update `ai-listener.js` to call `attestEdgeCloudNode()` with EdgeCloud job response metadata before settling proof
  - Added Step 1b in `ThetaInferenceHandler._resolveIntent()` between `completeIntent` and `generateProof`
  - `nodeId` derived from EdgeCloud job response `_nodeId` field (or deterministic hash fallback)
  - `gpuFingerprint` = hash of GPU model + driver version from response
  - `petaflopsUsed` mapped from GPU tier: H100=3958 GFLOPS, A100=2000, RTX4090=165
  - `providerTag` = `THETA_NATIVE` when `source === 'edgecloud'`, else `HYBRID_FALLBACK`
  - `nodeId` now passed into `generateProof` `publicValues` — ZK proof commits to hardware
  - Attestation failure is non-fatal (logged + continues to proof generation)
  - Added `attests` / `attestFailures` counters to `apiStats.onChain`
  - Updated heartbeat log: `attested=N` visible in `[Heartbeat]` line
  - ABI updated: `attestEdgeCloudNode` + `getAttestation` added to `CIRCUIT_ABI`
  - `PROVIDER_TAG` constant object added to handler (mirrors Solidity enum)

### 2.2 — SP1 Prover: Dedicated Model Serving Migration
> **DEFERRED — Pre-funding decision (Mar 2026)**
> On-demand EdgeCloud GPU is cost-optimal at current volume. Dedicated Model Serving
> (persistent CUDA) makes sense at scale when proving demand justifies the flat hourly
> cost. Re-evaluate when monthly proof volume exceeds ~500 proofs/day.
- [ ] Migrate SP1 prover from on-demand Docker to EdgeCloud Dedicated Model Serving
- [ ] Configure persistent CUDA endpoint via EdgeCloud API Key
- [ ] Update `sp1-prover/DEPLOY_ON_EDGECLOUD.md` with Dedicated Serving steps
- [ ] Update `Dockerfile.cuda` with Dedicated Serving entrypoint
- [ ] Validate sub-200ms proof generation with persistent warm container

### 2.3 — DePIN Priority Router  ✅ COMPLETE (Mar 2026)

> Reframed from "Hybrid Cloud Fallback" to "DePIN Priority Router" — the design
> principle is DePIN-first, cloud-last.  All external providers are pay-as-you-go
> (zero idle cost), so every tier is always available without pre-funding.

**Priority waterfall (hard-coded in `_executeService`):**

| Priority | Provider | Tag | Env key required |
|---|---|---|---|
| 1 | Theta EdgeCloud (direct) | `THETA_NATIVE` | `THETA_EDGECLOUD_API_KEY` |
| 2 | RapidAPI (Theta-routed) | `THETA_NATIVE` | `THETA_RAPIDAPI_KEY` |
| 3 | MCP Server (Theta toolchain) | `THETA_NATIVE` | `THETA_MCP_ENDPOINT` |
| 4 | Akash Network DePIN | `DEPIN_AKASH` | `AKASH_WALLET_MNEMONIC` |
| 5 | Render Network DePIN | `DEPIN_RENDER` | `RENDER_API_KEY` |
| 6 | AWS Bedrock (cloud last resort) | `HYBRID_CLOUD` | `AWS_ACCESS_KEY_ID` |
| — | Mock (dev/test) | — | (none — always falls through) |

- [x] Expand `ProviderTag` enum in `ThetaInferenceCircuit.sol`:
  `UNSET(0)` `THETA_NATIVE(1)` `HYBRID_FALLBACK(2)` `DEPIN_AKASH(3)` `DEPIN_RENDER(4)` `HYBRID_CLOUD(5)`
- [x] Replace 4-step waterfall in `_executeService` with 6-tier DePIN priority router
- [x] Add `_callAkash()` — Akash REST gateway client (thin-client path; SDL deployment roadmap)
- [x] Add `_callRender()` — Render Network API client (LLM + image generation)
- [x] Add `_callBedrock()` — AWS Bedrock SigV4 client (Llama, Claude; last resort)
- [x] Add `akash`, `render`, `bedrock` buckets to `apiStats`
- [x] Update `attestEdgeCloudNode` flow to map `source` string → correct `ProviderTag`
- [x] Add `PROVIDER_TAG_LABELS` reverse map for logging
- [x] Add DePIN router keys to `.env.deploy.example`
- [x] Add feature flags: `useAkashFallback`, `useRenderFallback`, `useBedrockFallback`
- [x] `getApiStatus()` now reports all six tiers including enabled/disabled state

**Roadmap items (dedicated circuits — future tracks):**
- [ ] `AkashCircuit.sol` — full SDL on-chain lease + bid management
- [ ] `RenderCircuit.sol` — Render Network native job settlement
- [ ] Gate `boostMultiplier` in `CoreRevenueSplitter` on `providerTag === THETA_NATIVE`

### 2.4 — FedML/Lavita Training Route
- [ ] Extend `ai-listener.js` ThetaInference handler for `preset = GPU_TRAINING_JOB`
- [ ] Add FedML job submission client (differential privacy mode)
- [ ] Generate SP1 proof with `publicValues: { jobId, datasetHash, outputModelHash }`
- [ ] Add `FEDML_API_KEY` to `.env.deploy.example`

---

## Track 3 — Theta Feature Hooks

> Goal: Wire every live Theta API surface into XFuel's circuit/agent layer

### 3.1 — EdgeStore DataHub Integration  ✅ COMPLETE (Mar 2026)
- [x] Replace mock Poseidon commitment in `DataHubs.sol` with `bytes32 edgeStoreCid` field
- [x] Add `edgeStoreNodeId` to `DataContribution` struct
- [x] Added `RELAYER_ROLE` to `DataHubs.sol` constructor + `AlreadySealed` error
- [x] Added `attachEdgeStoreCid(contributionId, edgeStoreCid, edgeStoreNodeId)` — RELAYER_ROLE only, idempotent guard
- [x] Added `EdgeStoreSealed(contributionId, edgeStoreCid, edgeStoreNodeId, sealedBy)` event
- [x] Create `circuits/data-hubs/theta-edgestore-adapter.js`
  - Wallet-signed auth token generation: `${timestamp}.${walletAddress}.${eth_sign("Theta EdgeStore Call ${timestamp}")}`
  - Token cached for 23h (refreshes 1h before 24h expiry)
  - `POST https://api.thetaedgestore.com/api/v2/data` upload → bytes32 CID
  - `GET https://data.thetaedgestore.com/api/v2/data/<key>` retrieval
  - `sealOnChain()` — non-fatal, calls `attachEdgeStoreCid()`, returns `{ txHash, error }`
  - `uploadAndSeal()` — combined entry point for handler
- [x] Wire EdgeStore adapter into `datahubs-handler.js`:
  - New `data_contribution` intent type triggers upload + on-chain seal
  - Graceful degradation: skips EdgeStore if `THETA_EDGESTORE_WALLET_KEY` not set
  - Non-fatal upload failure: handler returns `contribution_received` instead of erroring
  - `getStats()` includes `edgeStore` sub-stats
- [x] Add `THETA_EDGESTORE_WALLET_KEY` to `.env.deploy.example`
- [x] Test: 22 passing tests in `test/track3/EdgeStoreDataHub.test.cjs`
  - On-chain: struct init, `attachEdgeStoreCid`, `EdgeStoreSealed` event, `AlreadySealed`, `ContributionNotFound`, role guard, zero CID guard
  - Off-chain adapter: bytes32 normalisation, nodeId derivation, stats, error handling, auth token cache, token format
  - Handler: full upload+seal flow, graceful skip, non-fatal failure, `onProofReady`, stats

### 3.2 — Video API: VOD + ZK Provenance  ✅ COMPLETE (Mar 2026)
- [x] Create `backend/theta-bridge/src/theta-video-handler.js`
  - `POST /upload` → `{ id, presigned_url }`
  - `PUT <presigned_url>` → upload raw video bytes (5-min timeout)
  - `POST /video` with `source_upload_id` + optional `nft_collection` (DRM hook for Track 3.4)
  - Poll `GET /video/<id>` every 5s until `state === "success"` (30-min max, 360 attempts)
  - Returns `playbackUri` (HLS master.m3u8) + `videoId` + `contentHash` (keccak256 of playbackUri)
  - Calls `ThetaInferenceCircuit.emitVideoProvenance(intentId, videoId, contentHash, playbackUri)` — non-fatal
  - Livestream (Track 3.3): `POST /stream` → `GET /ingestor/filter` → `PUT /ingestor/<id>/select`
  - Returns RTMP `streamServer` + `streamKey` + 5-min ingestor expiry window
  - Auth: `Authorization: Basic base64(SA_ID:SA_SECRET)` on all requests
  - Configures via `THETA_VIDEO_SA_ID` + `THETA_VIDEO_SA_SECRET`
- [x] `VideoProvenance` event already present in `ThetaInferenceCircuit.sol` (Track 2.1 stub)
- [x] `emitVideoProvenance()` fully wired — relayer calls after transcoding completes
- [x] `VIDEO_PROCESSING` ServiceType already in contract enum — handler routes to video pipeline
- [x] Add `THETA_VIDEO_SA_ID` + `THETA_VIDEO_SA_SECRET` to `.env.deploy.example`

### 3.3 — Video API: Livestream Support
- [ ] Add `LIVE_STREAM` enum to `ThetaInferenceCircuit.sol` ServiceType
- [ ] Create livestream session handler in `theta-video-handler.js`
  - `POST /stream` → create stream
  - `GET /ingestor/filter` → list Edge Ingestors (sorted by proximity)
  - `PUT /ingestor/<id>/select` → select nearest ingestor (5-minute expiry window)
  - Return `stream_server` (RTMP) + `stream_key` to agent via webhook
- [ ] Add livestream endpoints to agent API (`/theta-ai/agent-intent` action: `LIVESTREAM_START`)
- [ ] Note: max 3 livestreams per service account — enforce in contract

### 3.4 — NFT-Based DRM
- [ ] Add `drmEnabled` + `nftCollection` fields to `VideoProcessing` intent struct
- [ ] When `drmEnabled = true`, pass `nft_collection` to Video API transcode request
- [ ] Integrate `TVA.Video` JavaScript SDK in `xfuel.app` for DRM-gated playback
  - `onAccessDenied` handler guides user to mint/purchase the linked TNT-721
  - Support `networkId: 361` (mainnet) and `networkId: 365` (testnet)
- [ ] Document DRM flow in `docs/THETA_INTEGRATIONS.md`

### 3.5 — Theta P2P Video Delivery SDK
- [ ] Add Theta P2P JavaScript SDK to `xfuel.app` (`xfuel-app/`)
  - Replaces direct HLS playback with Theta-distributed P2P delivery
  - Users watching via P2P relay reduce CDN costs and contribute bandwidth
- [ ] Wire `playback_uri` from Video API through P2P SDK player component
- [ ] Add P2P bandwidth contribution tracking to monitoring dashboard

### 3.6 — EdgeCloud MCP Tool Registration  ✅ COMPLETE (Mar 2026)

- [x] Create `scripts/theta-mcp-tool-descriptor.json`
  - 3 tools registered: `xfuel_submit_intent`, `xfuel_poll_status`, `xfuel_router_status`
  - Full JSON Schema input/output for each tool
  - Endpoint URLs templated from `XFUEL_AGENT_API` env var
  - Examples included for LLM, image gen, and webhook flows
- [x] Create `scripts/register-mcp-tool.cjs`
  - Reads descriptor, rewrites endpoint URLs to configured `XFUEL_AGENT_API`
  - Supports `--dry-run` flag (validated locally — all 3 tools output correctly)
  - Handles 409 Conflict (already registered) gracefully
  - Verifies registration by listing tools after submit
  - Production: `MCP_ENDPOINT=https://mcp.thetaedgecloud.com MCP_API_KEY=<key> XFUEL_AGENT_API=https://api.xfuel.app node scripts/register-mcp-tool.cjs`
- [x] Document MCP tool usage (see descriptor + script inline docs)
- [x] XFuel is now callable from any MCP-compatible client (Claude Desktop, Cursor, Cline, etc.)

---

## Track 4 — TDROP Integration

> Goal: Route a portion of XFuel's machine incentives through TDROP, aligning XFuel with Theta's AI agent incentive layer

> See [TDROP Deep Dive](#tdrop-deep-dive) section below for full mechanics.

### Prerequisite Research (Complete)
- [x] TDROP 2.0 governance executed January 2026: 4B TDROP moved from NFT liquidity mining → staking rewards pool through 2030
- [x] TDROP is TNT-20 token on Theta blockchain
- [x] TDROP staking: holders stake via Theta Web Wallet, earn rewards + governance voting rights
- [x] EdgeCloud accepts TDROP as compute payment (2026 roadmap)
- [x] TDROP 2.0 positions token as AI agent payment layer — autonomous payments between agents
- [x] TDROP rewards apply to completed EdgeCloud compute workloads

### 4.1 — Design: TDROP in CoreRevenueSplitter GET Sub-Bucket  ✅ COMPLETE (Mar 2026)

> Dynamic boost wired. THETA_NATIVE executions now automatically earn higher
> incentive payouts — no admin action required.

**Mechanism:**
- `depositFeeWithTag(circuitId, providerTag)` — ETH deposit with provider origin tag
- `tagFeeOrigin(circuitId, providerTag, amount)` — retroactive tag for fees already deposited at submit time
- `_computeBoost()` — linear interpolation: 0% THETA_NATIVE → 1.0x boost; 100% THETA_NATIVE → 2.5x boost
- `distribute()` — auto-applies dynamic boost at distribution time; resets period counters; emits `DynamicBoostApplied`
- `previewBoost()` — view: returns `(effectiveBoost, thetaNativeRatioBps)` for dashboards/monitoring
- `setDynamicBoostEnabled(bool)` — governance toggle (DEFAULT_ADMIN_ROLE or GOVERNANCE_ROLE)
- `ThetaInferenceCircuit.settleIntent()` — calls `tagFeeOrigin()` with the attested `ProviderTag` (non-fatal)

- [x] Design TDROP routing within the Machine & Agent Incentives (50% of GET) sub-bucket
- [x] Add `depositFeeWithTag()` and `tagFeeOrigin()` to `CoreRevenueSplitter`
- [x] Wire `settleIntent()` → `tagFeeOrigin()` in `ThetaInferenceCircuit`
- [x] Add `_computeBoost()` internal with linear interpolation MIN_BOOST..MAX_BOOST
- [x] Auto-apply boost in `distribute()` with `DynamicBoostApplied` event
- [x] Add `previewBoost()` view function
- [x] Add `setDynamicBoostEnabled()` governance function
- [x] Add `PROVIDER_TAG_THETA_NATIVE` constant matching `ProviderTag` enum
- [x] 27 tests: `test/track2/DynamicBoost.test.cjs` — all passing

**Roadmap (still pending):**
- [ ] TDROP TNT-20 contract address in `CoreRevenueSplitter` for token-denominated routing
- [ ] Governance vote via `veXFGovernance` to set TDROP routing BPS
- [ ] Draft `docs/TDROP_INTEGRATION_DESIGN.md` with tokenomics model

### 4.2 — TDROP Payment Option for Compute  ✅ COMPLETE (Mar 2026)
- [x] `ITdropToken` interface added to `ThetaInferenceCircuit.sol` (minimal ERC-20: transferFrom, transfer, balanceOf, allowance)
- [x] TDROP state vars: `tdropToken`, `tdropDiscountBps` (default 20%), `tdropPerTfuel` (1:1 default), `totalTdropCollected`
  - Mainnet TDROP: `0x1336739B05C7Ab8a526D40DCC0d04a826b5f8B03` (chain 361)
  - Testnet TDROP: `0xde41591ED1f8ED1484aC2CD8ca0876428de60EfF` (chain 365)
- [x] `submitIntentWithTDROP(serviceId, inputHash)` in `ThetaInferenceCircuit.sol`
  - Pulls TDROP from caller via `transferFrom` (caller must approve first)
  - Converts TFUEL price → TDROP via `tdropPerTfuel` exchange rate
  - Applies `tdropDiscountBps` discount to fee portion (default 20% off)
  - Forwards TDROP fee to `CoreRevenueSplitter.receiveERC20Fee()` (non-fatal)
  - Emits `TdropIntentSubmitted` + `InferenceIntentSubmitted` events
  - Settlement, attestation, ZK proof paths unchanged from TFUEL path
- [x] `setTdropConfig(token, discountBps, tdropPerTfuel)` governance function — admin/operator
- [x] `quoteTdrop(serviceId)` view — returns `(tdropRequired, tdropFee, tdropPayment, discountBps)`
- [x] `receiveERC20Fee(circuitId, token, amount, providerTag)` added to `CoreRevenueSplitter.sol`
  - Pulls TNT-20 via `transferFrom`, holds in `erc20Balances[token]`
  - Tracks per-circuit fees in `circuitErc20Fees[circuitId][token]`
  - THETA_NATIVE tag updates `thetaNativeFeesSinceReset` (feeds dynamic boost)
  - `getERC20Balance(token)` + `getCircuitERC20Fees(circuitId, token)` views
  - TDROP held separately from TFUEL — distribution path via governance (Track 4.1 roadmap)
- [x] `paymentToken` field added to `A2ACircuit.sol` Bid struct (`address(0)` = TFUEL, non-zero = ERC-20)
- [x] `submitBidWithTDROP(tdropToken, escrowTdrop, taskHash, capabilityRequired, deadline)` in `A2ACircuit.sol`
  - TDROP relay fee (0.1%) deducted + forwarded to splitter
  - Same acceptance/settlement flow as TFUEL bids
- [x] `TDROP_CONTRACT_ADDRESS`, `TDROP_DISCOUNT_BPS`, `TDROP_PER_TFUEL_RATE` added to `.env.deploy.example`
- [x] 35 tests: `test/track4/TDROPPayment.test.cjs` — all passing
  - ThetaInferenceCircuit: config, quoting, payment flow, discount math, rate scaling
  - CoreRevenueSplitter: ERC-20 ingestion, balance tracking, boost accounting
  - A2ACircuit: TDROP bid escrow, backward compat with TFUEL bids

### 4.3 — Agent-to-Agent TDROP Micropayments  ✅ COMPLETE (Mar 2026)
- [x] `paymentToken` field added to `A2ACircuit.sol` Bid struct (landed in Track 4.2)
  - `address(0)` = TFUEL (native); non-zero = ERC-20 (TDROP or any TNT-20)
- [x] `submitBidWithTDROP(tdropToken, escrowTdrop, taskHash, capabilityRequired, deadline)` (landed in Track 4.2)
  - TDROP relay fee (0.1% of escrow) deducted in TDROP, forwarded to splitter
  - Bid acceptance, settlement, and cancellation paths unchanged — provider receives TDROP
  - TDROP relay fees tagged `THETA_NATIVE (1)` in `CoreRevenueSplitter`, feeding dynamic boost
- [x] `receiveERC20Fee()` in `CoreRevenueSplitter` handles TDROP relay fees from both A2A and Inference circuits
- [x] Tests: covered by `test/track4/TDROPPayment.test.cjs` (tests 28–35)

### 4.4 — Staker Reward Integration (Roadmap)
- [ ] Investigate routing portion of veXF staker rewards as TDROP (complementing TFUEL)
- [ ] Align with `mintStakerReward` on subchain governance token
  - EdgeCloud node operators who stake on XFuel subchain could earn both governance tokens + TDROP
- [ ] This creates a three-layer incentive: TFUEL (gas) → TDROP (AI incentive) → XF governance token

---

## Track 5 — Webhooks and Event Layer

> Goal: Complete webhook and event coverage across all Theta API surfaces and on-chain events

> See [Webhook and Event Layer Deep Dive](#webhook-and-event-layer-deep-dive) section below for full inventory.

### Event Architecture Clarification (Documented 2026-03-09)

There are three distinct event layers in XFuel. Understanding which direction each flows is critical:

```
LAYER 1 — Theta Blockchain → XFuel Backend
  Method A (current):  HTTP polling via provider.getLogs() every pollInterval ms
                       → core-layer/ai-listener.js uses this for ALL EVM chains including Theta
  Method B (target):   WebSocket eth_subscribe — Theta node PUSHES logs to us instantly
                       → backend/theta-bridge/src/ai-listener.js already uses WS for Cosmos
  Key point: WS is a persistent outbound connection from OUR server to Theta's node.
             Theta never calls us. We hold the socket open and react to pushes.

LAYER 2 — Theta Off-Chain APIs → XFuel Backend
  EdgeCloud on-demand: SYNCHRONOUS HTTP — result returned in the response body. No polling.
  Video API transcode:  POLLING — we call GET /video/<id> every 5s until state === "success"
  EdgeStore upload:     SYNCHRONOUS — content key returned immediately in upload response.
  Key point: None of Theta's off-chain APIs have native server-push webhooks. We poll.

LAYER 3 — XFuel → Agents (Outbound)
  After any settlement (layers 1+2 complete), we POST to agent's callbackUrl.
  THIS is the actual webhook system — it flows outward FROM XFuel TO agents.
  We are the webhook sender. Agents are the receivers.
```

### 5.1 — On-Chain Event Polling (Current — Strengthen)  ✅ COMPLETE (Mar 2026)
- [x] Audit `ai-listener.js` for complete coverage of all contract events
  - `InferenceIntentSubmitted` ✓ (was already handled)
  - `IntentSettled` + `IntentFailed` ✓ (added — was missing from event map)
  - `EdgeCloudNodeAttested` ✓ (added — Track 2.1 event)
  - `VideoProvenance` ✓ (added — Track 3.2 event)
  - `EdgeStoreSealed` ✓ (added — Track 3.1 event)
  - `TdropIntentSubmitted` ✓ (added — Track 4.2 event)
  - `FeeReceivedTagged` / `DynamicBoostApplied` / `ERC20FeeReceived` ✓ (CoreRevenueSplitter)
  - `ProofVerified` / `ProofFailed` (ZKVerifierSP1) ✓ (added to INFERENCE_IFACE)
  - `BidSubmitted` / `AgentSettled` (A2ACircuit) ✓ (added to INFERENCE_IFACE)
- [x] Add WebSocket subscription path (`eth_subscribe newLogs`) for low-latency event detection
  - `DEFAULT_CHAINS.theta_mainnet.wsRpc` and `theta_testnet.wsRpc` wired to wss:// endpoints
  - `_connectWebSocket(chainKey, chain, wsUrl)` opens `ethers.WebSocketProvider` and calls `wsProv.on(filter, onLog)`
  - `_pollEVM()` skips HTTP polling when WS subscription is active (no double-processing)
  - Auto-reconnect on WS `close` event with 15s backoff
  - `getStatus()` now includes `wsConnected: bool` per chain
  - `stop()` cleanly destroys all WS providers
- [x] 11 new tests: `test/track5/EventLayer.test.cjs` (5.1 event map + WS path)

### 5.2 — Video API Status Polling → Webhook Pattern
- [ ] Implement polling loop for video transcoding completion in `theta-video-handler.js`
  - `GET /video/<id>` poll until `state === "success"` or `state === "error"`
  - Recommended interval: 5s (typical transcode: 2-10 min depending on length)
  - On success: fire XFuel webhook callback to original agent's `callbackUrl`
  - On error: emit `IntentFailed` event, refund intent payment
- [ ] **Note:** Theta Video API does NOT have native server-push webhooks; polling is the correct pattern
  - The `state` field transitions: `created` → `processing` (sub_state: `transcoding`) → `success`/`error`
  - `progress` field (0-100%) available for real-time progress reporting

### 5.3 — EdgeCloud Job Completion Events
- [ ] Implement EdgeCloud job status polling in `ai-listener.js`
  - Use `GetJobs` RPC API to check job completion status
  - Extract `node_id` and GPU metadata from job response for attestation (Track 2.1)
  - On completion: trigger SP1 proof generation → `settleIntent()`
- [ ] **Note:** EdgeCloud on-demand API is synchronous (response contains result directly)
  - On-demand: fire-and-forget HTTP POST → response IS the result (no separate completion webhook)
  - Dedicated deployments: same synchronous pattern via persistent endpoint
  - Job queue monitoring: use `GetJobs` RPC for dedicated deployment job history

### 5.4 — EdgeStore Upload Confirmation  ✅ COMPLETE (Mar 2026)
- [x] Upload confirmation check added to `theta-edgestore-adapter.js`
  - `POST /api/v2/data` returns content key synchronously — no webhook needed
  - `GET https://data.thetaedgestore.com/api/v2/data/<key>` verifies data is retrievable
  - `uploadAndSeal()` now takes `verifyRetrieval=true` (default) — aborts on-chain seal if retrieval fails
  - Returns `{ ..., retrievalConfirmed: boolean }` for callers to inspect
  - Stats: `retrievalConfirmations` and `retrievalConfirmFailures` counters added
- [x] 4 new tests in `test/track5/EventLayer.test.cjs`

### 5.5 — XFuel Outbound Webhook System (Strengthen Existing)  ✅ COMPLETE (Mar 2026)
- [x] Audit existing webhook delivery in `circuits/theta-inference/theta-inference-handler.js`
  - Retry logic confirmed: 3 attempts, exponential backoff (1s → 2s → 4s)
  - Webhook payload now includes: `intentId`, `status`, `output_hash`, `proof_tx_hash`, `edge_cloud_node_id`
  - Added `video_provenance_uri` field for VIDEO_PROCESSING intents
  - Added `edge_store_cid` field for DataHub intents
  - Added `provider_tag` (0-5) indicating which DePIN tier served the intent
  - Added `timestamp` (Unix ms) to all webhook payloads
- [x] HMAC-SHA256 webhook signature for receiver verification
  - Header: `X-XFuel-Signature: sha256=<hex>`
  - Key: `WEBHOOK_SECRET` env var (added to `.env.deploy.example`)
  - Signing: `HMAC-SHA256(key=WEBHOOK_SECRET, message=<JSON body string>)`
  - Non-fatal: if `crypto` import fails or secret not set, delivers without signature
  - Receivers verify with `crypto.timingSafeEqual(expected, received)`
- [x] 10 new tests in `test/track5/EventLayer.test.cjs`

### 5.6 — Theta On-Chain Native Event Subscriptions
- [ ] Add WebSocket RPC endpoint to `thetaConfig.ts`
  - Mainnet WS: `wss://eth-rpc-api.thetatoken.org/rpc` (confirm WebSocket support)
  - Testnet WS: `wss://eth-rpc-api-testnet.thetatoken.org/rpc`
- [ ] Implement `eth_subscribe("logs", filter)` in `ai-listener.js` as primary event source
  - Subscribe to all XFuel contract event signatures at startup
  - Fallback to `eth_getLogs` polling if WebSocket drops

---

## Track 6 — Dashboard and Grant

> Goal: Visual proof of Theta-native execution; updated grant materials

### 6.1 — EdgeCloud Stats Panel
- [ ] Add EdgeCloud real-time stats to monitoring dashboard
  - Active jobs count (via `GetJobs` RPC)
  - GPU utilization % (from EdgeCloud API response metadata)
  - Estimated PetaFLOPS active (active jobs × GPU tier PetaFLOPS rating)
  - "X / 80+ PetaFLOPS active on Theta EdgeCloud" indicator
- [ ] Show `edgeCloudNodeId` on settled intent detail view (from attestation)

### 6.2 — Subchain Status Panel
- [ ] Add subchain health panel to dashboard
  - Latest block height on subchain (via subchain RPC)
  - Validator count and status
  - Pending intent queue depth
  - Cross-chain transfer count

### 6.3 — TDROP Stats (Post Track 4)
- [ ] Add TDROP routing stats to dashboard
  - TDROP distributed to compute providers (from incentives sub-bucket)
  - TDROP accepted as payment (count + volume)

### 6.4 — Grant Materials Update
- [ ] Update `grant/submissions/theta-ecosystem-summary.md`
  - Add subchain address (365001 testnet)
  - Add MCP tool registration evidence
  - Add EdgeCloud attestation example (intentId → nodeId → proofTxHash)
  - Add Video API provenance example
  - Update deployed contract count and test count
- [ ] Create `docs/THETA_INTEGRATIONS.md` (master integration reference)
  - Architecture overview with subchain diagram
  - All API endpoints used with auth patterns
  - All event types and webhook shapes
  - EdgeStore wallet-auth flow
  - Video API flow with NFT-DRM
  - MCP tool registration guide
  - TDROP integration design

---

## Roadmap Items (Future)

> These are acknowledged but not scheduled. Revisit after tracks 1-6 are complete.

- [ ] TDROP tokenomics design and governance vote (Track 4.1 design first)
- [ ] `mintStakerReward` TNT20 governance token for subchain validators (Track 1.3 minimal version first)
- [ ] TPULSE subchain metrics overlay in dashboard (pending Theta publishing TPULSE RPC access)
- [ ] Second subchain for high-volume circuit (branch from current subchain if ThetaInferenceCircuit volume warrants isolation)
- [ ] Theta Intelligence analytics integration (Theta's own BI agent — explore as dashboard data source)
- [ ] Deutsche Telekom / NTT Digital validator routing in `Fee-to-Stake` (contact Theta Labs for validator node addresses)
- [ ] Osmosis CosmWasm governance whitelist (file proposal; vote rallying via Theta ecosystem validators who hold OSMO)
- [ ] TDROP usage rebate routing (H2 2026 Theta roadmap — developers get TDROP rebates on compute)
- [ ] Distributed inference (H2 2026 Theta roadmap — large models across multiple community EdgeCloud nodes)

---

## Theta API Reference Summary

> Quick reference for all Theta API surfaces used by XFuel.

### EdgeCloud On-Demand Inference
```
Base URL:   https://api.thetaedgecloud.com (or per-model endpoint from dashboard)
Auth:       API Key (per-project, from EdgeCloud dashboard)
Pattern:    Synchronous HTTP POST → response contains result directly
Models:     Llama 3.1, Flux, Whisper, Stable Diffusion, 20+ total
Docs:       https://docs.thetatoken.org/docs/edgecloud-on-demand-model-apis
```

### EdgeCloud Dedicated Model Serving
```
Base URL:   Persistent endpoint per deployment (from EdgeCloud dashboard)
Auth:       API Key
Pattern:    Persistent warm container; no cold-start
Use for:    SP1 prover (CUDA persistence required)
Docs:       https://docs.thetatoken.org/docs/serving-generative-ai-models
```

### EdgeCloud Client RPC APIs (Node-level)
```
Port:       16888 (Theta Node RPC)
Methods:    GetStatus, SetPrice, GetDeployments, GetJobs
Auth:       EdgeCloud API Key
Use for:    Job monitoring, reward tracking, node price management
Docs:       https://docs.thetatoken.org/docs/edgecloud-api-keys
```

### Theta Video API (EdgeCloud Video Services)
```
Base URL:    https://api.thetavideoapi.com
Auth:        x-tva-sa-id + x-tva-sa-secret headers
VOD flow:    POST /upload → PUT <presigned_url> → POST /video → poll GET /video/<id>
Livestream:  POST /stream → GET /ingestor/filter → PUT /ingestor/<id>/select → RTMP push
DRM:         Set nft_collection in POST /video; users need NFT ownership to decrypt
Webhook:     NONE — polling only (GET /video/<id> for state transitions)
Docs:        https://docs.thetatoken.org/docs/theta-video-api-developer-api
             https://docs.thetatoken.org/docs/theta-video-api-livestream
             https://docs.thetatoken.org/docs/theta-nft-based-drm
```

### EdgeStore
```
Upload URL:  https://api.thetaedgestore.com/api/v2/data
Retrieve:    https://data.thetaedgestore.com/api/v2/data/<key>
Auth:        Wallet-signed token: timestamp.walletAddress.eth_sign("Theta EdgeStore Call ${timestamp}")
             Token expires 24 hours
Output:      Content key (0x hex hash) — use as on-chain commitment
Webhook:     NONE — upload is synchronous; returns content key immediately
Docs:        https://docs.thetatoken.org/docs/theta-edgestore-gateway-alpha
```

### Theta EVM RPC (On-Chain Events)
```
Mainnet HTTP:   https://eth-rpc-api.thetatoken.org/rpc   (chain 361)
Testnet HTTP:   https://eth-rpc-api-testnet.thetatoken.org/rpc  (chain 365)
Event query:    eth_getLogs (filter by address + topic)
Event stream:   eth_subscribe (WebSocket — confirm endpoint)
Native Theta:   Port 16888 (thetacli / Theta.js SDK)
Docs:           https://docs.thetatoken.org/docs/rpc-api-reference
```

### Theta MCP Server
```
Compatible with: Claude Desktop, Cursor, Cline, Zed, Sourcegraph Cody
Protocol:        Model Context Protocol (MCP)
Models:          18+ via EdgeCloud on-demand
Use for XFuel:   Register xfuel_submit_intent as an MCP tool
Launched:        January 2026
```

### Theta P2P JavaScript SDK
```
Use for:    P2P video delivery in xfuel.app after Video API transcoding
SDK:        Browser-side JavaScript
Docs:       https://docs.thetatoken.org/docs/theta-p2p-javascript-sdk
```

---

## TDROP Deep Dive

> Full analysis of TDROP 2.0 mechanics and XFuel integration strategy.

### What TDROP 2.0 Is

TDROP is a TNT-20 token on the Theta blockchain. The 2.0 upgrade (executed January 2026) transformed it from an NFT-marketplace liquidity mining token into the **AI agent economy incentive layer** for the Theta ecosystem.

Key facts:
- **Total supply:** 20 billion TDROP
- **Staking pool:** 4 billion TDROP (redirected from NFT liquidity mining, Jan 2026)
- **Staking rewards:** Active through 2030
- **Governance:** Staked TDROP = voting rights on ThetaDrop proposals (liquidity mining rates, earning rates)
- **Payment:** EdgeCloud accepts TDROP for compute usage (active 2026)
- **Rebates:** H2 2026 roadmap — developers receive TDROP rebates based on EdgeCloud compute consumption
- **Agent payments:** TDROP 2.0 whitepaper explicitly positions it for AI-to-AI autonomous payments

### Why This Matters for XFuel

XFuel's current revenue model routes everything through TFUEL. TDROP 2.0 creates a second Theta-native incentive channel that XFuel is not currently using. The intersection points are:

| XFuel Component | TDROP Integration Point |
|----------------|------------------------|
| GET Machine & Agent Incentives (50% of GET) | Route X% to TDROP for Theta-native compute contributions |
| A2A agent-to-agent escrow | Accept TDROP as payment token (A2A is the designed TDROP use case) |
| ThetaInferenceCircuit compute payments | Accept TDROP alongside TFUEL; apply TDROP discount to incentivize adoption |
| veXF staker rewards | Optional TDROP component for stakers who contribute EdgeCloud nodes |
| EdgeCloud rebates (H2 2026) | XFuel's GET treasury could receive TDROP rebates from Theta when routing compute |

### Design Proposal: TDROP Routing in GET Sub-Bucket

The cleanest integration is within the existing `CoreRevenueSplitter` GET architecture:

```
Machine & Agent Incentives (50% of GET)
├── Compute subsidies (currently TFUEL)      → keep as TFUEL
├── Inference routing rewards (currently TFUEL)
│   └── Theta-native flag: if providerTag == THETA_NATIVE
│       └── Route X% of reward as TDROP     ← NEW
└── Volume-triggered boosts (currently TFUEL)
    └── TDROP boost for top compute contributors  ← NEW
```

This means:
1. Agents that route AI tasks through Theta EdgeCloud (vs. AWS/GCP fallback) earn a TDROP bonus
2. XFuel becomes a TDROP demand driver — aligns with Theta Labs' goals
3. No disruption to existing TFUEL flows

### Implementation Requirements

1. **TDROP contract address** on Theta mainnet (TNT-20) — retrieve from Theta docs/dashboard
2. **ERC-20 interface** for TDROP (it is TNT-20, which is ERC-20-compatible on Theta EVM)
3. **Price parity** — need oracle or fixed-rate for TDROP/TFUEL conversion in incentives calculation
4. **Governance gate** — `veXFGovernance` proposal to enable TDROP routing (community decision)
5. **`TDROP_TOKEN_ADDRESS`** env var in `.env.deploy.example`

### Risk Note
TDROP's primary liquidity is on ThetaDrop marketplace and Theta DEXes. Before routing significant protocol funds through TDROP, confirm liquidity depth is sufficient so incentive recipients can exit if needed. Start with a small BPS allocation (e.g., 500 BPS of the incentives sub-bucket = 2.5% of total GET).

---

## Webhook and Event Layer Deep Dive

> Complete inventory of every event source, pattern, and gap.

### Theta Platform: What Has Native Webhooks

| Platform | Native Webhooks | Pattern |
|----------|----------------|---------|
| EdgeCloud On-Demand API | **No** | Synchronous HTTP — response IS the result |
| EdgeCloud Dedicated Serving | **No** | Persistent endpoint, synchronous per request |
| EdgeCloud Client RPC | **No** | Pull-based (GetJobs, GetDeployments) |
| Theta Video API (VOD) | **No** | Poll `GET /video/<id>` until `state === "success"` |
| Theta Video API (Livestream) | **No** | Poll stream status; RTMP push is outbound from client |
| EdgeStore | **No** | Upload synchronous; returns content key immediately |
| Theta EVM (on-chain) | Partial | `eth_getLogs` (pull) + `eth_subscribe` (push via WebSocket) |
| Theta MCP Server | N/A | Tool invocation is synchronous (MCP protocol) |

**Key finding:** Theta has no native server-push webhooks on any off-chain API surface. All event detection is **polling-based** except on-chain events (which support WebSocket subscriptions via standard EVM `eth_subscribe`).

### XFuel Outbound Webhooks (What We Provide)

XFuel *sends* webhooks to agents after intent settlement. This is the correct direction — we are the event source for downstream consumers.

| Trigger | Webhook Event | Current Status |
|---------|--------------|----------------|
| `IntentSettled` on-chain | `xfuel.intent.settled` | ✓ Implemented |
| EdgeCloud job complete | `xfuel.compute.complete` | Partial (no nodeId in payload) |
| Proof verified | `xfuel.proof.verified` | Needs confirmation |
| Video transcode complete | `xfuel.video.ready` | ✗ Not implemented |
| EdgeStore upload confirmed | `xfuel.data.stored` | ✗ Not implemented |
| Intent failed | `xfuel.intent.failed` | Needs confirmation |

### Recommended Webhook Payload Schema (Unified)

```json
{
  "event":        "xfuel.intent.settled",
  "intentId":     "0x...",
  "status":       "settled | failed | processing",
  "serviceType":  "LLM_INFERENCE | VIDEO_PROCESSING | ...",
  "outputHash":   "0x...",
  "proofTxHash":  "0x...",
  "edgeCloudNodeId": "0x...",
  "providerTag":  "THETA_NATIVE | AWS_FALLBACK | GCP_FALLBACK",
  "videoData": {
    "videoId":      "video_...",
    "playbackUri":  "https://media.thetavideoapi.com/.../master.m3u8",
    "contentHash":  "0x...",
    "nftCollection": "0x..."
  },
  "storageData": {
    "edgeStoreCid": "0x...",
    "retrievalUrl": "https://data.thetaedgestore.com/api/v2/data/0x..."
  },
  "timestamp":    1741550000,
  "signature":    "HMAC-SHA256 of payload body with shared secret"
}
```

### Event Coverage by Source: Complete Map

```
SOURCE: Theta EVM (on-chain)
  Method:   eth_subscribe("logs") via WebSocket [PRIMARY]
            eth_getLogs poll [FALLBACK]
  Events:
    ZKVerifierSP1:         ProofVerified, ProofFailed, CircuitRegistered
    CoreRevenueSplitter:   FeeDeposited, Distributed, StakeRouted
    ThetaInferenceCircuit: InferenceIntentSubmitted, IntentSettled, EdgeCloudNodeAttested (new)
    A2ACircuit:            AgentRegistered, ReputationUpdated, SwarmFormed, AgentSettled
    ThetaGPUCircuit:       GPULeaseSubmitted, GPULeaseSettled
    DataHubs:              DataContributed (with EdgeStore CID after Track 3.1)
    veXFGovernance:        ProposalCreated, VoteCast, ProposalExecuted

SOURCE: EdgeCloud On-Demand API
  Method:   Synchronous HTTP (no polling needed)
  Events:   Job result returned in HTTP response body
  Action:   Extract nodeId from response → attestEdgeCloudNode() → settleIntent()

SOURCE: EdgeCloud Client RPC (GetJobs)
  Method:   Pull polling (every 30s for dedicated deployments)
  Events:   Job completion, earnings updates
  Action:   Monitor SP1 prover job health; alert on failure

SOURCE: Theta Video API
  Method:   Poll GET /video/<id> every 5s until state transitions
  States:   created → processing (transcoding) → success / error
  Action:   On success: emit VideoProvenance event + fire webhook to agent
            On error: refund intent + emit IntentFailed

SOURCE: EdgeStore
  Method:   Synchronous (upload returns content key immediately)
  Action:   Verify retrieval, then commit CID on-chain

SOURCE: XFuel Agent API (Outbound)
  Method:   HTTP POST to agent-provided callbackUrl
  Trigger:  Any settled, failed, or ready event above
  Security: HMAC-SHA256 signature in X-XFuel-Signature header
```

### Polling Intervals Reference

| Source | Recommended Interval | Notes |
|--------|---------------------|-------|
| On-chain events (HTTP fallback) | 10s (current) → consider 3s | Theta ~6s block time |
| On-chain events (WebSocket) | Immediate (push) | Target after Track 5.6 |
| Video API transcode status | 5s | Typical transcode: 2-10 min |
| EdgeCloud GetJobs | 30s | For dedicated SP1 prover health |
| EdgeStore verification | 1 attempt post-upload | Synchronous; no repeat needed |

---

*This document is maintained alongside the XFuel Protocol codebase. Update check marks as work is completed.*
*Last updated: 2026-03-09*
