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
