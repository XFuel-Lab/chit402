# XFuel Protocol — Circuit Specifications

> Deep-dive reference for all 16 modular circuits. Each circuit is fully isolated with its own state, events, pause mechanism, and off-chain handler. All fees route through `CoreRevenueSplitter` (30/30/25/15 split). See [`Growth-Expansion-Treasury.md`](Growth-Expansion-Treasury.md) for GET breakdown.

**Back to:** [README.md](../README.md) | **Whitepaper:** [WHITEPAPER.md](../WHITEPAPER.md)

---

## Circuit Overview

| # | Circuit | Contract | Default Chains | Fee |
|---|---------|----------|---------------|-----|
| 1 | AI Marketplace | `circuits/tao-evm/TAOCircuit.sol` | Bittensor, Theta | 0.5% |
| 2 | Agent Comms | `circuits/a2a/A2ACircuit.sol` | All chains | 0.1% relay + 0.5% task |
| 3 | Edge Compute | `circuits/theta-gpu/ThetaGPUCircuit.sol` | Theta | 0.5% |
| 4 | zkML Inference | `circuits/zkml/ZKMLCircuit.sol` | All chains | 0.75% |
| 5 | DePIN Compute | `circuits/akash/AkashCircuit.sol` | All chains | 0.5% |
| 6 | Autonomous Vaults | `circuits/autonomous-vaults/AutonomousVaults.sol` | All chains | 0.5% |
| 7 | Agent Robotics | `circuits/agent-robotics/AgentRobotics.sol` | All chains | 1% cert + 0.5% task |
| 8 | Data Hubs | `circuits/data-hubs/DataHubs.sol` | All chains | 0.5% |
| 9 | Yield Optimization | `circuits/yield-optimization/YieldCircuit.sol` | All chains | 0.5% + 1% harvest |
| 10 | NEAR Agents | `circuits/near-agents/NearAgents.sol` | All chains | 0.5% |
| 11 | Solana AI Bridge | `circuits/solana-ai-bridge/SolanaAIBridge.sol` | All chains | 0.75% |
| 12 | Filecoin Storage | `circuits/filecoin-storage/FilecoinStorage.sol` | All chains | 0.5% |
| 13 | Energy Grid | `circuits/energy-grid/EnergyGrid.sol` | All chains | 0.5% |
| 14 | Mapping Sensor | `circuits/mapping-sensor/MappingSensor.sol` | All chains | 0.5% |
| 15 | Wireless DePIN | `circuits/wireless-depin/WirelessDePIN.sol` | All chains | 0.5% |
| 16 | Uplink | `circuits/uplink/UplinkCircuit.sol` | All chains | 0.5% |

---

## Priority Circuits (v1.6.1)

### 1. AI Marketplace (TAOCircuit)

Cross-chain task routing for AI marketplaces with AMM fee capture and oracle-backed pricing.

| Feature | Implementation |
|---------|---------------|
| Cross-chain bridging | Hyperlane `IMailbox.dispatch()` for cross-chain task routing |
| AMM fee capture | `captureSwapFee()` hook for Uniswap V3-style pool integrations |
| Oracle pricing | Chainlink AggregatorV3 with admin price fallback |
| Task lifecycle | Submit → Bridge → Settle with SP1 proof |
| Fee model | 0.5% (configurable 0.1–1%) → CoreRevenueSplitter |

```
User → TAOCircuit.submitTask()
         ├── Fee → CoreRevenueSplitter.depositFee(CIRCUIT_ID)
         ├── Event → TaskRouted (ai-listener detects)
         └── Bridge → Hyperlane.dispatch() (if cross-chain)
```

### 2. Agent Communication (A2ACircuit)

ZK-secured agent-to-agent communication with service discovery, bidding, and x402-inspired micropayment channels.

| Feature | Implementation |
|---------|---------------|
| Service discovery | On-chain agent registry with capability indexing |
| Bidding/auction | Escrow-based bids with deadline TTL; provider acceptance |
| x402 micropayments | Payment channels: deposit → claim with ZK proof → close |
| SP1 privacy | Proof-gated messaging with nullifier replay protection |
| Fee model | 0.1% relay fee on escrow + 0.5% task fee on settlement |

### 3. Edge Compute (ThetaGPUCircuit)

GPU inference routing via Theta EdgeCloud with provider staking, model registry, and subchain-ready architecture.

| Feature | Implementation |
|---------|---------------|
| Model registry | On-chain catalog: name, category, price, min collateral |
| Provider staking | Collateral-backed providers with reputation scoring |
| Job lifecycle | Submit → Assign → Execute → Complete → Settle |
| Subchain-ready | Configurable subchainId + mainChainBridge for isolation |

---

## Expansion Circuits (v1.62–v1.66)

### 4. zkML Private Inference (ZKMLCircuit)

Private ML model inference where weights remain confidential while proving correctness on-chain via SP1 proofs. Model owners monetize inference without revealing proprietary weights.

### 5. DePIN Compute (AkashCircuit)

Decentralized GPU leasing via reverse-auction deployment management. Tenants specify GPU requirements, providers bid, and leases are managed with per-block payments and ZK delivery attestation.

