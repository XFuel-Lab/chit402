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

## Submission Checklist

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

## Attachments

- WHITEPAPER.md (v2.4 — Hybrid Theta-Centric Architecture)
- docs/THETA_INTEGRATIONS.md
- docs/AUDIT_GRANT_READINESS.md
- grant-templates/theta-ecosystem.md
- believer-guide.md

---

*Updated: 2026-03-11*
