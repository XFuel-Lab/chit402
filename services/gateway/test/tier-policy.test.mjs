/**
 * Phase 4 — tier selection policy tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTier, normalizeRequestedTier } from '../src/tier-policy.js';

const policy = (over = {}) => ({
  enabled: true,
  tier2Min: '10000',   // $0.01
  tier3Min: '1000000', // $1.00
  defaultMechanism: 'tee',
  available: { settlement: true, tee: true, 'zk-spotcheck': true, 'zk-full': false },
  ...over,
});

const task = (amount, proofTier) => ({ intent: { amount: String(amount), proofTier } });

test('disabled engine → legacy settlement/signed', () => {
  const r = selectTier(task(5_000_000), { enabled: false, available: { settlement: true } });
  assert.equal(r.tier, 'settlement');
  const r2 = selectTier(task(5_000_000), { enabled: false, available: { settlement: false } });
  assert.equal(r2.tier, 'signed');
});

test('value-at-risk floors', () => {
  assert.equal(selectTier(task(5000), policy()).tier, 'signed');        // below tier2Min
  assert.equal(selectTier(task(50_000), policy()).tier, 'settlement');  // between
  const hi = selectTier(task(2_000_000), policy());
  assert.equal(hi.tier, 'inference');
  assert.equal(hi.mechanism, 'tee');
});

test('request can raise but not lower the tier', () => {
  // raise: small value but agent wants inference
  const raised = selectTier(task(5000, 'tee'), policy());
  assert.equal(raised.tier, 'inference');
  assert.equal(raised.mechanism, 'tee');
  // lower attempt: high value, agent asks for signed → floor wins (inference)
  const floored = selectTier(task(2_000_000, 'signed'), policy());
  assert.equal(floored.tier, 'inference');
});

test('mechanism degrades to best available with a reason', () => {
  // ask for zk-full but only tee/spotcheck available → degrade
  const r = selectTier(task(2_000_000, 'zk-full'), policy());
  assert.equal(r.tier, 'inference');
  assert.equal(r.mechanism, 'zk-spotcheck'); // strongest available at/below zk-full
  assert.equal(r.degraded, true);
});

test('no Tier-3 mechanism available → degrade to settlement', () => {
  const r = selectTier(task(2_000_000), policy({ available: { settlement: true, tee: false, 'zk-spotcheck': false, 'zk-full': false } }));
  assert.equal(r.tier, 'settlement');
  assert.equal(r.degraded, true);
});

test('normalizeRequestedTier maps aliases', () => {
  assert.deepEqual(normalizeRequestedTier('t3b'), { tier: 'inference', mechanism: 'zk-spotcheck' });
  assert.deepEqual(normalizeRequestedTier('full'), { tier: 'inference', mechanism: 'zk-full' });
  assert.equal(normalizeRequestedTier('bogus'), null);
});

// ── COGS-denominated thresholds (ADR 0009) ───────────────────────────────────

/** $0.20 of provider cost — the batch-10 solvency threshold for bundling Tier-2. */
const TIER2_MIN_COGS = '200000';

test('COGS thresholds take precedence over amount thresholds when both apply', () => {
  // A $0.1034 cost-plus call clears the $0.01 amount threshold easily, so on the
  // amount basis it earns a settlement proof that costs 5x the fee it collected.
  // On COGS it does not, which is the whole point of the re-basing.
  const p = policy({ tier2MinCogs: TIER2_MIN_COGS });
  const r = selectTier({ intent: { amount: '103400' }, cogs: '94000' }, p);
  assert.equal(r.tier, 'signed');
  assert.match(r.reason, /provider cogs/);
});

test('a genuinely large call still earns its settlement proof', () => {
  const p = policy({ tier2MinCogs: TIER2_MIN_COGS });
  const r = selectTier({ intent: { amount: '550000' }, cogs: '500000' }, p);
  assert.equal(r.tier, 'settlement');
});

test('a price cut cannot downgrade assurance once thresholds are COGS-based', () => {
  // Same work, same COGS, priced two ways: rate card ($0.195) and cost-plus
  // ($0.1034). On the amount basis these can straddle a threshold; on COGS they
  // cannot, because COGS did not change.
  const p = policy({ tier2MinCogs: '90000' });
  const card = selectTier({ intent: { amount: '195000' }, cogs: '94000' }, p);
  const costPlus = selectTier({ intent: { amount: '103400' }, cogs: '94000' }, p);
  assert.equal(card.tier, costPlus.tier);
});

test('COGS is read from a receipt-shaped provider_cogs block too', () => {
  const p = policy({ tier2MinCogs: TIER2_MIN_COGS });
  const r = selectTier({ intent: { amount: '1000' }, provider_cogs: { actual: '500000' } }, p);
  assert.equal(r.tier, 'settlement');
});

test('without measured COGS the amount thresholds still govern', () => {
  // The gateway cannot always measure COGS — measureCogs returns 0n when the
  // catalogue has no rate. Falling back keeps assurance rather than dropping it.
  const p = policy({ tier2MinCogs: TIER2_MIN_COGS });
  const r = selectTier(task(50_000), p);
  assert.equal(r.tier, 'settlement');
  assert.match(r.reason, /settled amount/);
});

test('an unparseable threshold is treated as unset, not as zero', () => {
  // Zero would mean "every call clears it" — the opposite of a safe default for
  // a threshold that gates a $0.050 spend.
  const r = selectTier(task(50_000), policy({ tier2Min: 'ten thousand', tier3Min: '' }));
  assert.equal(r.tier, 'signed');
});
