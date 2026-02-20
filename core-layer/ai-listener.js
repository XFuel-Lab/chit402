/**
 * XFuel Core Layer — Multi-RPC AI Event Listener & Intent Solver
 *
 * Ecosystem-agnostic event polling for EVM and Cosmos chains with pluggable
 * circuit architecture. Extends the existing ai-listener.js with:
 *   - Configurable multi-chain RPC registry (add any EVM or Cosmos endpoint)
 *   - Intent solver: parses AI task intents ("route inference", "compute bid", etc.)
 *   - ZKVerifier hooks: triggers SP1 proof generation on task completion
 *   - Regenerable proof handling: auto-retries on latency >10s
 *   - Circuit isolation: each circuit receives events via its own handler
 *
 * Research ties:
 *   Per SP1 docs v5.x (2026): ~9s proving time, batch 11.6x speedup.
 *   Per Theta Metachain docs: 1-2s finality, TFUEL gas on all subchains.
 *   Per Bittensor EVM docs: Chain ID 964, RPC lite.chain.opentensor.ai.
 *   Per CosmWasm docs: IBC-native cross-chain messaging, CW20-ICS20 transfers.
 *
 * Usage:
 *   import { CoreListener } from './ai-listener.js';
 *   const listener = new CoreListener(config);
 *   listener.registerCircuit('my-circuit', myHandler);
 *   await listener.start();
 */

import { ethers } from 'ethers';

// ─── Chain Type Enum ──────────────────────────────────────────────────────────

const ChainType = Object.freeze({
  EVM: 'evm',
  COSMOS: 'cosmos',
});

// ─── Default Chain Registry ───────────────────────────────────────────────────
// Configurable — add any project's RPC to integrate with the Core Layer.

const DEFAULT_CHAINS = {
  theta_mainnet: {
    type: ChainType.EVM,
    name: 'Theta Mainnet',
    chainId: 361,
    rpc: 'https://eth-rpc-api.thetatoken.org/rpc',
    blockTime: 6000, // ~6s per Theta docs
    pollInterval: 2000,
  },
  theta_testnet: {
    type: ChainType.EVM,
    name: 'Theta Testnet',
    chainId: 365,
    rpc: 'https://eth-rpc-api-testnet.thetatoken.org/rpc',
    blockTime: 6000,
    pollInterval: 2000,
  },
  bittensor: {
    type: ChainType.EVM,
    name: 'Bittensor EVM',
    chainId: 964,
    rpc: 'https://lite.chain.opentensor.ai',
    blockTime: 12000,
    pollInterval: 5000,
  },
  osmosis: {
    type: ChainType.COSMOS,
    name: 'Osmosis',
    rpc: 'https://rpc.osmosis.zone',
    ws: 'wss://rpc.osmosis.zone/websocket',
    pollInterval: 6000,
  },
  akash: {
    type: ChainType.COSMOS,
    name: 'Akash Network',
    rpc: 'https://rpc.akash.forbole.com',
    ws: 'wss://rpc.akash.forbole.com/websocket',
    pollInterval: 6000,
  },
};

// ─── AI Intent Types ──────────────────────────────────────────────────────────

const AI_INTENT_TYPES = Object.freeze({
  COMPUTE_BID: 'compute_bid',
  COMPUTE_RESULT: 'compute_result',
  INFERENCE_REQUEST: 'inference_request',
  CAPABILITY_QUERY: 'capability_query',
  DATA_ATTESTATION: 'data_attestation',
  CIRCUIT_REGISTER: 'circuit_register',
});

// ─── Intent Solver ────────────────────────────────────────────────────────────

/**
 * Parse and classify raw on-chain events into structured AI intents.
 * Supports both EVM event logs and Cosmos transaction events.
 */
class IntentSolver {
  /**
   * Parse an EVM event log into an AI intent.
   * @param {Object} log - ethers.js Log object.
   * @param {Object} iface - ethers.js Interface for decoding.
   * @returns {Object|null} Parsed intent or null.
   */
  static parseEVMEvent(log, iface) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) return null;

      // Map known event names to intent types
      const eventToIntent = {
        TaskRouted: AI_INTENT_TYPES.INFERENCE_REQUEST,
        ComputeBidSubmitted: AI_INTENT_TYPES.COMPUTE_BID,
        ComputeResultAttested: AI_INTENT_TYPES.COMPUTE_RESULT,
        DataAttestationSubmitted: AI_INTENT_TYPES.DATA_ATTESTATION,
        CapabilityQuerySubmitted: AI_INTENT_TYPES.CAPABILITY_QUERY,
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
   * @param {Array} events - Cosmos SDK transaction events.
   * @param {string} chain - Chain identifier.
   * @returns {Object|null} Parsed intent or null.
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
}

