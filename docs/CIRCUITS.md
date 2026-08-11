# Circuits

Modular circuits plug into the Core Layer via events. Each circuit has its own state, pause control, and off-chain handler. Protocol fees settle in USDC on Base ([ADR 0001](adr/0001-usdc-revenue-and-router-verifier-positioning.md)).

Design overview: [WHITEPAPER.md](../WHITEPAPER.md).

## Catalog

| Circuit | Contract | Fee |
|---------|----------|-----|
| AI Marketplace | `TAOCircuit.sol` | 0.5% |
| Agent Comms | `A2ACircuit.sol` | 0.1% relay + 0.5% task |
| Edge Compute | `ThetaGPUCircuit.sol` | 0.5% |
| Inference (EdgeCloud adapter) | `ThetaInferenceCircuit.sol` | 0.5% |
| zkML | `ZKMLCircuit.sol` | 0.75% |
| DePIN Compute | `AkashCircuit.sol` | 0.5% |
| Bridge | `BridgeCircuit.sol` | 0.3% |
| Autonomous Vaults | `AutonomousVaults.sol` | 0.5% |
| Agent Robotics | `AgentRobotics.sol` | 1% cert + 0.5% task |
| Data Hubs | `DataHubs.sol` | 0.5% |
| Yield | `YieldCircuit.sol` | 0.5% + 1% harvest |
| NEAR Agents | `NearAgents.sol` | 0.5% |
| Solana AI Bridge | `SolanaAIBridge.sol` | 0.75% |
| Filecoin Storage | `FilecoinStorage.sol` | 0.5% |
| Energy / Mapping / Wireless / Uplink | see `contracts/circuits/` | 0.5% |

## Isolation

- Own state and roles per circuit
- Proofs verify through `ZKVerifierSP1` with circuit-specific nullifiers
- Independent pause
- Off-chain handler under `packages/circuit-runtime/`

## Register handlers

```
import { CoreListener } from './core-layer/ai-listener.js';
import { registerAllCircuits } from './packages/circuit-runtime/index.js';

const listener = new CoreListener({ /* chains */ });
registerAllCircuits(listener, { /* per-circuit config */ });
await listener.start();
```

## Custom circuit

```
registerCustomCircuit(listener, 'my-circuit', {
  async onIntent(intent, ctx) { /* ... */ },
  async onProofReady(proof, request) { /* ... */ },
}, ['base'], ['inference_request']);
```

## Layout

```
contracts/circuits/          Solidity (audit scope)
packages/circuit-runtime/    JS handlers + tests
```
