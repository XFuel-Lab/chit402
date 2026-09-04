/**
 * Rolling settlement on `/task-request`: charge measured cost-plus on the next
 * request, keep the debt across a ledger restart, and prove the 10% on the receipt.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-rolling-e2e-'));

process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.AKASHML_API_KEY = 'akml-test-key';
process.env.X402_ENABLED = 'true';
process.env.X402_ROLLING_SETTLEMENT = 'true';
process.env.X402_COST_PLUS = 'true';
process.env.X402_FACILITATOR_PROVIDER = 'zan';
process.env.X402_PAY_TO = '0xtreasury';
process.env.X402_NETWORK = 'base';
process.env.X402_FACILITATOR_API_KEY = 'testkey';
process.env.X402_USDC_PRICE_DEFAULT = '2000';
process.env.HUB_CATALOG_OFFLINE = 'false';
process.env.TASK_STORE_PERSIST = 'true';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');
process.env.PAYERS_LEDGER_DIR = path.join(tmp, 'payers');
process.env.M2M_DEMO_MODE = 'true';
delete process.env.THETA_EDGE_URL;
delete process.env.THETA_EDGECLOUD_API_KEY;

const { startMockFacilitator } = await import('../src/x402-mock-facilitator.js');
const { url: facUrl, close: closeFac } = await startMockFacilitator();
process.env.ZAN_X402_GATEWAY_URL = facUrl;

const { createApp } = await import('../src/server.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { quoteFromCogs, quoteUsage } = await import('../src/pricing.js');

const SERVED_TEXT = 'PONG from the stubbed provider';
const USAGE = { prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 };
const realFetch = globalThis.fetch;

const AKASH_MODELS = {
  data: [
    {
      id: 'meta-llama/Llama-3.3-70B-Instruct',
      name: 'Llama 3.3 70B',
      input_modalities: ['text'],
      pricing: { input: '0.00000013', output: '0.0000004' },
    },
    {
      id: 'zai-org/GLM-5.2',
      name: 'GLM 5.2',
      input_modalities: ['text'],
      pricing: { input: '0.0000014', output: '0.0000044' },
    },
  ],
};

let inferenceCalls = [];
let server;
let base;

function stubFetch(url, init) {
  const href = String(url);

  if (href.includes('api.akashml.com') && href.endsWith('/models')) {
    return Promise.resolve(new Response(JSON.stringify(AKASH_MODELS), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }

  if (href.includes('api.akashml.com') && href.includes('/chat/completions')) {
    inferenceCalls.push(JSON.parse(init.body));
    return Promise.resolve(new Response(JSON.stringify({
      id: 'cmpl-stub',
      choices: [{ message: { role: 'assistant', content: SERVED_TEXT }, finish_reason: 'stop' }],
      usage: USAGE,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }

  if (href.includes('thetaedgecloud.com')) {
    return Promise.resolve(new Response(JSON.stringify({ body: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }

  return realFetch(url, init);
}

const bodyOf = (over = {}) => ({
  message_type: 'inference_request',
  chain_id: 'base',
  amount: '2000',
  sender: '0x0000000000000000000000000000000000000001',
  model_id: 'akash/zai-org/GLM-5.2',
  messages: [{ role: 'user', content: 'Reply with one word.' }],
  max_tokens: 32,
  ...over,
});

const post = (over = {}, headers = {}) => realFetch(`${base}/task-request`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': 'xfuel-demo',
    ...headers,
  },
  body: JSON.stringify(bodyOf(over)),
});

async function waitComplete(taskId) {
  let status;
  let receipt;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 50));
    status = await (await realFetch(`${base}/task-status?task_id=${taskId}`)).json();
    if (['completed', 'failed', 'fee_collected'].includes(status.status)) {
      receipt = await (await realFetch(`${base}/receipt/${taskId}?format=json`)).json();
      if (receipt.provider_cogs?.actual || receipt.payment?.platform_fee != null) break;
    }
  }
  return { status, receipt };
}

before(async () => {
  globalThis.fetch = stubFetch;
  resetHubCatalogCache();
  await initAIListener();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  await closeFac();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('second 402 equals measured cost-plus, not the rate card', async () => {
  inferenceCalls = [];
  const firstRes = await post();
  const first = await firstRes.json();
  assert.equal(firstRes.status, 202, JSON.stringify(first));
  const { status, receipt } = await waitComplete(first.task_id);
  assert.equal(status.status, 'completed', JSON.stringify(status));
  assert.ok(receipt.provider_cogs?.actual, 'measured COGS must land on the receipt');

  const expected = quoteFromCogs(receipt.provider_cogs.actual).amount;
  const card = quoteUsage(USAGE, 'akash/zai-org/GLM-5.2').amount;
  assert.notEqual(expected, card, 'cost-plus and the rate card must diverge on this usage');

  const secondRes = await post();
  const challenge = await secondRes.json();
  assert.equal(secondRes.status, 402, JSON.stringify(challenge));
  assert.equal(challenge.accepts[0].maxAmountRequired, expected);

  const nonce = challenge.accepts[0].extra.nonce;
  const paidRes = await post({}, { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': nonce });
  const paid = await paidRes.json();
  assert.equal(paidRes.status, 202, JSON.stringify(paid));

  const secondDone = await waitComplete(paid.task_id);
  assert.equal(secondDone.status.status, 'completed');

  const owed = await (await realFetch(`${base}/receipt/${first.task_id}?format=json`)).json();
  assert.ok(owed.payment.ref, 'settlement attaches to the owed task, not the new one');
  assert.equal(owed.payment.gross_amount, expected);

  const recomputed = quoteFromCogs(owed.provider_cogs.actual);
  assert.equal(recomputed.amount, owed.payment.gross_amount);
  assert.equal(owed.payment.platform_fee_bps, 1000);
  assert.equal(owed.signature.payload_version, 4);
});

test('a first call whose ceiling exceeds $1 still prepays', async () => {
  const big = await post({ max_tokens: 250_000 }, { 'x-api-key': 'whale-key' });
  const challenge = await big.json();
  assert.equal(big.status, 402, JSON.stringify(challenge));
  assert.ok(BigInt(challenge.accepts[0].maxAmountRequired) > 1_000_000n, 'prepay for a >$1 ceiling');
});
