import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComputeRouter, PROVIDER_TAGS } from '../compute-router.js';

const silent = { log() {} };

function tier(tag, available, impl) {
  return { tag, available, execute: impl };
}

test('runs tiers in order and returns first truthy result', async () => {
  const calls = [];
  const router = new ComputeRouter({
    logger: silent,
    tiers: [
      tier('a', true, async () => { calls.push('a'); return null; }),
      tier('b', true, async () => { calls.push('b'); return { ok: 'b' }; }),
      tier('c', true, async () => { calls.push('c'); return { ok: 'c' }; }),
    ],
  });
  const out = await router.route({});
  assert.deepEqual(calls, ['a', 'b'], 'stops after first winner');
  assert.equal(out.source, 'b');
  assert.deepEqual(out.result, { ok: 'b' });
});

test('skips unavailable tiers (e.g. missing API key)', async () => {
  const calls = [];
  const router = new ComputeRouter({
    logger: silent,
    tiers: [
      tier('edgecloud', false, async () => { calls.push('edgecloud'); return { ok: 1 }; }),
      tier('rapidapi', false, async () => { calls.push('rapidapi'); return { ok: 1 }; }),
      tier('akash', true, async () => { calls.push('akash'); return { ok: 'akash' }; }),
    ],
  });
  const out = await router.route({});
  assert.deepEqual(calls, ['akash'], 'only available tier ran');
  assert.equal(out.source, 'akash');
});

test('returns {result:null, source:null} when no tier produces output', async () => {
  const router = new ComputeRouter({
    logger: silent,
    tiers: [
      tier('a', true, async () => null),
      tier('b', false, async () => ({ ok: 1 })),
    ],
  });
  const out = await router.route({});
  assert.equal(out.result, null);
  assert.equal(out.source, null);
});

test('a thrown error is fatal and propagates (no fallthrough)', async () => {
  const calls = [];
  const router = new ComputeRouter({
    logger: silent,
    tiers: [
      tier('a', true, async () => { calls.push('a'); throw new Error('boom'); }),
      tier('b', true, async () => { calls.push('b'); return { ok: 'b' }; }),
    ],
  });
  await assert.rejects(() => router.route({}), /boom/);
  assert.deepEqual(calls, ['a'], 'did not fall through after a throw');
});

test('logs the tier message before attempting', async () => {
  const logs = [];
  const router = new ComputeRouter({
    logger: { log: (m) => logs.push(m) },
    tiers: [
      { tag: 'a', available: true, execute: async () => null },
      { tag: 'b', available: true, log: 'trying b', execute: async () => ({ ok: 1 }) },
    ],
  });
  await router.route({});
  assert.deepEqual(logs, ['trying b']);
});

test('fromHandler builds the canonical 6-tier order with correct availability', async () => {
  const order = [];
  const handler = {
    edgeCloudApiKey: '',                       // tier 1 unavailable
    useRapidApiFallback: true, rapidApiKey: '', // tier 2 unavailable
    useMcpFallback: true, mcpEndpoint: 'http://mcp',
    useAkashFallback: true, akashMnemonic: 'seed',
    useRenderFallback: true, renderApiKey: 'rk',
    useBedrockFallback: true, awsAccessKeyId: 'id', awsSecretAccessKey: 'sk',
    _callEdgeCloud: async () => { order.push('edgecloud'); return null; },
    _callRapidAPI: async () => { order.push('rapidapi'); return null; },
    _callMCP: async () => { order.push('mcp'); return null; },     // returns null -> fallthrough
    _callAkash: async () => { order.push('akash'); return { ok: 'akash' }; },
    _callRender: async () => { order.push('render'); return { ok: 'render' }; },
    _callBedrock: async () => { order.push('bedrock'); return { ok: 'bedrock' }; },
  };
  const router = ComputeRouter.fromHandler(handler, { logger: silent });
  const out = await router.route({ serviceType: 0, requestBody: {}, modelName: 'm', gpuName: 'g' });
  // edgecloud + rapidapi skipped (no key); mcp runs (null) -> akash wins
  assert.deepEqual(order, ['mcp', 'akash']);
  assert.equal(out.source, PROVIDER_TAGS.AKASH);
});
