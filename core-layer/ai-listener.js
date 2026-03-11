/**
 * XFuel Core Layer — Multi-Prover AI Event Listener & Intent Solver
 *
 * Ecosystem-agnostic event polling for EVM, Cosmos, and Solana SVM chains
 * with pluggable circuit architecture and multi-prover proof normalization.
 *
 * Phase 3 extensions (Feb 2026):
 *   - Solana SVM chain polling via JSON-RPC (getSignaturesForAddress, getTransaction)
 *   - Multi-prover normalization: EVM (Groth16 ~270K gas), CosmWasm (ark-bn254),
 *     Solana (alt_bn128 ~200K CU) — unified proof result format
 *   - Gas-equivalent tracking: all provers benchmarked to <270K gas equivalents
 *   - Chain-specific event normalization: sol_log_data, EVM logs, Cosmos wasm events
 *   - Cross-chain proof routing: Wormhole (Solana↔EVM), Hyperlane (EVM↔Cosmos), IBC
 *   - DePIN TPS metrics per chain
 *
 * Research ties:
 *   Per SP1 docs v5.x (2026): ~9s proving time, batch 11.6x speedup.
 *   Per Solana docs: sBPF programs, alt_bn128 precompile, ~200K CU per Groth16.
 *   Per Helius/Light Protocol: ZK Compression Groth16 on BN254, 128-byte proofs.
 *   Per Theta Metachain docs: 1-2s finality, TFUEL gas on all subchains.
 *   Per Bittensor EVM docs: Chain ID 964, dTAO precompile at 0x805.
 *   Per CosmWasm docs: IBC-native cross-chain messaging, CW20-ICS20 transfers.
 *
 * Usage:
 *   import { CoreListener } from './ai-listener.js';
 *   const listener = new CoreListener(config);
 *   listener.registerCircuit('my-circuit', myHandler);
 *   await listener.start();
 */

import { ethers } from 'ethers';
import PQueue from 'p-queue';

// ─── Chain Type Enum ──────────────────────────────────────────────────────────

const ChainType = Object.freeze({
  EVM: 'evm',
  COSMOS: 'cosmos',
  SVM: 'svm',
  DEPIN: 'depin',
  MOVE_APTOS: 'move_aptos',
  MOVE_SUI: 'move_sui',
});

// ─── Prover Type Enum ─────────────────────────────────────────────────────────

const ProverType = Object.freeze({
  EVM_GROTH16: 'evm_groth16',
  COSMWASM_ARK_BN254: 'cosmwasm_ark_bn254',
  SOLANA_ALT_BN128: 'solana_alt_bn128',
});

// ─── Default Chain Registry ───────────────────────────────────────────────────

const DEFAULT_CHAINS = {
  theta_mainnet: {
    type: ChainType.EVM,
    prover: ProverType.EVM_GROTH16,
    name: 'Theta Mainnet',
    chainId: 361,
    rpc: 'https://eth-rpc-api.thetatoken.org/rpc',
    blockTime: 6000,
    pollInterval: 2000,
    gasTarget: 270000,
  },
  theta_testnet: {
    type: ChainType.EVM,
    prover: ProverType.EVM_GROTH16,
    name: 'Theta Testnet',
    chainId: 365,
    rpc: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    blockTime: 6000,
    pollInterval: 2000,
    gasTarget: 270000,
  },
  bittensor: {
    type: ChainType.EVM,
    prover: ProverType.EVM_GROTH16,
    name: 'Bittensor EVM',
    chainId: 964,
    rpc: 'https://lite.chain.opentensor.ai',
    blockTime: 12000,
    pollInterval: 5000,
    gasTarget: 270000,
    stakingPrecompile: '0x0000000000000000000000000000000000000805',
    minStake: '1000000000000000000', // 1 TAO
  },
  bittensor_testnet: {
    type: ChainType.EVM,
    prover: ProverType.EVM_GROTH16,
    name: 'Bittensor EVM Testnet',
    chainId: 945,
    rpc: 'https://test.chain.opentensor.ai',
    blockTime: 12000,
    pollInterval: 5000,
    gasTarget: 270000,
    precompile: '0x0000000000000000000000000000000000000805',
    stakingPrecompile: '0x0000000000000000000000000000000000000805',
    minStake: '1000000000000000000', // 1 TAO (testnet)
  },
  osmosis: {
    type: ChainType.COSMOS,
    prover: ProverType.COSMWASM_ARK_BN254,
    name: 'Osmosis',
    rpc: 'https://rpc.osmosis.zone',
    ws: 'wss://rpc.osmosis.zone/websocket',
    pollInterval: 6000,
    gasTarget: 270000,
  },
  akash: {
    type: ChainType.COSMOS,
    prover: ProverType.COSMWASM_ARK_BN254,
    name: 'Akash Network',
    rpc: 'https://rpc.akash.forbole.com',
    ws: 'wss://rpc.akash.forbole.com/websocket',
    pollInterval: 6000,
    gasTarget: 270000,
  },
  solana_devnet: {
    type: ChainType.SVM,
    prover: ProverType.SOLANA_ALT_BN128,
    name: 'Solana Devnet',
    rpc: 'https://api.devnet.solana.com',
    pollInterval: 3000,
    gasTarget: 220000, // ~220K CU ≈ 220K gas equivalent
    programId: null,   // Set to deployed xfuel-solana-prover program ID
  },
  solana_mainnet: {
    type: ChainType.SVM,
    prover: ProverType.SOLANA_ALT_BN128,
    name: 'Solana Mainnet',
    rpc: 'https://api.mainnet-beta.solana.com',
    pollInterval: 3000,
    gasTarget: 220000,
    programId: null,
  },
  render_network: {
    type: ChainType.DEPIN,
    prover: ProverType.EVM_GROTH16,
    name: 'Render Network',
    rpc: 'https://mainnet.render.network/rpc',
    pollInterval: 5000,
    gasTarget: 270000,
    depinProvider: 'render',
    gpuCapabilities: ['A100', 'H100', 'RTX4090'],
    pricingModel: 'per-frame',
  },
  akash_gpu: {
    type: ChainType.DEPIN,
    prover: ProverType.COSMWASM_ARK_BN254,
    name: 'Akash GPU Marketplace',
    rpc: 'https://rpc.akash.forbole.com',
    pollInterval: 6000,
    gasTarget: 270000,
    depinProvider: 'akash',
    gpuCapabilities: ['A100', 'H100', 'RTX3090', 'RTX4090'],
    pricingModel: 'reverse-auction',
    sdlVersion: 'v2.0',
  },
  aptos_mainnet: {
    type: ChainType.MOVE_APTOS,
    prover: ProverType.EVM_GROTH16,
    name: 'Aptos Mainnet',
    chainId: 1,
    rpc: 'https://fullnode.mainnet.aptoslabs.com/v1',
    pollInterval: 4000,
    gasTarget: 50000,
    vmType: 'move',
    zkAdapter: 'aptos_groth16_native',
  },
  sui_mainnet: {
    type: ChainType.MOVE_SUI,
    prover: ProverType.EVM_GROTH16,
    name: 'Sui Mainnet',
    chainId: 101,
    rpc: 'https://fullnode.mainnet.sui.io:443',
    pollInterval: 3000,
    gasTarget: 50000,
    vmType: 'move',
    zkAdapter: 'sui_groth16_native',
  },
};

// ─── Gas Equivalent Benchmarks ────────────────────────────────────────────────

const GAS_BENCHMARKS = Object.freeze({
  [ProverType.EVM_GROTH16]: {
    verifyProof: 270000,
    verifyBatch3: 830000,
    composedCall: 500000,
    crossChainRelay: 403000,
    stakeCheck: 143000,
    unit: 'gas',
  },
  [ProverType.COSMWASM_ARK_BN254]: {
    verifyProof: 250000,
    verifyBatch3: 720000,
    unit: 'gas_equivalent',
  },
  [ProverType.SOLANA_ALT_BN128]: {
    verifyProof: 220000,
    verifyBatch3: 640000,
    bridgeEvent: 10000,
    unit: 'compute_units',
  },
});

// ─── AI Intent Types ──────────────────────────────────────────────────────────

