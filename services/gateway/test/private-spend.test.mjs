import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashApiKey, apiKeyFromReq, apiKeyHashFromReq } from '../src/buyer-attr.js';
import { computeUsageStats } from '../src/telemetry.js';
import { privacyOf, buildReceipt } from '../src/receipt.js';

test('hashApiKey: stable sha256 hex; null for empty', () => {
  assert.equal(hashApiKey(null), null);
  assert.equal(hashApiKey(''), null);
  const a = hashApiKey('partner-key-1');
  const b = hashApiKey('partner-key-1');
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(hashApiKey('partner-key-1'), hashApiKey('partner-key-2'));
});

test('apiKeyFromReq: X-API-Key and Bearer', () => {
  assert.equal(apiKeyFromReq({ headers: { 'x-api-key': 'abc' } }), 'abc');
  assert.equal(apiKeyFromReq({ headers: { authorization: 'Bearer xyz' } }), 'xyz');
  assert.equal(apiKeyFromReq({ headers: {} }), null);
});

test('apiKeyHashFromReq matches hashApiKey', () => {
  const req = { headers: { 'x-api-key': 'demo' } };
  assert.equal(apiKeyHashFromReq(req), hashApiKey('demo'));
});

test('computeUsageStats: filters by apiKeyHash for buyer scope', () => {
  const h1 = hashApiKey('buyer-a');
  const h2 = hashApiKey('buyer-b');
  const tasks = [
    { taskId: 't1', status: 'completed', createdAt: Date.now(), intent: { paymentRail: 'usdc', amount: '100' }, feeAmount: '1', netAmount: '99', meta: { apiKeyHash: h1, privateSpend: true, provider: 'openai' } },
    { taskId: 't2', status: 'completed', createdAt: Date.now(), intent: { paymentRail: 'usdc', amount: '200' }, feeAmount: '2', netAmount: '198', meta: { apiKeyHash: h2, provider: 'groq' } },
    { taskId: 't3', status: 'pending', createdAt: Date.now(), intent: { paymentRail: 'tfuel', amount: '50' }, feeAmount: '0', netAmount: '50', meta: { apiKeyHash: h1 } },
  ];
  const network = computeUsageStats(tasks);
  assert.equal(network.scope, 'network');
  assert.equal(network.tasks.total, 3);

  const mine = computeUsageStats(tasks, { apiKeyHash: h1 });
  assert.equal(mine.scope, 'buyer');
  assert.equal(mine.tasks.total, 2);
  assert.equal(mine.tasks.private_spend, 1);
  assert.equal(mine.payments.by_rail.usdc.count, 1);
});

test('privacyOf / buildReceipt: vendor_blind when meta set', () => {
  const task = {
    taskId: 'priv-1',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: { type: 'inference_request', paymentRail: 'usdc', amount: '10000', modelId: 'm' },
    feeAmount: '50',
    netAmount: '9950',
    feeBps: 50,
    meta: { provider: 'pooled', privateSpend: true, privacyMode: 'vendor_blind', chain: 'base' },
    sp1Proof: null,
  };
  assert.equal(privacyOf(task).mode, 'vendor_blind');
  const receipt = buildReceipt(task, { baseUrl: 'https://api.example' });
  assert.equal(receipt.privacy.mode, 'vendor_blind');
  assert.equal(receipt.privacy.trust, 'gateway');
  assert.ok(receipt.links.json.includes('format=json'));
});

test('privacyOf: null when not private spend', () => {
  assert.equal(privacyOf({ meta: {} }), null);
  assert.equal(privacyOf({}), null);
});

test('lineageOf: builds receipt_chain from parent', async () => {
  const { lineageOf } = await import('../src/receipt.js');
  assert.equal(lineageOf({ taskId: 't2', meta: {} }), null);
  const lin = lineageOf({
    taskId: 't2',
    meta: { parentTaskId: 't1', a2aMessageId: 'a2a-1', correlationId: 'sess' },
  });
  assert.equal(lin.parent_task_id, 't1');
  assert.equal(lin.a2a_message_id, 'a2a-1');
  assert.deepEqual(lin.receipt_chain, ['t1', 't2']);
});

test('north_star: paid_tasks_7d and usdc_fees_7d', () => {
  const now = Date.now();
  const tasks = [
    {
      taskId: 'p1',
      status: 'completed',
      createdAt: now - 1000,
      intent: { paymentRail: 'usdc', amount: '1000000' },
      feeAmount: '5000',
      netAmount: '995000',
      meta: {},
    },
    {
      taskId: 'p2',
      status: 'pending',
      createdAt: now - 1000,
      intent: { paymentRail: 'usdc', amount: '1000000' },
      feeAmount: '5000',
      netAmount: '995000',
      meta: {},
    },
    {
      taskId: 'old',
      status: 'completed',
      createdAt: now - 10 * 24 * 3600 * 1000,
      intent: { paymentRail: 'usdc', amount: '1000000' },
      feeAmount: '9999',
      netAmount: '990001',
      meta: {},
    },
  ];
  const s = computeUsageStats(tasks, { now });
  assert.equal(s.north_star.paid_tasks_7d, 1);
  assert.equal(s.north_star.usdc_paid_tasks_7d, 1);
  assert.equal(s.north_star.usdc_fees_7d, '5000');
});

test('buildAuditorExport: redacts content; reports policy', async () => {
  const { buildAuditorExport, buildReceipt } = await import('../src/receipt.js');
  const task = {
    taskId: 'aud-1',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: { type: 'inference_request', paymentRail: 'usdc', amount: '1000000', modelId: 'm', paymentRef: 'base:0xabc' },
    feeAmount: '5000',
    netAmount: '995000',
    feeBps: 50,
    meta: { provider: 'pooled', privateSpend: true, privacyMode: 'vendor_blind', chain: 'base' },
    sp1Proof: null,
    result: { secret_prompt: 'should never appear in auditor export' },
  };
  const receipt = buildReceipt(task, { baseUrl: 'https://api.example' });
  const exp = buildAuditorExport(receipt);
  assert.equal(exp.schema, 'xfuel.auditor_export.v1');
  assert.equal(exp.in_policy, true);
  assert.equal(exp.totals.fee_bps, 50);
  assert.ok(exp.redacted.includes('prompts'));
  assert.ok(!JSON.stringify(exp).includes('should never appear'));
  assert.equal(exp.privacy.mode, 'vendor_blind');
});
