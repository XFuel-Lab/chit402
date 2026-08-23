import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRail,
  extractPaymentNonce,
  extractPaymentHeader,
  priceUSDC,
  runX402Handshake,
} from '../src/x402-server.js';
import { startMockFacilitator } from '../src/x402-mock-facilitator.js';
import { WebhookDispatcher } from '../src/webhooks.js';

// cfg override so the loop runs against the mock facilitator without env coupling.
function cfgFor(url, over = {}) {
  return {
    enabled: true,
    defaultRail: 'usdc',
    fallbackToTfuel: true,
    gatewayUrl: url,
    apiKey: 'testkey',
    payTo: '0xtreasury',
    network: 'base',
    asset: 'USDC',
    challengeTtlMs: 120000,
    usdcPriceDefault: '50000',
    usdcPrices: {},
    ...over,
  };
}

test('resolveRail: cfg default, explicit usdc/tfuel', () => {
  assert.equal(resolveRail({}, { defaultRail: 'usdc' }), 'usdc');
  assert.equal(resolveRail({}, { defaultRail: 'tfuel' }), 'tfuel');
  assert.equal(resolveRail({ payment: { rail: 'tfuel' } }, { defaultRail: 'usdc' }), 'tfuel');
  assert.equal(resolveRail({ payment: { rail: 'usdc' } }, { defaultRail: 'tfuel' }), 'usdc');
});

test('priceUSDC: hand-set model price wins, otherwise the floor', () => {
  const cfg = { usdcPriceDefault: '50000', usdcPrices: { 'llama-3-70b': '90000' } };
  assert.equal(priceUSDC({ model_id: 'llama-3-70b' }, cfg), '90000');
  // Nothing to meter on a bare request, so the floor is the price.
  assert.equal(priceUSDC({ model_id: 'unknown' }, cfg), '50000');
});

test('priceUSDC: the buyer cannot name the price with payment.maxAmount', () => {
  // This used to return the buyer's own figure verbatim, so a 68k-token job
  // could be settled for one base unit. maxAmount is a ceiling they choose to
  // meet or decline ? never an instruction to us.
  const cfg = { usdcPriceDefault: '10000' };
  assert.equal(priceUSDC({ payment: { maxAmount: '1' } }, cfg), '10000');
  assert.equal(priceUSDC({ payment: { maxAmount: '999999999' } }, cfg), '10000');
});

test('priceUSDC: a large prompt is priced above the floor, a ping is not', () => {
  const cfg = { usdcPriceDefault: '10000' };
  // ~68k prompt tokens (the measured median agent call) at the default card.
  const agent = priceUSDC(
    { messages: [{ role: 'user', content: 'x'.repeat(272_000) }], max_tokens: 250 },
    cfg,
  );
  assert.ok(Number(agent) > 20_000, `median agent call should clear $0.02, got ${agent}`);

  const ping = priceUSDC({ messages: [{ role: 'user', content: 'hello' }], max_tokens: 16 }, cfg);
  assert.equal(ping, '10000', 'a ping falls back to the floor');
});

test('settled gross cannot be restated by the paid retry (receipt integrity)', async () => {
  // The exploit this guards: the buyer pays a $0.01 challenge, then declares a
  // $1.00 `amount` on the retry and mints a signed receipt claiming $1.00 gross.
  // Gross must come from the challenge the payment was bound to. See
  // docs/KNOWN_ISSUES.md ? our own flagship demo did exactly this.
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgFor(url, { usdcPriceDefault: '10000' });

    const challenge = await runX402Handshake(
      { headers: {}, body: { payment: { rail: 'usdc' } } },
      { taskId: 'x402-integrity', cfg },
    );
    const accept = challenge.body.accepts[0];
    assert.equal(accept.maxAmountRequired, '10000', 'challenge priced at $0.01');

    const settled = await runX402Handshake({
      headers: { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': accept.extra.nonce },
      // Inflated declaration + a different maxAmount on the retry.
      body: { payment: { rail: 'usdc', maxAmount: '1000000' }, amount: '1000000' },
    }, { taskId: 'x402-integrity', cfg });

    assert.equal(settled.kind, 'settled');
    assert.equal(settled.settledAmount, '10000', 'gross is the bound challenge amount, not the declaration');
  } finally {
    await close();
  }
});