const AI_INTENT_TYPES = Object.freeze({
  COMPUTE_BID: 'compute_bid',
  COMPUTE_RESULT: 'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY: 'capability_query',
  DATA_ATTESTATION: 'data_attestation',
  CIRCUIT_REGISTER: 'circuit_register',
  BRIDGE_REQUEST: 'bridge_request',
  BRIDGE_COMPLETION: 'bridge_completion',
  SETTLEMENT_REQUEST: 'settlement_request',
  SWARM_FORMED: 'swarm_formed',
  SWARM_SETTLED: 'swarm_settled',
  AGENT_SETTLED: 'agent_settled',
  DATA_PROVENANCED: 'data_provenanced',
  SELECTIVE_DISCLOSURE: 'selective_disclosure',
});

// ─── Intent Outcome Types (Phase 4) ──────────────────────────────────────────

const IntentOutcomeType = Object.freeze({
  FULFILLED: 'fulfilled',
  PARTIAL: 'partial',
  FAILED: 'failed',
  NO_PATH: 'no_path',
  TIMEOUT: 'timeout',
  DEFERRED: 'deferred',
});

// ─── DePIN Provider Status ───────────────────────────────────────────────────

const DePINProviderStatus = Object.freeze({
  AVAILABLE: 'available',
  BUSY: 'busy',
  OFFLINE: 'offline',
  BIDDING: 'bidding',
});

// ─── Solana Event Types ───────────────────────────────────────────────────────

const SOLANA_EVENT_TYPE = Object.freeze({
  PROOF_VERIFIED: 0x01,
  BRIDGE_EVENT: 0x02,
});

// ─── Multi-Prover Normalizer ──────────────────────────────────────────────────

/**
 * Normalizes proof results from different prover backends into a
 * unified format for cross-chain routing and circuit consumption.
 */
class ProverNormalizer {
  /**
   * Normalize an EVM proof result (from ZKVerifierSP1.sol events).
   */
  static normalizeEVM(log, iface) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) return null;
      if (parsed.name !== 'ProofVerified' && parsed.name !== 'ProofFailed') return null;

      return {
        prover: ProverType.EVM_GROTH16,
        status: parsed.name === 'ProofVerified' ? 'verified' : 'failed',
        circuitId: parsed.args.circuitId || parsed.args[0],
        nullifier: parsed.args.nullifier || parsed.args[1],
        publicValuesHash: parsed.args.publicValuesHash || parsed.args[2],
        verifier: parsed.args.verifier || parsed.args[3],
        timestamp: Number(parsed.args.timestamp || parsed.args[4] || 0),
        gasUsed: null,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        chain: null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Normalize a CosmWasm proof result (from wasm contract events).
   */
  static normalizeCosmos(events, chain) {
    for (const event of events) {
      if (event.type !== 'wasm') continue;

      const attrs = {};
      for (const attr of event.attributes || []) {
        const key = typeof attr.key === 'string' && attr.key.includes('=')
          ? Buffer.from(attr.key, 'base64').toString()
          : attr.key;
        const value = attr.value
          ? (typeof attr.value === 'string' && attr.value.includes('=')
              ? Buffer.from(attr.value, 'base64').toString()
              : attr.value)
          : '';
        attrs[key] = value;
      }

      if (attrs.action !== 'verify_proof' && attrs.action !== 'proof_verified') continue;

      return {
        prover: ProverType.COSMWASM_ARK_BN254,
        status: attrs.result === 'failed' ? 'failed' : 'verified',
        circuitId: attrs.circuit_id || null,
        nullifier: attrs.nullifier || null,
        publicValuesHash: attrs.public_values_hash || null,
        verifier: attrs.sender || null,
        timestamp: Number(attrs.timestamp || 0),
        gasUsed: Number(attrs.gas_used || 0),
        txHash: attrs.tx_hash || null,
        blockNumber: Number(attrs.block_height || 0),
        chain,
      };
    }
    return null;
  }

  /**
   * Normalize a Solana proof result (from sol_log_data structured events).
   *
   * Event format from xfuel-solana-prover:
   *   ProofVerified (0x01): [type(1) | circuit_id(32) | nullifier(32) | verifier(32) | timestamp(8)]
   *   BridgeEvent   (0x02): [type(1) | circuit_id(32) | nullifier(32) | chain(2) | len(4) | payload]
   */
  static normalizeSolana(logData, txSignature, slot, chain) {
    if (!logData || logData.length < 1) return null;

    const eventType = logData[0];

    if (eventType === SOLANA_EVENT_TYPE.PROOF_VERIFIED && logData.length >= 105) {
      const circuitId = '0x' + Buffer.from(logData.slice(1, 33)).toString('hex');
      const nullifier = '0x' + Buffer.from(logData.slice(33, 65)).toString('hex');
      const verifier = Buffer.from(logData.slice(65, 97)).toString('hex');
      const timestampBytes = logData.slice(97, 105);
      const timestamp = Number(Buffer.from(timestampBytes).readBigInt64LE(0));

      return {
        prover: ProverType.SOLANA_ALT_BN128,
        status: 'verified',
        circuitId,
        nullifier,
        publicValuesHash: null,
        verifier,
        timestamp,
        gasUsed: GAS_BENCHMARKS[ProverType.SOLANA_ALT_BN128].verifyProof,
        txHash: txSignature,
        blockNumber: slot,
        chain,
      };
    }

    if (eventType === SOLANA_EVENT_TYPE.BRIDGE_EVENT && logData.length >= 71) {
      const circuitId = '0x' + Buffer.from(logData.slice(1, 33)).toString('hex');
      const nullifier = '0x' + Buffer.from(logData.slice(33, 65)).toString('hex');
      const targetChain = Buffer.from(logData.slice(65, 67)).readUInt16LE(0);
      const payloadLen = Buffer.from(logData.slice(67, 71)).readUInt32LE(0);
      const payload = logData.slice(71, 71 + payloadLen);

      return {
        prover: ProverType.SOLANA_ALT_BN128,
        status: 'bridge_event',
        circuitId,
        nullifier,
        publicValuesHash: null,
        verifier: null,
        timestamp: Math.floor(Date.now() / 1000),
        gasUsed: GAS_BENCHMARKS[ProverType.SOLANA_ALT_BN128].bridgeEvent,
        txHash: txSignature,
        blockNumber: slot,
        chain,
        bridgeTarget: targetChain,
        bridgePayload: payload,
      };
    }

    return null;
  }

  /**
   * Check if a proof result meets the <270K gas equivalent target.
   */
  static meetsGasTarget(result) {
    if (!result || !result.prover) return false;
    const benchmark = GAS_BENCHMARKS[result.prover];
    if (!benchmark) return false;
    return benchmark.verifyProof <= 270000;
  }

  /**
   * Get the gas-equivalent cost for a prover operation.
   */
  static getGasEquivalent(proverType, operation = 'verifyProof') {
    const benchmark = GAS_BENCHMARKS[proverType];
    if (!benchmark) return null;
    return {
      cost: benchmark[operation] || null,
      unit: benchmark.unit,
      meetsTarget: (benchmark[operation] || Infinity) <= 270000,
    };
  }
}

// ─── Intent Solver ────────────────────────────────────────────────────────────

/**
 * Parse and classify raw on-chain events into structured AI intents.
 * Supports EVM event logs, Cosmos transaction events, and Solana program logs.
 */
