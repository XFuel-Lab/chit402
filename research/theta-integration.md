# Theta Network Integration Research — XFuel Protocol

**Date:** February 2026
**Purpose:** Document all Theta hooks, endpoints, SDKs, and APIs for the hybrid Theta-centric evolution.

---

## 1. Theta EdgeCloud — Hybrid Cloud-Edge Platform

**Dashboard:** https://www.thetaedgecloud.com/dashboard

### 1.1 On-Demand Model APIs (Serverless GPU Inference)

| Model | Category | Use Case | API Endpoint Pattern |
|-------|----------|----------|---------------------|
| Llama 3.x (8B/70B/405B) | Text/LLM | Chat, code gen, reasoning | `POST /v1/chat/completions` |
| FLUX.1 (schnell/dev/pro) | Image | Image generation from text | `POST /v1/images/generations` |
| Whisper (large-v3) | Audio | Speech-to-text transcription | `POST /v1/audio/transcriptions` |
| Stable Diffusion XL | Image | Image generation/editing | `POST /v1/images/generations` |
| Object Detection (YOLO) | Vision | Real-time object detection | `POST /v1/vision/detect` |
| Video Processing | Video | Transcoding, analysis | `POST /v1/video/process` |
| TTS / Voice Cloning | Audio | Text-to-speech, voice synthesis | `POST /v1/audio/speech` |

**Authentication:** API key via `x-api-key` header or `Authorization: Bearer <key>`.
**Billing:** Pay-per-inference in TFUEL; pricing set per model via EdgeCloud dashboard.

### 1.2 Dedicated Models / Deployments

- Deploy custom fine-tuned models on reserved GPU clusters
- Persistent endpoints with guaranteed availability
- GPU types: A100, H100, RTX 4090 (community nodes)
- Pricing: Hourly rental rates set via `SetPrice` RPC

### 1.3 Jupyter Notebook Prototyping

- Browser-based Jupyter on EdgeCloud GPU nodes
- Pre-installed: PyTorch, TensorFlow, Hugging Face Transformers
- Persistent storage for datasets/models

### 1.4 Training on GPU Nodes/Clusters

- Distributed training across edge nodes
- Support for multi-GPU and multi-node configurations
- Job scheduling via EdgeCloud API

### 1.5 Persistent Storage

- Decentralized storage for models, datasets, checkpoints
- Content-addressed (CID-based) for immutability
- Integrated with IPFS/Filecoin for redundancy

### 1.6 Agentic AI Services

| Service | Description | API Pattern |
|---------|-------------|-------------|
| AI Agents | Autonomous task execution agents | `POST /v1/agents/create` |
| Voice Cloning | Clone voices from audio samples | `POST /v1/audio/clone` |
| RAG Chatbot | Retrieval-Augmented Generation chatbot | `POST /v1/rag/query` |

### 1.7 NFT-Based DRM

- **Docs:** https://docs.thetatoken.org/docs/theta-nft-based-drm
- Content access gated by NFT ownership
- Theta Video API integration for DRM-protected streaming
- ERC-721/1155 compatible on Theta Metachain

### 1.8 Video API

- Transcoding: Multi-resolution adaptive bitrate
- P2P delivery via Theta edge nodes
- Live streaming with low-latency WebRTC
- Video analytics and viewership tracking

---

## 2. SDKs & APIs

### 2.1 Theta JS SDK (Blockchain)

- **Docs:** https://docs.thetatoken.org/docs/theta-js-sdk-overview
- **Package:** `@thetalabs/theta-js` (already in package.json as ^0.0.86)
- **Capabilities:**
  - Wallet creation and management
  - THETA/TFUEL token transfers
  - Smart contract deployment and interaction
  - Staking operations
  - Transaction signing and broadcasting

```javascript
import { thetajs } from '@thetalabs/theta-js';
const provider = new thetajs.providers.HttpProvider('https://eth-rpc-api.thetatoken.org/rpc');
const wallet = new thetajs.Wallet(privateKey, provider);
```

### 2.2 Theta P2P JS SDK (Video)

- **Docs:** https://docs.thetatoken.org/docs/theta-p2p-javascript-sdk
- **Purpose:** P2P video delivery via edge nodes
- **Integration:** Embed in frontend for decentralized video streaming

### 2.3 On-Demand API MCP Server

- **Package:** `@thetalabs/on-demand-api-mcp` (npm)
- **GitHub:** https://github.com/thetatoken/on-demand-api-mcp
- **Capabilities:**
  - 20+ AI model access via MCP protocol
  - Sync/async inference calls
  - No-code integration for AI tools
  - Structured tool definitions for LLM function calling
- **Integration pattern:**
  ```javascript
  // MCP Server connection
  const mcpClient = new MCPClient('https://mcp.thetaedgecloud.com');
  const result = await mcpClient.callTool('inference', {
    model: 'llama-3-70b',
    prompt: 'Analyze this DePIN metric...',
  });
  ```

### 2.4 RapidAPI Hosting