test('handshake amount override prices the challenge, not the current body', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgFor(url, { usdcPriceDefault: '10000' });
    const challenge = await runX402Handshake(
      { headers: {}, body: { payment: { rail: 'usdc' } } },
      { taskId: 'x402-rolling', cfg, amount: '20240' },
    );
    const accept = challenge.body.accepts[0];
    assert.equal(accept.maxAmountRequired, '20240');

    const settled = await runX402Handshake({
      headers: { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': accept.extra.nonce },
      body: { payment: { rail: 'usdc' } },
    }, { taskId: 'x402-rolling', cfg, amount: '20240' });
    assert.equal(settled.kind, 'settled');
    assert.equal(settled.settledAmount, '20240');
  } finally {
    await close();
  }
});

test('extractPaymentHeader: v1 X-PAYMENT and v2 PAYMENT-SIGNATURE', () => {
  // v1: X-PAYMENT (XFuel SDK)
  const v1 = extractPaymentHeader({ headers: { 'x-payment': 'v1-blob' } });
  assert.equal(v1.header, 'v1-blob');
  assert.equal(v1.version, 1);

  // v2: PAYMENT-SIGNATURE (CDP-native like Bankr)
  const v2 = extractPaymentHeader({ headers: { 'payment-signature': 'v2-blob' } });
  assert.equal(v2.header, 'v2-blob');
  assert.equal(v2.version, 2);

  // v1 takes precedence when both are present (shouldn't happen, but be predictable)
  const both = extractPaymentHeader({ headers: { 'x-payment': 'v1', 'payment-signature': 'v2' } });
  assert.equal(both.header, 'v1');
  assert.equal(both.version, 1);

  // No payment header
  const none = extractPaymentHeader({ headers: {} });
  assert.equal(none.header, null);
  assert.equal(none.version, null);
});

test('extractPaymentNonce: v1 explicit header, v2 explicit header, json blob, base64 blob', () => {
  // v1: X-Payment-Nonce
  assert.equal(extractPaymentNonce({ headers: { 'x-payment-nonce': 'abc' } }), 'abc');

  // v2: PAYMENT-NONCE (CDP-native)
  assert.equal(extractPaymentNonce({ headers: { 'payment-nonce': 'v2-nonce' } }), 'v2-nonce');

  // v1 header takes precedence
  assert.equal(extractPaymentNonce({ headers: { 'x-payment-nonce': 'v1', 'payment-nonce': 'v2' } }), 'v1');

  // v1: nonce in X-PAYMENT JSON blob
  assert.equal(extractPaymentNonce({ headers: { 'x-payment': JSON.stringify({ nonce: 'n1' }) } }), 'n1');

  // v2: nonce in PAYMENT-SIGNATURE JSON blob
  assert.equal(extractPaymentNonce({ headers: { 'payment-signature': JSON.stringify({ nonce: 'v2json' }) } }), 'v2json');

  // v1: nonce in X-PAYMENT base64 blob
  const b64 = Buffer.from(JSON.stringify({ nonce: 'n2' }), 'utf8').toString('base64');
  assert.equal(extractPaymentNonce({ headers: { 'x-payment': b64 } }), 'n2');

  // v2: nonce in PAYMENT-SIGNATURE base64 blob
  const b64v2 = Buffer.from(JSON.stringify({ nonce: 'v2b64' }), 'utf8').toString('base64');
  assert.equal(extractPaymentNonce({ headers: { 'payment-signature': b64v2 } }), 'v2b64');

  // No headers
  assert.equal(extractPaymentNonce({ headers: {} }), null);
});

