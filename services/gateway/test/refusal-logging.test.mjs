/**
 * Settle refusals log their real network and a bounded sub_reason and phase.
 *
 * - Each refusal path in test/fixtures/refusal-scenarios.mjs logs exactly one
 *   count with its network (unknown stays `other`), code, sub_reason, phase.
 * - A spent nonce logs spent_nonce, never the mismatched field.
 * - Leak test: a child process runs every path with dummy secrets and a
 *   debug logger; stdout, stderr, the failure file and the breakdown carry
 *   no signature, authorization nonce, challenge nonce or payment header.
 * - refusalBreakdown windows, the ops route switch and the read-only
 *   scripts/refusal-counts.mjs (against a local server) work.
 * - Source scan: every sub_reason literal in x402-settle.js is on the list.
 * Responses are pinned separately (refusal-body-pin.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REFUSAL_SUB_REASONS,
  recordReceiptFailure,
  refusalBreakdown,
  listReceiptFailures,
  receiptFailureCsv,
  resetReceiptFailuresForTests,
} from '../src/receipt-failures.js';
import { SCENARIOS, attempt, RESOURCE } from './fixtures/refusal-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY = path.resolve(HERE, '..');
const SETTLE_SRC = fs.readFileSync(path.join(GATEWAY, 'src', 'x402-settle.js'), 'utf8');
const SERVER_SRC = fs.readFileSync(path.join(GATEWAY, 'src', 'server.js'), 'utf8');

/** Paths whose challenge is missing or names a network we do not count. */
const NETWORK_OTHER = new Set(['no_nonce', 'challenge_unknown', 'network_not_allowed']);

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  test(`refusal logs its network, code, sub_reason and phase: ${name}`, async () => {
    resetReceiptFailuresForTests();
    const { decision } = await scenario.run();
    assert.ok(decision?.kind === 'failed', `${name}: expected a refusal`);
    const [reason, sub, phase] = scenario.want;
    const out = refusalBreakdown();
    assert.equal(out.total, 1, `${name}: one refusal counted, got ${JSON.stringify(out.counts)}`);
    assert.deepEqual(out.counts, [{
      network: NETWORK_OTHER.has(name) ? 'other' : 'base',
      reason,
      sub_reason: sub,
      phase,
      count: 1,
    }], name);
  });
}

test('a spent nonce logs spent_nonce, not the mismatched field', async () => {
  resetReceiptFailuresForTests();
  const first = await attempt({});
  assert.equal(first.decision?.kind, 'settled', `setup settle: ${JSON.stringify(first.decision)}`);
  resetReceiptFailuresForTests();
  const again = await attempt({
    store: first.store, nonce: first.nonce, challenge: null,
    call: { resource: `${RESOURCE}-other` },
  });
  assert.equal(again.decision?.code, 'payment_replayed');
  const out = refusalBreakdown();
  assert.equal(out.counts.length, 1, JSON.stringify(out.counts));
  assert.equal(out.counts[0].sub_reason, 'spent_nonce');
  assert.equal(out.counts[0].reason, 'payment_replayed');
});

test('post-submit refusal rows carry sub_reason and phase; the CSV columns do not change', async () => {
  resetReceiptFailuresForTests();
  await SCENARIOS.settle_http.run();
  const rows = listReceiptFailures();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sub_reason, 'http');
  assert.equal(rows[0].phase, 'post_submit');
  const header = receiptFailureCsv(rows).split('\n')[0];
  assert.equal(header, 'time,network,stage,reason,tx,outcome,request_id');
});

test('an unlisted sub_reason or free text logs as other', () => {
  resetReceiptFailuresForTests();
  recordReceiptFailure({ preSettle: true, network: 'base', reason: 'challenge_mismatch', sub_reason: '0xdeadbeef payer' });
  recordReceiptFailure({ preSettle: true, network: 'eip155:1', reason: 'not_a_code', sub_reason: { toString: () => 'resource' } });
  const out = refusalBreakdown();
  assert.deepEqual(out.counts.map((c) => [c.network, c.reason, c.sub_reason]), [
    ['base', 'challenge_mismatch', 'other'],
    ['other', 'other', 'other'],
  ]);
});