class IntentSolver {
  /**
   * Parse an EVM event log into an AI intent.
   */
  static parseEVMEvent(log, iface) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) return null;

      const eventToIntent = {
        TaskRouted: AI_INTENT_TYPES.INFERENCE_REQUEST,
        ComputeBidSubmitted: AI_INTENT_TYPES.COMPUTE_BID,
        ComputeResultAttested: AI_INTENT_TYPES.COMPUTE_RESULT,
        DataAttestationSubmitted: AI_INTENT_TYPES.DATA_ATTESTATION,
        CapabilityQuerySubmitted: AI_INTENT_TYPES.CAPABILITY_QUERY,
        // Priority Circuit events (Phase 2)
        IntentSubmitted: AI_INTENT_TYPES.COMPUTE_BID,
        BidSubmitted: AI_INTENT_TYPES.COMPUTE_BID,
        TaskCompleted: AI_INTENT_TYPES.COMPUTE_RESULT,
        SettlementRequested: AI_INTENT_TYPES.SETTLEMENT_REQUEST,
        InferenceAttested: AI_INTENT_TYPES.COMPUTE_RESULT,
        SettlementCompleted: AI_INTENT_TYPES.SETTLEMENT_REQUEST,
        BridgeInitiated: AI_INTENT_TYPES.BRIDGE_REQUEST,
        BridgeCompleted: AI_INTENT_TYPES.BRIDGE_COMPLETION,
        ProofRelayed: AI_INTENT_TYPES.DATA_ATTESTATION,
        CrossChainProofReceived: AI_INTENT_TYPES.DATA_ATTESTATION,
        SwarmFormed: AI_INTENT_TYPES.SWARM_FORMED,
        AgentSettled: AI_INTENT_TYPES.AGENT_SETTLED,
        SwarmDissolved: AI_INTENT_TYPES.SWARM_SETTLED,
        DataProvenanced: AI_INTENT_TYPES.DATA_PROVENANCED,
        SelectiveDisclosureVerified: AI_INTENT_TYPES.SELECTIVE_DISCLOSURE,
        InferenceIntentSubmitted: AI_INTENT_TYPES.INFERENCE_REQUEST,
      };

      const intentType = eventToIntent[parsed.name] || null;
      if (!intentType) return null;

      return {
        type: intentType,
        eventName: parsed.name,
        args: parsed.args,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        address: log.address,
        raw: log,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse a Cosmos transaction event into an AI intent.
   */
  static parseCosmosEvent(events, chain) {
    for (const event of events) {
      if (event.type !== 'wasm') continue;

      const attrs = {};
      for (const attr of event.attributes || []) {
        const key = typeof attr.key === 'string' && attr.key.includes('=')
          ? Buffer.from(attr.key, 'base64').toString()
          : attr.key;
        const value = attr.value
          ? (typeof attr.value === 'string' && attr.value.includes('=')
              ? Buffer.from(attr.value, 'base64').toString()
              : attr.value)
          : '';
        attrs[key] = value;
      }

      const action = attrs.action;
      if (!action || !Object.values(AI_INTENT_TYPES).includes(action)) continue;

      return {
        type: action,
        sender: attrs.sender || null,
        recipient: attrs.recipient || null,
        amount: attrs.amount || '0',
        denom: attrs.denom || '',
        modelId: attrs.model_id || null,
        inputHash: attrs.input_hash || null,
        outputHash: attrs.output_hash || null,
        nonce: attrs.nonce || null,
        chain,
      };
    }

    return null;
  }

  /**
   * Parse a Solana program log into an AI intent.
   *
   * Solana programs emit structured data via sol_log_data. The xfuel-solana-prover
   * emits ProofVerified (0x01) and BridgeEvent (0x02) events that downstream
   * circuits can consume as intents.
   */
  static parseSolanaEvent(logMessages, txSignature, slot, chain) {
    if (!logMessages || !Array.isArray(logMessages)) return null;

    for (const msg of logMessages) {
      if (typeof msg !== 'string') continue;

      // sol_log_data emits as "Program data: <base64>"
      if (msg.startsWith('Program data: ')) {
        try {
          const b64 = msg.slice('Program data: '.length);
          const data = Buffer.from(b64, 'base64');
          const normalized = ProverNormalizer.normalizeSolana(
            data, txSignature, slot, chain
          );

          if (normalized && normalized.status === 'verified') {
            return {
              type: AI_INTENT_TYPES.COMPUTE_RESULT,
              circuitId: normalized.circuitId,
              nullifier: normalized.nullifier,
              verifier: normalized.verifier,
              timestamp: normalized.timestamp,
              txHash: txSignature,
              blockNumber: slot,
              chain,
              prover: ProverType.SOLANA_ALT_BN128,
            };
          }
        } catch {
          continue;
        }
      }

      // msg! macro emits as "Program log: <message>"
      if (msg.startsWith('Program log: SP1 proof verified')) {
        return {
          type: AI_INTENT_TYPES.COMPUTE_RESULT,
          eventName: 'SP1ProofVerified',
          txHash: txSignature,
          blockNumber: slot,
          chain,
          prover: ProverType.SOLANA_ALT_BN128,
        };
      }
    }

    return null;
  }
}

// ─── Cross-Chain Proof Router ─────────────────────────────────────────────────

/**
 * Routes verified proof results to destination chains for settlement.
 *
 * Routing matrix:
 *   Solana → Theta EVM:   Wormhole VAA
 *   Solana → Cosmos:      Wormhole VAA → IBC relay
 *   EVM    → Cosmos:      Hyperlane dispatch
 *   EVM    → Solana:      Wormhole VAA
 *   Cosmos → EVM:         IBC → Hyperlane
 */
