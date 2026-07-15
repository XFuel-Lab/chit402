/**
 * XFuel Protocol — Circuit Registry
 *
 * Central registration point for all circuit modules.
 * Import this file to auto-register all priority circuits with CoreListener.
 *
 * Usage:
 *   import { CoreListener } from '../../core-layer/ai-listener.js';
 *   import { registerAllCircuits } from './index.js';
 *
 *   const listener = new CoreListener(config);
 *   registerAllCircuits(listener, circuitConfig);
 *   await listener.start();
 */

import { TAOHandler } from './tao-evm/tao-handler.js';
import { A2AHandler } from './a2a/a2a-handler.js';
import { GPUHandler } from './theta-gpu/gpu-handler.js';
import { ZKMLHandler } from './zkml/zkml-handler.js';
import { AkashHandler } from './akash/akash-handler.js';
import { VaultsHandler } from './autonomous-vaults/vaults-handler.js';
import { RoboticsHandler } from './agent-robotics/robotics-handler.js';
import { DataHubsHandler } from './data-hubs/datahubs-handler.js';
import { YieldHandler } from './yield-optimization/yield-handler.js';
import { NearHandler } from './near-agents/near-handler.js';
import { SolanaHandler } from './solana-ai-bridge/solana-handler.js';
import { FilecoinHandler } from './filecoin-storage/filecoin-handler.js';
import { EnergyHandler } from './energy-grid/energy-handler.js';
import { MappingHandler } from './mapping-sensor/mapping-handler.js';
import { WirelessHandler } from './wireless-depin/wireless-handler.js';
import { UplinkHandler } from './uplink/uplink-handler.js';
import { AI_INTENT_TYPES } from '../../core-layer/ai-listener.js';

/**
 * Register all priority circuits with a CoreListener instance.
 *
 * @param {CoreListener} listener - The core listener to register circuits with.
 * @param {Object} config - Per-circuit configuration.
 * @param {Object} [config.tao] - TAO EVM circuit config.
 * @param {Object} [config.a2a] - A2A circuit config.
 * @param {Object} [config.gpu] - Theta GPU circuit config.
 * @param {Object} [config.zkml] - zkML Inference circuit config.
 * @param {Object} [config.akash] - Akash DePIN circuit config.
 * @param {Object} [config.vaults] - Autonomous Vaults circuit config.
 * @param {Object} [config.robotics] - Agent Robotics circuit config.
 * @param {Object} [config.dataHubs] - Data Ownership Hubs circuit config.
 * @param {Object} [config.yield] - Yield Optimization circuit config.
 * @param {Object} [config.near] - NEAR Agents circuit config.
 * @param {Object} [config.solana] - Solana AI Bridge circuit config.
 * @param {Object} [config.filecoin] - Filecoin Storage circuit config.
 * @param {Object} [config.energy] - Energy Grid circuit config.
 * @param {Object} [config.mapping] - Mapping Sensor circuit config.
 * @param {Object} [config.wireless] - Wireless DePIN circuit config.
 */
