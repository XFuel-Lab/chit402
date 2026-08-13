import test from 'node:test';
import assert from 'node:assert/strict';

import { rateForModel, costOfUsage } from '../src/provider-rates.js';

/** Live AkashML /v1/models shape, verified 2026-08-12: USD per token, as strings. */
const AKASH_GLM = { cost: { input: '0.0000014', output: '0.0000044', input_cache_read: '0.00000026' } };
const AKASH_LLAMA = { cost: { input: '0.00000013', output: '0.0000004' } }; // no cache rate published
const AKASH_GPT_OSS = { cost: { input: '0.000000037', output: '0.00000049' } };

test('rateForModel reads the live per-token shape', () => {
  assert.deepEqual(rateForModel(AKASH_GLM), {
    input: 1.4e-6, output: 4.4e-6, cachedInput: 2.6e-7, perRequest: 0,
  });
});

test('a flat per-request charge is counted, not dropped', () => {
  // `request` is 0 across AkashML today, but the field is in the live response
  // and a non-zero value would hit hardest on short calls, where tokens are cheap.
  const rate = rateForModel({ cost: { input: '0', output: '0', request: '0.002' } });
  assert.equal(rate.perRequest, 0.002);
  assert.equal(costOfUsage({ prompt_tokens: 10, completion_tokens: 5 }, rate), 2000n);
});

test('a model with no published cache rate reports null, not zero', () => {
  // Zero would silently make cached tokens free and understate what we owe.
  assert.equal(rateForModel(AKASH_LLAMA).cachedInput, null);
});

test('rateForModel returns null when there is no usable price', () => {
  assert.equal(rateForModel(null), null);
  assert.equal(rateForModel({}), null);
  assert.equal(rateForModel({ cost: null }), null);
  // Theta prices per inference, not per token — no input/output rate to read.
  assert.equal(rateForModel({ cost: { tfuel_per_inference: '0.1' } }), null);
});

test('median agent call on Llama 3.3 70B costs $0.00894 — the measured baseline', () => {
  const cost = costOfUsage(
    { prompt_tokens: 68000, completion_tokens: 247 },
    rateForModel(AKASH_LLAMA),
  );
  // 68000 × 0.13/M + 247 × 0.40/M = $0.0089388 → 8939 base units.
  assert.equal(cost, 8939n);
});

test('the same call on GPT-OSS-120B costs 3.4x less', () => {
  const llama = costOfUsage({ prompt_tokens: 68000, completion_tokens: 247 }, rateForModel(AKASH_LLAMA));
  const gptOss = costOfUsage({ prompt_tokens: 68000, completion_tokens: 247 }, rateForModel(AKASH_GPT_OSS));
  assert.equal(gptOss, 2638n);
  assert.ok(Number(llama) / Number(gptOss) > 3.3, 'model choice is the largest COGS lever we control');
});

test('the old flat 70%-of-price estimate was several times too high', () => {
  // Metered retail for this call is ~$0.021, so the bps estimate said $0.0147.
  const bpsEstimate = 14700n;
  const real = costOfUsage({ prompt_tokens: 68000, completion_tokens: 247 }, rateForModel(AKASH_LLAMA));
  assert.ok(bpsEstimate > real, `estimate ${bpsEstimate} overstated real cost ${real}`);
});

test('cached tokens bill at the cached rate only when the provider publishes one', () => {
  const usage = { prompt_tokens: 68000, completion_tokens: 247, cached_prompt_tokens: 63000 };

  // GLM publishes $0.26/M cached against $1.40/M fresh.
  const glmCached = costOfUsage(usage, rateForModel(AKASH_GLM));
  const glmFresh = costOfUsage({ ...usage, cached_prompt_tokens: null }, rateForModel(AKASH_GLM));
  assert.ok(glmCached < glmFresh, 'a published cache rate reduces the bill');

  // Llama publishes none, so a reported cache hit must still bill as fresh.
  const llamaCached = costOfUsage(usage, rateForModel(AKASH_LLAMA));
  const llamaFresh = costOfUsage({ ...usage, cached_prompt_tokens: null }, rateForModel(AKASH_LLAMA));
  assert.equal(llamaCached, llamaFresh, 'no published rate means no discount, whatever the hit rate');
});

test('cached tokens cannot exceed the prompt, and rounding never under-reports', () => {
  const rate = rateForModel(AKASH_GLM);
  const over = costOfUsage({ prompt_tokens: 100, completion_tokens: 0, cached_prompt_tokens: 999 }, rate);
  const all = costOfUsage({ prompt_tokens: 100, completion_tokens: 0, cached_prompt_tokens: 100 }, rate);
  assert.equal(over, all);
  // One GPT-OSS token costs 0.037 base units — round up to 1, never down to free.
  assert.equal(costOfUsage({ prompt_tokens: 1, completion_tokens: 0 }, rateForModel(AKASH_GPT_OSS)), 1n);
});

// Live Theta /service/list shape, verified 2026-08-12. Integers are US cents.
const thetaRow = (cost, unit, divisor = 1_000_000) => ({
  hub: 'theta',
  cost: { ...cost, cost_divisor: divisor, price_unit: { unit, isPriceSplit: /token/i.test(unit) } },
});

test('Theta publishes per-token rates too — in cents over a divisor', () => {
  // GLM-5.2: 154/484 per 1M tokens = $1.54/$4.84.
  const rate = rateForModel(thetaRow({ input: 154, output: 484 }, '1M input tokens'));
  assert.equal(rate.input, 1.54e-6);
  assert.equal(rate.output, 4.84e-6);
  assert.equal(rate.cachedInput, null, 'Theta publishes no cached-read rate on any service');
});

test('the cents reading is pinned by Theta\'s own per-image price', () => {
  // The diffusion models read 1 per image, and Theta resells exactly these at
  // $0.01/request on RapidAPI. That fixes the unit as cents, not TFUEL.
  const sdxl = rateForModel(thetaRow({ input: 0, output: 1 }, 'image', 1));
  assert.equal(sdxl.perRequest, 0.01);
  assert.equal(costOfUsage({ prompt_tokens: 0, completion_tokens: 0 }, sdxl), 10_000n);

  // ESRGAN carries 1 on both sides for a single $0.01 charge — summing would double it.
  assert.equal(rateForModel(thetaRow({ input: 1, output: 1 }, 'image', 1)).perRequest, 0.01);
});

test('Theta GLM costs more than AkashML GLM, and the GLM rate row still covers it', () => {
  const theta = costOfUsage(
    { prompt_tokens: 68_000, completion_tokens: 247 },
    rateForModel(thetaRow({ input: 154, output: 484 }, '1M input tokens')),
  );
  const akash = costOfUsage({ prompt_tokens: 68_000, completion_tokens: 247 }, rateForModel(AKASH_GLM));
  assert.ok(theta > akash, 'Theta prices the same model ~10% above AkashML');
  // The GLM row quotes $0.2085; Theta's COGS has to sit under it.
  assert.ok(theta < 208_500n, `Theta GLM COGS ${theta} must stay under the GLM rate row`);
});

test('an unparseable Theta unit does not silently become a token rate', () => {
  const rate = rateForModel(thetaRow({ input: 1, output: 0 }, '', 1));
  assert.equal(rate.input, 0);
  assert.equal(rate.perRequest, 0.01);
});

test('costOfUsage is safe on missing input', () => {
  assert.equal(costOfUsage(null, rateForModel(AKASH_GLM)), 0n);
  assert.equal(costOfUsage({ prompt_tokens: 10 }, null), 0n);
  assert.equal(costOfUsage({}, rateForModel(AKASH_GLM)), 0n);
});