class ProofRouter {
  static getRoute(sourceChainType, destChainType) {
    const routes = {
      [`${ChainType.SVM}->${ChainType.EVM}`]: {
        bridge: 'wormhole',
        method: 'VAA',
        estimatedTime: '~15s',
        gasEquivalent: 403000,
      },
      [`${ChainType.SVM}->${ChainType.COSMOS}`]: {
        bridge: 'wormhole+ibc',
        method: 'VAA→IBC',
        estimatedTime: '~30s',
        gasEquivalent: 450000,
      },
      [`${ChainType.EVM}->${ChainType.COSMOS}`]: {
        bridge: 'hyperlane',
        method: 'dispatch',
        estimatedTime: '~20s',
        gasEquivalent: 403000,
      },
      [`${ChainType.EVM}->${ChainType.SVM}`]: {
        bridge: 'wormhole',
        method: 'VAA',
        estimatedTime: '~15s',
        gasEquivalent: 350000,
      },
      [`${ChainType.COSMOS}->${ChainType.EVM}`]: {
        bridge: 'ibc+hyperlane',
        method: 'IBC→dispatch',
        estimatedTime: '~25s',
        gasEquivalent: 450000,
      },
      [`${ChainType.EVM}->${ChainType.EVM}`]: {
        bridge: 'hyperlane',
        method: 'dispatch',
        estimatedTime: '~12s',
        gasEquivalent: 403000,
      },
      [`${ChainType.COSMOS}->${ChainType.COSMOS}`]: {
        bridge: 'ibc',
        method: 'channel',
        estimatedTime: '~15s',
        gasEquivalent: 250000,
      },
      [`${ChainType.EVM}->${ChainType.DEPIN}`]: {
        bridge: 'hyperlane+depin',
        method: 'dispatch→provider',
        estimatedTime: '~20s',
        gasEquivalent: 420000,
      },
      [`${ChainType.DEPIN}->${ChainType.EVM}`]: {
        bridge: 'depin+hyperlane',
        method: 'result→dispatch',
        estimatedTime: '~20s',
        gasEquivalent: 420000,
      },
      [`${ChainType.COSMOS}->${ChainType.DEPIN}`]: {
        bridge: 'ibc+depin',
        method: 'IBC→provider',
        estimatedTime: '~25s',
        gasEquivalent: 460000,
      },
      [`${ChainType.DEPIN}->${ChainType.COSMOS}`]: {
        bridge: 'depin+ibc',
        method: 'result→IBC',
        estimatedTime: '~25s',
        gasEquivalent: 460000,
      },
      [`${ChainType.DEPIN}->${ChainType.DEPIN}`]: {
        bridge: 'depin-direct',
        method: 'p2p',
        estimatedTime: '~10s',
        gasEquivalent: 300000,
      },
      [`${ChainType.SVM}->${ChainType.DEPIN}`]: {
        bridge: 'wormhole+depin',
        method: 'VAA→provider',
        estimatedTime: '~25s',
        gasEquivalent: 470000,
      },
      [`${ChainType.DEPIN}->${ChainType.SVM}`]: {
        bridge: 'depin+wormhole',
        method: 'result→VAA',
        estimatedTime: '~25s',
        gasEquivalent: 470000,
      },
      // Aptos Move routes
      [`${ChainType.EVM}->${ChainType.MOVE_APTOS}`]: {
        bridge: 'layerzero',
        method: 'oft_send',
        estimatedTime: '~20s',
        gasEquivalent: 380000,
      },
      [`${ChainType.MOVE_APTOS}->${ChainType.EVM}`]: {
        bridge: 'layerzero',
        method: 'oft_receive',
        estimatedTime: '~20s',
        gasEquivalent: 380000,
      },
      [`${ChainType.COSMOS}->${ChainType.MOVE_APTOS}`]: {
        bridge: 'ibc+layerzero',
        method: 'IBC→oft_send',
        estimatedTime: '~30s',
        gasEquivalent: 480000,
      },
      [`${ChainType.MOVE_APTOS}->${ChainType.COSMOS}`]: {
        bridge: 'layerzero+ibc',
        method: 'oft_receive→IBC',
        estimatedTime: '~30s',
        gasEquivalent: 480000,
      },
      // Sui Move routes
      [`${ChainType.EVM}->${ChainType.MOVE_SUI}`]: {
        bridge: 'wormhole',
        method: 'VAA→sui_object',
        estimatedTime: '~18s',
        gasEquivalent: 350000,
      },
      [`${ChainType.MOVE_SUI}->${ChainType.EVM}`]: {
        bridge: 'wormhole',
        method: 'sui_object→VAA',
        estimatedTime: '~18s',
        gasEquivalent: 350000,
      },
      [`${ChainType.COSMOS}->${ChainType.MOVE_SUI}`]: {
        bridge: 'ibc+wormhole',
        method: 'IBC→VAA→sui',
        estimatedTime: '~30s',
        gasEquivalent: 500000,
      },
      [`${ChainType.MOVE_SUI}->${ChainType.COSMOS}`]: {
        bridge: 'wormhole+ibc',
        method: 'sui→VAA→IBC',
        estimatedTime: '~30s',
        gasEquivalent: 500000,
      },
      [`${ChainType.MOVE_APTOS}->${ChainType.MOVE_SUI}`]: {
        bridge: 'wormhole',
        method: 'move_bridge',
        estimatedTime: '~15s',
        gasEquivalent: 300000,
      },
      [`${ChainType.MOVE_SUI}->${ChainType.MOVE_APTOS}`]: {
        bridge: 'wormhole',
        method: 'move_bridge',
        estimatedTime: '~15s',
        gasEquivalent: 300000,
      },
      [`${ChainType.SVM}->${ChainType.MOVE_APTOS}`]: {
        bridge: 'wormhole',
        method: 'VAA→move',
        estimatedTime: '~20s',
        gasEquivalent: 420000,
      },
      [`${ChainType.MOVE_APTOS}->${ChainType.SVM}`]: {
        bridge: 'wormhole',
        method: 'move→VAA',
        estimatedTime: '~20s',
        gasEquivalent: 420000,
      },
      [`${ChainType.SVM}->${ChainType.MOVE_SUI}`]: {
        bridge: 'wormhole',
        method: 'VAA→sui',
        estimatedTime: '~20s',
        gasEquivalent: 420000,
      },
      [`${ChainType.MOVE_SUI}->${ChainType.SVM}`]: {
        bridge: 'wormhole',
        method: 'sui→VAA',
        estimatedTime: '~20s',
        gasEquivalent: 420000,
      },
      [`${ChainType.DEPIN}->${ChainType.MOVE_APTOS}`]: {
        bridge: 'depin+layerzero',
        method: 'result→oft',
        estimatedTime: '~25s',
        gasEquivalent: 490000,
      },
      [`${ChainType.MOVE_APTOS}->${ChainType.DEPIN}`]: {
        bridge: 'layerzero+depin',
        method: 'oft→provider',
        estimatedTime: '~25s',
        gasEquivalent: 490000,
      },
      [`${ChainType.DEPIN}->${ChainType.MOVE_SUI}`]: {
        bridge: 'depin+wormhole',
        method: 'result→sui',
        estimatedTime: '~25s',
        gasEquivalent: 490000,
      },
      [`${ChainType.MOVE_SUI}->${ChainType.DEPIN}`]: {
        bridge: 'wormhole+depin',
        method: 'sui→provider',
        estimatedTime: '~25s',
        gasEquivalent: 490000,
      },
    };

    return routes[`${sourceChainType}->${destChainType}`] || null;
  }

  static allRoutes() {
    const types = [ChainType.EVM, ChainType.COSMOS, ChainType.SVM, ChainType.DEPIN, ChainType.MOVE_APTOS, ChainType.MOVE_SUI];
    const result = [];
    for (const src of types) {
      for (const dst of types) {
        if (src === dst && src === ChainType.SVM) continue;
        if (src === dst) continue;
        const route = ProofRouter.getRoute(src, dst);
        if (route) result.push({ source: src, dest: dst, ...route });
      }
    }
    return result;
  }

  /**
   * Select optimal DePIN provider for a compute task based on GPU requirements,
   * pricing model, and availability across Akash and Render networks.
   */
  static selectDePINProvider(taskRequirements, providers) {
    if (!providers || providers.length === 0) return null;

    const eligible = providers.filter(p => {
      if (p.status !== DePINProviderStatus.AVAILABLE) return false;
      if (taskRequirements.gpu && !p.gpuCapabilities?.includes(taskRequirements.gpu)) return false;
      if (taskRequirements.minVRAM && (p.vram || 0) < taskRequirements.minVRAM) return false;
      return true;
    });

    if (eligible.length === 0) return null;

    eligible.sort((a, b) => (a.pricePerUnit || Infinity) - (b.pricePerUnit || Infinity));
    return eligible[0];
  }

  /**
   * Build multi-hop route for cross-DePIN task routing.
   * Finds cheapest path through intermediary chains if direct route unavailable.
   */
  static findMultiHopRoute(sourceType, destType, maxHops = 3) {
    const direct = ProofRouter.getRoute(sourceType, destType);
    if (direct) return { hops: [{ source: sourceType, dest: destType, ...direct }], totalGas: direct.gasEquivalent };

    const types = [ChainType.EVM, ChainType.COSMOS, ChainType.SVM, ChainType.DEPIN, ChainType.MOVE_APTOS, ChainType.MOVE_SUI];
    for (const mid of types) {
      if (mid === sourceType || mid === destType) continue;
      const hop1 = ProofRouter.getRoute(sourceType, mid);
      const hop2 = ProofRouter.getRoute(mid, destType);
      if (hop1 && hop2) {
        return {
          hops: [
            { source: sourceType, dest: mid, ...hop1 },
            { source: mid, dest: destType, ...hop2 },
          ],
          totalGas: hop1.gasEquivalent + hop2.gasEquivalent,
        };
      }
    }

    return null;
  }
}

// ─── Core Listener ────────────────────────────────────────────────────────────

/**
 * Multi-RPC event listener with pluggable circuit handlers and
 * multi-prover proof normalization.
 *
 * Architecture:
 *   CoreListener → Chain Pollers → IntentSolver → Circuit Handler → ZK Proof → Settlement
 *                → ProverNormalizer → ProofRouter → Cross-Chain Relay
 */
