/**
 * The prove gate decides who spends prover budget, and `/health` is how anyone
 * outside finds out whether Tier-2 proofs are being produced at all.
 *
 * Both matter because the prover is scaled to zero when idle: that is the largest
 * single fixed-cost saving available and it is only safe while the state is
 * legible. A partner must be able to see "proofs are off" without asking us.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { proveAllowedForKey, proofAvailability } from '../src/prove-gate.js';

beforeEach(() => {
  delete process.env.PROVER_ENABLED;
  delete process.env.PROVER_ALLOW_KEYS;
});

test('proving is on by default', () => {
  assert.equal(proveAllowedForKey('any-key'), true);
});

test('PROVER_ENABLED=false turns proving off for everyone', () => {
  process.env.PROVER_ENABLED = 'false';
  assert.equal(proveAllowedForKey('any-key'), false);
});

test('an allow-list is authoritative in both states', () => {
  process.env.PROVER_ALLOW_KEYS = 'partner-a, partner-b';
  for (const enabled of ['true', 'false']) {
    process.env.PROVER_ENABLED = enabled;
    assert.equal(proveAllowedForKey('partner-a'), true, `enabled=${enabled}`);
    assert.equal(proveAllowedForKey('someone-else'), false, `enabled=${enabled}`);
    // An unauthenticated caller must not slip through an allow-list.
    assert.equal(proveAllowedForKey(undefined), false, `enabled=${enabled}`);
  }
});

test('/health reports proofs as unavailable when no prover is reachable', () => {
  const p = proofAvailability(false);
  assert.equal(p.settlement_proof, 'unavailable');
  assert.equal(p.prover_configured, false);
  // The point of saying so: the rest of the product is unaffected.
  assert.match(p.note, /signed receipts are unaffected/i);
});

test('/health distinguishes "scaled to zero" from "restricted to partners"', () => {
  process.env.PROVER_ALLOW_KEYS = 'partner-a';
  assert.equal(proofAvailability(true).settlement_proof, 'allow_listed');
  assert.equal(proofAvailability(false).settlement_proof, 'unavailable');
});

test('signed receipts are advertised as unconditional in every posture', () => {
  for (const configured of [true, false]) {
    for (const enabled of ['true', 'false']) {
      process.env.PROVER_ENABLED = enabled;
      assert.equal(proofAvailability(configured).signed_receipts, 'always');
    }
  }
});

test('/health never leaks the allow-listed keys', () => {
  process.env.PROVER_ALLOW_KEYS = 'sk-partner-secret,sk-other';
  const serialized = JSON.stringify(proofAvailability(true));
  assert.ok(!serialized.includes('sk-partner-secret'), 'keys must not appear in a public endpoint');
  assert.equal(proofAvailability(true).allow_list_size, 2);
});