function registerAllCircuits(listener, config = {}) {
  // ─── TAO EVM Circuit ────────────────────────────────────────────────────
  // AI Marketplace Circuit: cross-chain task routing, AMM fees, oracle pricing.
  // Listens on Bittensor EVM and Theta for marketplace task events.
  const taoHandler = new TAOHandler(config.tao || {});
  listener.registerCircuit(
    'tao-evm',
    taoHandler,
    ['bittensor', 'theta_mainnet', 'theta_testnet'],
    [AI_INTENT_TYPES.INFERENCE_REQUEST, AI_INTENT_TYPES.COMPUTE_BID, AI_INTENT_TYPES.DATA_ATTESTATION]
  );

  // ─── A2A Circuit ────────────────────────────────────────────────────────
  // ZK-Secured Agent Communications: bidding, discovery, x402 micropayments.
  // Listens on ALL chains for agent-to-agent events.
  const a2aHandler = new A2AHandler(config.a2a || {});
  listener.registerCircuit(
    'a2a',
    a2aHandler,
    null, // All chains
    [AI_INTENT_TYPES.COMPUTE_BID, AI_INTENT_TYPES.CAPABILITY_QUERY, AI_INTENT_TYPES.INFERENCE_REQUEST]
  );

  // ─── Theta GPU Circuit ──────────────────────────────────────────────────
  // Edge Compute Routing: GPU inference via Theta EdgeCloud, TFUEL fees.
  // Listens on Theta chains for GPU job routing events.
  const gpuHandler = new GPUHandler(config.gpu || {});
  listener.registerCircuit(
    'theta-gpu',
    gpuHandler,
    ['theta_mainnet', 'theta_testnet'],
    [AI_INTENT_TYPES.INFERENCE_REQUEST, AI_INTENT_TYPES.COMPUTE_BID]
  );

  // ─── zkML Inference Circuit ────────────────────────────────────────────
  // Private ML Inference: ZK-verified model inference where model weights
  // remain private and only correctness is proven on-chain via SP1.
  const zkmlHandler = new ZKMLHandler(config.zkml || {});
  listener.registerCircuit(
    'zkml',
    zkmlHandler,
    null, // All chains — model owners can be on any EVM chain
    [AI_INTENT_TYPES.INFERENCE_REQUEST, AI_INTENT_TYPES.DATA_ATTESTATION]
  );

  // ─── Akash/DePIN Compute Circuit ─────────────────────────────────────
  // Decentralized GPU Leasing: Reverse-auction deployments, per-block
  // lease payments, and SP1 compute delivery attestation.
  const akashHandler = new AkashHandler(config.akash || {});
  listener.registerCircuit(
    'akash-depin',
    akashHandler,
    null, // All chains — tenants can request from any EVM chain
    [AI_INTENT_TYPES.COMPUTE_BID, AI_INTENT_TYPES.INFERENCE_REQUEST]
  );

  // ─── Autonomous AI Vaults Circuit ──────────────────────────────────
  // AI-driven tokenized vault strategies with ZK-verified rebalancing.
  // Per Almanak: agent swarms for strategy lifecycle; ERC-7540 composability.
  const vaultsHandler = new VaultsHandler(config.vaults || {});
  listener.registerCircuit(
    'autonomous-vaults',
    vaultsHandler,
    null, // All chains — vaults can be on any EVM chain
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.INFERENCE_REQUEST]
  );

  // ─── Agent Robotics Circuit ──────────────────────────────────────────
  // ZK-proven sim-to-real trajectory verification with safety certs.
  // Per NRN Agents: digital twins at 60Hz, verifiable compositional frameworks.
  const roboticsHandler = new RoboticsHandler(config.robotics || {});
  listener.registerCircuit(
    'agent-robotics',
    roboticsHandler,
    null, // All chains — sim environments can target any chain
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.COMPUTE_BID]
  );

  // ─── Data Ownership Hubs Circuit ───────────────────────────────────
  // Decentralized data contribution, ZK-verified provenance, tokenized access.
  // Per Vana: DataDAOs with VRC-20 tokens; Per Grass: ZK provenance rollups.
  const dataHubsHandler = new DataHubsHandler(config.dataHubs || {});
  listener.registerCircuit(
    'data-hubs',
    dataHubsHandler,
    null, // All chains
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.CAPABILITY_QUERY]
  );

  // ─── Yield Optimization Circuit ──────────────────────────────────────
  // Multi-pool ZK-verified yield rebalancing with concentrated-liquidity awareness.
  // Per Osmosis: 200-300x CL efficiency; geometric tick spacing; IBC routing.
  const yieldHandler = new YieldHandler(config.yield || {});
  listener.registerCircuit(
    'yield-optimization',
    yieldHandler,
    null, // All chains — yield pools span multiple networks
    [AI_INTENT_TYPES.INFERENCE_REQUEST, AI_INTENT_TYPES.DATA_ATTESTATION]
  );

  // ─── NEAR Agents Circuit ────────────────────────────────────────────
  // Usability-focused autonomous AI agents with chain-abstraction awareness.
  // Per NEAR: Shade Agents + AI Agent Market + Chain Signatures (MPC).
  const nearHandler = new NearHandler(config.near || {});
  listener.registerCircuit(
    'near-agents',
    nearHandler,
    null, // All chains — agents execute cross-chain via chain signatures
    [AI_INTENT_TYPES.INFERENCE_REQUEST, AI_INTENT_TYPES.COMPUTE_BID, AI_INTENT_TYPES.CAPABILITY_QUERY]
  );

  // ─── Solana AI Bridge Circuit ──────────────────────────────────────
  // EVM↔Solana bridge for Render/io.net/Grass/SendAI AI tasks.
  // Wormhole/CCIP cross-chain messaging with ZK-verified settlement.
  const solanaHandler = new SolanaHandler(config.solana || {});
  listener.registerCircuit(
    'solana-ai-bridge',
    solanaHandler,
    null, // All chains — bridge tasks can originate from any EVM chain
    [AI_INTENT_TYPES.INFERENCE_REQUEST, AI_INTENT_TYPES.COMPUTE_BID, AI_INTENT_TYPES.DATA_ATTESTATION]
  );

  // ─── Filecoin Storage Circuit ─────────────────────────────────────
  // Decentralized storage deals with ZK-verified WindowPoSt/SnapDeal proofs.
  // Per Filecoin: 3,800+ SPs, 20 EiB capacity; Per Lighthouse: perpetual storage.
  const filecoinHandler = new FilecoinHandler(config.filecoin || {});
  listener.registerCircuit(
    'filecoin-storage',
    filecoinHandler,
    null, // All chains — storage deals can originate from any EVM chain
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.COMPUTE_BID]
  );

  // ─── Energy Grid Circuit ─────────────────────────────────────────
  // DePIN energy: ZK-verified production attestation, P2P trading, carbon credits.
  // Per Daylight: $75M raised, GRID token, 45% cheaper electricity, zero-upfront.
  const energyHandler = new EnergyHandler(config.energy || {});
  listener.registerCircuit(
    'energy-grid',
    energyHandler,
    null, // All chains — energy nodes can register from any EVM chain
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.COMPUTE_BID]
  );

  // ─── Mapping Sensor Circuit ──────────────────────────────────────
  // DePIN mapping: ZK-verified geospatial attestation, data marketplace, coverage.
  // Per Hivemapper: HONEY burn-and-mint; $200-300B mapping industry.
  const mappingHandler = new MappingHandler(config.mapping || {});
  listener.registerCircuit(
    'mapping-sensor',
    mappingHandler,
    null, // All chains — mapping devices can register from any EVM chain
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.COMPUTE_BID]
  );

  // --- Wireless DePIN Circuit ---
  // Decentralized wireless: ZK-verified coverage proofs, data credit settlement.
  // Per Helium: 900K+ hotspots, HNT burn-and-mint, Proof-of-Coverage.
  const wirelessHandler = new WirelessHandler(config.wireless || {});
  listener.registerCircuit(
    'wireless-depin',
    wirelessHandler,
    null,
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.COMPUTE_BID]
  );

  // --- Uplink Circuit ---
  // WiFi bandwidth sharing: ZK-verified session proofs, data credit settlement.
  // Per Uplink: 5M+ routers, ULX token, Avalanche L1.
  // Synergy: WirelessDePIN (LoRaWAN/5G) + Uplink (WiFi) = full connectivity DePIN.
  const uplinkHandler = new UplinkHandler(config.uplink || {});
  listener.registerCircuit(
    'uplink',
    uplinkHandler,
    null,
    [AI_INTENT_TYPES.DATA_ATTESTATION, AI_INTENT_TYPES.COMPUTE_BID]
  );

  return {
    taoHandler, a2aHandler, gpuHandler, zkmlHandler, akashHandler,
    vaultsHandler, roboticsHandler, dataHubsHandler, yieldHandler, nearHandler, solanaHandler,
    filecoinHandler, energyHandler, mappingHandler, wirelessHandler, uplinkHandler,
  };
}

/**
 * Register a single custom circuit with a CoreListener instance.
 * This is the recommended way to add new circuits to the system.
 *
 * @param {CoreListener} listener - The core listener.
 * @param {string} circuitId - Unique identifier for the circuit.
 * @param {Object} handler - Circuit handler with onIntent and optionally onProofReady.
 * @param {string[]} [chains] - Chains to listen on (null = all).
 * @param {string[]} [intentTypes] - Intent types to receive (null = all).
 */
function registerCustomCircuit(listener, circuitId, handler, chains = null, intentTypes = null) {
  listener.registerCircuit(circuitId, handler, chains, intentTypes);
}

export {
  registerAllCircuits,
  registerCustomCircuit,
  TAOHandler,
  A2AHandler,
  GPUHandler,
  ZKMLHandler,
  AkashHandler,
  VaultsHandler,
  RoboticsHandler,
  DataHubsHandler,
  YieldHandler,
  NearHandler,
  SolanaHandler,
  FilecoinHandler,
  EnergyHandler,
  MappingHandler,
  WirelessHandler,
  UplinkHandler,
};