test('full 402 loop against mock facilitator: challenge ? settle ? replay-rejected', async () => {
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgFor(url);

    // Step 1: no X-PAYMENT ? 402 challenge (bound to amount + payTo + nonce)
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 'x402-req-1', cfg });
    assert.equal(challenge.kind, 'challenge');
    const accept = challenge.body.accepts[0];
    assert.equal(challenge.body.x402Version, 2);
    assert.equal(accept.amount, '50000');
    assert.equal(accept.maxAmountRequired, '50000');
    assert.equal(accept.payTo, '0xtreasury');
    assert.equal(accept.network, 'eip155:8453');
    const nonce = accept.extra.nonce;
    // EIP-3009 nonce must be bytes32: 0x + 64 hex chars. Per Section 3.5.
    assert.match(nonce, /^0x[0-9a-f]{64}$/);

    // Step 2: retry with X-PAYMENT + nonce ? verify + settle
    const reqPay = {
      headers: { 'x-payment': 'PAYMENT-BLOB', 'x-payment-nonce': nonce },
      body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' },
    };
    const settled = await runX402Handshake(reqPay, { taskId: 'x402-req-1', cfg });
    assert.equal(settled.kind, 'settled');
    assert.match(settled.paymentRef, /^base:0x/);
    assert.equal(settled.settledAmount, '50000', 'settled gross comes from the bound challenge');

    // Step 3: replay the same nonce ? rejected (spent)
    const replay = await runX402Handshake(reqPay, { taskId: 'x402-req-1', cfg });
    assert.equal(replay.kind, 'failed');
    assert.equal(replay.reason, 'payment_replayed');
  } finally {
    await close();
  }
});

test('full 402 loop against mock facilitator (v2 PAYMENT-SIGNATURE): CDP-native buyer', async () => {
  // This is the Bankr case: CDP-native client sends PAYMENT-SIGNATURE, not X-PAYMENT.
  // The challenge still returns x402Version: 2, and the paid retry must succeed.
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgFor(url);

    // Step 1: no payment header → 402 challenge (same as v1)
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 'x402-v2-1', cfg });
    assert.equal(challenge.kind, 'challenge');
    assert.equal(challenge.body.x402Version, 2, 'challenge is still v2');
    const accept = challenge.body.accepts[0];
    const nonce = accept.extra.nonce;
    // EIP-3009 nonce must be bytes32: 0x + 64 hex chars. Per Section 3.5.
    assert.match(nonce, /^0x[0-9a-f]{64}$/);

    // Step 2: retry with PAYMENT-SIGNATURE + PAYMENT-NONCE → verify + settle (v2 path)
    const reqPayV2 = {
      headers: { 'payment-signature': 'CDP-V2-PAYMENT-BLOB', 'payment-nonce': nonce },
      body: { payment: { rail: 'usdc' }, model_id: 'llama-3-70b' },
    };
    const settled = await runX402Handshake(reqPayV2, { taskId: 'x402-v2-1', cfg });
    assert.equal(settled.kind, 'settled', 'v2 PAYMENT-SIGNATURE retry settles');
    assert.match(settled.paymentRef, /^base:0x/);
    assert.equal(settled.settledAmount, '50000');

    // Step 3: replay the same nonce → rejected (spent)
    const replay = await runX402Handshake(reqPayV2, { taskId: 'x402-v2-1', cfg });
    assert.equal(replay.kind, 'failed');
    assert.equal(replay.reason, 'payment_replayed');
  } finally {
    await close();
  }
});

test('v2 PAYMENT-SIGNATURE retry is seen as a payment, not re-challenged as unpaid', async () => {
  // This is the exact Bankr bug: they send PAYMENT-SIGNATURE but the old code
  // only read X-PAYMENT, so they got a 402 challenge instead of settlement.
  const { url, close } = await startMockFacilitator();
  try {
    const cfg = cfgFor(url);

    // Get a challenge
    const challenge = await runX402Handshake(
      { headers: {}, body: { payment: { rail: 'usdc' } } },
      { taskId: 'x402-bankr', cfg },
    );
    const nonce = challenge.body.accepts[0].extra.nonce;

    // A v2 client sends PAYMENT-SIGNATURE, not X-PAYMENT
    const v2Pay = {
      headers: { 'payment-signature': 'SIGNED-PAYMENT', 'payment-nonce': nonce },
      body: { payment: { rail: 'usdc' } },
    };
    const result = await runX402Handshake(v2Pay, { taskId: 'x402-bankr', cfg });

    // Must NOT be a challenge (which was the bug)
    assert.notEqual(result.kind, 'challenge', 'v2 payment must not be re-challenged');
    assert.equal(result.kind, 'settled', 'v2 payment must settle');
  } finally {
    await close();
  }
});

