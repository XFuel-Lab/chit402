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
- [ ] Add `EdgeCloudAttestation` struct to `ThetaInferenceCircuit.sol`
  - Fields: `nodeId`, `gpuFingerprint`, `petaflopsUsed`, `attestedAt`
- [ ] Add `attestEdgeCloudNode()` function (RELAYER_ROLE only)
- [ ] Add `EdgeCloudNodeAttested` event
- [ ] Encode `nodeId` in SP1 `publicValues` so attestation is cryptographically bound to proof
- [ ] Update `ai-listener.js` to call `attestEdgeCloudNode()` with EdgeCloud job response metadata before settling proof
- [ ] Update tests for new attestation flow

### 2.2 — SP1 Prover: Dedicated Model Serving Migration
- [ ] Migrate SP1 prover from on-demand Docker to EdgeCloud Dedicated Model Serving
- [ ] Configure persistent CUDA endpoint via EdgeCloud API Key
- [ ] Update `sp1-prover/DEPLOY_ON_EDGECLOUD.md` with Dedicated Serving steps
- [ ] Update `Dockerfile.cuda` with Dedicated Serving entrypoint
- [ ] Validate sub-200ms proof generation with persistent warm container

### 2.3 — Hybrid Cloud Fallback Router
- [ ] Add `HybridCloudRouter` to `ai-listener.js`
  - Priority 1: Theta EdgeCloud (primary; marks jobs as `THETA_NATIVE` for incentive boost)
  - Priority 2: AWS Bedrock (burst overflow when EdgeCloud queue > threshold)
  - Priority 3: Google Vertex AI (final fallback)
- [ ] Add `providerTag` to `EdgeCloudAttestation` — distinguish Theta-native from fallback executions
- [ ] Gate `boostMultiplier` in `CoreRevenueSplitter` on `providerTag === THETA_NATIVE`

### 2.4 — FedML/Lavita Training Route
- [ ] Extend `ai-listener.js` ThetaInference handler for `preset = GPU_TRAINING_JOB`
- [ ] Add FedML job submission client (differential privacy mode)
- [ ] Generate SP1 proof with `publicValues: { jobId, datasetHash, outputModelHash }`
- [ ] Add `FEDML_API_KEY` to `.env.deploy.example`

---

## Track 3 — Theta Feature Hooks

> Goal: Wire every live Theta API surface into XFuel's circuit/agent layer

### 3.1 — EdgeStore DataHub Integration
- [ ] Replace mock Poseidon commitment in `DataHubs.sol` with `bytes32 edgeStoreCid` field
- [ ] Add `edgeStoreNodeId` to `DataContribution` struct
- [ ] Create `circuits/data-hubs/theta-edgestore-adapter.js`
  - Wallet-signed auth token generation: `timestamp.walletAddress.eth_sign("Theta EdgeStore Call ${timestamp}")`
  - `POST https://api.thetaedgestore.com/api/v2/data` upload
  - Return EdgeStore content key (`0x...` hex) for on-chain commitment
  - Token refresh logic (24h expiry)
- [ ] Add `THETA_EDGESTORE_WALLET_KEY` to `.env.deploy.example`
- [ ] Update `DataHubs.sol` on-chain commitment to store EdgeStore content key (not raw hash)
- [ ] Test: upload dataset → get CID → commit on-chain → verify retrieval via `GET https://data.thetaedgestore.com/api/v2/data/<key>`

### 3.2 — Video API: VOD + ZK Provenance
- [ ] Create `backend/theta-bridge/src/theta-video-handler.js`
  - `POST https://api.thetavideoapi.com/upload` → presigned URL
  - `PUT <presigned_url>` → upload video bytes
  - `POST https://api.thetavideoapi.com/video` with `source_upload_id` + `nft_collection` (link to TNT-721)
  - Poll `GET /video/<id>` until `state === "success"`
  - Return `playback_uri` (HLS master.m3u8) + `video_id` for on-chain commitment
- [ ] Add `VideoProvenance` event to `ThetaInferenceCircuit.sol`
  - Fields: `intentId`, `videoId`, `contentHash`, `playbackUri`, `nftCollection`
- [ ] Wire `VIDEO_PROCESSING` service type through new handler (currently falls through to generic EdgeCloud)
- [ ] Add `THETA_VIDEO_SA_ID` + `THETA_VIDEO_SA_SECRET` to `.env.deploy.example`

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

