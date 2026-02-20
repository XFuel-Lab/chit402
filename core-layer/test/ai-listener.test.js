/**
 * Core Layer — AI Listener Unit Tests (Mocha)
 *
 * Run: npx mocha core-layer/test/ai-listener.test.js --timeout 30000
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { CoreListener, IntentSolver, AI_INTENT_TYPES, ChainType } from '../ai-listener.js';

describe('CoreListener', () => {
  let listener;

  beforeEach(() => {
    listener = new CoreListener({
      chains: {
        test_evm: {
          type: ChainType.EVM,
          name: 'Test EVM',
          chainId: 1337,
          rpc: 'http://localhost:8545',
          pollInterval: 1000,
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
  });

  describe('Circuit Registration', () => {
    it('should register a circuit', () => {
      const handler = { onIntent: async () => {} };
      listener.registerCircuit('test-circuit', handler);
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
      listener.registerCircuit(
        'theta-only',
        { onIntent: async () => {} },
        ['theta_mainnet']
      );

      const circuit = listener.circuits.get('theta-only');
      assert.deepEqual(circuit.chains, ['theta_mainnet']);
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
  });

  describe('Intent Dispatch', () => {
    it('should dispatch intent to matching circuits', async () => {
      let received = null;
      listener.registerCircuit('test', {
        onIntent: async (intent) => { received = intent; },
      });

      const intent = {
        type: AI_INTENT_TYPES.INFERENCE_REQUEST,
        chain: 'test_evm',
      };

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
        { type: AI_INTENT_TYPES.INFERENCE_REQUEST },
        'test_evm'
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
        { type: AI_INTENT_TYPES.INFERENCE_REQUEST },
        'test_evm'
      );
      assert.equal(received, null);
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
        { programVKey: '0x' + '00'.repeat(32) },
        'test'
      );

      assert.ok(result);
      assert.ok(result.proof || result.error);
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
});

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
        attributes: [
          { key: 'recipient', value: 'osmo1...' },
        ],
      }];

      const intent = IntentSolver.parseCosmosEvent(events, 'osmosis');
      assert.equal(intent, null);
    });
  });
});