### 6. Autonomous Vaults (AutonomousVaults)

AI-driven, tokenized yield strategies where agent swarms manage vaults with ZK-verified rebalancing. Strategy logic remains private; only optimization proofs are verified on-chain.

### 7. Agent Robotics (AgentRobotics)

ZK-proven sim-to-real trajectory verification for robotic agents, with on-chain safety certification and a task marketplace for certified agents.

### 8. Data Hubs (DataHubs)

Decentralized data contribution with ZK-verified provenance attestation, tokenized dataset access, and DAO-governed data hubs. Inspired by Vana and Grass protocols.

### 9. Yield Optimization (YieldCircuit)

Generalized multi-pool yield optimization with ZK-verified rebalancing, concentrated-liquidity awareness (Osmosis supercharged pools), and cross-chain routing.

### 10. NEAR Agents (NearAgents)

Autonomous AI agent marketplace with intent bidding and ZK settlement, bridging NEAR's agent ecosystem to XFuel's Core Layer.

### 11. Solana AI Bridge (SolanaAIBridge)

EVM↔Solana bridge for Render, io.net, Grass, and SendAI compute via Wormhole messaging, with provider registry and ZK settlement.

### 12. Filecoin Storage (FilecoinStorage)

ZK-verified decentralized storage deals with WindowPoSt proof verification, provider registry, and storage deal lifecycle management.

### 13. Energy Grid (EnergyGrid)

DePIN energy attestation, P2P trading, and carbon credit management. Integrates Daylight and Glow DePIN energy networks.

### 14. Mapping Sensor (MappingSensor)

DePIN geospatial mapping, sensor data marketplace, and coverage tracking. Integrates Hivemapper and DIMO sensor networks.

### 15. Wireless DePIN (WirelessDePIN)

DePIN wireless coverage (LoRaWAN/5G/WiFi), ZK coverage proofs, and data credit settlement. Integrates Helium and XNET networks.

### 16. Uplink (UplinkCircuit)

WiFi bandwidth sharing, ZK session proofs, router quality EMA, and connectivity mapping. Integrates Uplink and Althea networks.

---

## Circuit Isolation Matrix

| Property | All Circuits |
|----------|-------------|
| State | Each circuit has its own isolated state (mappings, counters) |
| Fee routing | All fees → CoreRevenueSplitter via `depositFee(CIRCUIT_ID)` |
| ZK verification | All proofs → ZKVerifierSP1 with circuit-specific nullifiers |
| Pausable | Independent pause per circuit — pausing one does not affect others |
| Off-chain handler | Each circuit has a dedicated `*-handler.js` for ai-listener |
| Access control | Roles on one circuit do not grant access to others |

---

## Registering All Circuits

```javascript
import { CoreListener } from './core-layer/ai-listener.js';
import { registerAllCircuits } from './circuits/index.js';

const listener = new CoreListener({
  chains: {
    theta_mainnet: { type: 'evm', chainId: 361, rpc: '...' },
    bittensor:     { type: 'evm', chainId: 964, rpc: '...' },
  },
});

const handlers = registerAllCircuits(listener, {
  tao: { contractAddress: '0x...' },
  a2a: { contractAddress: '0x...' },
  gpu: { contractAddress: '0x...', edgeCloudEndpoint: 'http://localhost:8090' },
  // ... additional circuit configs
});

await listener.start();
```

---

## Building a Custom Circuit

Any project can build a circuit that plugs into XFuel's Core Layer:

```javascript
import { registerCustomCircuit } from './circuits/index.js';

const myHandler = {
  async onIntent(intent, ctx) {
    // Your domain-specific logic
    // Call ctx.generateProof() when ready to settle
  },
  async onProofReady(proof, request) {
    // Settlement confirmed
  },
};

registerCustomCircuit(listener, 'my-custom-circuit', myHandler,
  ['theta_mainnet'],         // chains to listen on
  ['inference_request']      // intent types to receive
);
```

---

## File Structure

```
circuits/
├── index.js                  # Central registry — registerAllCircuits()
├── tao-evm/
│   ├── TAOCircuit.sol        # Solidity contract
│   ├── tao-handler.js        # Off-chain handler for ai-listener
│   ├── interfaces/           # Hyperlane, Chainlink interfaces
│   └── test/                 # 15 Hardhat tests
├── a2a/
│   ├── A2ACircuit.sol
│   ├── a2a-handler.js
│   └── test/                 # 15 Hardhat tests
├── theta-gpu/
│   ├── ThetaGPUCircuit.sol
│   ├── gpu-handler.js
│   └── test/                 # 15 Hardhat tests
├── [zkml, akash, autonomous-vaults, agent-robotics, data-hubs,
│    yield-optimization, near-agents, solana-ai-bridge,
│    filecoin-storage, energy-grid, mapping-sensor,
│    wireless-depin, uplink]/
│   ├── *.sol                 # Solidity contract
│   ├── *-handler.js          # Off-chain handler
│   └── test/                 # 14–15 Hardhat tests each
```

Full circuit architecture and design rationale: **[WHITEPAPER.md — Sections 14-20](../WHITEPAPER.md#14-priority-circuits-step-2--v161)**