### 3.6 — EdgeCloud MCP Tool Registration
- [ ] Create `scripts/theta-mcp-tool-descriptor.json`
  - Register `xfuel_submit_intent` as an MCP tool
  - Parameters: `preset`, `gpuTier`, `prompt`, `callbackUrl`
  - Endpoint: `POST http://<agent-api>/theta-ai/agent-intent`
- [ ] Create `scripts/register-mcp-tool.cjs` to submit tool descriptor to Theta MCP server
- [ ] Document MCP tool usage in `docs/THETA_INTEGRATIONS.md`
- [ ] This makes XFuel callable from any MCP-compatible client (Claude Desktop, Cursor, Cline, etc.)

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

### 4.1 — Design: TDROP in CoreRevenueSplitter GET Sub-Bucket
- [ ] Design TDROP routing within the Machine & Agent Incentives (50% of GET) sub-bucket
  - Proposal: when `providerTag === THETA_NATIVE`, route X% of incentives as TDROP (not TFUEL)
  - Requires TDROP TNT-20 contract address in `CoreRevenueSplitter`
  - Requires governance vote via `veXFGovernance` to set TDROP routing BPS
- [ ] Draft `docs/TDROP_INTEGRATION_DESIGN.md` with tokenomics model
- [ ] Review with team before implementation (tokenomics change requires careful design)

### 4.2 — TDROP Payment Option for Compute
- [ ] Add TDROP as accepted payment token in `ThetaInferenceCircuit.sol`
  - Accept TDROP (TNT-20) alongside TFUEL for `submitIntent()` payments
  - Apply TDROP-specific fee BPS (potentially discounted to incentivize adoption)
- [ ] Add TDROP price oracle reference (Chainlink hook already exists in `CoreRevenueSplitter`)

### 4.3 — Agent-to-Agent TDROP Micropayments
- [ ] Extend `A2ACircuit.sol` to support TDROP-denominated escrow alongside TFUEL
  - TDROP is described in TDROP 2.0 whitepaper as the designated AI-to-AI payment token
  - A2A relay fee (currently 0.1%) could be paid in TDROP for agents on Theta
- [ ] Add `paymentToken` field to `A2ACircuit` task escrow struct

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

### 5.1 — On-Chain Event Polling (Current — Strengthen)
- [ ] Audit `ai-listener.js` for complete coverage of all contract events
  - `InferenceIntentSubmitted` ✓ (currently handled)
  - `IntentSettled` ✓ (currently handled)
  - `EdgeCloudNodeAttested` — add after Track 2.1
  - `VideoProvenance` — add after Track 3.2
  - `FeeDeposited` / `Distributed` (CoreRevenueSplitter) — confirm coverage
  - `ProofVerified` / `ProofFailed` (ZKVerifierSP1) — confirm coverage
  - `AgentRegistered` / `ReputationUpdated` (A2ACircuit) — confirm coverage
- [ ] Add WebSocket subscription path (`eth_subscribe newLogs`) for low-latency event detection
  - Current: HTTP polling every ~10s
  - Target: WebSocket subscription with HTTP polling fallback
  - Theta EVM supports `eth_subscribe` via WebSocket RPC endpoint

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

### 5.4 — EdgeStore Upload Confirmation
- [ ] Add upload confirmation check in `theta-edgestore-adapter.js`
  - `POST /api/v2/data` returns content key synchronously — no webhook needed
  - Verify retrieval: `GET https://data.thetaedgestore.com/api/v2/data/<key>` returns data
  - Only commit content key on-chain after retrieval confirmation succeeds

### 5.5 — XFuel Outbound Webhook System (Strengthen Existing)
- [ ] Audit existing webhook delivery in `backend/theta-bridge/src/m2m-server.js`
  - Confirm retry logic on failed delivery (target: 3 retries with exponential backoff)
  - Confirm webhook payload includes: `intentId`, `status`, `outputHash`, `proofTxHash`, `edgeCloudNodeId`
  - Add `videoProvenanceUri` field to webhook payload for VIDEO_PROCESSING intents
  - Add `edgeStoreCid` field to webhook payload for DataHub intents
- [ ] Add webhook signature (HMAC-SHA256 of payload with shared secret) for verification by receivers

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
