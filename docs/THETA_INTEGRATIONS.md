# XFuel Protocol — EdgeCloud / Theta API Reference (provider ops)

> **Banner (ADR 0002):** Provider integration only — **not** settlement home.
> Canonical entry: [`docs/providers/edgecloud.md`](providers/edgecloud.md).

**Created:** 2026-03-11  
**Owner:** XFuel Core Team  
**Status:** Living ops reference for EdgeCloud + Theta RPC surfaces

Technical reference for Theta/EdgeCloud API surfaces (auth, endpoints, events) used when
EdgeCloud is enabled as a **GPU provider tier**.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Theta RPC Endpoints](#theta-rpc-endpoints)
- [EdgeCloud On-Demand Inference](#edgecloud-on-demand-inference)
- [EdgeCloud Dedicated Deployments](#edgecloud-dedicated-deployments)
- [Theta Video API — VOD](#theta-video-api--vod)
- [Theta Video API — Livestream](#theta-video-api--livestream)
- [Theta EdgeStore](#theta-edgestore)
- [Theta P2P Video SDK](#theta-p2p-video-sdk)
- [NFT-Based DRM](#nft-based-drm)
- [Theta MCP Server](#theta-mcp-server)
- [XFuel Subchain](#xfuel-subchain)
- [TDROP Integration](#tdrop-integration)
- [On-Chain Event Reference](#on-chain-event-reference)
- [Outbound Webhook Schema](#outbound-webhook-schema)

---

## Theta RPC Endpoints

**Docs:** https://docs.thetatoken.org/docs/rpc-api-reference

Theta exposes **two distinct RPC interfaces**:

### 1. ETH-RPC Adaptor (what XFuel uses)

This is the Ethereum-compatible JSON-RPC adaptor. It exposes standard ETH methods (`eth_blockNumber`, `eth_getLogs`, `eth_call`, etc.) and is what ethers.js connects to.

```
Mainnet:  https://eth-rpc-api.thetatoken.org/rpc        (chain ID 361)
Testnet:  https://eth-rpc-api-testnet.thetatoken.org/rpc (chain ID 365)
```

XFuel uses these via:
- `ethers.JsonRpcProvider(rpcUrl)` — contract reads, event polling (`getLogs`)
- `WebSocket` provider — block subscription in `CoreListener`
- `eth_blockNumber` — subchain health polling in Dashboard (6.2)

### 2. Theta Node Native RPC (NOT used by XFuel)

The Theta Node runs its own RPC server at **port 16888** (local node only). It exposes Theta-native methods: `theta.GetBlock`, `theta.GetAccount`, `theta.GetTransaction`, `theta.GetVersion`, `theta.BroadcastRawTransaction`, etc.

```
Local node:  http://localhost:16888/rpc   (Theta Node RPC)
ThetaCli:    http://localhost:16889/rpc   (ThetaCli Daemon — wallet management)
```

XFuel does **not** use these endpoints. They require running a local Theta Node and are for direct protocol-level queries, not application-level smart contract interaction.

### Chain IDs

| Network | Chain ID | ETH-RPC Adaptor |
|---------|----------|-----------------|
| Theta Mainnet | 361 (`0x169`) | `https://eth-rpc-api.thetatoken.org/rpc` |
| Theta Testnet | 365 (`0x16d`) | `https://eth-rpc-api-testnet.thetatoken.org/rpc` |
| XFuel Subchain (testnet) | 365001 | `VITE_SUBCHAIN_TESTNET_RPC` (env var) |
| XFuel Subchain (mainnet) | 361001 | `VITE_SUBCHAIN_MAINNET_RPC` (env var) |
| XFuel Subchain (privatenet) | 360777 | `http://127.0.0.1:19888/rpc` |

### ETH-RPC Adaptor Limitations

Two important constraints apply when targeting the Theta ETH-RPC adaptor (source: [Theta ETH-RPC docs](https://docs.thetatoken.org/docs/web3-stack-eth-rpc-support)):

**1. Non-standard methods are NOT supported.**

The adaptor does not implement `evm_snapshot`, `evm_revert`, or `evm_mine`. This means Hardhat fixtures (e.g. `waffle.loadFixture()`) that rely on these methods will fail when pointed at a live Theta RPC. XFuel's test suite runs against the local Hardhat network (chain ID 1337), which is correct — never point `npx hardhat test` at a Theta RPC.

**2. EVM revert messages are generic.**

When a transaction reverts on-chain, Theta's adaptor always returns `"evm: execution reverted"` regardless of the custom error string. Tests that use:

```js
await expect(...).to.be.revertedWith('Some specific message')
```

will pass on Hardhat local but **fail** against a live Theta node. If you ever write integration tests that target Theta directly, replace the expected message with `"evm: execution reverted"`.

> **XFuel status:** All `revertedWith` tests in `test/` run against Hardhat local — no action required. This note is for future contributors adding Theta-live integration tests.

---

## Theta Explorer API

**Docs:** https://docs.thetatoken.org/docs/explorer-api-reference

```
Base URL:  https://explorer-api.thetatoken.org/api/
Protocol:  REST (no authentication required)
```

Endpoints used by XFuel (`src/utils/thetaEdgeCloud.ts`):

| Endpoint | Returns | Used for |
|----------|---------|----------|
| `GET /supply/theta` | `{ total_supply, circulation_supply }` | Network stats panel |
| `GET /supply/tfuel` | `{ circulation_supply }` | Network stats panel |
| `GET /stake/totalAmount` | `{ totalAmount, totalNodes }` | Network stats panel |
| `GET /account/:address` | `{ balance: { thetawei, tfuelwei }, sequence, txs_counter }` | Wallet balance display |
| `GET /accounttx/:address?type=&pageNumber=&limitNumber=&isEqualType=` | tx list | Account tx history |

**What the Explorer API does NOT provide:**
- EdgeCloud node counts, active AI jobs, or compute TFLOPS — these are EdgeCloud-internal
- Per-wallet edge node reward earnings — not exposed via public API
- TDROP boost multipliers — not in Explorer API

**Block status codes** (from docs — used when parsing `theta.GetBlock` responses if native RPC is ever needed):
```
0: pending  1: valid  2: invalid  3: committed
4: directly finalized  5: indirectly finalized  6: trusted
A block is considered finalized if status is 4, 5, or 6.
```

**Transaction types** (for filtering `GET /accounttx`):
```
0: coinbase  2: send  7: smart contract  8: deposit stake  9: withdraw stake
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     XFuel Core Layer                            │
│  ZKVerifierSP1 · CoreRevenueSplitter · veXFGovernance           │
└──────────┬──────────────────────────────────────────────────────┘
           │  registers circuits, verifies proofs, splits fees
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    XFuel Circuits (EVM)                         │
│  ThetaInferenceCircuit · A2ACircuit · ThetaGPUCircuit · DataHubs│
└────┬──────────┬────────────────┬───────────────────────────┬────┘
     │          │                │                           │
     ▼          ▼                ▼                           ▼
EdgeCloud   Theta Video     EdgeStore              XFuel Subchain
On-Demand   API (VOD +      (DataHub              (chain 365001)
Inference   Livestream)      sealing)
     │
     ▼
SP1 zkVM proof generation → on-chain settlement
     │
     ▼
Agent webhook callback (HMAC-SHA256 signed)
```

**Key principle:** Theta APIs are polled (no native server-push webhooks on off-chain surfaces). XFuel is the webhook *sender* — agents register a `callbackUrl` and receive a POST after intent settlement.

---

## EdgeCloud AI Services Overview

**Docs:** https://docs.thetatoken.org/docs/theta-edgecloud-ai-services

Theta EdgeCloud offers multiple distinct AI service tiers. XFuel integrates with the first two:

| Service | API Surface | Auth | XFuel Usage |
|---------|-------------|------|-------------|
| On-Demand Inference | `ondemand.thetaedgecloud.com` | `x-api-key` | Primary inference path (Track 2.1) |
| Dedicated Model Serving | Deployment `Inference Endpoint` | Optional basic auth | SP1 prover host (Track 2.2, deferred) |
| Programmatic Deployment Mgmt | `controller.thetaedgecloud.com` | `x-api-key` (project key) | Track 2.2 deferred |
| Agentic AI / RAG | Dashboard-managed agent | Agent embed API | UI integration only |
| EdgeCloud Client RPC | `localhost:9545/rpc` | None (local) | Job monitor (Track 5.3) |
| Jupyter / GPU Training | Dashboard | Dashboard | Not integrated |

> **Two types of API key:** On-demand inference uses an *access key* from the "On-demand model APIs" page. Deployment management uses a *project API key* from "Settings → Projects". They are separate credentials.

---

## EdgeCloud On-Demand Inference

**Docs:** https://docs.thetatoken.org/docs/edgecloud-on-demand-model-apis

```
Base URL:   https://ondemand.thetaedgecloud.com
Auth:       x-api-key: <THETA_EDGECLOUD_API_KEY>   (access key from EdgeCloud dashboard)
Pattern:    POST /infer_request/{model_slug}/completions
            Body: { input: { messages, max_tokens, ... }, stream: false, variant: "quantized" }
Models:     Llama 3.1 (8B/70B/405B), Flux.1, Whisper, Stable Diffusion, 20+
```

### Request (LLM example)
```http
POST /infer_request/llama_3_8b/completions
x-api-key: <THETA_EDGECLOUD_API_KEY>
Content-Type: application/json

{
  "input": {
    "messages": [{ "role": "user", "content": "..." }],
    "max_tokens": 512,
    "temperature": 0.7
  },
  "stream": false,
  "variant": "quantized"
}
```

> **Note:** The model is specified in the **URL slug**, not in the body. The body uses an `input` wrapper (not bare `messages`). Access keys are obtained from the EdgeCloud dashboard "On-demand model APIs" page — they are different from the `x-api-key` management keys used for `controller.thetaedgecloud.com`.

### Dedicated LLM Deployments (OpenAI-compatible)
Dedicated model deployments (Track 2.2) expose an **OpenAI-compatible** endpoint at their inference URL:

```http
POST {INFERENCE_ENDPOINT}/v1/chat/completions
Content-Type: application/json

{
  "model": "meta-llama/Llama-3.1-8B-Instruct",
  "messages": [{ "role": "user", "content": "..." }],
  "max_tokens": 512
}
```

No `x-api-key` header is required for public dedicated deployments (auth is optional and configured per-deployment via `auth_username`/`auth_password`).

### XFuel Handler Flow
1. `ThetaInferenceHandler._callEdgeCloud()` submits POST to `https://ondemand.thetaedgecloud.com/infer_request/{slug}/completions`
2. Response contains result (may be SSE stream even with `stream:false` — handler parses both)
3. Handler calls `ThetaInferenceCircuit.attestEdgeCloudNode()` with extracted metadata (non-fatal)
4. SP1 proof generated with `publicValues: { intentId, inputHash, outputHash, nodeId }`
5. `settleIntent(intentId, outputHash, proofBytes)` on-chain — ZK-verified settlement

**Source:** `circuits/theta-inference/theta-inference-handler.js` — `_callEdgeCloud()`, `_callRapidApi()`

---

## EdgeCloud Dedicated Deployments

**Docs:** https://docs.thetatoken.org/docs/serving-generative-ai-models  
**Programmatic Management:** https://docs.thetatoken.org/docs/use-edgecloud-api-keys-to-manage-deployments

```
Controller API:  https://controller.thetaedgecloud.com   (create/list/stop/delete deployments)
Auth:            x-api-key: <EDGECLOUD_PROJECT_API_KEY>  (project-scoped key from dashboard Settings → Projects)
Machine Types:   vm_gt1 (T4), vm_gv1 (V100), vm_ga1 (A100) — GET https://api.thetaedgecloud.com/resource/vm/list
Use for:         SP1 prover (CUDA persistence — Track 2.2, deferred)
```

### Key Management API Calls
```bash
# List standard templates
GET  https://controller.thetaedgecloud.com/deployment_template/list_standard_templates?category=prototyping

# Create deployment
POST https://controller.thetaedgecloud.com/deployment
     { project_id, deployment_template_id, vm_id, min_replicas, max_replicas, annotations }

# List deployments
GET  https://controller.thetaedgecloud.com/deployments/list?project_id={id}

# Delete deployment (uses Shard + Suffix from list response)
DELETE https://controller.thetaedgecloud.com/deployments/{shard}/{suffix}?project_id={id}
```

> **Status:** Track 2.2 (Dedicated Model Serving) is deferred pending funding. The `@thetalabs/theta-edgecloud` npm package provides a Node.js SDK for these operations.

### EdgeCloud Client RPC — GetJobs (Track 5.3)
```
Endpoint:   http://localhost:9545/rpc   (local EdgeCloud client node — no API key needed)
Method:     edgecloud.GetJobs          (per https://docs.thetatoken.org/docs/theta-edgecloud-client-rpc-apis)
Params:     [{ page: 0, size: 50 }]
Response:   { result: { jobs: [{ id, reward_usd, success_time, error_time, error_message }] } }
Interval:   30s
Env:        SP1_PROVER_ENDPOINT (set to http://localhost:9545/rpc on nodes running EdgeCloud client)
```

> **Critical distinction:** The EdgeCloud Client RPC runs **locally on nodes that contribute GPU capacity** via the EdgeCloud client software. It is NOT a remote API — it requires running the EdgeCloud client on the same machine. This is separate from both:
> - The on-demand API (`ondemand.thetaedgecloud.com`) — used to *consume* AI inference
> - The Theta Node native RPC (port 16888) — used for native Theta protocol queries

> **Job response fields:** Jobs do NOT have a `status` field. Completion is indicated by `success_time` being set; failure by `error_time`/`error_message` being set.

The `CoreListener._startEdgeCloudJobMonitor()` polls this endpoint for dedicated deployment health. Stats exposed in `getStatus().edgeCloudJobs`.

> **Status:** Deferred (Track 2.2). Job monitor is wired but exits early without `SP1_PROVER_ENDPOINT`.

---

## Theta Video API — VOD

**Docs:** https://docs.thetatoken.org/docs/theta-video-api-developer-api

```
Base URL:   https://api.thetavideoapi.com
Auth:       x-tva-sa-id: <THETA_VIDEO_SA_ID>
            x-tva-sa-secret: <THETA_VIDEO_SA_SECRET>
```

### Upload & Transcode Flow
```
1. POST /upload                   → { id, presigned_url }
2. PUT <presigned_url> (raw bytes) → 200 OK
3. POST /video                    → { id: "video_..." }
   body: { source_upload_id, playback_policy: "public", [nft_collection] }
4. GET /video/<id>  (poll 5s)     → { state: "success", playback_uri }
```

### State Machine
```
created → processing (sub_state: transcoding) → success
                                              → error
```
`progress` (0–100%) available during `processing` state.

### On-Chain Hook
After `state === "success"`, `ThetaInferenceCircuit.emitVideoProvenance()` is called:
```solidity
event VideoProvenance(
  bytes32 indexed intentId,
  string  videoId,
  bytes32 contentHash,   // keccak256(playbackUri)
  string  playbackUri
);
```

**Source:** `backend/theta-bridge/src/theta-video-handler.js` — `uploadAndTranscode()`, `_pollVideo()`, `_emitProvenance()`

---

## Theta Video API — Livestream

**Docs:** https://docs.thetatoken.org/docs/theta-video-api-livestream

```
Base URL:   https://api.thetavideoapi.com
Auth:       same SA credentials as VOD
Max streams: 3 per service account
```

### Livestream Setup Flow
```
1. POST /stream                         → { id: "stream_..." }
   Body: { name: "..." }  — no playback_policy field for streams
2. GET /ingestor/filter                 → [ { id, ip, stakes, geo }, ... ]
   (sorted nearest-first by requester IP)
3. PUT /ingestor/<id>/select            → { stream_server, stream_key }
   Body: { "tva_stream": "stream_..." } — REQUIRED; omitting causes 403
   Valid for 5 minutes — must start RTMP push within window
4. Push RTMP:  rtmp://<stream_server>/live  (key: <stream_key>)
```

**Source:** `backend/theta-bridge/src/theta-video-handler.js` — `createLivestream()`, `_listIngestors()`, `_selectIngestor()`

> **Note:** Livestream modelled as `VIDEO_PROCESSING` (serviceType 5) — no separate `LIVE_STREAM` enum needed.

### Video API Webhooks (Theta-side events)

Theta Video API can POST event notifications to your backend when video transcoding state changes. Configured in the TVA dashboard.

```
Event types:
  video.created          — video object created (transcoding queued)
  video.updated          — metadata updated, or retry triggered
  video.partial_finished — one resolution tier completed
  video.finished         — all resolution tiers complete
  video.errored          — transcoding error
  video.deleted          — video deleted

Payload (POST to your endpoint):
{
  "id":                 "wbhk_evnt_...",
  "service_account_id": "srvacc_...",
  "object_id":          "video_...",
  "object_uri":         "https://api.thetadrop.com/video/video_...",
  "event":              "video.finished",
  "create_time":        "2023-06-13 18:14:09 +00:00",
  "update_time":        "2023-06-13 18:14:09 +00:00"
}
```

- Theta expects a **2xx** response; retries with exponential backoff if non-2xx
- Events **not** guaranteed in delivery order
- To verify: fetch the object via `object_uri` (authenticated with SA headers)

> **XFuel usage:** `ThetaVideoHandler` uses polling (`_pollVideo`) rather than webhooks. The TVA webhook system is available but not wired up — polling is simpler for the current on-demand VOD flow.

---

## Theta EdgeStore

**Docs:** https://docs.thetatoken.org/docs/theta-edgestore-gateway-alpha

```
Upload:    POST https://api.thetaedgestore.com/api/v2/data
Retrieve:  GET  https://data.thetaedgestore.com/api/v2/data/<key>
Pattern:   Upload is synchronous — returns content key (bytes32 hex) immediately
Webhook:   NONE
```

### Auth Token Format
```
${timestamp}.${walletAddress}.${eth_sign("Theta EdgeStore Call ${timestamp}")}
```
Token cached for 23h (refreshes 1h before 24h expiry). Signing key: `THETA_EDGESTORE_WALLET_KEY`.

### On-Chain Hook
```solidity
// DataHubs.sol
function attachEdgeStoreCid(
  bytes32 contributionId,
  bytes32 edgeStoreCid,
  string  calldata edgeStoreNodeId
) external onlyRole(RELAYER_ROLE);

event EdgeStoreSealed(
  bytes32 indexed contributionId,
  bytes32 edgeStoreCid,
  string  edgeStoreNodeId,
  address sealedBy
);
```

**Source:** `circuits/data-hubs/theta-edgestore-adapter.js` — `uploadAndSeal()`, `sealOnChain()`

---

## Theta P2P Video SDK

**Docs:** https://docs.thetatoken.org/docs/theta-p2p-javascript-sdk

```
Scripts (must load in order):
  1. https://vjs.zencdn.net/7.15.4/video.js               (video.js player)
  2. https://cdn.jsdelivr.net/npm/[email protected]  (hls.js — BEFORE theta scripts)
  3. https://d1ktbyo67sh8fw.cloudfront.net/js/theta.umd.min.js
  4. https://d1ktbyo67sh8fw.cloudfront.net/js/theta-hls-plugin.umd.min.js
  5. https://d1ktbyo67sh8fw.cloudfront.net/js/videojs-theta-plugin.min.js

Global:  window.videojs  (standard video.js API)
Tech:    techOrder: ["theta_hlsjs", "html5"]
```

### React Integration
```tsx
import ThetaP2PPlayer from '@/components/ThetaP2PPlayer';

// P2P playback only
<ThetaP2PPlayer
  src="https://media.thetavideoapi.com/.../master.m3u8"
  internalVideoId="xfuel-job-0xabc"
/>

// With NFT-DRM guard (Track 3.4) — requires both videoId + nftCollection
<ThetaP2PPlayer
  src="https://media.thetavideoapi.com/.../master.m3u8"
  videoId="video_m3jxh0abh8p6vwejd0av1p9yg2"
  nftCollection="0x..."
  networkId={365}
  onAccessDenied={(col) => window.open(`https://thetadrop.com/nft/${col}`)}
/>
```

Props:
- `src` — HLS master playlist URL (required)
- `videoId` — Theta Video API ID (required for DRM)
- `internalVideoId` — your app's peer-grouping key (optional; defaults to `videoId`)
- `nftCollection` — TNT-721 collection address (enables DRM when set with `videoId`)
- `networkId` — 361 mainnet / 365 testnet (default: 365)

The component lazy-loads all SDK scripts in order at runtime and falls back to native HLS `<source>` tag if CDN is unreachable.

**Displayed in:** `ThetaAI.tsx` — result panel for `VIDEO_PROCESSING` intents automatically shows the P2P player when `playback_uri`, `output_url`, or `hls_url` is present in the result JSON.

---

## NFT-Based DRM

**Docs:** https://docs.thetatoken.org/docs/theta-nft-based-drm

```
Script:  https://d1ktbyo67sh8fw.cloudfront.net/js/tva.umd.min.js  (CDN)
Global:  window.TVA
Pattern: new TVA.Video({ videoId, videoEl, onAccessOK, onAccessDenied, onError, networkId })
         tva.signin()  →  triggers MetaMask wallet connect + Theta DRM server NFT check
```

### Integration Points

| Layer | Implementation |
|-------|---------------|
| Backend | `theta-video-handler.js` passes `nft_collection` to `POST /video` |
| On-chain | `VideoProvenance` event records `contentHash` for DRM-gated content |
| Frontend | `ThetaP2PPlayer` accepts `videoId` + `nftCollection` props; loads TVA SDK |
| UI Preset | `NFT_DRM_GUARD` in `ThetaAI.tsx` Full Catalog |

**DRM flow:**
1. Caller submits `VIDEO_PROCESSING` intent with `nftCollection` address in input
2. Backend passes `nft_collection` to Theta Video API transcode request; response includes `video_id`
3. Frontend receives `video_id` + `nft_collection` in result JSON; renders `ThetaP2PPlayer`
4. `ThetaP2PPlayer` loads `tva.umd.min.js` and calls `new TVA.Video({ videoId, videoEl, ... })`
5. Viewer clicks "Connect MetaMask" → `tva.signin()` → Theta DRM server verifies NFT ownership
6. On success: `onAccessOK` fires, decryption key issued, video plays
7. On failure: `onAccessDenied` fires, XFuel UI shows "Get Access NFT →" with collection link

---

## Theta MCP Server

**Docs:** https://docs.thetatoken.org/docs/edgecloud-mcp (MCP protocol, Jan 2026)

```
Compatible: Claude Desktop, Cursor, Cline, Zed, Sourcegraph Cody
Models:     18+ via EdgeCloud on-demand
Protocol:   Model Context Protocol (MCP)
```

### Registered XFuel Tools

| Tool | Description |
|------|-------------|
| `xfuel_submit_intent` | Submit an AI inference intent; returns `intentId` |
| `xfuel_poll_status` | Poll intent status by `intentId` |
| `xfuel_router_status` | Get DePIN router status (active tiers, stats) |

**Registration:** `scripts/register-mcp-tool.cjs` — reads `scripts/theta-mcp-tool-descriptor.json`, rewrites endpoints from `XFUEL_AGENT_API`, handles 409 gracefully.

```bash
MCP_ENDPOINT=https://mcp.thetaedgecloud.com \
MCP_API_KEY=<key> \
XFUEL_AGENT_API=https://api.xfuel.app \
node scripts/register-mcp-tool.cjs
```

---

## XFuel Subchain

**Docs:** https://docs.thetatoken.org/docs/theta-metachain

```
Privatenet:  chain 360777 (localhost:18888 main / 19888 subchain)
Testnet:     chain 365001 (env: VITE_SUBCHAIN_TESTNET_RPC)
Mainnet:     chain 361001 (env: VITE_SUBCHAIN_MAINNET_RPC)
```

### Registration Costs
```
Subchain registration:  10,000 wTHETA
Per validator:          1,000 wTHETA + 20,000 TFUEL (× 3 validators)
Gov token stake:        100,000 XFGOV per validator
```

### Gov Token (XFGOV)
```
Contract:          contracts/governance/XFuelSubchainGovToken.sol
Supply:            1B hard cap, 500M initial
Reward rate:       2 XFGOV/block
Key functions:     mintStakerReward(address, uint256)
                   stakerRewardPerBlock() view
                   updateMinter(address) — call with VSM address after deploy
```

### Registration Script
```bash
node scripts/theta-subchain-init.cjs \
  --network privatenet \
  --step mintmock | register | collateral | stake
```

### Deployed Circuits on Subchain
- `ThetaInferenceCircuit` (8 services, 6 presets) — deployed `0x817d542d2eA7c2B03235D77edb854C72D24B7d24`
- `A2ACircuit`
- `ThetaGPUCircuit`
- `DataHubs`

---

## TDROP Integration

**What TDROP is:** TNT-20 governance and incentive token for the Theta ecosystem.
- Current utility: ThetaDrop NFT marketplace (VIP tiers: Bronze 100K / Silver 1M / Gold 10M TDROP), staking yield, on-chain governance voting on ThetaDrop proposals
- 4B TDROP staking rewards pool active through 2030 (redirected from NFT liquidity mining, Jan 2026)
- Governance is quarterly, fully on-chain — voting power proportional to staked share
- EdgeCloud compute payments + developer rebates = **H2 2026 roadmap** (not yet live)
- TDROP 2.0 positions the token as an AI-to-AI autonomous payment layer (forward-looking)

**Docs:** https://docs.thetatoken.org/docs/intro-to-tdrop

**Contract addresses:**
- Mainnet: `0x1336739B05C7Ab8a526D40DCC0d04a826b5f8B03` (chain 361)
- Testnet: `0xde41591ED1f8ED1484aC2CD8ca0876428de60EfF` (chain 365)

**XFuel's TDROP integration is a protocol-layer feature** — XFuel accepts TDROP as payment to `ThetaInferenceCircuit` and `A2ACircuit` ahead of EdgeCloud's own TDROP support. This positions XFuel as a TDROP demand driver now, with native EdgeCloud settlement available once Theta activates it.

### Payment Flow (ThetaInferenceCircuit)
```solidity
// Caller approves TDROP first, then:
submitIntentWithTDROP(bytes32 serviceId, bytes32 inputHash)
// → pulls TDROP via transferFrom
// → applies tdropDiscountBps (default 20%)
// → forwards TDROP fee to CoreRevenueSplitter.receiveERC20Fee()
// → emits TdropIntentSubmitted + InferenceIntentSubmitted

// Configure:
setTdropConfig(
  address token,    // TDROP contract
  uint256 discountBps,   // 2000 = 20%
  uint256 tdropPerTfuel  // 1e18 = 1:1 rate
)

// Quote:
quoteTdrop(bytes32 serviceId)
// → (tdropRequired, tdropFee, tdropPayment, discountBps)
```

### Dynamic Boost (CoreRevenueSplitter)
THETA_NATIVE executions earn up to 2.5× boost on the GET Machine & Agent Incentives sub-bucket:
```
0% THETA_NATIVE → 1.0× boost
100% THETA_NATIVE → 2.5× boost (linear interpolation)
```

Toggle: `setDynamicBoostEnabled(bool)` — DEFAULT_ADMIN_ROLE or GOVERNANCE_ROLE.

---

## On-Chain Event Reference

| Event | Contract | Track |
|-------|----------|-------|
| `InferenceIntentSubmitted(intentId, serviceId, inputHash, fee)` | ThetaInferenceCircuit | — |
| `TdropIntentSubmitted(intentId, tdropAmount, discountApplied)` | ThetaInferenceCircuit | 4.2 |
| `IntentSettled(intentId, outputHash, proofTxHash)` | ThetaInferenceCircuit | — |
| `IntentFailed(intentId, reason)` | ThetaInferenceCircuit | — |
| `EdgeCloudNodeAttested(intentId, nodeId, gpuFingerprint, petaflopsUsed, providerTag)` | ThetaInferenceCircuit | 2.1 |
| `VideoProvenance(intentId, videoId, contentHash, playbackUri)` | ThetaInferenceCircuit | 3.2 |
| `EdgeStoreSealed(contributionId, edgeStoreCid, edgeStoreNodeId, sealedBy)` | DataHubs | 3.1 |
| `FeeReceivedTagged(circuitId, amount, providerTag)` | CoreRevenueSplitter | 4.1 |
| `DynamicBoostApplied(period, effectiveBoost, thetaNativeRatioBps)` | CoreRevenueSplitter | 4.1 |
| `ERC20FeeReceived(circuitId, token, amount, providerTag)` | CoreRevenueSplitter | 4.2 |
| `ProofVerified(circuitId, proofId, publicInputsHash)` | ZKVerifierSP1 | — |
| `ProofFailed(circuitId, proofId, reason)` | ZKVerifierSP1 | — |
| `BidSubmitted / AgentSettled` | A2ACircuit | 4.3 |

### Event Subscription (core-layer/ai-listener.js)
```
Primary:  eth_subscribe("logs") via WebSocket (ethers.WebSocketProvider)
Fallback: eth_getLogs HTTP polling (every 10s, skipped when WS active)
WS endpoints:
  Mainnet: wss://eth-rpc-api.thetatoken.org/rpc
  Testnet: wss://eth-rpc-api-testnet.thetatoken.org/rpc
Reconnect: 15s backoff on close
```

---

## Outbound Webhook Schema

XFuel POSTs to the agent's `callbackUrl` after intent settlement. All requests include an HMAC-SHA256 signature.

```json
{
  "event":              "xfuel.intent.settled",
  "intentId":           "0x...",
  "status":             "settled | failed | processing",
  "serviceType":        "LLM_INFERENCE | VIDEO_PROCESSING | ...",
  "outputHash":         "0x...",
  "proofTxHash":        "0x...",
  "edgeCloudNodeId":    "0x...",
  "providerTag":        1,
  "providerTagLabel":   "THETA_NATIVE",
  "video_provenance_uri": "https://media.thetavideoapi.com/.../master.m3u8",
  "edge_store_cid":     "0x...",
  "timestamp":          1741550000,
  "signature":          "sha256=<HMAC-SHA256-hex>"
}
```

### Signature Verification
```js
const crypto = require('crypto');
const expected = crypto
  .createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');
const received = req.headers['x-xfuel-signature'].replace('sha256=', '');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
```

Key: `WEBHOOK_SECRET` (32-byte hex, set in `.env.local`). Delivery is non-fatal if secret not configured — payload arrives without signature header.

### Retry Policy
- 3 attempts, exponential backoff: 1s → 2s → 4s
- On permanent failure: intent is still settled on-chain; only webhook delivery fails

---

*This document is maintained alongside the XFuel Protocol codebase.*  
*Last updated: 2026-03-11*