// ─── Core Listener ────────────────────────────────────────────────────────────

/**
 * Multi-RPC event listener with pluggable circuit handlers.
 *
 * Architecture:
 *   CoreListener polls registered chains for events, parses them via IntentSolver,
 *   and dispatches to registered circuit handlers. Each circuit receives only the
 *   events it subscribed to, maintaining full isolation.
 *
 *   CoreListener → IntentSolver → Circuit Handler → ZK Proof → Settlement
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

    // Provider cache (chainKey => ethers.JsonRpcProvider)
    this.providers = new Map();

    // Circuit registry (circuitId => { handler, chains, eventFilter })
    this.circuits = new Map();

    // Polling state
    this.isRunning = false;
    this.pollTimers = new Map();
    this.lastBlocks = new Map();

    // Processed events (dedup)
    this.processedEvents = new Set();
    this.maxProcessedCache = 10000;

    // Metrics
    this.metrics = {
      eventsProcessed: 0,
      intentsParsed: 0,
      proofsGenerated: 0,
      proofsFailed: 0,
      proofRetries: 0,
      startedAt: null,
    };
  }

  // ─── Circuit Registration ─────────────────────────────────────────────────

  /**
   * Register a circuit module to receive events.
   * @param {string} circuitId - Unique circuit identifier.
   * @param {Object} handler - Circuit handler object.
   * @param {Function} handler.onIntent - Called with parsed intents.
   * @param {Function} [handler.onProofReady] - Called when SP1 proof is ready.
   * @param {string[]} [chains] - Chain keys to listen on (default: all).
   * @param {string[]} [intentTypes] - Intent types to receive (default: all).
   */
  registerCircuit(circuitId, handler, chains = null, intentTypes = null) {
    this.circuits.set(circuitId, {
      handler,
      chains: chains || Object.keys(this.chains),
      intentTypes: intentTypes || Object.values(AI_INTENT_TYPES),
    });
    this.log.info?.(`Circuit registered: ${circuitId}`) ||
      console.log(`[CoreListener] Circuit registered: ${circuitId}`);
  }

  /**
   * Remove a circuit from the registry.
   */
  unregisterCircuit(circuitId) {
    this.circuits.delete(circuitId);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start polling all registered chains.
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.metrics.startedAt = Date.now();

    // Initialize providers for EVM chains
    for (const [key, chain] of Object.entries(this.chains)) {
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
      }
    }

    // Start polling loops
    for (const [key, chain] of Object.entries(this.chains)) {
      const interval = chain.pollInterval || 5000;
      const timer = setInterval(() => this._pollChain(key), interval);
      this.pollTimers.set(key, timer);
    }

    this.log.info?.('CoreListener started') ||
      console.log('[CoreListener] Started polling all chains');
  }

  /**
   * Stop all polling and clean up.
   */
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
      }
    } catch (err) {
      this.log.error?.({ err, chain: chainKey }, 'Poll error') ||
        console.error(`[CoreListener] Poll error on ${chainKey}:`, err.message);
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

    // Get contract addresses for this chain
    const contractAddrs = this.contracts[chainKey] || [];

    if (contractAddrs.length === 0) {
      // No contracts configured — just track block height
      this.lastBlocks.set(chainKey, currentBlock);
      return;
    }

    // Fetch logs from all registered contracts
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

          // Parse intent
          let intent = null;
          if (contractCfg.iface) {
            intent = IntentSolver.parseEVMEvent(log, contractCfg.iface);
          }

          if (intent) {
            this.metrics.intentsParsed++;
            intent.chain = chainKey;
            await this._dispatchIntent(intent, chainKey);
          }
        }
      } catch (err) {
        this.log.error?.({ err, contract: contractCfg.address }, 'EVM log fetch error') ||
          console.error(`[CoreListener] Log fetch error:`, err.message);
      }
    }

    this.lastBlocks.set(chainKey, currentBlock);
  }

  /**
   * Poll a Cosmos chain for new transaction events via RPC.
   * In production, prefer WebSocket subscription (see existing ai-listener.js).
   */
  async _pollCosmos(chainKey, chain) {
    // Cosmos polling stub — in production, use @cosmjs/stargate or WebSocket.
    // The existing ai-listener.js handles Osmosis/Akash WebSocket connections.
    // This stub provides the multi-chain framework; plug in CosmJS for each chain.
  }

  // ─── Intent Dispatch ──────────────────────────────────────────────────────

  /**
   * Dispatch a parsed intent to all registered circuits that want it.
   */
  async _dispatchIntent(intent, chainKey) {
    for (const [circuitId, circuit] of this.circuits) {
      // Check if circuit listens on this chain
      if (!circuit.chains.includes(chainKey)) continue;

      // Check if circuit wants this intent type
      if (!circuit.intentTypes.includes(intent.type)) continue;

      try {
        await circuit.handler.onIntent(intent, {
          chain: chainKey,
          circuitId,
          generateProof: (proofReq) => this._generateProof(proofReq, circuitId),
        });
      } catch (err) {
        this.log.error?.({ err, circuitId, intent: intent.type }, 'Circuit handler error') ||
          console.error(`[CoreListener] Circuit ${circuitId} error:`, err.message);
      }
    }
  }

  // ─── SP1 Proof Hooks ──────────────────────────────────────────────────────

  /**
   * Generate an SP1 ZK proof for a completed task.
   * Includes auto-retry on latency >10s (regenerable proof handling).
   *
   * @param {Object} proofRequest - Proof generation parameters.
   * @param {string} circuitId - Requesting circuit.
   * @returns {Object} Proof result { proof, publicValues, nullifier, provingTimeMs }.
   */
  async _generateProof(proofRequest, circuitId) {
    const MAX_RETRIES = 3;
    const LATENCY_THRESHOLD_MS = 10000; // 10s — per SP1 docs, target <1s for optimized

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const startTime = Date.now();

      try {
        // Call SP1 prover (mock or real)
        const result = await this._callSP1Prover(proofRequest);
        const elapsed = Date.now() - startTime;

        result.provingTimeMs = elapsed;
        this.metrics.proofsGenerated++;

        // If latency is too high and we have retries left, regenerate
        if (elapsed > LATENCY_THRESHOLD_MS && attempt < MAX_RETRIES) {
          this.log.warn?.({
            circuitId,
            elapsed,
            attempt,
          }, 'Proof latency >10s — regenerating');
          this.metrics.proofRetries++;
          continue;
        }

        // Notify circuit handler
        const circuit = this.circuits.get(circuitId);
        if (circuit?.handler?.onProofReady) {
          await circuit.handler.onProofReady(result, proofRequest);
        }

        return result;
      } catch (err) {
        this.metrics.proofsFailed++;
        this.log.error?.({ err, circuitId, attempt }, 'Proof generation failed');

        if (attempt === MAX_RETRIES) {
          return {
            error: err.message,
            attempt,
            provingTimeMs: Date.now() - startTime,
          };
        }

        // Wait before retry (exponential backoff)
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  /**
   * Call SP1 prover service. Stub — in production, calls sp1-prover-client.js
   * or the hosted prover endpoint.
   */
  async _callSP1Prover(proofRequest) {
    // Mock implementation — returns synthetic proof data.
    // In production, replace with:
    //   const { getSP1Prover } = await import('./sp1-prover-client.js');
    //   return await getSP1Prover().generateProof(proofRequest);

    const mockProof = {
      proof: '0x' + 'ab'.repeat(130), // ~260 bytes Groth16
      publicValues: '0x' + 'cd'.repeat(64),
      nullifier: '0x' + Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join(''),
      programVKey: proofRequest.programVKey || '0x' + '00'.repeat(32),
    };

    // Simulate proving time (~2-9s depending on batch)
    const delay = 2000 + Math.random() * 7000;
    await new Promise((r) => setTimeout(r, delay));

    return mockProof;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _addProcessedEvent(eventId) {
    this.processedEvents.add(eventId);
    if (this.processedEvents.size > this.maxProcessedCache) {
      // Evict oldest entries (Set iterates in insertion order)
      const iter = this.processedEvents.values();
      for (let i = 0; i < this.maxProcessedCache / 2; i++) {
        this.processedEvents.delete(iter.next().value);
      }
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  getStatus() {
    return {
      isRunning: this.isRunning,
      chains: Object.fromEntries(
        Object.entries(this.chains).map(([k, v]) => [k, {
          name: v.name,
          type: v.type,
          lastBlock: this.lastBlocks.get(k) || 0,
          connected: this.providers.has(k),
        }])
      ),
      circuits: Array.from(this.circuits.keys()),
      metrics: {
        ...this.metrics,
        uptimeMs: this.metrics.startedAt ? Date.now() - this.metrics.startedAt : 0,
      },
    };
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
  CoreListener,
  IntentSolver,
  ChainType,
  AI_INTENT_TYPES,
  DEFAULT_CHAINS,
};

export default CoreListener;
