/**
 * Protocol Review lows after #587.
 * F1: SETTLEMENT_PROOF_ENABLED=true alone cannot turn the add-on on; a code
 *     constant must change with signed tier/in_proof and the verifier rule.
 * F2: tier2_above is not a dead end while the add-on is off.
 * F4: prover health / metrics polling does not start while the add-on is off.
 * This file never calls the test override until the last tests, so the real
 * guard is what runs.
 */
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.SETTLEMENT_PROOF_ENABLED;

// Local stand-in for the SP1 prover: counts every request (health, metrics, prove).
let hits = 0;
const prover = http.createServer((req, res) => {
  hits += 1;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
});
await new Promise((resolve) => prover.listen(0, '127.0.0.1', resolve));
process.env.SP1_PROVER_URL = `http://127.0.0.1:${prover.address().port}`;
delete process.env.ZAN_PROVER_URL;
process.env.SP1_DASHBOARD_PORT = '0';

const flag = await import('../src/settlement-proof-flag.js');
const logger = (await import('../src/logger.js')).default;
const { BookPolicyStore, POLICY_TYPES, enforcePolicy } = await import('../src/book-policy.js');
const { initSP1Prover, getSP1Prover } = await import('../src/sp1-prover-client.js');
const { refreshProverProbe } = await import('../src/prove-gate.js');

after(async () => { await new Promise((resolve) => prover.close(resolve)); });
afterEach(() => { delete process.env.SETTLEMENT_PROOF_ENABLED; });

// ── F1 ──────────────────────────────────────────────────────────────────────

test('F1: the code guard is false; changing it is a reviewed code change', () => {
  assert.equal(flag.SETTLEMENT_TIER_CLAIMS_SIGNED, false);
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/settlement-proof-flag.js'), 'utf8');
  assert.match(src, /export const SETTLEMENT_TIER_CLAIMS_SIGNED = false;/);
  assert.doesNotMatch(src, /Reopening is a config change/);
  assert.match(src, /in_proof true and a\s+\*\s+matching non-zero v2 payment commitment/);
  assert.doesNotMatch(src, /process\.env\.[A-Z_]*SIGNED/, 'the guard is never read from the environment');
});

test('F1: SETTLEMENT_PROOF_ENABLED=true stays off and warns once', () => {
  const warnings = [];
  const orig = logger.warn;
  logger.warn = (...args) => { warnings.push(args); };
  try {
    assert.equal(flag.settlementProofRequestedByEnv({ SETTLEMENT_PROOF_ENABLED: 'true' }), true);
    assert.equal(flag.settlementProofEnabled({ SETTLEMENT_PROOF_ENABLED: 'true' }), false);
    process.env.SETTLEMENT_PROOF_ENABLED = 'true';
    assert.equal(flag.settlementProofEnabled(), false);
    flag.warnIfSettlementProofIgnored();
    assert.equal(warnings.length, 1, 'one warning, not one per request');
    assert.match(String(warnings[0][1]), /SETTLEMENT_PROOF_ENABLED=true is ignored/);
    assert.equal(flag.settlementProofEnabled({}), false);
  } finally {
    logger.warn = orig;
  }
});

test('F1: the refusal middleware still refuses with SETTLEMENT_PROOF_ENABLED=true', () => {
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  let status = null; let nexted = false;
  const res = { status(s) { status = s; return this; }, json(b) { this.body = b; return this; } };
  flag.refuseSettlementProofWhenOff({ body: { proof_tier: 'settlement' } }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(status, 400);
  assert.equal(res.body.error.code, 'settlement_proof_not_offered');
});

test('F1: the test override cannot be used outside NODE_ENV=test', () => {
  const prev = process.env.NODE_ENV;
  try {
    for (const env of ['production', 'development', '']) {
      process.env.NODE_ENV = env;
      assert.throws(() => flag._allowSettlementProofForTests(true), /test-only/);
    }
  } finally {
    process.env.NODE_ENV = prev;
  }
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  assert.equal(flag.settlementProofEnabled(), false, 'a refused override changes nothing');
});

// ── F2 ──────────────────────────────────────────────────────────────────────

test('F2: tier2_above cannot be set while off (env true included); clearing still works', () => {
  for (const value of [undefined, 'true']) {
    if (value) process.env.SETTLEMENT_PROOF_ENABLED = value;
    const policy = new BookPolicyStore();
    const r = policy.set(1, POLICY_TYPES.TIER2_ABOVE, '50000');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'settlement_proof_not_offered');
    assert.match(r.reason, /not currently offered/);
    assert.equal(policy.set(1, POLICY_TYPES.TIER2_ABOVE, null).ok, true);
  }
});