test('malformed payment header still fails closed', async () => {
  const { url, close } = await startMockFacilitator({ valid: false });
  try {
    const cfg = cfgFor(url);

    // Get a challenge
    const challenge = await runX402Handshake(
      { headers: {}, body: { payment: { rail: 'usdc' } } },
      { taskId: 'x402-malformed', cfg },
    );
    const nonce = challenge.body.accepts[0].extra.nonce;

    // v1 malformed
    const v1Bad = {
      headers: { 'x-payment': 'INVALID', 'x-payment-nonce': nonce },
      body: {},
    };
    const r1 = await runX402Handshake(v1Bad, { taskId: 'x402-malformed', cfg });
    assert.equal(r1.kind, 'failed');

    // v2 malformed (fresh challenge needed since nonce was spent checking v1)
    const challenge2 = await runX402Handshake(
      { headers: {}, body: { payment: { rail: 'usdc' } } },
      { taskId: 'x402-malformed-2', cfg },
    );
    const nonce2 = challenge2.body.accepts[0].extra.nonce;
    const v2Bad = {
      headers: { 'payment-signature': 'INVALID', 'payment-nonce': nonce2 },
      body: {},
    };
    const r2 = await runX402Handshake(v2Bad, { taskId: 'x402-malformed-2', cfg });
    assert.equal(r2.kind, 'failed');
  } finally {
    await close();
  }
});

test('handshake surfaces facilitator rejection (→ caller falls back to TFUEL)', async () => {
  const { url, close } = await startMockFacilitator({ valid: false });
  try {
    const cfg = cfgFor(url);
    const reqNoPay = { headers: {}, body: { payment: { rail: 'usdc' } } };
    const challenge = await runX402Handshake(reqNoPay, { taskId: 't', cfg });
    const nonce = challenge.body.accepts[0].extra.nonce;
    const reqPay = { headers: { 'x-payment': 'BLOB', 'x-payment-nonce': nonce }, body: {} };
    const decision = await runX402Handshake(reqPay, { taskId: 't', cfg });
    assert.equal(decision.kind, 'failed');
    assert.equal(decision.reason, 'mock_rejected');
  } finally {
    await close();
  }
});

test('gateway_not_configured is reported (→ caller returns 503)', async () => {
  // The gateway configuration check happens after challenge binding is verified.
  // So to test gateway_not_configured, we need a valid nonce that exists in the store.
  // We do this by first getting a 402 challenge (which stores the nonce), then
  // using that nonce in a payment request with a misconfigured gateway.
  const cfg = cfgFor(null, { gatewayUrl: null, apiKey: null, facilitatorProvider: 'zan' });
  const reqNoPayment = { headers: {}, body: {} };
  const challenge = await runX402Handshake(reqNoPayment, { taskId: 't', cfg });
  assert.equal(challenge.kind, 'challenge', 'should get 402 challenge first');
  const nonce = challenge.body.accepts[0].extra.nonce;

  const reqPay = { headers: { 'x-payment': 'BLOB', 'x-payment-nonce': nonce }, body: {} };
  const decision = await runX402Handshake(reqPay, { taskId: 't', cfg });
  assert.equal(decision.kind, 'failed');
  assert.equal(decision.reason, 'gateway_not_configured');
});

test('TaskSettled webhook payload includes payment_rail + payment_ref', () => {
  const dispatcher = new WebhookDispatcher({ subscribersFor: () => [] }, { activeTasks: new Map() });
  const payload = dispatcher.buildPayload({
    taskId: 't',
    status: 'completed',
    feeAmount: '1',
    netAmount: '2',
    intent: { type: 'inference_request', paymentRail: 'usdc', paymentRef: 'base:0xabc' },
  });
  assert.equal(payload.payment_rail, 'usdc');
  assert.equal(payload.payment_ref, 'base:0xabc');

  // TFUEL default when unset
  const tfuel = dispatcher.buildPayload({ taskId: 't2', status: 'completed', intent: { type: 'compute_bid' } });
  assert.equal(tfuel.payment_rail, 'tfuel');
  assert.equal(tfuel.payment_ref, null);
});

// -- Cost-plus has to reach the money path ------------------------------------
// ADR 0009 shipped `quoteFromCogs` with unit tests and never called it from the
// quote path, so `X402_COST_PLUS=true` changed what /v1/models and
// /.well-known/x402 advertised and nothing about what was charged. The gateway
// published $1.54/$4.84 per million while billing the rate card's $3.00/$9.00.
// Every test here asserts a quoted amount, because that is the thing that was
// wrong while the module-level tests were green.

