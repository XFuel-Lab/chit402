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

import {
  proveAllowedForKey,
  proofAvailability,
  refreshProverProbe,
  resetProverProbe,
} from '../src/prove-gate.js';

beforeEach(() => {
  delete process.env.PROVER_ENABLED;
  delete process.env.PROVER_ALLOW_KEYS;
  resetProverProbe();
});

/** A prover stub whose health check answers however the test needs. */
const prover = (ok) => ({ healthCheck: async () => ok });

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

test('/health distinguishes "scaled to zero" from "restricted to partners"', async () => {
  process.env.PROVER_ALLOW_KEYS = 'partner-a';
  await refreshProverProbe(prover(true));
  assert.equal(proofAvailability(true).settlement_proof, 'allow_listed');
  assert.equal(proofAvailability(false).settlement_proof, 'unavailable');
});

/**
 * The bug this closes: the ECS prover was scaled to zero and `/health` went on
 * reporting `prover_configured: true` with "proofs are generated for every
 * settled task", because both came from a URL being set rather than anything
 * answering. Configured and reachable are now separate claims.
 */
test('a configured but unreachable prover is not reported as available', async () => {
  await refreshProverProbe(prover(false));
  const p = proofAvailability(true);

  assert.equal(p.prover_configured, true, 'the URL is still set');
  assert.equal(p.prover_reachable, false, 'and it was asked, and did not answer');
  assert.equal(p.settlement_proof, 'unavailable');
  assert.match(p.note, /did not answer/i);
  assert.match(p.note, /signed receipts are unaffected/i);
});

test('an unprobed prover reports unknown rather than borrowing confidence from config', () => {
  const p = proofAvailability(true);
  assert.equal(p.prover_reachable, null, 'null means not yet asked, not "no"');
  assert.equal(p.settlement_proof, 'unknown');
  assert.equal(p.prover_checked_at, null);
  assert.match(p.note, /unconfirmed/i);
});

test('with no prover to ask, there is no check to timestamp', () => {
  refreshProverProbe(null);
  const p = proofAvailability(false);
  assert.equal(p.prover_reachable, null);
  assert.equal(p.prover_checked_at, null, 'a timestamp here would imply something answered');
});

test('a probe that throws counts as unreachable, not as unknown', async () => {
  await refreshProverProbe({ healthCheck: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(proofAvailability(true).prover_reachable, false);
});

test('the probe is cached, so /health does not hammer a dead prover', async () => {
  let calls = 0;
  const counting = { healthCheck: async () => { calls += 1; return true; } };

  await refreshProverProbe(counting);
  assert.equal(refreshProverProbe(counting), null, 'a fresh result is not re-probed');
  assert.equal(calls, 1);

  // Past the TTL it probes again, so a prover scaled back up is picked up.
  await refreshProverProbe(counting, { ttlMs: 0 });
  assert.equal(calls, 2);
});

/**
 * Tier-2 is threshold-gated and, under ADR 0009, opt-in and separately priced.
 * The old note promised a proof on every settled task, which at a fixed ~$0.050
 * per proof would be a loss on every call it was true of.
 */
test('/health does not claim a proof for every settled task', async () => {
  await refreshProverProbe(prover(true));
  const p = proofAvailability(true);

  assert.equal(p.settlement_proof, 'open');
  assert.doesNotMatch(p.note, /for every settled task/i);
  assert.match(p.note, /threshold/i);
});

test('/health publishes the Tier-2 gate so a partner can see why no proof appeared', async () => {
  await refreshProverProbe(prover(true));
  const tier2 = { basis: 'provider_cogs', min_cogs_usd: 2, min_amount_usd: 0.01, opt_in_price_usd: 0.08 };
  assert.deepEqual(proofAvailability(true, { tier2 }).tier2, tier2);
  assert.equal(proofAvailability(true).tier2, undefined, 'omitted when not supplied');
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
