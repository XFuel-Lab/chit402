import test from 'node:test';
import assert from 'node:assert/strict';

import {
  quoteTask,
  quoteFromCogs,
  costPlusEnabled,
  platformFeeBps,
  checkPricingConfig,
  publishedPrice,
  describePricing,
  rateCardFor,
  promptTokensFor,
  DEFAULT_RATE,
  DEFAULT_FLOOR_UNITS,
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_TIER2_PROOF_UNITS,
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

// ── cost-plus pricing (ADR 0009) ─────────────────────────────────────────────

/** Measured COGS of a median agent call on GLM-5.2 via AkashML: $0.094. */
const MEDIAN_AGENT_COGS = 94_000n;

test('cost-plus is off unless explicitly enabled', () => {
  const prev = process.env.X402_COST_PLUS;
  delete process.env.X402_COST_PLUS;
  try {
    assert.equal(costPlusEnabled(), false);
    process.env.X402_COST_PLUS = 'true';
    assert.equal(costPlusEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.X402_COST_PLUS;
    else process.env.X402_COST_PLUS = prev;
  }
});

test('a median agent call prices at COGS plus 10%', () => {
  const q = quoteFromCogs(MEDIAN_AGENT_COGS);
  assert.equal(q.basis, 'cost_plus');
  assert.equal(q.provider_cogs, '94000');
  assert.equal(q.platform_fee, '9400');
  assert.equal(q.amount, '103400');
  assert.equal(q.floor_applied, false);
});

test('the buyer can recompute the total from the receipt — the point of the model', () => {
  // A buyer holds `provider_cogs.actual` (signed) and the stated fee_bps. If
  // these do not reconcile exactly, the bill is not auditable and the whole
  // argument for cost-plus over a rate card collapses.
  const q = quoteFromCogs(MEDIAN_AGENT_COGS);
  const recomputed = BigInt(q.provider_cogs) + BigInt(q.platform_fee);
  assert.equal(String(recomputed), q.amount);
  assert.equal(q.fee_bps, DEFAULT_PLATFORM_FEE_BPS);
});

test('the floor still catches a call too small to settle', () => {
  // A 500-token tool call on Llama costs $0.000105. Ten percent of that is a
  // hundredth of a cent — far below what a settlement costs us.
  const q = quoteFromCogs(105n);
  assert.equal(q.amount, String(DEFAULT_FLOOR_UNITS));
  assert.equal(q.floor_applied, true);
});

test('the charge is cost-proportional, so no per-model row is needed', () => {
  const single = BigInt(quoteFromCogs(MEDIAN_AGENT_COGS).amount);
  const triple = BigInt(quoteFromCogs(MEDIAN_AGENT_COGS * 3n).amount);
  assert.equal(triple, single * 3n);
});

test('the fee rounds up, so we never absorb the rounding', () => {
  // 105 base units at 10% is 10.5 — truncating would hand back half a unit on
  // every call, which at floor-adjacent sizes is most of the margin.
  const q = quoteFromCogs(105n, { usdcFloor: 0 });
  assert.equal(q.platform_fee, '11');
  assert.equal(q.amount, '116');
});

test('the fee rate is configurable without touching the floor', () => {
  const q = quoteFromCogs(MEDIAN_AGENT_COGS, { platformFeeBps: 500 });
  assert.equal(q.platform_fee, '4700');
  assert.equal(q.amount, '98700');
});

test('a bigint from costOfUsage and a number from JSON price identically', () => {
  assert.equal(quoteFromCogs(94_000n).amount, quoteFromCogs(94_000).amount);
  assert.equal(quoteFromCogs('94000').amount, quoteFromCogs(94_000n).amount);
});

test('unmeasurable COGS falls to the floor rather than charging zero', () => {
  // `measureCogs` returns 0n with basis 'no_rate' when the catalogue has no
  // price. Charging nothing would serve the call free; the floor is the honest
  // fallback.
  for (const bad of [0n, 0, null, undefined, -5, 'nonsense']) {
    assert.equal(quoteFromCogs(bad).amount, String(DEFAULT_FLOOR_UNITS), `input: ${String(bad)}`);
  }
});

test('a malformed fee rate keeps the default rather than mispricing', () => {
  const prev = process.env.X402_PLATFORM_FEE_BPS;
  process.env.X402_PLATFORM_FEE_BPS = 'ten percent';
  try {
    assert.equal(platformFeeBps(), DEFAULT_PLATFORM_FEE_BPS);
  } finally {
    if (prev === undefined) delete process.env.X402_PLATFORM_FEE_BPS;
    else process.env.X402_PLATFORM_FEE_BPS = prev;
  }
});

test('an opt-in Tier-2 proof is a flat charge on top, above the floor', () => {
  // The proof costs ~$0.050 whatever the job was, so it is priced flat. Critically
  // it is added *after* the floor: a floor-priced call that asks for a proof must
  // not buy a $0.050 proof inside a $0.01 payment.
  const tiny = quoteFromCogs(105n, { tier2: true });
  assert.equal(tiny.tier2_proof, String(DEFAULT_TIER2_PROOF_UNITS));
  assert.equal(tiny.amount, String(BigInt(DEFAULT_FLOOR_UNITS) + BigInt(DEFAULT_TIER2_PROOF_UNITS)));
  assert.equal(tiny.floor_applied, true);
});

test('a proof is only charged when it was asked for', () => {
  assert.equal(quoteFromCogs(MEDIAN_AGENT_COGS).tier2_proof, '0');
  assert.equal(quoteFromCogs(MEDIAN_AGENT_COGS).amount, '103400');
  assert.equal(quoteFromCogs(MEDIAN_AGENT_COGS, { tier2: true }).amount, '183400');
});

test('the proof price covers its measured cost', () => {
  // 0.341064 PROVE at $0.147 is ~$0.050 per Succinct request, and it cannot be
  // batched down for AI tasks. Selling below that is selling at a loss.
  assert.ok(
    BigInt(DEFAULT_TIER2_PROOF_UNITS) > 50_000n,
    `proof price ${DEFAULT_TIER2_PROOF_UNITS} must exceed the ~50000 it costs`,
  );
});

test('a risky pricing combination is reported, not silently accepted', () => {
  const prev = process.env.X402_COST_PLUS;
  process.env.X402_COST_PLUS = 'true';
  try {
    // Cost-plus on, Tier-2 gated on the settled amount: $0.0094 of fee against a
    // $0.050 proof on every paid call.
    const bad = checkPricingConfig({
      enabled: true,
      tier2Min: '10000',
      available: { settlement: true },
    });
    assert.equal(bad.ok, false);
    assert.match(bad.warnings[0], /VI_TIER2_MIN_COGS/);

    const good = checkPricingConfig({
      enabled: true,
      tier2Min: '10000',
      tier2MinCogs: '2000000',
      available: { settlement: true },
    });
    assert.equal(good.ok, true);
  } finally {
    if (prev === undefined) delete process.env.X402_COST_PLUS;
    else process.env.X402_COST_PLUS = prev;
  }
});

test('the config check stays quiet while cost-plus is off', () => {
  delete process.env.X402_COST_PLUS;
  assert.equal(checkPricingConfig({ enabled: true, tier2Min: '10000' }).ok, true);
});

test('cost-plus is a large price cut against the rate card it replaces', () => {
  // The GLM-5.2 row charges $0.195 for the same call cost-plus prices at
  // $0.1034 — the competitive argument for the change, pinned so a rate-card
  // edit cannot quietly undo it.
  const card = Number(quoteTask({ model_id: 'zai-org/GLM-5.2', messages: promptOf(20_000), max_tokens: 15_000 }).amount);
  const costPlus = Number(quoteFromCogs(MEDIAN_AGENT_COGS).amount);
  const cut = 1 - costPlus / card;
  assert.ok(cut > 0.4 && cut < 0.55, `expected a ~47% cut, got ${(cut * 100).toFixed(1)}%`);
});

// -- What a buyer can discover before they spend anything ----------------------
// Cost-plus is only meaningful if the two inputs are visible in advance. The
// receipt already signs `provider_cogs.actual`, so a bill could be audited after
// the fact, but until these surfaces published a rate there was no way to check
// a price *before* paying it.

/** AkashML GLM-5.2: $1.40 / $4.40 per million, as per-token USD. */
const GLM_RATE = { input: 0.0000014, output: 0.0000044, cachedInput: 0.00000026, perRequest: 0 };

test('cost-plus publishes the provider rate and our price, so the fee is checkable', () => {
  const p = publishedPrice('akash/zai-org/GLM-5.2', GLM_RATE, { costPlus: true });

  assert.equal(p.basis, 'cost_plus');
  assert.equal(p.fee_bps, DEFAULT_PLATFORM_FEE_BPS);
  assert.equal(p.provider_cost_per_million.input, 1.4);
  assert.equal(p.provider_cost_per_million.output, 4.4);
  // A buyer must be able to multiply the published cost by the published fee
  // and land exactly on the published price.
  assert.equal(p.price_per_million.input, 1.54);
  assert.equal(p.price_per_million.output, 4.84);
});

test('a published cached-read rate carries the same markup, and an absent one is not invented', () => {
  const withCache = publishedPrice('akash/zai-org/GLM-5.2', GLM_RATE, { costPlus: true });
  assert.equal(withCache.provider_cost_per_million.cached_input, 0.26);
  assert.equal(withCache.price_per_million.cached_input, 0.286);

  // Theta publishes no cached-read rate on any service. Absent must not read as free.
  const noCache = publishedPrice('theta/glm_5_2', { ...GLM_RATE, cachedInput: null }, { costPlus: true });
  assert.equal(noCache.provider_cost_per_million.cached_input, undefined);
  assert.equal(noCache.price_per_million.cached_input, undefined);
});

test('a per-artefact model publishes a marked-up per-request price, not just the cost', () => {
  // ESRGAN and the diffusion models charge $0.01 per image with zero token
  // rates. Publishing only `provider_per_request_usd` left `price_per_million: 0`
  // sitting there looking like the whole price, and looking like zero.
  const p = publishedPrice('theta/esrgan', {
    input: 0, output: 0, cachedInput: null, perRequest: 0.01,
  }, { costPlus: true });

  assert.equal(p.provider_per_request_usd, 0.01);
  assert.equal(p.price_per_request_usd, 0.011);
});

test('cost-plus admits it cannot quote a model the provider prices nowhere', () => {
  const p = publishedPrice('theta/blip', null, { costPlus: true });
  assert.equal(p.basis, 'cost_plus');
  assert.equal(p.price_per_million, null, 'better an admitted gap than an invented number');
  assert.match(p.note, /task-quote/);
});

test('the rate card publishes our price only, because it does not track cost', () => {
  const p = publishedPrice('zai-org/GLM-5.2', GLM_RATE, { costPlus: false });
  assert.equal(p.basis, 'rate_card');
  assert.equal(p.price_per_million.input, 3);
  assert.equal(p.price_per_million.output, 9);
  assert.equal(p.provider_cost_per_million, undefined, 'the card is ours; COGS is not its basis');
  // The ceiling-quote overcharge is a property of the price, so it is disclosed.
  assert.match(p.note, /max_tokens/);
});

test('every published price names the floor and the Tier-2 surcharge', () => {
  for (const costPlus of [true, false]) {
    const p = publishedPrice('akash/zai-org/GLM-5.2', GLM_RATE, { costPlus });
    assert.equal(p.min_charge_usd, 0.01, `costPlus=${costPlus}`);
    assert.equal(p.tier2_proof_usd, DEFAULT_TIER2_PROOF_UNITS / 1_000_000, `costPlus=${costPlus}`);
    assert.equal(p.currency, 'USDC');
  }
});

test('the manifest describes the basis in force, not the one we prefer', () => {
  const plus = describePricing({ costPlus: true });
  assert.equal(plus.basis, 'cost_plus');
  assert.equal(plus.platform_fee_bps, DEFAULT_PLATFORM_FEE_BPS);
  assert.match(plus.description, /recompute the bill/);

  const card = describePricing({ costPlus: false });
  assert.equal(card.basis, 'rate_card');
  assert.equal(card.platform_fee_bps, undefined, 'no fee percentage exists under the card');
});

test('discovery points at the exact-quote endpoint, since per-token rates are not a price', () => {
  const d = describePricing({ costPlus: true });
  assert.equal(d.per_model_rates, '/v1/models');
  assert.match(d.quote_endpoint, /task-quote/);
  assert.equal(d.min_charge_usd, 0.01);
});