class CoreListener {
  /**
   * @param {Object} config
   * @param {Object} [config.chains] - Chain registry (merged with DEFAULT_CHAINS).
   * @param {Object} [config.contracts] - Contract addresses per chain.
   * @param {Object} [config.sp1] - SP1 prover configuration.
   * @param {Function} [config.logger] - Logger function (default: console).
   */
  constructor(config = {}) {
    this.chains = { ...DEFAULT_CHAINS, ...(config.chains || {}) };
    this.contracts = config.contracts || {};
    this.sp1Config = config.sp1 || {};
    this.log = config.logger || console;

    // Provider cache
    this.providers = new Map();

    // Circuit registry
    this.circuits = new Map();

    // Polling state
    this.isRunning = false;
    this.pollTimers = new Map();
    this.lastBlocks = new Map();
    this.lastSolanaSignatures = new Map();

    // Processed events (dedup)
    this.processedEvents = new Set();
    this.maxProcessedCache = 10000;

    // Proof result cache (for cross-chain routing)
    this.proofResults = [];
    this.maxProofCache = 1000;

    // DePIN provider registry
    this.depinProviders = new Map();

    // Per-chain error tracking (dedup + backoff)
    this.chainErrors = new Map();

    // Intent outcome tracking (Phase 4)
    this.intentOutcomes = [];
    this.maxOutcomeCache = 5000;
    this.pendingIntents = new Map();
    this.intentTimeoutMs = 60000;

    // Bounded intent queue (backpressure + concurrency control)
    const maxConcurrency = parseInt(process.env.MAX_CONCURRENCY, 10) || 50;
    this.queue = new PQueue({ concurrency: maxConcurrency });
    this.maxPending = parseInt(process.env.MAX_PENDING, 10) || 1000;
    this.backpressureThreshold = Math.floor(this.maxPending * 0.8);

    // Metrics
    this.metrics = {
      eventsProcessed: 0,
      intentsParsed: 0,
      proofsGenerated: 0,
      proofsFailed: 0,
      proofRetries: 0,
      proofsNormalized: 0,
      bridgeEventsRouted: 0,
      depinTasksRouted: 0,
      intentsOutcomed: 0,
      noPathSolved: 0,
      queueOverflows: 0,
      backpressureWarnings: 0,
      startedAt: null,
      perChain: {},
      perProver: {
        [ProverType.EVM_GROTH16]: { verified: 0, failed: 0, avgGas: 0 },
        [ProverType.COSMWASM_ARK_BN254]: { verified: 0, failed: 0, avgGas: 0 },
        [ProverType.SOLANA_ALT_BN128]: { verified: 0, failed: 0, avgGas: 0 },
      },
      perCircuit: {
        compute_marketplace: { events: 0, intents: 0, proofs: 0, settlements: 0 },
        inference_router: { events: 0, intents: 0, proofs: 0, settlements: 0 },
        bridge_circuit: { events: 0, intents: 0, proofs: 0, relays: 0 },
        a2a_swarm: { events: 0, swarmsFormed: 0, agentsSettled: 0, swarmsDissolved: 0 },
        zkml_privacy: { events: 0, disclosures: 0, provenanced: 0 },
      },
      perOutcome: {
        [IntentOutcomeType.FULFILLED]: 0,
        [IntentOutcomeType.PARTIAL]: 0,
        [IntentOutcomeType.FAILED]: 0,
        [IntentOutcomeType.NO_PATH]: 0,
        [IntentOutcomeType.TIMEOUT]: 0,
        [IntentOutcomeType.DEFERRED]: 0,
      },
    };
  }

  // ─── Circuit Registration ─────────────────────────────────────────────────

  registerCircuit(circuitId, handler, chains = null, intentTypes = null) {
    this.circuits.set(circuitId, {
      handler,
      chains: chains || Object.keys(this.chains),
      intentTypes: intentTypes || Object.values(AI_INTENT_TYPES),
    });
    this.log.info?.(`Circuit registered: ${circuitId}`) ||
      console.log(`[CoreListener] Circuit registered: ${circuitId}`);
  }

  unregisterCircuit(circuitId) {
    this.circuits.delete(circuitId);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.metrics.startedAt = Date.now();

    for (const [key, chain] of Object.entries(this.chains)) {
      this.metrics.perChain[key] = { events: 0, intents: 0, proofs: 0 };

      if (chain.type === ChainType.EVM) {
        try {
          const provider = new ethers.JsonRpcProvider(chain.rpc, chain.chainId);
          this.providers.set(key, provider);
          const block = await provider.getBlockNumber();
          this.lastBlocks.set(key, block);
          this.log.info?.(`Connected to ${chain.name} (block ${block})`) ||
            console.log(`[CoreListener] Connected to ${chain.name} (block ${block})`);
        } catch (err) {
          this.log.warn?.(`Failed to connect to ${chain.name}: ${err.message}`) ||
            console.warn(`[CoreListener] Failed to connect to ${chain.name}: ${err.message}`);
        }
      } else if (chain.type === ChainType.SVM) {
        this.lastSolanaSignatures.set(key, null);
        this.log.info?.(`Solana chain configured: ${chain.name}`) ||
          console.log(`[CoreListener] Solana chain configured: ${chain.name}`);
      }
    }

    for (const [key, chain] of Object.entries(this.chains)) {
      const interval = chain.pollInterval || 5000;
      const timer = setInterval(() => this._pollChain(key), interval);
      this.pollTimers.set(key, timer);
    }

    this.log.info?.('CoreListener started') ||
      console.log('[CoreListener] Started polling all chains');
  }

  stop() {
    this.isRunning = false;
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();
    this.providers.clear();

    this.log.info?.({ metrics: this.metrics }, 'CoreListener stopped') ||
      console.log('[CoreListener] Stopped', this.metrics);
  }

  // ─── Polling ──────────────────────────────────────────────────────────────

  async _pollChain(chainKey) {
    if (!this.isRunning) return;
    const chain = this.chains[chainKey];
    if (!chain) return;

    try {
      if (chain.type === ChainType.EVM) {
        await this._pollEVM(chainKey, chain);
      } else if (chain.type === ChainType.COSMOS) {
        await this._pollCosmos(chainKey, chain);
      } else if (chain.type === ChainType.SVM) {
        await this._pollSolana(chainKey, chain);
      }

      // Reset error counter on success
      if (this.chainErrors.has(chainKey)) {
        const prev = this.chainErrors.get(chainKey);
        if (prev.consecutive > 0) {
          console.log(`[CoreListener] ${chain.name} recovered after ${prev.consecutive} errors`);
        }
        this.chainErrors.delete(chainKey);
      }
    } catch (err) {
      const tracker = this.chainErrors.get(chainKey) || { consecutive: 0, lastMsg: '', suppressedCount: 0 };
      tracker.consecutive++;

      const shortMsg = (err.message || '').split('\n')[0].slice(0, 100);
      const isSameError = shortMsg === tracker.lastMsg;
      tracker.lastMsg = shortMsg;

      // Log first occurrence, then every 15th repeat (suppress the noise)
      if (!isSameError || tracker.consecutive === 1 || tracker.consecutive % 15 === 0) {
        const suffix = tracker.suppressedCount > 0 ? ` (suppressed ${tracker.suppressedCount} repeats)` : '';
        console.warn(`[CoreListener] ${chain.name} poll error #${tracker.consecutive}: ${shortMsg}${suffix}`);
        tracker.suppressedCount = 0;
      } else {
        tracker.suppressedCount++;
      }

      this.chainErrors.set(chainKey, tracker);
    }
  }

  /**
   * Poll an EVM chain for new events since lastBlock.
   */
  async _pollEVM(chainKey, chain) {
    const provider = this.providers.get(chainKey);
    if (!provider) return;

    const currentBlock = await provider.getBlockNumber();
    const lastBlock = this.lastBlocks.get(chainKey) || currentBlock;
    if (currentBlock <= lastBlock) return;

    const contractAddrs = this.contracts[chainKey] || [];
    if (contractAddrs.length === 0) {
      this.lastBlocks.set(chainKey, currentBlock);
      return;
    }

    for (const contractCfg of contractAddrs) {
      try {
        const filter = {
          address: contractCfg.address,
          fromBlock: lastBlock + 1,
          toBlock: currentBlock,
          topics: contractCfg.topics || [],
        };

        const logs = await provider.getLogs(filter);

        for (const log of logs) {
          const eventId = `${chainKey}-${log.transactionHash}-${log.logIndex}`;
          if (this.processedEvents.has(eventId)) continue;
          this._addProcessedEvent(eventId);

          this.metrics.eventsProcessed++;
          this._incChainMetric(chainKey, 'events');

          // Try proof normalization first
          if (contractCfg.iface) {
            const proofResult = ProverNormalizer.normalizeEVM(log, contractCfg.iface);
            if (proofResult) {
              proofResult.chain = chainKey;
              this._recordProofResult(proofResult);
            }
          }

          // Then try intent parsing
          let intent = null;
          if (contractCfg.iface) {
            intent = IntentSolver.parseEVMEvent(log, contractCfg.iface);
          }

          if (intent) {
            this.metrics.intentsParsed++;
            this._incChainMetric(chainKey, 'intents');
            intent.chain = chainKey;
            intent.prover = chain.prover;
            await this._dispatchIntent(intent, chainKey);
          }
        }
      } catch (err) {
        console.warn(`[CoreListener] Log fetch error (${chainKey}/${contractCfg.address?.slice(0, 10)}): ${(err.message || '').split('\n')[0].slice(0, 120)}`);
      }
    }

    this.lastBlocks.set(chainKey, currentBlock);
  }