const { priceUSDCResolved } = await import('../src/x402-server.js');
const { getHubCatalog, resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { costOfUsage } = await import('../src/provider-rates.js');
const { quoteFromCogs } = await import('../src/pricing.js');

/** AkashML GLM-5.2's published rate: $1.40 / $4.40 per million. */
const GLM_IN = 0.0000014;
const GLM_OUT = 0.0000044;

/** Pin the catalogue so a quote does not depend on a live provider API. */
async function primeCatalog() {
  process.env.HUB_CATALOG_OFFLINE = 'false';
  resetHubCatalogCache();
  const fetchFn = async (url) => {
    if (String(url).includes('/service/list')) {
      return {
        ok: true,
        async json() {
          return {
            body: {
              services: [{
                alias: 'glm_5_2',
                name: 'GLM 5.2',
                state: 'public',
                default_prediction: 'completions',
                // No `cost` block: Theta publishes none for this stub, which is
                // the "provider rate unknown" case cost-plus must not price.
                predictions: { completions: { input_vars: { messages: {} } } },
              }],
            },
          };
        },
      };
    }
    if (String(url).includes('/models')) {
      return {
        ok: true,
        async json() {
          return {
            object: 'list',
            data: [{
              id: 'zai-org/GLM-5.2',
              name: 'GLM 5.2',
              created: 1,
              owned_by: 'akash-network',
              pricing: { input: String(GLM_IN), output: String(GLM_OUT) },
            }],
          };
        },
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  await getHubCatalog({ forceRefresh: true, fetchFn });
}

const agentBody = (over = {}) => ({
  model_id: 'akash/zai-org/GLM-5.2',
  messages: [{ role: 'user', content: 'x'.repeat(80_000) }],
  max_tokens: 15_000,
  ...over,
});

const withCostPlus = async (on, fn) => {
  const prev = process.env.X402_COST_PLUS;
  if (on) process.env.X402_COST_PLUS = 'true';
  else delete process.env.X402_COST_PLUS;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.X402_COST_PLUS;
    else process.env.X402_COST_PLUS = prev;
  }
};

test('X402_COST_PLUS actually changes the quote, not just the advertised price', async () => {
  await primeCatalog();
  const cfg = { usdcPriceDefault: '10000', usdcPrices: {} };

  const card = await withCostPlus(false, () => priceUSDCResolved(agentBody(), cfg));
  const plus = await withCostPlus(true, () => priceUSDCResolved(agentBody(), cfg));

  assert.notEqual(plus, card, 'the flag changed nothing ? cost-plus is not wired');

  // Exact, and derived from the published rate rather than a copied constant, so
  // this pins the wiring (right model, right tokens, right function) without
  // reimplementing the arithmetic it is checking.
  const { promptTokensFor } = await import('../src/pricing.js');
  const cogs = costOfUsage(
    { prompt_tokens: promptTokensFor(agentBody()), completion_tokens: 15_000 },
    { input: GLM_IN, output: GLM_OUT, cachedInput: null, perRequest: 0 },
  );
  assert.equal(plus, quoteFromCogs(cogs, { usdcFloor: '10000' }).amount);

  // And it is the ~47% cut ADR 0009 promised, not a rounding difference.
  const cut = 1 - Number(plus) / Number(card);
  assert.ok(cut > 0.4 && cut < 0.55, `expected a ~47% cut, got ${(cut * 100).toFixed(1)}%`);
});

test('an opt-in proof is charged for at quote time', async () => {
  await primeCatalog();
  const cfg = { usdcPriceDefault: '10000', usdcPrices: {} };

  const plain = await withCostPlus(true, () => priceUSDCResolved(agentBody(), cfg));
  const proved = await withCostPlus(true, () =>
    priceUSDCResolved(agentBody({ proof_tier: 'settlement' }), cfg));

  // A requested tier raises the floor past tier2MinCogs, so without this an
  // opt-in proof is a fixed ~$0.050 cost against a few cents of fee.
  assert.equal(BigInt(proved) - BigInt(plain), 80_000n, 'the flat $0.08 proof price');

  // `signed` is not a proof and must not be charged as one.
  const signed = await withCostPlus(true, () =>
    priceUSDCResolved(agentBody({ proof_tier: 'signed' }), cfg));
  assert.equal(signed, plain);
});

test('a model with no published rate falls back to the card, never to the floor', async () => {
  await primeCatalog();
  const cfg = { usdcPriceDefault: '10000', usdcPrices: {} };
  const body = agentBody({ model_id: 'theta/glm_5_2' });

  const plus = await withCostPlus(true, () => priceUSDCResolved(body, cfg));
  const card = await withCostPlus(false, () => priceUSDCResolved(body, cfg));

  // Theta publishes no rate in this catalogue, so cost-plus cannot price it.
  // Quoting an unknown cost at cost-plus would land every such call on the
  // floor ? a $0.20 job billed at $0.01.
  assert.equal(plus, card);
  assert.ok(BigInt(plus) > 10_000n, 'must not collapse to the floor');
});

test('a cost-plus quote publishes a breakdown that rebuilds the price', async () => {
  await primeCatalog();
  const { quoteResolved } = await import('../src/x402-server.js');
  const cfg = { usdcPriceDefault: '10000', usdcPrices: {} };

  const q = await withCostPlus(true, () =>
    quoteResolved(agentBody({ proof_tier: 'settlement' }), cfg));

  assert.equal(q.basis, 'cost_plus');

  // The whole claim of cost-plus is that the bill is checkable. If the parts we
  // publish on /task-quote do not add up to the amount we charge, the claim is
  // marketing.
  assert.equal(
    BigInt(q.provider_cogs) + BigInt(q.platform_fee) + BigInt(q.tier2_proof),
    BigInt(q.amount),
  );
  assert.equal(BigInt(q.platform_fee), (BigInt(q.provider_cogs) * 1000n + 9_999n) / 10_000n);

  // And the rate we publish is the provider's, not the rate card's $3.00/$9.00.
  assert.deepEqual(q.rate, { in: 1_400_000, out: 4_400_000 });
  assert.equal(q.priced_model, 'akash/zai-org/GLM-5.2');
});

test('TEE / spot-check / zk-full do not add the $0.08 settlement-proof surcharge', async () => {
  await primeCatalog();
  const { priceUSDCResolved, wantsSettlementProof } = await import('../src/x402-server.js');
  const cfg = { usdcPriceDefault: '10000', usdcPrices: {} };

  assert.equal(wantsSettlementProof({ proof_tier: 'settlement' }), true);
  for (const t of ['signed', 'tee', 'zk-spotcheck', 'zk-full', 'spotcheck', undefined]) {
    assert.equal(wantsSettlementProof({ proof_tier: t }), false, String(t));
  }

  const plain = await withCostPlus(true, () => priceUSDCResolved(agentBody(), cfg));
  const tee = await withCostPlus(true, () =>
    priceUSDCResolved(agentBody({ proof_tier: 'tee' }), cfg));
  const spot = await withCostPlus(true, () =>
    priceUSDCResolved(agentBody({ proof_tier: 'zk-spotcheck' }), cfg));
  const full = await withCostPlus(true, () =>
    priceUSDCResolved(agentBody({ proof_tier: 'zk-full' }), cfg));

  assert.equal(tee, plain);
  assert.equal(spot, plain);
  assert.equal(full, plain);
});

test('advertised basis (/.well-known/x402) and /task-quote agree under cost-plus', async () => {
  await primeCatalog();
  const { quoteResolved } = await import('../src/x402-server.js');
  const { buildX402Manifest } = await import('../src/x402-discovery.js');
  const cfg = { usdcPriceDefault: '10000', usdcPrices: {} };

  await withCostPlus(true, async () => {
    const advertised = buildX402Manifest('https://example.test').pricing.basis;
    const quoted = (await quoteResolved(agentBody(), cfg)).basis;
    assert.equal(advertised, 'cost_plus');
    assert.equal(quoted, advertised);
  });
});

test('X402_USDC_PRICES wins even under cost-plus', async () => {
  await primeCatalog();
  const { priceUSDCResolved } = await import('../src/x402-server.js');
  const cfg = {
    usdcPriceDefault: '10000',
    usdcPrices: { 'akash/zai-org/GLM-5.2': '77777' },
  };
  const priced = await withCostPlus(true, () => priceUSDCResolved(agentBody(), cfg));
  assert.equal(priced, '77777');
});