test('F2: an existing tier2_above names the exit instead of an unusable proof_tier', () => {
  const policy = new BookPolicyStore();
  // A policy stored before the add-on was switched off.
  policy.byAgent.set(1, { agent_id: 1, tier2_above: { threshold: '50000' } });
  for (const proof_tier of [undefined, 'settlement', 'inference']) {
    const blocked = enforcePolicy(1, { amount: '60000', proof_tier }, { policy });
    assert.equal(blocked.allowed, false, String(proof_tier));
    assert.equal(blocked.code, 'tier2_unavailable');
    assert.match(blocked.reason, /clear or raise tier2_above/);
    assert.doesNotMatch(blocked.reason, /requires proof_tier/);
  }
  assert.equal(enforcePolicy(1, { amount: '40000' }, { policy }).allowed, true, 'below threshold unaffected');
  assert.equal(policy.set(1, POLICY_TYPES.TIER2_ABOVE, null).ok, true);
  assert.equal(enforcePolicy(1, { amount: '60000' }, { policy }).allowed, true, 'cleared policy lets the spend through');
});

// ── F4 ──────────────────────────────────────────────────────────────────────

test('F4: prover init while off makes no request and starts no polling', async () => {
  process.env.SETTLEMENT_PROOF_ENABLED = 'true'; // env alone: still off
  const client = await initSP1Prover();
  assert.ok(client, 'client object exists (prover-configured checks unchanged)');
  assert.equal(getSP1Prover(), client);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(hits, 0, 'no health, metrics or fallback request');
  // The /health metrics path passes null while off; null never probes.
  assert.equal(refreshProverProbe(flag.settlementProofEnabled() ? client : null), null);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(hits, 0);
});

test('F4 control: with the add-on on, the health probe does reach the prover', async () => {
  flag._allowSettlementProofForTests(true);
  process.env.SETTLEMENT_PROOF_ENABLED = 'true';
  const p = refreshProverProbe(flag.settlementProofEnabled() ? getSP1Prover() : null);
  assert.ok(p, 'probe started');
  await p;
  assert.ok(hits > 0);
});

// ── F5 ──────────────────────────────────────────────────────────────────────

test('F5: the seven listed docs no longer present the add-on as live', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const banned = {
    'docs/RECEIPT_SCHEMA_V2.md': [/itemized `payment\.tier2_proof` \(\$0\.10\)/],
    'packages/sdk/examples/flagship-demo.ts': [/opt-in \$0\.10/],
    'docs/product/escrow-helper.md': [/"proof_tier": "settlement"/],
    'docs/product/policy-and-audit.md': [/`inference` \|$/m],
    'skills/openclaw-chit402/SKILL.md': [/unless explicitly asked/],
    'docs/M2M_API.md': [/settlement proof when available/],
  };
  for (const [file, patterns] of Object.entries(banned)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const re of patterns) assert.doesNotMatch(text, re, `${file}: ${re}`);
  }
  const smoke = fs.readFileSync(path.join(root, 'docs/product/tier2-in-proof-binding-smoke.md'), 'utf8');
  assert.match(smoke.split('\n').slice(0, 5).join('\n'), /Not currently offered/);
  assert.match(fs.readFileSync(path.join(root, 'docs/product/policy-and-audit.md'), 'utf8'), /tier2_unavailable/);
});