test('refusalBreakdown counts over [since, until) and rejects a bad bound', () => {
  resetReceiptFailuresForTests();
  const at = (iso, sub) => recordReceiptFailure({ preSettle: true, network: 'base', reason: 'challenge_mismatch', sub_reason: sub, time: iso });
  at('2026-10-26T10:15:00Z', 'resource');
  at('2026-10-26T10:45:00Z', 'resource');
  at('2026-10-26T12:05:00Z', 'amount_short');
  at('2026-10-27T01:00:00Z', 'payto_house');
  recordReceiptFailure({
    network: 'eip155:8453', stage: 'confirm', reason: 'settle_unconfirmed', outcome: 'pending',
    sub_reason: 'chain_mismatch', phase: 'post_submit', time: '2026-10-26T12:30:00Z',
  });
  const day = refusalBreakdown({ since: '2026-10-26T00:00:00Z', until: '2026-10-27T00:00:00Z' });
  assert.equal(day.bucket, 'hour');
  assert.equal(day.total, 4);
  assert.deepEqual(day.counts, [
    { network: 'base', reason: 'challenge_mismatch', sub_reason: 'amount_short', phase: 'pre_settle', count: 1 },
    { network: 'base', reason: 'challenge_mismatch', sub_reason: 'resource', phase: 'pre_settle', count: 2 },
    { network: 'base', reason: 'settle_unconfirmed', sub_reason: 'chain_mismatch', phase: 'post_submit', count: 1 },
  ]);
  const late = refusalBreakdown({ since: '2026-10-26T12:00:00Z' });
  assert.equal(late.total, 3);
  assert.equal(refusalBreakdown({ since: 'yesterday-ish' }), null);
  assert.equal(refusalBreakdown({ until: 'nope' }), null);
  // Read-only: asking twice gives the same answer.
  assert.deepEqual(refusalBreakdown({ since: '2026-10-26T00:00:00Z', until: '2026-10-27T00:00:00Z' }), day);
});

test('every sub_reason literal in x402-settle.js is on the fixed list', () => {
  const listed = new Set(REFUSAL_SUB_REASONS);
  const literals = new Set();
  for (const re of [/\bsub: '([a-z_]+)'/g, /\bmismatch\('([a-z_]+)'\)/g, /\bdeny\([^,]+, '([a-z_]+)'/g, /\bhold\('([a-z_]+)'/g, /: '(bind_[a-z_]+)'/g]) {
    for (const m of SETTLE_SRC.matchAll(re)) literals.add(m[1]);
  }
  assert.ok(literals.size >= 40, `scan found only ${literals.size} literals`);
  for (const lit of literals) assert.ok(listed.has(lit), `sub_reason '${lit}' is not in REFUSAL_SUB_REASONS`);
  assert.ok(!/return mismatch\(\);/.test(SETTLE_SRC), 'a mismatch() call has no sub_reason');
  assert.ok(!/refused\(req, '[a-z_]+'\);/.test(SETTLE_SRC), 'a refused() call has no network or sub_reason');
  assert.ok(!/\{ preSettle: true \}\)/.test(SETTLE_SRC), 'a pre-settle refusal has no network or sub_reason');
});

test('the ops route serves the breakdown only on ?breakdown=1, behind the same token', () => {
  const route = SERVER_SRC.slice(SERVER_SRC.indexOf("app.get('/v1/ops/receipt-failures'"));
  const handler = route.slice(0, route.indexOf('\n  });\n'));
  assert.ok(/receiptFailuresAuth\(extractReceiptFailuresToken\(req\)\)/.test(handler), 'route keeps its token check');
  const auth = handler.indexOf('receiptFailuresAuth(');
  const branch = handler.indexOf("req.query?.breakdown === '1'");
  assert.ok(auth >= 0 && branch > auth, 'the breakdown branch runs after the token check');
  assert.ok(/refusal_breakdown: refusalBreakdown\(/.test(handler), 'breakdown branch returns refusalBreakdown');
  assert.ok(/res\.json\(\{ failures, refusal_counts: refusalCounts, escrow_refusals: escrowRefusals, alert_rows_dropped: droppedAlertRows \}\)/.test(handler),
    'the default ops response is unchanged');
});

function stubOps(reply) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(reply));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)),
  })));
}

