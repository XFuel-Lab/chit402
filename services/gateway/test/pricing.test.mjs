import test from 'node:test';
import assert from 'node:assert/strict';

import {
  quoteTask,
  rateCardFor,
  promptTokensFor,
  DEFAULT_RATE,
  DEFAULT_FLOOR_UNITS,
} from '../src/pricing.js';

/** ~4 chars/token, so 4n characters is about n tokens. */
const promptOf = (tokens) => [{ role: 'user', content: 'x'.repeat(tokens * 4) }];

test('the floor applies when there is nothing to meter', () => {
  const q = quoteTask({});
  assert.equal(q.amount, String(DEFAULT_FLOOR_UNITS));
  assert.equal(q.floor_applied, true);
  assert.equal(q.basis, 'metered');
});

test('a chat-sized prompt stays at the floor', () => {
  // 750 in / 105 out meters to well under a cent — the floor is what keeps a
  // small call above the cost of settling it.
  const q = quoteTask({ messages: promptOf(750), max_tokens: 105 });
  assert.equal(q.amount, '10000');
  assert.equal(q.floor_applied, true);
});

test('a median agent call prices near the $0.02 market median, not the floor', () => {
  const q = quoteTask({ messages: promptOf(68_000), max_tokens: 247 });
  const cents = Number(q.amount) / 10_000;
  assert.equal(q.floor_applied, false);
  assert.ok(cents > 1.8 && cents < 2.4, `expected ~2c for a median agent call, got ${cents}c`);
});

test('price scales with prompt size — the whole point of metering', () => {
  const small = Number(quoteTask({ messages: promptOf(50_000) }).amount);
  const large = Number(quoteTask({ messages: promptOf(100_000) }).amount);
  assert.ok(large > small * 1.9, `doubling the prompt should roughly double the price (${small} → ${large})`);
});

test('output is quoted at the max_tokens ceiling, as the exact scheme requires', () => {
  const tight = Number(quoteTask({ messages: promptOf(1000), max_tokens: 100 }).amount);
  const loose = Number(quoteTask({ messages: promptOf(1000), max_tokens: 100_000 }).amount);
  assert.ok(loose > tight, 'a larger output budget costs more up front');
  assert.equal(loose, 300 + Math.ceil((100_000 * DEFAULT_RATE.out) / 1e6));
});

test('a hand-set model price overrides the card entirely', () => {
  const q = quoteTask(
    { model_id: 'llama-3-70b', messages: promptOf(68_000) },
    { usdcPrices: { 'llama-3-70b': '90000' } },
  );
  assert.equal(q.amount, '90000');
  assert.equal(q.basis, 'model_price');
});

test('rateCardFor matches a model family by longest prefix', () => {
  const cfg = {
    rateCard: {
      default: { in: 300_000, out: 900_000 },
      akash: { in: 200_000, out: 600_000 },
      'akash/zai-org': { in: 100_000, out: 300_000 },
    },
  };
  assert.deepEqual(rateCardFor('akash/meta/llama', cfg), { in: 200_000, out: 600_000 });
  assert.deepEqual(rateCardFor('akash/zai-org/GLM-5.2', cfg), { in: 100_000, out: 300_000 });
  // Matches no configured prefix and has no built-in row, so it falls to default.
  assert.deepEqual(rateCardFor('theta/qwen3', cfg), { in: 300_000, out: 900_000 });
  assert.deepEqual(rateCardFor(null, cfg), { in: 300_000, out: 900_000 });
});

test('rateCardFor falls back to the defaults with no card configured', () => {
  assert.deepEqual(rateCardFor('anything', {}), DEFAULT_RATE);
});

test('the floor is configurable', () => {
  const q = quoteTask({ messages: promptOf(10) }, { usdcFloor: '50000' });
  assert.equal(q.amount, '50000');
});

