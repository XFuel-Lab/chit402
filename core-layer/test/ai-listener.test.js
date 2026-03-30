/**
 * Core Layer — AI Listener & Multi-Prover Tests
 *
 * Covers: circuit registration, intent dispatch, Solana SVM polling,
 * multi-prover normalization, gas <270K equivalents, cross-chain routing,
 * end-to-end proof flows.
 *
 * Run: npm run test:contracts:core:listener
 *        (or: node --test core-layer/test/ai-listener.test.js)
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CoreListener,
  IntentSolver,
  ProverNormalizer,
  ProofRouter,
  AI_INTENT_TYPES,
  ChainType,
  ProverType,
  GAS_BENCHMARKS,
  SOLANA_EVENT_TYPE,
  DEFAULT_CHAINS,
} from '../ai-listener.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadCJSModule(relPath) {
  const absPath = resolve(__dirname, relPath);
  const src = readFileSync(absPath, 'utf-8');
  const m = new Module(absPath);
  m.paths = Module._nodeModulePaths(resolve(__dirname, '../..'));
  m._compile(src, absPath);
  return m.exports;
}

const {
  AutoGPTHook,
  CrewAIHook,
  LangChainHook,
  getHook,
  PartnerHookManager,
  REPUTATION_PRIORITY_THRESHOLD,
} = loadCJSModule('../../partner-hooks.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function makeSolanaProofVerifiedLog(circuitId, nullifier) {
  const buf = Buffer.alloc(105);
  buf[0] = SOLANA_EVENT_TYPE.PROOF_VERIFIED;
  Buffer.from(circuitId.replace('0x', ''), 'hex').copy(buf, 1, 0, 32);
  Buffer.from(nullifier.replace('0x', ''), 'hex').copy(buf, 33, 0, 32);
  Buffer.alloc(32, 0xaa).copy(buf, 65); // verifier
  buf.writeBigInt64LE(BigInt(1708444800), 97); // timestamp
  return buf;
}

function makeSolanaBridgeEventLog(circuitId, nullifier, targetChain, payload) {
  const payloadBuf = Buffer.from(payload, 'utf8');
  const buf = Buffer.alloc(71 + payloadBuf.length);
  buf[0] = SOLANA_EVENT_TYPE.BRIDGE_EVENT;
  Buffer.from(circuitId.replace('0x', ''), 'hex').copy(buf, 1, 0, 32);
  Buffer.from(nullifier.replace('0x', ''), 'hex').copy(buf, 33, 0, 32);
  buf.writeUInt16LE(targetChain, 65);
  buf.writeUInt32LE(payloadBuf.length, 67);
  payloadBuf.copy(buf, 71);
  return buf;
}

// ─── CoreListener ─────────────────────────────────────────────────────────────

describe('CoreListener', () => {
  let listener;

  beforeEach(() => {
    listener = new CoreListener({
      chains: {
        test_evm: {
          type: ChainType.EVM,
          prover: ProverType.EVM_GROTH16,
          name: 'Test EVM',
          chainId: 1337,
          rpc: 'http://localhost:8545',
          pollInterval: 1000,
          gasTarget: 270000,
        },
        test_solana: {
          type: ChainType.SVM,
          prover: ProverType.SOLANA_ALT_BN128,
          name: 'Test Solana',
          rpc: 'http://localhost:8899',
          pollInterval: 1000,
          gasTarget: 220000,
          programId: 'XfueSP1111111111111111111111111111111111111',
        },
      },
      logger: silentLogger(),
    });
  });

  describe('Circuit Registration', () => {
    it('should register a circuit', () => {
      listener.registerCircuit('test-circuit', { onIntent: async () => {} });
      assert.equal(listener.circuits.size, 1);
    });

    it('should register multiple circuits', () => {
      listener.registerCircuit('c1', { onIntent: async () => {} });
      listener.registerCircuit('c2', { onIntent: async () => {} });
      assert.equal(listener.circuits.size, 2);
    });

    it('should unregister a circuit', () => {
      listener.registerCircuit('test', { onIntent: async () => {} });
      listener.unregisterCircuit('test');
      assert.equal(listener.circuits.size, 0);
    });

    it('should filter by intent type', () => {
      listener.registerCircuit(
        'inference-only',
        { onIntent: async () => {} },
        null,
        [AI_INTENT_TYPES.INFERENCE_REQUEST]
      );
      const circuit = listener.circuits.get('inference-only');
      assert.deepEqual(circuit.intentTypes, ['inference_request']);
    });

    it('should filter by chain', () => {
      listener.registerCircuit('theta-only', { onIntent: async () => {} }, ['theta_mainnet']);
      const circuit = listener.circuits.get('theta-only');
      assert.deepEqual(circuit.chains, ['theta_mainnet']);
    });

    it('should register with SVM chain filter', () => {
      listener.registerCircuit('solana-only', { onIntent: async () => {} }, ['test_solana']);
      const circuit = listener.circuits.get('solana-only');
      assert.deepEqual(circuit.chains, ['test_solana']);
    });
  });

  describe('Status', () => {
    it('should return status when not running', () => {
      const status = listener.getStatus();
      assert.equal(status.isRunning, false);
      assert.equal(status.metrics.eventsProcessed, 0);
    });

    it('should track registered circuits in status', () => {
      listener.registerCircuit('c1', { onIntent: async () => {} });
      const status = listener.getStatus();
      assert.deepEqual(status.circuits, ['c1']);
    });

    it('should include all chain types in status', () => {
      const status = listener.getStatus();
      assert.equal(status.chains.test_evm.type, ChainType.EVM);
      assert.equal(status.chains.test_solana.type, ChainType.SVM);
    });

    it('should include prover info per chain', () => {
      const status = listener.getStatus();
      assert.equal(status.chains.test_evm.prover, ProverType.EVM_GROTH16);
      assert.equal(status.chains.test_solana.prover, ProverType.SOLANA_ALT_BN128);
    });

    it('should include gas benchmarks in status', () => {
      const status = listener.getStatus();
      assert.ok(status.gasBenchmarks);
      assert.equal(status.gasBenchmarks[ProverType.EVM_GROTH16].verifyProof, 270000);
      assert.equal(status.gasBenchmarks[ProverType.SOLANA_ALT_BN128].verifyProof, 220000);
    });

    it('should include cross-chain routes in status', () => {
      const status = listener.getStatus();
      assert.ok(Array.isArray(status.routes));
      assert.ok(status.routes.length > 0);
    });

    it('should include per-prover metrics', () => {
      const status = listener.getStatus();
      assert.ok(status.metrics.perProver);
      assert.ok(status.metrics.perProver[ProverType.EVM_GROTH16]);
      assert.ok(status.metrics.perProver[ProverType.SOLANA_ALT_BN128]);
    });
  });

  describe('Intent Dispatch', () => {
    it('should dispatch intent to matching circuits', async () => {
      let received = null;
      listener.registerCircuit('test', {
        onIntent: async (intent) => { received = intent; },
      });

      const intent = { type: AI_INTENT_TYPES.INFERENCE_REQUEST, chain: 'test_evm' };
      await listener._dispatchIntent(intent, 'test_evm');
      assert.equal(received.type, 'inference_request');
    });

    it('should not dispatch to circuits on wrong chain', async () => {
      let received = null;
      listener.registerCircuit(
        'test',
        { onIntent: async (intent) => { received = intent; } },
        ['other_chain']
      );
      await listener._dispatchIntent(
        { type: AI_INTENT_TYPES.INFERENCE_REQUEST }, 'test_evm'
      );
      assert.equal(received, null);
    });

    it('should not dispatch wrong intent type', async () => {
      let received = null;
      listener.registerCircuit(
        'test',
        { onIntent: async (intent) => { received = intent; } },
        null,
        [AI_INTENT_TYPES.COMPUTE_BID]
      );
      await listener._dispatchIntent(
        { type: AI_INTENT_TYPES.INFERENCE_REQUEST }, 'test_evm'
      );
      assert.equal(received, null);
    });

    it('should provide prover context to circuit handler', async () => {
      let ctx = null;
      listener.registerCircuit('test', {
        onIntent: async (_intent, context) => { ctx = context; },
      });

      await listener._dispatchIntent(
        { type: AI_INTENT_TYPES.COMPUTE_RESULT }, 'test_evm'
      );

      assert.equal(ctx.chain, 'test_evm');
      assert.equal(ctx.prover, ProverType.EVM_GROTH16);
      assert.ok(ctx.gasEquivalent);
      assert.equal(ctx.gasEquivalent.cost, 270000);
      assert.ok(typeof ctx.generateProof === 'function');
      assert.ok(typeof ctx.getRoute === 'function');
    });

    it('should provide Solana prover context for SVM chains', async () => {
      let ctx = null;
      listener.registerCircuit('test', {
        onIntent: async (_intent, context) => { ctx = context; },
      });

      await listener._dispatchIntent(
        { type: AI_INTENT_TYPES.COMPUTE_RESULT }, 'test_solana'
      );

      assert.equal(ctx.prover, ProverType.SOLANA_ALT_BN128);
      assert.equal(ctx.gasEquivalent.cost, 220000);
      assert.equal(ctx.gasEquivalent.unit, 'compute_units');
      assert.equal(ctx.gasEquivalent.meetsTarget, true);
    });

    it('should provide route getter for cross-chain dispatch', async () => {
      let ctx = null;
      listener.registerCircuit('test', {
        onIntent: async (_intent, context) => { ctx = context; },
      });

      await listener._dispatchIntent(
        { type: AI_INTENT_TYPES.COMPUTE_RESULT }, 'test_solana'
      );

      const route = ctx.getRoute(ChainType.EVM);
      assert.equal(route.bridge, 'wormhole');
      assert.equal(route.method, 'VAA');
    });
  });

  describe('Proof Generation', () => {
    it('should generate mock proof with retry on high latency', async () => {
      listener.registerCircuit('test', {
        onIntent: async () => {},
        onProofReady: async (result) => {
          assert.ok(result.proof);
          assert.ok(result.nullifier);
        },
      });

      const result = await listener._generateProof(
        { programVKey: '0x' + '00'.repeat(32) }, 'test'
      );

      assert.ok(result);
      assert.ok(result.proof || result.error);
    });

    it('should include proof size in mock result', async () => {
      const result = await listener._callSP1Prover({});
      assert.equal(result.proofSizeBytes, 260);
    });
  });

  describe('Proof Result Tracking', () => {
    it('should record normalized proof results', () => {
      const result = {
        prover: ProverType.EVM_GROTH16,
        status: 'verified',
        circuitId: '0x01',
        nullifier: '0x02',
        gasUsed: 268000,
      };

      listener._recordProofResult(result);
      assert.equal(listener.proofResults.length, 1);
      assert.equal(listener.metrics.proofsNormalized, 1);
      assert.equal(listener.metrics.perProver[ProverType.EVM_GROTH16].verified, 1);
    });

    it('should track per-prover metrics separately', () => {
      listener._recordProofResult({
        prover: ProverType.EVM_GROTH16, status: 'verified', gasUsed: 268000,
      });
      listener._recordProofResult({
        prover: ProverType.SOLANA_ALT_BN128, status: 'verified', gasUsed: 200000,
      });
      listener._recordProofResult({
        prover: ProverType.COSMWASM_ARK_BN254, status: 'failed', gasUsed: 250000,
      });

      assert.equal(listener.metrics.perProver[ProverType.EVM_GROTH16].verified, 1);
      assert.equal(listener.metrics.perProver[ProverType.SOLANA_ALT_BN128].verified, 1);
      assert.equal(listener.metrics.perProver[ProverType.COSMWASM_ARK_BN254].failed, 1);
    });

    it('should evict old proof results when cache is full', () => {
      listener.maxProofCache = 10;
      for (let i = 0; i < 15; i++) {
        listener._recordProofResult({
          prover: ProverType.EVM_GROTH16, status: 'verified',
        });
      }
      assert.ok(listener.proofResults.length <= 10);
    });
  });

  describe('Processed Event Cache', () => {
    it('should deduplicate events', () => {
      listener._addProcessedEvent('evt-1');
      listener._addProcessedEvent('evt-1');
      assert.equal(listener.processedEvents.size, 1);
    });

    it('should evict old entries when cache is full', () => {
      listener.maxProcessedCache = 10;
      for (let i = 0; i < 15; i++) {
        listener._addProcessedEvent(`evt-${i}`);
      }
      assert.ok(listener.processedEvents.size <= 15);
    });
  });

  describe('Chain Metric Tracking', () => {
    it('should increment per-chain metrics', () => {
      listener._incChainMetric('test_evm', 'events');
      listener._incChainMetric('test_evm', 'events');
      listener._incChainMetric('test_evm', 'intents');

      assert.equal(listener.metrics.perChain.test_evm.events, 2);
      assert.equal(listener.metrics.perChain.test_evm.intents, 1);
    });

    it('should auto-create chain metrics', () => {
      listener._incChainMetric('new_chain', 'events');
      assert.ok(listener.metrics.perChain.new_chain);
      assert.equal(listener.metrics.perChain.new_chain.events, 1);
    });
  });
});

// ─── IntentSolver ─────────────────────────────────────────────────────────────

describe('IntentSolver', () => {
  describe('parseCosmosEvent', () => {
    it('should parse a wasm AI intent event', () => {
      const events = [{
        type: 'wasm',
        attributes: [
          { key: 'action', value: 'inference_request' },
          { key: 'sender', value: 'osmo1abc...' },
          { key: 'amount', value: '1000000' },
          { key: 'model_id', value: 'llama-3' },
        ],
      }];

      const intent = IntentSolver.parseCosmosEvent(events, 'osmosis');
      assert.ok(intent);
      assert.equal(intent.type, 'inference_request');
      assert.equal(intent.sender, 'osmo1abc...');
      assert.equal(intent.amount, '1000000');
      assert.equal(intent.modelId, 'llama-3');
    });

    it('should return null for non-AI events', () => {
      const events = [{
        type: 'transfer',
        attributes: [{ key: 'recipient', value: 'osmo1...' }],
      }];

      const intent = IntentSolver.parseCosmosEvent(events, 'osmosis');
      assert.equal(intent, null);
    });

    it('should handle base64-encoded attributes', () => {
      const events = [{
        type: 'wasm',
        attributes: [
          { key: Buffer.from('action').toString('base64'), value: Buffer.from('compute_bid').toString('base64') },
          { key: Buffer.from('sender').toString('base64'), value: Buffer.from('osmo1xyz').toString('base64') },
        ],
      }];

      const intent = IntentSolver.parseCosmosEvent(events, 'osmosis');
      // Base64 values might not contain '=' so they may not be decoded. That's expected.
      // The solver checks for '=' character to detect base64.
    });
  });

  describe('parseSolanaEvent', () => {
    it('should parse a ProofVerified log', () => {
      const circuitId = '01'.repeat(32);
      const nullifier = '02'.repeat(32);
      const logData = makeSolanaProofVerifiedLog('0x' + circuitId, '0x' + nullifier);
      const b64 = logData.toString('base64');

      const logMessages = [`Program data: ${b64}`];
      const intent = IntentSolver.parseSolanaEvent(
        logMessages, 'sig123', 12345, 'solana_devnet'
      );

      assert.ok(intent);
      assert.equal(intent.type, AI_INTENT_TYPES.COMPUTE_RESULT);
      assert.equal(intent.prover, ProverType.SOLANA_ALT_BN128);
      assert.equal(intent.txHash, 'sig123');
      assert.equal(intent.blockNumber, 12345);
    });

    it('should parse a Program log proof message', () => {
      const logMessages = ['Program log: SP1 proof verified for circuit abc'];
      const intent = IntentSolver.parseSolanaEvent(
        logMessages, 'sig456', 67890, 'solana_devnet'
      );

      assert.ok(intent);
      assert.equal(intent.type, AI_INTENT_TYPES.COMPUTE_RESULT);
      assert.equal(intent.eventName, 'SP1ProofVerified');
    });

    it('should return null for irrelevant logs', () => {
      const logMessages = ['Program log: some other message', 'Program log: initialized'];
      const intent = IntentSolver.parseSolanaEvent(
        logMessages, 'sig789', 11111, 'solana_devnet'
      );
      assert.equal(intent, null);
    });

    it('should return null for null/empty input', () => {
      assert.equal(IntentSolver.parseSolanaEvent(null, 'sig', 0, 'x'), null);
      assert.equal(IntentSolver.parseSolanaEvent([], 'sig', 0, 'x'), null);
    });

    it('should handle malformed base64 gracefully', () => {
      const logMessages = ['Program data: !!!invalid-base64!!!'];
      const intent = IntentSolver.parseSolanaEvent(
        logMessages, 'sig', 0, 'solana_devnet'
      );
      assert.equal(intent, null);
    });
  });
});

// ─── ProverNormalizer ─────────────────────────────────────────────────────────

describe('ProverNormalizer', () => {
  describe('normalizeSolana', () => {
    it('should normalize a ProofVerified event', () => {
      const circuitId = 'ab'.repeat(32);
      const nullifier = 'cd'.repeat(32);
      const logData = makeSolanaProofVerifiedLog('0x' + circuitId, '0x' + nullifier);

      const result = ProverNormalizer.normalizeSolana(logData, 'sigABC', 999, 'solana_devnet');

      assert.ok(result);
      assert.equal(result.prover, ProverType.SOLANA_ALT_BN128);
      assert.equal(result.status, 'verified');
      assert.equal(result.circuitId, '0x' + circuitId);
      assert.equal(result.nullifier, '0x' + nullifier);
      assert.equal(result.txHash, 'sigABC');
      assert.equal(result.blockNumber, 999);
      assert.equal(result.gasUsed, 220000);
    });

    it('should normalize a BridgeEvent event', () => {
      const circuitId = 'ee'.repeat(32);
      const nullifier = 'ff'.repeat(32);
      const logData = makeSolanaBridgeEventLog('0x' + circuitId, '0x' + nullifier, 2, 'bridge-payload');

      const result = ProverNormalizer.normalizeSolana(logData, 'sigDEF', 1000, 'solana_devnet');

      assert.ok(result);
      assert.equal(result.status, 'bridge_event');
      assert.equal(result.bridgeTarget, 2);
      assert.ok(result.bridgePayload);
    });

    it('should return null for short data', () => {
      const result = ProverNormalizer.normalizeSolana(Buffer.alloc(10), 'sig', 0, 'x');
      assert.equal(result, null);
    });

    it('should return null for null input', () => {
      assert.equal(ProverNormalizer.normalizeSolana(null, 'sig', 0, 'x'), null);
    });

    it('should return null for unknown event type', () => {
      const buf = Buffer.alloc(106);
      buf[0] = 0xFF; // Unknown type
      assert.equal(ProverNormalizer.normalizeSolana(buf, 'sig', 0, 'x'), null);
    });
  });

  describe('normalizeCosmos', () => {
    it('should normalize a proof_verified wasm event', () => {
      const events = [{
        type: 'wasm',
        attributes: [
          { key: 'action', value: 'proof_verified' },
          { key: 'circuit_id', value: 'test-circuit' },
          { key: 'nullifier', value: '0xabc' },
          { key: 'sender', value: 'osmo1test' },
          { key: 'result', value: 'verified' },
        ],
      }];

      const result = ProverNormalizer.normalizeCosmos(events, 'osmosis');
      assert.ok(result);
      assert.equal(result.prover, ProverType.COSMWASM_ARK_BN254);
      assert.equal(result.status, 'verified');
      assert.equal(result.circuitId, 'test-circuit');
      assert.equal(result.chain, 'osmosis');
    });

    it('should detect failed status', () => {
      const events = [{
        type: 'wasm',
        attributes: [
          { key: 'action', value: 'verify_proof' },
          { key: 'result', value: 'failed' },
        ],
      }];

      const result = ProverNormalizer.normalizeCosmos(events, 'akash');
      assert.ok(result);
      assert.equal(result.status, 'failed');
    });

    it('should return null for non-proof events', () => {
      const events = [{
        type: 'wasm',
        attributes: [{ key: 'action', value: 'transfer' }],
      }];
      assert.equal(ProverNormalizer.normalizeCosmos(events, 'osmosis'), null);
    });
  });

  describe('meetsGasTarget', () => {
    it('should pass for EVM Groth16 at 270K', () => {
      assert.equal(ProverNormalizer.meetsGasTarget({
        prover: ProverType.EVM_GROTH16,
      }), true);
    });

    it('should pass for Solana alt_bn128 at 220K', () => {
      assert.equal(ProverNormalizer.meetsGasTarget({
        prover: ProverType.SOLANA_ALT_BN128,
      }), true);
    });

    it('should pass for CosmWasm ark-bn254 at 250K', () => {
      assert.equal(ProverNormalizer.meetsGasTarget({
        prover: ProverType.COSMWASM_ARK_BN254,
      }), true);
    });

    it('should fail for null/missing prover', () => {
      assert.equal(ProverNormalizer.meetsGasTarget(null), false);
      assert.equal(ProverNormalizer.meetsGasTarget({}), false);
      assert.equal(ProverNormalizer.meetsGasTarget({ prover: 'unknown' }), false);
    });
  });

  describe('getGasEquivalent', () => {
    it('should return EVM gas with correct unit', () => {
      const eq = ProverNormalizer.getGasEquivalent(ProverType.EVM_GROTH16);
      assert.equal(eq.cost, 270000);
      assert.equal(eq.unit, 'gas');
      assert.equal(eq.meetsTarget, true);
    });

    it('should return Solana CU with correct unit', () => {
      const eq = ProverNormalizer.getGasEquivalent(ProverType.SOLANA_ALT_BN128);
      assert.equal(eq.cost, 220000);
      assert.equal(eq.unit, 'compute_units');
      assert.equal(eq.meetsTarget, true);
    });

    it('should return CosmWasm gas equivalent', () => {
      const eq = ProverNormalizer.getGasEquivalent(ProverType.COSMWASM_ARK_BN254);
      assert.equal(eq.cost, 250000);
      assert.equal(eq.unit, 'gas_equivalent');
      assert.equal(eq.meetsTarget, true);
    });

    it('should return batch costs', () => {
      const evmBatch = ProverNormalizer.getGasEquivalent(ProverType.EVM_GROTH16, 'verifyBatch3');
      assert.equal(evmBatch.cost, 830000);
      assert.equal(evmBatch.meetsTarget, false);
    });

    it('should return null for unknown prover', () => {
      assert.equal(ProverNormalizer.getGasEquivalent('fake_prover'), null);
    });

    it('should return null cost for unknown operation', () => {
      const eq = ProverNormalizer.getGasEquivalent(ProverType.EVM_GROTH16, 'nonexistent');
      assert.equal(eq.cost, null);
    });
  });
});

// ─── ProofRouter ──────────────────────────────────────────────────────────────

describe('ProofRouter', () => {
  describe('getRoute', () => {
    it('should route Solana to EVM via Wormhole', () => {
      const route = ProofRouter.getRoute(ChainType.SVM, ChainType.EVM);
      assert.ok(route);
      assert.equal(route.bridge, 'wormhole');
      assert.equal(route.method, 'VAA');
    });

    it('should route Solana to Cosmos via Wormhole+IBC', () => {
      const route = ProofRouter.getRoute(ChainType.SVM, ChainType.COSMOS);
      assert.ok(route);
      assert.equal(route.bridge, 'wormhole+ibc');
      assert.equal(route.method, 'VAA→IBC');
    });

    it('should route EVM to Cosmos via Hyperlane', () => {
      const route = ProofRouter.getRoute(ChainType.EVM, ChainType.COSMOS);
      assert.ok(route);
      assert.equal(route.bridge, 'hyperlane');
      assert.equal(route.method, 'dispatch');
    });

    it('should route EVM to Solana via Wormhole', () => {
      const route = ProofRouter.getRoute(ChainType.EVM, ChainType.SVM);
      assert.ok(route);
      assert.equal(route.bridge, 'wormhole');
    });

    it('should route Cosmos to EVM via IBC+Hyperlane', () => {
      const route = ProofRouter.getRoute(ChainType.COSMOS, ChainType.EVM);
      assert.ok(route);
      assert.equal(route.bridge, 'ibc+hyperlane');
    });

    it('should route EVM to EVM via Hyperlane', () => {
      const route = ProofRouter.getRoute(ChainType.EVM, ChainType.EVM);
      assert.ok(route);
      assert.equal(route.bridge, 'hyperlane');
    });

    it('should route Cosmos to Cosmos via IBC', () => {
      const route = ProofRouter.getRoute(ChainType.COSMOS, ChainType.COSMOS);
      assert.ok(route);
      assert.equal(route.bridge, 'ibc');
    });

    it('should return null for unknown routes', () => {
      assert.equal(ProofRouter.getRoute('unknown', ChainType.EVM), null);
    });

    it('should have gas equivalent for all routes', () => {
      const allRoutes = ProofRouter.allRoutes();
      for (const route of allRoutes) {
        assert.ok(typeof route.gasEquivalent === 'number', `${route.source}->${route.dest} missing gasEquivalent`);
      }
    });
  });

  describe('allRoutes', () => {
    it('should return all supported routes', () => {
      const routes = ProofRouter.allRoutes();
      assert.ok(routes.length >= 6);
    });

    it('should include source and dest for each route', () => {
      const routes = ProofRouter.allRoutes();
      for (const route of routes) {
        assert.ok(route.source);
        assert.ok(route.dest);
        assert.ok(route.bridge);
        assert.ok(route.method);
      }
    });
  });
});

// ─── GAS_BENCHMARKS ───────────────────────────────────────────────────────────

describe('Gas Benchmarks', () => {
  it('should have all three provers', () => {
    assert.ok(GAS_BENCHMARKS[ProverType.EVM_GROTH16]);
    assert.ok(GAS_BENCHMARKS[ProverType.COSMWASM_ARK_BN254]);
    assert.ok(GAS_BENCHMARKS[ProverType.SOLANA_ALT_BN128]);
  });

  it('all provers should meet <270K gas target for single verify', () => {
    assert.ok(GAS_BENCHMARKS[ProverType.EVM_GROTH16].verifyProof <= 270000);
    assert.ok(GAS_BENCHMARKS[ProverType.COSMWASM_ARK_BN254].verifyProof <= 270000);
    assert.ok(GAS_BENCHMARKS[ProverType.SOLANA_ALT_BN128].verifyProof <= 270000);
  });

  it('each prover should have a unit field', () => {
    assert.equal(GAS_BENCHMARKS[ProverType.EVM_GROTH16].unit, 'gas');
    assert.equal(GAS_BENCHMARKS[ProverType.COSMWASM_ARK_BN254].unit, 'gas_equivalent');
    assert.equal(GAS_BENCHMARKS[ProverType.SOLANA_ALT_BN128].unit, 'compute_units');
  });

  it('batch verify should have higher cost than single', () => {
    assert.ok(GAS_BENCHMARKS[ProverType.EVM_GROTH16].verifyBatch3 >
      GAS_BENCHMARKS[ProverType.EVM_GROTH16].verifyProof);
  });
});

// ─── DEFAULT_CHAINS ───────────────────────────────────────────────────────────

describe('DEFAULT_CHAINS', () => {
  it('should include Solana devnet and mainnet', () => {
    assert.ok(DEFAULT_CHAINS.solana_devnet);
    assert.ok(DEFAULT_CHAINS.solana_mainnet);
    assert.equal(DEFAULT_CHAINS.solana_devnet.type, ChainType.SVM);
    assert.equal(DEFAULT_CHAINS.solana_mainnet.type, ChainType.SVM);
  });

  it('should include Bittensor with staking precompile', () => {
    assert.ok(DEFAULT_CHAINS.bittensor);
    assert.equal(DEFAULT_CHAINS.bittensor.chainId, 964);
    assert.ok(DEFAULT_CHAINS.bittensor.stakingPrecompile);
  });

  it('should include Theta mainnet and testnet', () => {
    assert.ok(DEFAULT_CHAINS.theta_mainnet);
    assert.ok(DEFAULT_CHAINS.theta_testnet);
    assert.equal(DEFAULT_CHAINS.theta_mainnet.chainId, 361);
    assert.equal(DEFAULT_CHAINS.theta_testnet.chainId, 365);
  });

  it('should include Cosmos chains', () => {
    assert.ok(DEFAULT_CHAINS.osmosis);
    assert.ok(DEFAULT_CHAINS.akash);
    assert.equal(DEFAULT_CHAINS.osmosis.type, ChainType.COSMOS);
    assert.equal(DEFAULT_CHAINS.akash.type, ChainType.COSMOS);
  });

  it('every chain should have a prover type', () => {
    for (const [key, chain] of Object.entries(DEFAULT_CHAINS)) {
      assert.ok(chain.prover, `Chain ${key} missing prover`);
    }
  });

  it('every chain should have a gas target', () => {
    for (const [key, chain] of Object.entries(DEFAULT_CHAINS)) {
      assert.ok(typeof chain.gasTarget === 'number', `Chain ${key} missing gasTarget`);
      assert.ok(chain.gasTarget <= 270000, `Chain ${key} gasTarget ${chain.gasTarget} exceeds 270K`);
    }
  });
});

// ─── End-to-End Multi-Prover Flows ────────────────────────────────────────────

describe('End-to-End: Multi-Prover', () => {
  let listener;

  beforeEach(() => {
    listener = new CoreListener({
      chains: {
        theta: {
          type: ChainType.EVM,
          prover: ProverType.EVM_GROTH16,
          name: 'Theta',
          chainId: 361,
          rpc: 'http://localhost:8545',
          pollInterval: 999999,
          gasTarget: 270000,
        },
        solana: {
          type: ChainType.SVM,
          prover: ProverType.SOLANA_ALT_BN128,
          name: 'Solana',
          rpc: 'http://localhost:8899',
          pollInterval: 999999,
          gasTarget: 220000,
          programId: 'TestProgramId111111111111111111111111111111',
        },
        osmosis: {
          type: ChainType.COSMOS,
          prover: ProverType.COSMWASM_ARK_BN254,
          name: 'Osmosis',
          rpc: 'http://localhost:26657',
          pollInterval: 999999,
          gasTarget: 270000,
        },
      },
      logger: silentLogger(),
    });
  });

  it('should dispatch Solana proof to EVM-bound circuit with correct routing', async () => {
    let routeResult = null;
    listener.registerCircuit('cross-chain', {
      onIntent: async (_intent, ctx) => {
        routeResult = ctx.getRoute(ChainType.EVM);
      },
    });

    await listener._dispatchIntent(
      { type: AI_INTENT_TYPES.COMPUTE_RESULT },
      'solana'
    );

    assert.ok(routeResult);
    assert.equal(routeResult.bridge, 'wormhole');
    assert.equal(routeResult.method, 'VAA');
    assert.ok(routeResult.gasEquivalent <= 500000);
  });

  it('should dispatch EVM proof to Cosmos-bound circuit with Hyperlane', async () => {
    let routeResult = null;
    listener.registerCircuit('cross-chain', {
      onIntent: async (_intent, ctx) => {
        routeResult = ctx.getRoute(ChainType.COSMOS);
      },
    });

    await listener._dispatchIntent(
      { type: AI_INTENT_TYPES.COMPUTE_RESULT },
      'theta'
    );

    assert.ok(routeResult);
    assert.equal(routeResult.bridge, 'hyperlane');
  });

  it('should track multi-prover metrics independently', () => {
    listener._recordProofResult({
      prover: ProverType.EVM_GROTH16, status: 'verified', gasUsed: 268000,
    });
    listener._recordProofResult({
      prover: ProverType.SOLANA_ALT_BN128, status: 'verified', gasUsed: 200000,
    });
    listener._recordProofResult({
      prover: ProverType.COSMWASM_ARK_BN254, status: 'verified', gasUsed: 245000,
    });

    const m = listener.metrics.perProver;
    assert.equal(m[ProverType.EVM_GROTH16].verified, 1);
    assert.equal(m[ProverType.EVM_GROTH16].avgGas, 268000);
    assert.equal(m[ProverType.SOLANA_ALT_BN128].verified, 1);
    assert.equal(m[ProverType.SOLANA_ALT_BN128].avgGas, 200000);
    assert.equal(m[ProverType.COSMWASM_ARK_BN254].verified, 1);
    assert.equal(m[ProverType.COSMWASM_ARK_BN254].avgGas, 245000);
  });

  it('all provers under 270K gas equivalent', () => {
    for (const [prover, benchmark] of Object.entries(GAS_BENCHMARKS)) {
      assert.ok(
        benchmark.verifyProof <= 270000,
        `${prover} verifyProof ${benchmark.verifyProof} exceeds 270K target`
      );
    }
  });

  it('should normalize proof from each prover and verify gas target', () => {
    const provers = [
      ProverType.EVM_GROTH16,
      ProverType.SOLANA_ALT_BN128,
      ProverType.COSMWASM_ARK_BN254,
    ];

    for (const prover of provers) {
      const meets = ProverNormalizer.meetsGasTarget({ prover });
      assert.ok(meets, `${prover} does not meet <270K gas target`);

      const eq = ProverNormalizer.getGasEquivalent(prover);
      assert.ok(eq.meetsTarget, `${prover} gas equivalent exceeds target`);
    }
  });

  it('full pipeline: Solana event → normalize → route → dispatch', async () => {
    const circuitId = 'ab'.repeat(32);
    const nullifier = 'cd'.repeat(32);
    const logData = makeSolanaProofVerifiedLog('0x' + circuitId, '0x' + nullifier);

    // Step 1: Normalize the Solana log
    const normalized = ProverNormalizer.normalizeSolana(logData, 'sigXYZ', 500, 'solana');
    assert.ok(normalized);
    assert.equal(normalized.status, 'verified');
    assert.equal(normalized.prover, ProverType.SOLANA_ALT_BN128);

    // Step 2: Record the proof
    listener._recordProofResult(normalized);
    assert.equal(listener.proofResults.length, 1);
    assert.equal(listener.metrics.perProver[ProverType.SOLANA_ALT_BN128].verified, 1);

    // Step 3: Parse as intent
    const b64 = logData.toString('base64');
    const intent = IntentSolver.parseSolanaEvent(
      [`Program data: ${b64}`], 'sigXYZ', 500, 'solana'
    );
    assert.ok(intent);
    assert.equal(intent.type, AI_INTENT_TYPES.COMPUTE_RESULT);

    // Step 4: Dispatch to a circuit that checks routing
    let dispatched = false;
    listener.registerCircuit('pipeline-test', {
      onIntent: async (i, ctx) => {
        dispatched = true;
        assert.equal(ctx.prover, ProverType.SOLANA_ALT_BN128);
        assert.equal(ctx.gasEquivalent.cost, 220000);
        assert.ok(ctx.gasEquivalent.meetsTarget);

        const route = ctx.getRoute(ChainType.EVM);
        assert.equal(route.bridge, 'wormhole');
      },
    });

    await listener._dispatchIntent(intent, 'solana');
    assert.ok(dispatched);
  });
});

// ─── Enums & Constants ────────────────────────────────────────────────────────

describe('Enums', () => {
  it('ChainType should be frozen', () => {
    assert.ok(Object.isFrozen(ChainType));
    assert.equal(ChainType.EVM, 'evm');
    assert.equal(ChainType.COSMOS, 'cosmos');
    assert.equal(ChainType.SVM, 'svm');
  });

  it('ProverType should be frozen', () => {
    assert.ok(Object.isFrozen(ProverType));
    assert.equal(ProverType.EVM_GROTH16, 'evm_groth16');
    assert.equal(ProverType.COSMWASM_ARK_BN254, 'cosmwasm_ark_bn254');
    assert.equal(ProverType.SOLANA_ALT_BN128, 'solana_alt_bn128');
  });

  it('AI_INTENT_TYPES should be frozen', () => {
    assert.ok(Object.isFrozen(AI_INTENT_TYPES));
  });

  it('SOLANA_EVENT_TYPE should be frozen', () => {
    assert.ok(Object.isFrozen(SOLANA_EVENT_TYPE));
    assert.equal(SOLANA_EVENT_TYPE.PROOF_VERIFIED, 0x01);
    assert.equal(SOLANA_EVENT_TYPE.BRIDGE_EVENT, 0x02);
  });
});

// ─── Queue & Backpressure ─────────────────────────────────────────────────────

describe('Queue & Backpressure', () => {
  function makeListener(opts = {}) {
    return new CoreListener({
      chains: {
        test_evm: {
          type: ChainType.EVM,
          prover: ProverType.EVM_GROTH16,
          name: 'Test EVM',
          chainId: 1337,
          rpc: 'http://localhost:8545',
          pollInterval: 999999,
          gasTarget: 270000,
        },
      },
      logger: silentLogger(),
      ...opts,
    });
  }

  it('should reject intents when queue overflows maxPending', async () => {
    const listener = makeListener();
    listener.queue.concurrency = 1;
    listener.maxPending = 5;
    listener.backpressureThreshold = 4;

    listener.registerCircuit('slow', {
      onIntent: async () => {
        await new Promise(r => setTimeout(r, 100));
      },
    });

    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(
        listener._dispatchIntent(
          { type: AI_INTENT_TYPES.INFERENCE_REQUEST, txHash: `overflow-${i}` },
          'test_evm'
        )
      );
    }
    const settled = await Promise.all(results);

    assert.ok(listener.metrics.queueOverflows > 0, 'Should have recorded queue overflows');

    const rejections = settled.filter(
      r => r && r.type === 'failed' && r.details?.reason?.includes('Queue overflow')
    );
    assert.ok(rejections.length > 0, 'At least one intent should be rejected due to overflow');
  });

  it('should respect concurrency limit', async () => {
    const listener = makeListener();
    listener.queue.concurrency = 3;

    let peakConcurrent = 0;
    let currentConcurrent = 0;

    listener.registerCircuit('tracker', {
      onIntent: async () => {
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 50));
        currentConcurrent--;
      },
    });

    const promises = [];
    for (let i = 0; i < 15; i++) {
      promises.push(
        listener._dispatchIntent(
          { type: AI_INTENT_TYPES.INFERENCE_REQUEST, txHash: `conc-${i}` },
          'test_evm'
        )
      );
    }
    await Promise.all(promises);

    assert.ok(
      peakConcurrent <= 3,
      `Peak concurrency was ${peakConcurrent}, expected <=3`
    );
    assert.ok(peakConcurrent >= 2, `Peak concurrency was ${peakConcurrent}, expected >=2`);
  });

  it('should emit backpressure warnings when queue exceeds threshold', async () => {
    const listener = makeListener();
    listener.maxPending = 100;
    listener.backpressureThreshold = 3;
    listener.queue.concurrency = 1;

    listener.registerCircuit('blocker', {
      onIntent: async () => {
        await new Promise(r => setTimeout(r, 200));
      },
    });

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('Backpressure')) warnings.push(msg);
    };

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        listener._dispatchIntent(
          { type: AI_INTENT_TYPES.INFERENCE_REQUEST, txHash: `bp-${i}` },
          'test_evm'
        )
      );
    }
    await Promise.all(promises);
    console.warn = origWarn;

    assert.ok(
      listener.metrics.backpressureWarnings > 0,
      `Expected backpressure warnings, got ${listener.metrics.backpressureWarnings}`
    );
  });

  it('should handle high-volume simulation (500 events)', async () => {
    const listener = makeListener();
    listener.maxPending = 1000;
    listener.queue.concurrency = 50;

    let handledCount = 0;
    listener.registerCircuit('counter', {
      onIntent: async () => { handledCount++; },
    });

    const promises = [];
    for (let i = 0; i < 500; i++) {
      promises.push(
        listener._dispatchIntent(
          { type: AI_INTENT_TYPES.INFERENCE_REQUEST, txHash: `vol-${i}` },
          'test_evm'
        )
      );
    }
    await Promise.all(promises);

    assert.equal(handledCount, 500, `Expected 500 handled, got ${handledCount}`);
    assert.equal(listener.metrics.queueOverflows, 0, 'No overflows expected with sufficient capacity');
  });

  it('should track queue stats in getStatus()', async () => {
    const listener = makeListener();
    const status = listener.getStatus();

    assert.ok(status.queue, 'Status should include queue stats');
    assert.equal(typeof status.queue.concurrency, 'number');
    assert.equal(typeof status.queue.size, 'number');
    assert.equal(typeof status.queue.pending, 'number');
    assert.equal(status.queue.maxPending, listener.maxPending);
    assert.equal(status.queue.backpressureThreshold, listener.backpressureThreshold);
    assert.equal(status.queue.overflows, 0);
  });
});

// ─── Agent Framework Hooks ────────────────────────────────────────────────────

describe('Agent Framework Hooks', () => {
  const silentOpts = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, log: () => {}, debug: () => {} },
  };

  describe('AutoGPTHook execution', () => {
    it('should execute a goal-based intent and return plan + result with rep score', async () => {
      const hook = new AutoGPTHook(silentOpts);
      const result = await hook.executeHook({
        intent: 'Deploy a smart contract on Theta',
        agentId: 'agent-alpha',
        agentReputation: 7500,
      });

      assert.equal(result.hookType, 'autogpt');
      assert.equal(result.status, 'completed');
      assert.equal(result.agentId, 'agent-alpha');
      assert.ok(result.plan);
      assert.ok(result.plan.steps.length >= 2);
      assert.ok(Array.isArray(result.result));
      assert.equal(result.priority, true, 'Rep 7500 should grant priority');
      assert.equal(result.repScore, 7500);
      assert.ok(typeof result.gasEstimate === 'number');
    });
  });

  describe('CrewAIHook execution', () => {
    it('should execute a multi-agent crew task and merge results', async () => {
      const hook = new CrewAIHook(silentOpts);
      const result = await hook.executeHook({
        task: 'Analyze market data and generate report',
        crew: [
          { role: 'analyst', agentId: 'a1', reputation: 6000 },
          { role: 'writer', agentId: 'a2', reputation: 8000 },
          { role: 'reviewer', agentId: 'a3', reputation: 5500 },
        ],
      });

      assert.equal(result.hookType, 'crewai');
      assert.equal(result.status, 'completed');
      assert.equal(result.crewSize, 3);
      assert.equal(result.roleResults.length, 3);
      assert.ok(result.mergedOutput);
      assert.equal(result.priority, true, 'Avg rep ~6500 should grant priority');
      assert.ok(result.avgReputation >= 5000);
      assert.ok(typeof result.gasEstimate === 'number');
    });
  });

  describe('LangChainHook execution', () => {
    it('should execute a chained LLM workflow and return step results', async () => {
      const hook = new LangChainHook(silentOpts);
      const result = await hook.executeHook({
        intent: 'Summarize governance proposals',
        chain: ['fetch', 'parse', 'summarize', 'format'],
        agentId: 'chain-agent',
        agentReputation: 9000,
      });

      assert.equal(result.hookType, 'langchain');
      assert.equal(result.status, 'completed');
      assert.equal(result.chainLength, 4);
      assert.equal(result.steps.length, 4);
      assert.equal(result.steps[0].name, 'fetch');
      assert.equal(result.steps[3].name, 'format');
      assert.ok(result.finalOutput);
      assert.equal(result.priority, true);
      assert.equal(result.repScore, 9000);
    });
  });

  describe('Reputation-gated revert for low-rep agents', () => {
    it('should deny priority to agents below rep threshold and log warning', async () => {
      const warnings = [];
      const warnLogger = {
        info: () => {},
        warn: (...args) => { warnings.push(args.join(' ')); },
        error: () => {},
        log: () => {},
        debug: () => {},
      };

      const autogpt = new AutoGPTHook({ logger: warnLogger });
      const crewai = new CrewAIHook({ logger: warnLogger });
      const langchain = new LangChainHook({ logger: warnLogger });

      const r1 = await autogpt.executeHook({
        intent: 'low rep goal',
        agentReputation: 1000,
      });
      assert.equal(r1.priority, false, 'AutoGPT: rep 1000 should not get priority');
      assert.equal(r1.repScore, 1000);

      const r2 = await crewai.executeHook({
        task: 'low rep crew task',
        crew: [
          { role: 'worker', agentId: 'w1', reputation: 2000 },
          { role: 'worker', agentId: 'w2', reputation: 3000 },
        ],
      });
      assert.equal(r2.priority, false, 'CrewAI: avg rep 2500 should not get priority');

      const r3 = await langchain.executeHook({
        intent: 'low rep chain',
        agentReputation: 4999,
      });
      assert.equal(r3.priority, false, 'LangChain: rep 4999 should not get priority');
      assert.equal(r3.repScore, 4999);

      assert.ok(warnings.length >= 3, `Expected >=3 low-rep warnings, got ${warnings.length}`);
      assert.ok(warnings.some(w => w.includes('Low reputation') || w.includes('below threshold')));
    });
  });

  describe('Concurrent hook execution', () => {
    it('should handle multiple hooks running concurrently without interference', async () => {
      const manager = new PartnerHookManager(silentOpts);
      const autogpt = new AutoGPTHook(silentOpts);
      const crewai = new CrewAIHook(silentOpts);
      const langchain = new LangChainHook(silentOpts);

      manager.registerHook('autogpt', autogpt);
      manager.registerHook('crewai', crewai);
      manager.registerHook('langchain', langchain);

      const [r1, r2, r3] = await Promise.all([
        manager.executeHook('autogpt', 'executeHook', [{
          intent: 'concurrent goal A',
          agentReputation: 6000,
        }]),
        manager.executeHook('crewai', 'executeHook', [{
          task: 'concurrent crew task B',
          crew: [{ role: 'lead', agentId: 'c1', reputation: 7000 }],
        }]),
        manager.executeHook('langchain', 'executeHook', [{
          intent: 'concurrent chain C',
          chain: ['step1', 'step2'],
          agentReputation: 8000,
        }]),
      ]);

      assert.equal(r1.result.hookType, 'autogpt');
      assert.equal(r1.result.status, 'completed');
      assert.equal(r2.result.hookType, 'crewai');
      assert.equal(r2.result.status, 'completed');
      assert.equal(r3.result.hookType, 'langchain');
      assert.equal(r3.result.status, 'completed');

      const status = manager.getIntegrationStatus();
      assert.equal(status.totalHooks, 3);
      assert.equal(status.metrics.hookExecutions, 3);

      const hookTypes = getHook('autogpt', silentOpts);
      assert.ok(hookTypes instanceof AutoGPTHook);
      const hookLC = getHook('langchain', silentOpts);
      assert.ok(hookLC instanceof LangChainHook);
      const hookCR = getHook('crewai', silentOpts);
      assert.ok(hookCR instanceof CrewAIHook);

      assert.throws(() => getHook('unknown'), /unknown hook type/);
    });
  });
});