  /**
   * Poll a Cosmos chain for new transaction events.
   */
  async _pollCosmos(chainKey, chain) {
    // Cosmos polling — in production, use @cosmjs/stargate or WebSocket.
    // The framework dispatches through the same intent/normalizer pipeline.
  }

  /**
   * Poll a Solana SVM chain for new program transactions.
   *
   * Uses getSignaturesForAddress to discover new transactions involving
   * the xfuel-solana-prover program, then fetches each transaction's
   * logs and parses structured events.
   */
  async _pollSolana(chainKey, chain) {
    if (!chain.programId) return;

    try {
      const response = await fetch(chain.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [
            chain.programId,
            {
              limit: 20,
              until: this.lastSolanaSignatures.get(chainKey) || undefined,
            },
          ],
        }),
      });

      const data = await response.json();
      if (!data.result || data.result.length === 0) return;

      // Update cursor to most recent signature
      this.lastSolanaSignatures.set(chainKey, data.result[0].signature);

      for (const sigInfo of data.result) {
        const eventId = `${chainKey}-${sigInfo.signature}`;
        if (this.processedEvents.has(eventId)) continue;
        this._addProcessedEvent(eventId);

        if (sigInfo.err) continue; // Skip failed transactions

        // Fetch full transaction for logs
        const txResponse = await fetch(chain.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'getTransaction',
            params: [sigInfo.signature, { encoding: 'json', maxSupportedTransactionVersion: 0 }],
          }),
        });

        const txData = await txResponse.json();
        if (!txData.result?.meta?.logMessages) continue;

        this.metrics.eventsProcessed++;
        this._incChainMetric(chainKey, 'events');

        const intent = IntentSolver.parseSolanaEvent(
          txData.result.meta.logMessages,
          sigInfo.signature,
          sigInfo.slot,
          chainKey
        );

        if (intent) {
          this.metrics.intentsParsed++;
          this._incChainMetric(chainKey, 'intents');
          await this._dispatchIntent(intent, chainKey);
        }

        // Parse structured event data from innerInstructions or log data
        const logMsgs = txData.result.meta.logMessages;
        for (const msg of logMsgs) {
          if (!msg.startsWith('Program data: ')) continue;
          try {
            const b64 = msg.slice('Program data: '.length);
            const logBytes = Buffer.from(b64, 'base64');
            const proofResult = ProverNormalizer.normalizeSolana(
              logBytes, sigInfo.signature, sigInfo.slot, chainKey
            );
            if (proofResult) {
              this._recordProofResult(proofResult);
            }
          } catch {
            // Skip unparseable log data
          }
        }
      }
    } catch (err) {
      console.warn(`[CoreListener] Solana poll error (${chainKey}): ${(err.message || '').split('\n')[0].slice(0, 120)}`);
    }
  }

  // ─── Intent Dispatch (Queue-Wrapped) ──────────────────────────────────────

  async _dispatchIntent(intent, chainKey) {
    if (this.queue.size >= this.maxPending) {
      this.metrics.queueOverflows++;
      console.warn(
        `[CoreListener] Queue overflow: ${this.queue.size}/${this.maxPending} pending. Rejecting intent.`
      );
      const rejectId = intent.txHash ||
        `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return this._resolveIntentOutcome(rejectId, IntentOutcomeType.FAILED, {
        reason: 'Queue overflow — backpressure limit reached',
      });
    }

    if (this.queue.size > this.backpressureThreshold) {
      this.metrics.backpressureWarnings++;
      console.warn(
        `[CoreListener] Backpressure: queue ${this.queue.size}/${this.maxPending}`
      );
    }

    return this.queue.add(() => this._processIntent(intent, chainKey));
  }

  async _processIntent(intent, chainKey) {
    const intentId = intent.txHash || `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    this.pendingIntents.set(intentId, {
      intent,
      chainKey,
      submittedAt: Date.now(),
    });

    let dispatched = false;

    for (const [circuitId, circuit] of this.circuits) {
      if (!circuit.chains.includes(chainKey)) continue;
      if (!circuit.intentTypes.includes(intent.type)) continue;

      dispatched = true;
      try {
        const result = await circuit.handler.onIntent(intent, {
          chain: chainKey,
          circuitId,
          prover: this.chains[chainKey]?.prover || null,
          gasEquivalent: ProverNormalizer.getGasEquivalent(
            this.chains[chainKey]?.prover, 'verifyProof'
          ),
          generateProof: (proofReq) => this._generateProof(proofReq, circuitId),
          getRoute: (destChainType) => ProofRouter.getRoute(
            this.chains[chainKey]?.type, destChainType
          ),
          findMultiHopRoute: (destChainType) => ProofRouter.findMultiHopRoute(
            this.chains[chainKey]?.type, destChainType
          ),
          selectDePINProvider: (task) => ProofRouter.selectDePINProvider(
            task, Array.from(this.depinProviders.values())
          ),
          resolveOutcome: (outcomeType, details) =>
            this._resolveIntentOutcome(intentId, outcomeType, details),
        });

        if (result && result.outcome) {
          this._resolveIntentOutcome(intentId, result.outcome, result.details || {});
        } else if (result !== undefined) {
          this._resolveIntentOutcome(intentId, IntentOutcomeType.FULFILLED, {
            circuitId, result,
          });
        }
      } catch (err) {
        this.log.error?.({ err, circuitId, intent: intent.type }, 'Circuit handler error') ||
          console.error(`[CoreListener] Circuit ${circuitId} error:`, err.message);
        this._resolveIntentOutcome(intentId, IntentOutcomeType.FAILED, {
          circuitId, error: err.message,
        });
      }
    }

    if (!dispatched) {
      await this._solveNoPath(intent, chainKey);
    }

    this._checkIntentTimeouts();
  }

  // ─── SP1 Proof Hooks ──────────────────────────────────────────────────────

  async _generateProof(proofRequest, circuitId) {
    const MAX_RETRIES = 3;
    const LATENCY_THRESHOLD_MS = 10000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const startTime = Date.now();

      try {
        const result = await this._callSP1Prover(proofRequest);
        const elapsed = Date.now() - startTime;

        result.provingTimeMs = elapsed;
        this.metrics.proofsGenerated++;
        this._incChainMetric(proofRequest.chain || 'unknown', 'proofs');

        if (elapsed > LATENCY_THRESHOLD_MS && attempt < MAX_RETRIES) {
          this.log.warn?.({ circuitId, elapsed, attempt }, 'Proof latency >10s — regenerating');
          this.metrics.proofRetries++;
          continue;
        }

        const circuit = this.circuits.get(circuitId);
        if (circuit?.handler?.onProofReady) {
          await circuit.handler.onProofReady(result, proofRequest);
        }

        return result;
      } catch (err) {
        this.metrics.proofsFailed++;
        this.log.error?.({ err, circuitId, attempt }, 'Proof generation failed');

        if (attempt === MAX_RETRIES) {
          return { error: err.message, attempt, provingTimeMs: Date.now() - startTime };
        }

        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  async _callSP1Prover(proofRequest) {
    const mockProof = {
      proof: '0x' + 'ab'.repeat(130),
      publicValues: '0x' + 'cd'.repeat(64),
      nullifier: '0x' + Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join(''),
      programVKey: proofRequest.programVKey || '0x' + '00'.repeat(32),
      proofSizeBytes: 260,
    };

    const delay = 2000 + Math.random() * 7000;
    await new Promise((r) => setTimeout(r, delay));

    return mockProof;
  }

  // ─── Proof Result Tracking ────────────────────────────────────────────────

  _recordProofResult(result) {
    this.metrics.proofsNormalized++;

    const proverMetric = this.metrics.perProver[result.prover];
    if (proverMetric) {
      if (result.status === 'verified') proverMetric.verified++;
      else if (result.status === 'failed') proverMetric.failed++;
      if (result.gasUsed) {
        proverMetric.avgGas = proverMetric.avgGas
          ? Math.round((proverMetric.avgGas + result.gasUsed) / 2)
          : result.gasUsed;
      }
    }

    this.proofResults.push(result);
    if (this.proofResults.length > this.maxProofCache) {
      this.proofResults = this.proofResults.slice(-this.maxProofCache / 2);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _addProcessedEvent(eventId) {
    this.processedEvents.add(eventId);
    if (this.processedEvents.size > this.maxProcessedCache) {
      const iter = this.processedEvents.values();
      for (let i = 0; i < this.maxProcessedCache / 2; i++) {
        this.processedEvents.delete(iter.next().value);
      }
    }
  }

  _incChainMetric(chainKey, field) {
    if (!this.metrics.perChain[chainKey]) {
      this.metrics.perChain[chainKey] = { events: 0, intents: 0, proofs: 0 };
    }
    this.metrics.perChain[chainKey][field]++;
  }

  // ─── DePIN Provider Management ───────────────────────────────────────────

  registerDePINProvider(providerId, config) {
    this.depinProviders.set(providerId, {
      ...config,
      status: DePINProviderStatus.AVAILABLE,
      registeredAt: Date.now(),
      tasksCompleted: 0,
      avgLatencyMs: 0,
    });
    this.log.info?.(`DePIN provider registered: ${providerId} (${config.network})`) ||
      console.log(`[CoreListener] DePIN provider registered: ${providerId}`);
  }

  async routeDePINTask(task) {
    const providers = Array.from(this.depinProviders.values()).filter(
      p => p.status === DePINProviderStatus.AVAILABLE
    );

    const selected = ProofRouter.selectDePINProvider(task, providers);
    if (!selected) {
      return this._resolveIntentOutcome(task.intentId, IntentOutcomeType.NO_PATH, {
        reason: 'No eligible DePIN providers',
        taskRequirements: task,
      });
    }

    this.metrics.depinTasksRouted++;
    return {
      provider: selected,
      route: ProofRouter.getRoute(task.sourceChainType || ChainType.EVM, ChainType.DEPIN),
      estimatedCost: selected.pricePerUnit * (task.units || 1),
    };
  }

  // ─── Intent Outcome Tracking (Phase 4) ─────────────────────────────────

  /**
   * Record an intent outcome. Called when an intent reaches a terminal state.
   * Supports fulfilled, partial, failed, no_path, timeout, and deferred outcomes.
   */
  _resolveIntentOutcome(intentId, outcomeType, details = {}) {
    const outcome = {
      intentId,
      type: outcomeType,
      resolvedAt: Date.now(),
      details,
    };

    this.intentOutcomes.push(outcome);
    if (this.intentOutcomes.length > this.maxOutcomeCache) {
      this.intentOutcomes = this.intentOutcomes.slice(-this.maxOutcomeCache / 2);
    }

    this.metrics.intentsOutcomed++;
    if (this.metrics.perOutcome[outcomeType] !== undefined) {
      this.metrics.perOutcome[outcomeType]++;
    }

    this.pendingIntents.delete(intentId);

    this.log.info?.({ intentId, outcomeType }, 'IntentOutcome resolved') ||
      console.log(`[CoreListener] IntentOutcome: ${intentId} → ${outcomeType}`);

    return outcome;
  }

  /**
   * Attempt no-path solving: when no direct route exists, try multi-hop
   * routing, provider fallbacks, or deferred execution.
   */
  async _solveNoPath(intent, chainKey) {
    this.metrics.noPathSolved++;
    const chain = this.chains[chainKey];
    if (!chain) {
      return this._resolveIntentOutcome(intent.txHash, IntentOutcomeType.FAILED, {
        reason: 'Unknown chain',
      });
    }

    const allTypes = [ChainType.EVM, ChainType.COSMOS, ChainType.SVM, ChainType.DEPIN, ChainType.MOVE_APTOS, ChainType.MOVE_SUI];
    for (const targetType of allTypes) {
      if (targetType === chain.type) continue;
      const multiHop = ProofRouter.findMultiHopRoute(chain.type, targetType);
      if (multiHop && multiHop.totalGas < 500000) {
        return this._resolveIntentOutcome(intent.txHash, IntentOutcomeType.DEFERRED, {
          reason: 'Multi-hop route found',
          route: multiHop,
          estimatedGas: multiHop.totalGas,
        });
      }
    }

    return this._resolveIntentOutcome(intent.txHash, IntentOutcomeType.NO_PATH, {
      reason: 'No viable route after multi-hop search',
      sourceChain: chainKey,
      sourceType: chain.type,
    });
  }

  /**
   * Check for timed-out pending intents and resolve them.
   */
  _checkIntentTimeouts() {
    const now = Date.now();
    for (const [intentId, pendingIntent] of this.pendingIntents) {
      if (now - pendingIntent.submittedAt > this.intentTimeoutMs) {
        this._resolveIntentOutcome(intentId, IntentOutcomeType.TIMEOUT, {
          reason: 'Intent timed out',
          elapsed: now - pendingIntent.submittedAt,
        });
      }
    }
  }

  getIntentOutcomeStats() {
    return {
      total: this.metrics.intentsOutcomed,
      perOutcome: { ...this.metrics.perOutcome },
      pending: this.pendingIntents.size,
      recentOutcomes: this.intentOutcomes.slice(-10),
    };
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  getStatus() {
    return {
      isRunning: this.isRunning,
      chains: Object.fromEntries(
        Object.entries(this.chains).map(([k, v]) => [k, {
          name: v.name,
          type: v.type,
          prover: v.prover,
          lastBlock: this.lastBlocks.get(k) || 0,
          connected: this.providers.has(k) || v.type === ChainType.SVM || v.type === ChainType.DEPIN,
          gasTarget: v.gasTarget,
          depinProvider: v.depinProvider || null,
        }])
      ),
      circuits: Array.from(this.circuits.keys()),
      depinProviders: Object.fromEntries(this.depinProviders),
      metrics: {
        ...this.metrics,
        uptimeMs: this.metrics.startedAt ? Date.now() - this.metrics.startedAt : 0,
      },
      queue: {
        concurrency: this.queue.concurrency,
        size: this.queue.size,
        pending: this.queue.pending,
        maxPending: this.maxPending,
        backpressureThreshold: this.backpressureThreshold,
        overflows: this.metrics.queueOverflows,
        backpressureWarnings: this.metrics.backpressureWarnings,
      },
      intentOutcomes: this.getIntentOutcomeStats(),
      gasBenchmarks: GAS_BENCHMARKS,
      routes: ProofRouter.allRoutes(),
    };
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
  CoreListener,
  IntentSolver,
  ProverNormalizer,
  ProofRouter,
  ChainType,
  ProverType,
  AI_INTENT_TYPES,
  GAS_BENCHMARKS,
  SOLANA_EVENT_TYPE,
  DEFAULT_CHAINS,
  IntentOutcomeType,
  DePINProviderStatus,
};

export default CoreListener;

// ─── Self-Running Main (when executed directly) ──────────────────────────────

const isMainModule = typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('ai-listener.js') || process.argv[1].endsWith('ai-listener'));

if (isMainModule) {
  (async () => {
    try {
      // Load .env and .env.local
      const dotenv = await import('dotenv');
      dotenv.config();
      dotenv.config({ path: '.env.local', override: true });

      // Dynamic import of the handler (ES module)
      const { ThetaInferenceHandler } = await import('../circuits/theta-inference/theta-inference-handler.js');

      console.log('═══════════════════════════════════════════════════════════');
      console.log('  XFuel Protocol — Core AI Listener');
      console.log('═══════════════════════════════════════════════════════════');

      const contractAddress = process.env.THETA_INFERENCE_ADDRESS || process.env.VITE_THETA_INFERENCE_ADDRESS;

      // Validate env and show API status
      const envStatus = ThetaInferenceHandler.validateEnv();
      console.log(`  EdgeCloud key: ${envStatus.edgeCloudKey}`);
      console.log(`  RapidAPI key:  ${envStatus.rapidApiKey}`);
      console.log(`  MCP endpoint:  ${envStatus.mcpEndpoint}`);
      if (envStatus.canResolveFromAws) {
        console.log('  AWS resolve:   YES (will fetch key from Secrets Manager)');
      }

      const INFERENCE_IFACE = new ethers.Interface([
        'event InferenceIntentSubmitted(bytes32 indexed circuitId, bytes32 indexed intentId, uint8 serviceType, bytes32 indexed serviceId, address requester, uint256 payment, uint256 fee, bytes32 inputHash)',
        'event IntentCompleted(bytes32 indexed intentId, bytes32 outputHash, bytes32 modelHash, uint256 latencyMs)',
        'event IntentSettled(bytes32 indexed intentId, bytes32 nullifier, uint256 settledAmount)',
        'event IntentFailed(bytes32 indexed intentId, string reason)',
        'event PresetIntentSubmitted(bytes32 indexed intentId, bytes32 indexed presetId, uint8 gpuTier, address requester, uint256 payment)',
      ]);

      const contracts = {};

      if (contractAddress) {
        contracts.theta_testnet = [{
          address: contractAddress,
          iface: INFERENCE_IFACE,
          topics: [],
        }];
        contracts.theta_mainnet = [{
          address: contractAddress,
          iface: INFERENCE_IFACE,
          topics: [],
        }];
        console.log(`  Contract:  ${contractAddress}`);
      } else {
        console.log('  Contract:  (none — listening for all EVM events)');
      }

      // Resolve relayer private key for on-chain settlement
      let relayerKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '';
      if (!relayerKey && process.env.DEPLOYER_MAINNET_KEYSTORE_PATH && process.env.AWS_ACCESS_KEY_ID) {
        console.log('  Resolving relayer key from keystore...');
        try {
          const { readFileSync } = await import('fs');
          const keystorePath = process.env.DEPLOYER_MAINNET_KEYSTORE_PATH;
          const keystoreJson = readFileSync(keystorePath, 'utf-8');
          // Fetch password from AWS SM
          const { createHmac, createHash } = await import('crypto');
          const arn = process.env.DEPLOYER_KEYSTORE_PASSWORD || '';
          if (arn.startsWith('arn:aws:')) {
            const region = process.env.AWS_REGION || 'us-east-1';
            const body = JSON.stringify({ SecretId: arn });
            const now = new Date();
            const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
            const dateStamp = amzDate.slice(0, 8);
            const hash = (d) => createHash('sha256').update(d).digest('hex');
            const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
            const payloadHash = hash(body);
            const canonicalRequest = `POST\n/\n\ncontent-type:application/x-amz-json-1.1\nhost:secretsmanager.${region}.amazonaws.com\nx-amz-date:${amzDate}\nx-amz-target:secretsmanager.GetSecretValue\n\ncontent-type;host;x-amz-date;x-amz-target\n${payloadHash}`;
            const credentialScope = `${dateStamp}/${region}/secretsmanager/aws4_request`;
            const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hash(canonicalRequest)}`;
            let signingKey = hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, dateStamp);
            signingKey = hmac(signingKey, region);
            signingKey = hmac(signingKey, 'secretsmanager');
            signingKey = hmac(signingKey, 'aws4_request');
            const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
            const authHeader = `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=${signature}`;
            const res = await fetch(`https://secretsmanager.${region}.amazonaws.com`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'secretsmanager.GetSecretValue',
                'X-Amz-Date': amzDate,
                'Host': `secretsmanager.${region}.amazonaws.com`,
                'Authorization': authHeader,
              },
              body,
            });
            if (res.ok) {
              const data = await res.json();
              const password = data.SecretString || '';
              const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
              relayerKey = wallet.privateKey;
              console.log(`  Relayer key:   ${wallet.address.slice(0, 10)}... (from keystore)`);
            }
          }
        } catch (err) {
          console.warn(`  Relayer key resolution failed: ${err.message?.slice(0, 80)}`);
        }
      } else if (relayerKey) {
        console.log(`  Relayer key:   ${relayerKey.slice(0, 10)}... (from env)`);
      }

      const thetaRpc = process.env.THETA_TESTNET_RPC || 'https://eth-rpc-api-testnet.thetatoken.org/rpc';

      // Create the real handler with live API integration + on-chain settlement
      const handler = new ThetaInferenceHandler({
        edgeCloudApiKey: process.env.THETA_EDGECLOUD_API_KEY || '',
        rapidApiKey: process.env.THETA_RAPIDAPI_KEY || '',
        mcpEndpoint: process.env.THETA_MCP_ENDPOINT || '',
        contractAddress: contractAddress || null,
        relayerPrivateKey: relayerKey || null,
        rpcUrl: thetaRpc,
      });

      // Resolve API keys from AWS Secrets Manager if needed
      await handler.resolveApiKeys();

      // Initialize on-chain contract connection
      await handler.initContract();

      const apiStatus = handler.getApiStatus();

      const listener = new CoreListener({ contracts });

      // Register the real handler as circuit + wire listener reference for monitoring
      listener.registerCircuit('theta-inference', handler, ['theta_testnet', 'theta_mainnet']);
      if (handler.setListenerRef) handler.setListenerRef(listener);

      await listener.start();

      const chainCount = Object.keys(listener.chains).length;
      const connectedCount = listener.providers.size;
      const modeLabel = apiStatus.mode === 'LIVE' ? '✓ ENABLED'
        : apiStatus.mode === 'RAPIDAPI' ? '✓ RAPIDAPI'
        : '✗ MOCK (set THETA_EDGECLOUD_API_KEY for live)';

      console.log('');
      console.log('  ✓ XFuel CoreListener started successfully');
      console.log(`  ✓ Polling ${connectedCount} EVM chains (${chainCount} total configured)`);
      console.log('  ✓ Registered circuit: theta-inference');
      console.log(`  ✓ Live EdgeCloud mode: ${modeLabel}`);
      if (apiStatus.edgeCloud.enabled) {
        console.log(`  ✓ EdgeCloud key: ${apiStatus.edgeCloud.keyPrefix}`);
      }
      if (apiStatus.rapidApi.enabled) {
        console.log(`  ✓ RapidAPI key:  ${apiStatus.rapidApi.keyPrefix}`);
      }
      if (apiStatus.onChain.enabled) {
        console.log(`  ✓ On-chain settle: ENABLED (relayer=${apiStatus.onChain.relayer.slice(0, 10)}...)`);
      } else {
        console.log('  ✗ On-chain settle: DISABLED (no relayer key)');
      }
      console.log('');
      console.log('  Waiting for intents... (leave this window open)');
      console.log('═══════════════════════════════════════════════════════════\n');

      // Keep-alive heartbeat every 30 seconds — with failure prediction
      setInterval(() => {
        const status = listener.getStatus();
        const uptime = Math.round(status.metrics.uptimeMs / 1000);
        const hStats = handler.getApiStatus();
        const apiLabel = hStats.mode === 'LIVE' ? 'edgecloud'
          : hStats.mode === 'RAPIDAPI' ? 'rapidapi' : 'mock';
        const apiCalls = hStats.edgeCloud.stats.calls + hStats.rapidApi.stats.calls + hStats.mock.calls;
        const settled = hStats.onChain.stats.settles || 0;
        const completed = hStats.onChain.stats.completes || 0;
        const attested = hStats.onChain.stats.attests || 0;
        const errChains = [];
        for (const [k, v] of listener.chainErrors) {
          errChains.push(`${k}(${v.consecutive})`);
        }
        const errSuffix = errChains.length > 0 ? ` | rpc-errors: ${errChains.join(', ')}` : '';

        // Failure prediction from monitoring stats
        const monStats = handler.getMonitoringStats ? handler.getMonitoringStats(listener) : null;
        const prediction = monStats?.failurePrediction;
        const predSuffix = prediction && prediction.level !== 'low'
          ? ` | RISK=${prediction.level.toUpperCase()}: ${prediction.message}`
          : '';

        console.log(
          `[Heartbeat ${new Date().toLocaleTimeString()}] ` +
          `uptime=${uptime}s | events=${status.metrics.eventsProcessed} | ` +
          `intents=${status.metrics.intentsParsed} | proofs=${status.metrics.proofsGenerated} | ` +
          `api=${apiLabel}(${apiCalls}) | settled=${settled}/${completed} | attested=${attested}` +
          `${errSuffix}${predSuffix}`
        );
      }, 30000);

    } catch (err) {
      console.error('\n  ✗ CoreListener failed to start:', err.message);
      console.error('    Stack:', err.stack);
      process.exit(1);
    }
  })();
}