- **URL:** https://rapidapi.com/thetaedgecloudprovider-thetaedgecloudteam/api/theta-edge-cloud-ai-inference-api
- **Usage:** Subscribe → copy API snippet → instant access
- **Routing:** Requests route to enterprise/community GPU nodes
- **Auth:** `X-RapidAPI-Key` header + `X-RapidAPI-Host: theta-edge-cloud-ai-inference-api.p.rapidapi.com`
- **Endpoints:**
  ```
  POST /inference/chat      → LLM chat completions
  POST /inference/image     → Image generation
  POST /inference/audio     → Speech-to-text
  POST /inference/tts       → Text-to-speech
  POST /inference/vision    → Object detection
  POST /inference/video     → Video processing
  ```

---

## 3. Theta Blockchain Integration

### 3.1 Metachain Architecture

- **EVM-compatible** subchains with TFUEL as gas token
- **Chain IDs:** Mainnet 361, Testnet 365
- **RPC:** `https://eth-rpc-api.thetatoken.org/rpc` (mainnet), `https://eth-rpc-api-testnet.thetatoken.org/rpc` (testnet)
- **Finality:** 1-2 seconds per subchain
- **Validator requirements:** 1,000 wTHETA + 20,000 TFUEL per subchain validator

### 3.2 Integration Guide

- **Docs:** https://docs.thetatoken.org/docs/theta-mainnet-integration-guide
- Standard EVM deployment via Hardhat/Foundry
- Gas price: 4000 Gwei minimum on mainnet
- Contract verification via Theta Explorer API

### 3.3 Edge Node Setup

- **Docs:** https://docs.thetatoken.org/docs/setup-theta-edge-node
- Edge nodes contribute GPU/CPU compute to EdgeCloud
- Earn TFUEL rewards for compute contributions
- Caching and encoding for video delivery

### 3.4 EdgeCloud Client Guide

- **Docs:** https://docs.thetatoken.org/docs/theta-edgecloud-client-guide
- Client RPC APIs:
  - `GetStatus` — Node status, wallet, pricing, recent jobs
  - `SetPrice` — Set hourly GPU rental rates
  - `GetDeployments` — List active model deployments
  - `GetJobs` — List job history

---

## 4. 2026 Roadmap Alignment

### H1 2026 (Current)
- Inference Engine upgrades
- RapidAPI integration (expanded model access)
- Template library expansion (open-source AI models)
- MCP server for streamlined GPU access

### H2 2026 (Upcoming)
- Distributed inferencing (community nodes host LLMs)
- AI agents for fan engagement and event operations
- Telecom/enterprise collaborations
- TDROP 2.0 staking tokenomics

---

## 5. XFuel Protocol Integration Points

### 5.1 ThetaInferenceCircuit Hooks

| Hook | Theta API | Circuit Action |
|------|-----------|----------------|
| `submitIntent(LLM_INFERENCE)` | `/v1/chat/completions` | Submit LLM inference intent, ZK-verify output |
| `submitIntent(IMAGE_GENERATION)` | `/v1/images/generations` | Generate image via FLUX/SD, hash output for proof |
| `submitIntent(SPEECH_TO_TEXT)` | `/v1/audio/transcriptions` | Transcribe audio, attest result on-chain |
| `submitIntent(VOICE_CLONING)` | `/v1/audio/clone` | Clone voice, store model hash on-chain |
| `submitIntent(RAG_QUERY)` | `/v1/rag/query` | RAG chatbot query, ZK-verify retrieval |
| `submitIntent(VIDEO_PROCESSING)` | `/v1/video/process` | Transcode video, verify output integrity |
| `submitIntent(OBJECT_DETECTION)` | `/v1/vision/detect` | Detect objects, attest bounding boxes |

### 5.2 TAOCircuit Theta Routing

- When a TAO inference request is submitted, compare cost between Bittensor subnets and Theta EdgeCloud
- If Theta is cheaper or faster, route to ThetaGPUCircuit via internal call
- Use SP1ProofHooks for zkML proof of cost comparison
- Target: <50K gas overhead for routing decision

### 5.3 Revenue Flow

```
User submits intent (pays TFUEL/TAO)
  → Fee deducted (0.5% default, configurable 0.1-1%)
  → Fee sent to CoreRevenueSplitter.depositFee(CIRCUIT_ID)
  → 30% BBB / 30% LP / 25% Stakers / 15% Treasury
  → Net payment held in escrow until settlement
  → On proof verification: provider paid, job settled
```

### 5.4 Environment Variables Required

```env
# Theta EdgeCloud API
THETA_EDGECLOUD_API_KEY=          # EdgeCloud dashboard API key
THETA_RAPIDAPI_KEY=               # RapidAPI subscription key
THETA_MCP_ENDPOINT=               # MCP server URL

# Theta Blockchain
THETA_MAINNET_PRIVATE_KEY=        # Deployer private key (Theta 361)
THETA_TESTNET_PRIVATE_KEY=        # Testnet deployer key (Theta 365)

# Contract Addresses (from previous deployments)
THETA_REVENUE_SPLITTER=           # CoreRevenueSplitter on Theta
THETA_ZK_VERIFIER=                # ZKVerifierSP1 on Theta
THETA_GPU_CIRCUIT=                # Existing ThetaGPUCircuit address
```