test('promptTokensFor reads messages, a prompt, or neither', () => {
  assert.equal(promptTokensFor({ messages: promptOf(100) }), 100);
  assert.equal(promptTokensFor({ prompt: 'x'.repeat(400) }), 100);
  assert.equal(promptTokensFor({ input: 'x'.repeat(400) }), 100);
  assert.equal(promptTokensFor({}), 0);
});

test('an expensive model is priced on its own row, not the cheap default', () => {
  // GLM-5.2 costs us $1.40/M input against GPT-OSS-120B's $0.037/M — a 38x range
  // the single default row cannot span. Selling GLM at the default lost $0.075 on
  // every median agent call, and it was the model we routed to by default.
  const cheap = rateCardFor('openai/gpt-oss-120b');
  const dear = rateCardFor('zai-org/GLM-5.2');
  assert.equal(cheap.in, DEFAULT_RATE.in);
  assert.ok(dear.in > cheap.in, 'the dearer model must not be sold at the cheap rate');

  const body = { model_id: 'zai-org/GLM-5.2', messages: promptOf(68_000), max_tokens: 500 };
  // COGS for this call is $0.09629; the quote has to clear it.
  assert.ok(Number(quoteTask(body).amount) > 96_290, 'GLM must be quoted above its own COGS');
});

test('a rate row matches whether or not the catalog hub prefix is present', () => {
  assert.deepEqual(rateCardFor('akash/zai-org/GLM-5.2'), rateCardFor('zai-org/GLM-5.2'));
});

test('both hubs serving GLM-5.2 are priced, not just the one we prefer today', () => {
  // Theta's GLM costs $0.106 per median agent call against AkashML's $0.096. The
  // preference order between them has already flipped once, so pricing only the
  // preferred copy would silently go underwater the next time it moves.
  assert.deepEqual(rateCardFor('theta/glm_5_2'), rateCardFor('zai-org/GLM-5.2'));
  assert.ok(rateCardFor('theta/glm_5_2').in > DEFAULT_RATE.in);
});

test('the xfuel/auto alias matches no row, which is why it must be resolved first', () => {
  // Not a wart to fix here — `quoteTask` is deliberately sync and pure, and
  // resolution needs the live catalog. This asserts the hazard so the resolve step
  // in x402-server.js cannot be removed without a red test: quoting the alias
  // verbatim charges the cheap default for whatever it resolves to.
  assert.deepEqual(rateCardFor('xfuel/auto'), DEFAULT_RATE);

  const body = { messages: promptOf(68_000), max_tokens: 247 };
  const alias = Number(quoteTask({ ...body, model_id: 'xfuel/auto' }).amount);
  const served = Number(quoteTask({ ...body, model_id: 'akash/zai-org/GLM-5.2' }).amount);
  assert.ok(served > alias * 9, `the alias must not be cheaper than what it serves (${alias} vs ${served})`);
});

test('a configured card overrides the built-in rows, even a less specific one', () => {
  assert.deepEqual(
    rateCardFor('zai-org/GLM-5.2', { rateCard: { 'zai-org/GLM-5.2': { in: 111, out: 222 } } }),
    { in: 111, out: 222 },
  );
  // The built-in row is a floor against a known-dear model, not an override of
  // what the operator configured — a broader configured key still wins.
  assert.deepEqual(
    rateCardFor('akash/zai-org/GLM-5.2', { rateCard: { 'akash/zai-org': { in: 111, out: 222 } } }),
    { in: 111, out: 222 },
  );
});

test('a malformed rate card falls back rather than throwing', () => {
  const prev = process.env.X402_USDC_RATE_CARD;
  process.env.X402_USDC_RATE_CARD = 'not json';
  try {
    assert.deepEqual(rateCardFor('anything'), DEFAULT_RATE);
  } finally {
    if (prev === undefined) delete process.env.X402_USDC_RATE_CARD;
    else process.env.X402_USDC_RATE_CARD = prev;
  }
});