function runScript(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(GATEWAY, 'scripts', 'refusal-counts.mjs'), ...args], {
      env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('scripts/refusal-counts.mjs GETs the breakdown and prints JSON, never the token', async () => {
  const breakdown = { since: '2026-10-26T00:00:00.000Z', until: null, bucket: 'hour', total: 2, counts: [{ network: 'base', reason: 'challenge_mismatch', sub_reason: 'resource', phase: 'pre_settle', count: 2 }] };
  const ops = await stubOps({ refusal_breakdown: breakdown });
  const token = 'dummy-ops-token-7f3a9c';
  try {
    const out = await runScript(['--base', ops.base, '--since', '2026-10-26T00:00:00Z'], { OPS_READ_TOKEN: token });
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), { refusal_breakdown: breakdown });
    assert.equal(ops.seen.length, 1);
    assert.equal(ops.seen[0].method, 'GET');
    assert.ok(/^\/v1\/ops\/receipt-failures\?breakdown=1&since=2026-10-26T00%3A00%3A00Z$/.test(ops.seen[0].url), ops.seen[0].url);
    assert.equal(ops.seen[0].auth, `Bearer ${token}`);
    assert.ok(!(out.stdout + out.stderr).includes(token), 'token printed');
    const missing = await runScript(['--base', ops.base], {});
    assert.equal(missing.code, 1);
    assert.ok(/OPS_READ_TOKEN is not set/.test(missing.stderr));
  } finally {
    await ops.close();
  }
});

test('leak test: no signature, nonce or payment header in logs, rows or counts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refusal-leak-'));
  const file = path.join(dir, 'failures.jsonl');
  const fixture = path.join(HERE, 'fixtures', 'refusal-scenarios.mjs');
  const rf = path.join(GATEWAY, 'src', 'receipt-failures.js');
  const code = `
    const { SCENARIOS, paymentHeader } = await import(${JSON.stringify(fixture)});
    const rf = await import(${JSON.stringify(rf)});
    const nonces = [];
    for (const s of Object.values(SCENARIOS)) { const r = await s.run(); if (r.nonce) nonces.push(r.nonce); }
    process.stdout.write('\\n@@BREAKDOWN@@' + JSON.stringify(rf.refusalBreakdown()) + '\\n');
    process.stdout.write('@@ROWS@@' + JSON.stringify(rf.listReceiptFailures()) + '\\n');
    process.stdout.write('@@NONCES@@' + JSON.stringify(nonces) + '\\n');
    process.stdout.write('@@HEADER@@' + paymentHeader() + '\\n');
    process.exit(0);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: GATEWAY,
    env: { ...process.env, LOG_LEVEL: 'trace', RECEIPT_FAILURES_FILE: file, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  const exit = await new Promise((r) => child.on('close', r));
  assert.equal(exit, 0, stderr.slice(-2000));
  const pick = (tag) => (stdout.split(`@@${tag}@@`)[1] || '').split('\n')[0];
  const nonces = JSON.parse(pick('NONCES'));
  const header = pick('HEADER');
  assert.ok(nonces.length >= 15, 'scenarios ran');
  const logs = stdout.split('\n@@BREAKDOWN@@')[0] + stderr;
  const fileText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  assert.ok(fileText.includes('"sub_reason"'), 'post-submit rows reached the failure file');
  assert.ok(/"sub_reason"/.test(logs), 'refusal log lines were written');
  const haystacks = { logs, file: fileText, breakdown: pick('BREAKDOWN'), rows: pick('ROWS') };
  const needles = {
    signature: '5e5e5e5e5e5e5e5e',
    auth_nonce: 'a7a7a7a7a7a7a7a7',
    other_auth_nonce: 'b8b8b8b8b8b8b8b8',
    header_prefix: header.slice(0, 24),
    header_tail: header.slice(-24),
    ...Object.fromEntries(nonces.map((n, i) => [`challenge_nonce_${i}`, n.slice(2)])),
  };
  for (const [where, text] of Object.entries(haystacks)) {
    for (const [what, needle] of Object.entries(needles)) {
      assert.ok(!text.toLowerCase().includes(needle.toLowerCase()), `${what} leaked into ${where}`);
    }
    assert.ok(!/authorization"\s*:/i.test(text), `an authorization object leaked into ${where}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
