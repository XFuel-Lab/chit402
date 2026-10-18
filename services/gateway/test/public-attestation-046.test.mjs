/**
 * 0.4.6 public receipt attestation: issuance, store, worker, serve flag.
 * Throwaway P-256 key behind a fake signer. No KMS, no network, no prod.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'public-attestation-046-secret';
process.env.AGENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chit-pa046-agents-'));
delete process.env.PUBLIC_ATTESTATION_SIGN;
delete process.env.PUBLIC_ATTESTATION_SERVE;

const here = path.dirname(fileURLToPath(import.meta.url));
const verifyDist = path.join(here, '..', '..', '..', 'packages', 'verify', 'dist');

const pa = await import('../src/public-attestation.js');
const storeMod = await import('../src/public-attestation-store.js');
const { createPublicAttestationWorker, PUBLIC_ATTESTATION_DEFAULTS } = await import('../src/public-attestation-worker.js');
const { _setIssuerSignerForTest } = await import('../src/issuer-signer.js');
const { readCapUsage, consumeReceiptSlot } = await import('../src/issuance-cap.js');
const verifier = await import(path.join(verifyDist, 'public-attestation.js'));
const verifierJws = await import(path.join(verifyDist, 'jws.js'));

const TASK = 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ROW = 'row-hash-pa046';
const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const PAYER = '0x9999999999999999999999999999999999999999';
const TX = `0x${'ab'.repeat(32)}`;
const MODEL = 'hidden-model-pa046';

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const publicJwk = { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
  const kid = verifierJws.jwkThumbprint(publicJwk);
  return { privateKey, publicJwk, kid };
}

function fakeSigner(key, log = []) {
  return {
    kind: 'test',
    kid: key.kid,
    publicJwk: key.publicJwk,
    async sign(buf) {
      log.push(Buffer.from(buf).toString('utf8'));
      return crypto.sign('sha256', buf, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    },
  };
}

function holderJwsFor(key, over = {}) {
  const claims = {
    task_id: TASK,
    iss: 'chit402',
    iat: '2026-10-17T18:29:41.512Z',
    payment: {
      rail: 'usdc', ref: `base:${TX}`, asset: pa.BASE_USDC, payee: PAYEE,
      gross_amount: '2000', settled_amount: '2000', net_amount: '1990', fee_amount: '10',
    },
    caller_binding: { payer_wallet: PAYER },
    route: { model: MODEL, provider: 'hidden-provider' },
    book_chain: { row_hash: ROW, book_id: 4 },
    output: { hash: `0x${'cd'.repeat(32)}` },
    request_digest: 'digest-secret',
    payload_version: 10,
    ...over,
  };
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: key.kid })}.${b(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function entryFor(over = {}) {
  return {
    task_id: TASK, payment_ref: `base:${TX}`, payer: PAYER, agent_id: 4,
    collected: true, evidence: 'collected', rail: 'usdc', row_hash: ROW, ...over,
  };
}

function treeWith(taskId, rowHash, { index = 3, epoch = 1 } = {}) {
  const leaves = [];
  for (let i = 0; i < index; i += 1) leaves.push(Buffer.from(pa.leafHashOf(`pad-${i}`, 'x'), 'hex'));
  leaves.push(Buffer.from(pa.leafHashOf(taskId, rowHash), 'hex'));
  const byTask = new Map([[taskId, index]]);
  return { _locate: (id) => (byTask.has(String(id)) ? { epoch, leaves, byTask } : null) };
}

function historyFor(key) {
  return {
    entries: [{
      kid: key.kid, jwk: { ...key.publicJwk, kid: key.kid, alg: 'ES256', use: 'sig' },
      alg: 'ES256', not_before: '2020-01-01T00:00:00.000Z', not_after: null,
      status: 'active', revoked_at: null,
    }],
  };
}

function setup({ tree, entry = entryFor(), holder, now, env = {}, sign, alerts = [], extra = {} } = {}) {
  const store = new storeMod.PublicAttestationStore({ alert: (e) => alerts.push(e) });
  const worker = createPublicAttestationWorker({
    store,
    tree: () => tree,
    findEntry: (id) => (entry && String(id) === entry.task_id ? entry : null),
    holderJws: () => holder,
    now: now || (() => Date.parse('2026-10-17T18:30:12.000Z')),
    alert: (e) => alerts.push(e),
    env: { ...env },
    ...(sign ? { sign } : {}),
    ...extra,
  });
  return { store, worker, alerts };
}

const issuer = keypair();
const signLog = [];
before(() => {
  _setIssuerSignerForTest(fakeSigner(issuer, signLog));
});

test('allowlist: the signed public claims are exactly the allowlist and leak nothing private', async () => {
  const holder = holderJwsFor(issuer);
  const { store, worker } = setup({ tree: treeWith(TASK, ROW), holder });
  await worker.enqueue(entryFor());
  await worker.tick();
  const row = await store.get(TASK);
  assert.equal(row.state, 'signed', JSON.stringify(row));
  const [h, p] = row.jws.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', typ: pa.PUBLIC_RECEIPT_TYP, kid: issuer.kid });
  const payload = Buffer.from(p, 'base64url').toString('utf8');
  assert.ok(payload.startsWith('chit402.public_receipt.v1\n{'));
  assert.throws(() => JSON.parse(payload), 'the payload must not parse as JSON');
  const claims = JSON.parse(payload.slice(payload.indexOf('\n') + 1));
  assert.deepEqual(Object.keys(claims).sort(), [...pa.PUBLIC_CLAIM_KEYS]);
  assert.deepEqual(Object.keys(claims.payment).sort(), [...pa.PUBLIC_PAYMENT_KEYS]);
  assert.deepEqual(Object.keys(claims.log).sort(), [...pa.PUBLIC_LOG_KEYS]);
  assert.deepEqual(claims, {
    attested_at: '2026-10-17T18:30:00.000Z',
    iss: 'chit402',
    issued_at: '2026-10-17T18:29:00.000Z',
    log: { epoch: 1, leaf_hash: pa.leafHashOf(TASK, ROW), leaf_index: 3 },
    payment: { asset: pa.BASE_USDC, gross_amount: '2000', payee: PAYEE, rail: 'usdc', ref: `base:${TX}`, settled_amount: '2000' },
    task_id: TASK,
  });
  for (const banned of [PAYER.toLowerCase(), MODEL, 'hidden-provider', ROW, 'digest-secret', 'book_id', 'payload_version', '"v"', 'net_amount', 'fee_amount', 'payload_hash', 'payer']) {
    assert.equal(payload.toLowerCase().includes(banned.toLowerCase()), false, banned);
  }
  // Gateway lists and verifier lists are the same lists.
  assert.deepEqual([...pa.PUBLIC_CLAIM_KEYS], [...verifier.PUBLIC_RECEIPT_CLAIM_KEYS]);
  assert.deepEqual([...pa.PUBLIC_PAYMENT_KEYS], [...verifier.PUBLIC_RECEIPT_PAYMENT_KEYS]);
  assert.deepEqual([...pa.PUBLIC_LOG_KEYS], [...verifier.PUBLIC_RECEIPT_LOG_KEYS]);
});

test('the gateway output parses and verifies in the 0.4.6 verifier and is refused by verifyIssuerJws', async () => {
  const { store, worker } = setup({ tree: treeWith(TASK, ROW), holder: holderJwsFor(issuer) });
  await worker.enqueue(entryFor());
  await worker.tick();
  const jws = (await store.get(TASK)).jws;
  const parsed = verifier.parsePublicAttestation(jws);
  assert.equal(parsed.ok, true, parsed.detail);
  const trust = verifier.verifyPublicAttestationTrust(parsed, historyFor(issuer));
  assert.equal(trust.ok, true, trust.reason);
  const asReceipt = verifierJws.verifyIssuerJws(jws, { ...issuer.publicJwk, kid: issuer.kid });
  assert.equal(asReceipt.valid, false);
  assert.equal(asReceipt.reason, 'typ_mismatch');
});

test('M4 a stored leaf that is not SHA256(0x00 || task_id|row_hash) is never signed', async () => {
  const alerts = [];
  const before = signLog.length;
  const { store, worker } = setup({ tree: treeWith(TASK, 'another-row'), holder: holderJwsFor(issuer), alerts });
  await worker.enqueue(entryFor());
  await worker.tick();
  assert.equal((await store.get(TASK)).state, 'failed');
  assert.equal((await store.get(TASK)).last_error, 'leaf_mismatch');
  assert.equal(signLog.length, before);
  assert.ok(alerts.some((a) => a.event === 'public_attestation_failed'));
  assert.equal(await store.servedAttestation(TASK), null);
});

test('M2 no leaf yet: retried with backoff, never signed before the leaf exists', async () => {
  let t = Date.parse('2026-10-17T18:30:12.000Z');
  const before = signLog.length;
  const tree = { _locate: () => null };
  const { store, worker } = setup({ tree, holder: holderJwsFor(issuer), now: () => t });
  await worker.enqueue(entryFor());
  await worker.tick();
  const row = await store.get(TASK);
  assert.equal(row.state, 'pending');
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'not_in_log');
  assert.equal(row.next_at, t + 30_000);
  assert.equal(signLog.length, before);
  assert.deepEqual(await store.servedAttestation(TASK), { status: 'pending' });
});

test('M2 eligibility: only collected native Base USDC with a positive settled amount', () => {
  const claims = JSON.parse(Buffer.from(holderJwsFor(issuer).split('.')[1], 'base64url'));
  assert.deepEqual(pa.publicAttestationEligibility(entryFor(), claims), { ok: true });
  const no = (entry, c = claims) => assert.equal(pa.publicAttestationEligibility(entry, c).ok, false, JSON.stringify(entry));
  no(entryFor({ collected: false }));
  no(entryFor({ evidence: 'inflow_claimed' }));
  no(entryFor({ evidence: 'a2a_escrow' }));
  no(entryFor({ evidence: 'board_stamp' }));
  no(entryFor({ evidence: 'policy_blocked' }));
  no(entryFor({ foreign_x402: true, source: 'foreign_ingest' }));
  no(entryFor({ source: 'openrouter_broadcast' }));
  no(entryFor({ source: 'late_issue' }));
  no(entryFor({ refusal: { refusal_id: 'r' } }));
  no(entryFor({ task_id: 'xfuel-ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }));
  no(entryFor({ payment_ref: `base:0x${'ee'.repeat(32)}` }));
  no(entryFor(), { ...claims, payment: { ...claims.payment, ref: `solana:${'5'.repeat(87)}` } });
  no(entryFor(), { ...claims, payment: { ...claims.payment, asset: PAYER } });
  no(entryFor(), { ...claims, payment: { ...claims.payment, rail: 'reported' } });
  no(entryFor(), { ...claims, payment: { ...claims.payment, settled_amount: null } });
  no(entryFor(), { ...claims, payment: { ...claims.payment, settled_amount: '0' } });
  no(entryFor(), { ...claims, iat: undefined });
});

test('M7 signer outage: bounded backoff, then failed plus an alert; never parks a late submission', async () => {
  let t = Date.parse('2026-10-17T18:30:12.000Z');
  const alerts = [];
  let calls = 0;
  const sign = async () => { calls += 1; const e = new Error('kms down'); e.code = 'kms_unavailable'; throw e; };
  const { store, worker } = setup({ tree: treeWith(TASK, ROW), holder: holderJwsFor(issuer), now: () => t, sign, alerts, extra: { maxAttempts: 5 } });
  await worker.enqueue(entryFor());
  const delays = [];
  for (let i = 0; i < 10; i += 1) {
    const prev = (await store.get(TASK)).next_at;
    t = Math.max(t, prev);
    await worker.tick();
    const row = await store.get(TASK);
    if (row.state !== 'pending') break;
    delays.push(row.next_at - t);
    t += 60 * 60_000; // refill the rate bucket
  }
  assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000]);
  assert.equal((await store.get(TASK)).state, 'failed');
  assert.equal((await store.get(TASK)).last_error, 'kms_unavailable');
  assert.equal(calls, 5);
  assert.ok(alerts.some((a) => a.event === 'public_attestation_failed'));
  assert.equal(await store.servedAttestation(TASK), null);
  // Backoff is capped at 30 minutes.
  const capped = setup({ tree: treeWith(TASK, ROW), holder: holderJwsFor(issuer), now: () => t, sign, extra: { maxAttempts: 50 } });
  await capped.worker.enqueue(entryFor());
  for (let i = 0; i < 12; i += 1) {
    t = Math.max(t, (await capped.store.get(TASK)).next_at) + 60 * 60_000;
    await capped.worker.tick();
  }
  assert.equal((await capped.store.get(TASK)).next_at - t, 30 * 60_000);
});

test('M7 a hung signer times out and is retried', async () => {
  const sign = () => new Promise(() => {});
  const { store, worker } = setup({ tree: treeWith(TASK, ROW), holder: holderJwsFor(issuer), sign, extra: { signTimeoutMs: 20 } });
  await worker.enqueue(entryFor());
  await worker.tick();
  assert.equal((await store.get(TASK)).state, 'pending');
  assert.equal((await store.get(TASK)).last_error, 'sign_timeout');
  assert.ok(worker.stats().sign_ms.le_50 >= 1);
});

test('M7 rate cap and one sign at a time', async () => {
  const many = Array.from({ length: 5 }, (_, i) => `xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4${i}`);
  let inFlight = 0;
  let maxInFlight = 0;
  const sign = async (payload) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const signer = fakeSigner(issuer);
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${b({ alg: 'ES256', typ: pa.PUBLIC_RECEIPT_TYP, kid: issuer.kid })}.${Buffer.from(payload).toString('base64url')}`;
    return { jws: `${input}.${(await signer.sign(Buffer.from(input))).toString('base64url')}`, kid: issuer.kid };
  };
  const store = new storeMod.PublicAttestationStore();
  const trees = new Map(many.map((id, i) => [id, i]));
  const tree = {
    _locate: (id) => (trees.has(id) ? { epoch: 1, byTask: new Map([[id, 0]]), leaves: [Buffer.from(pa.leafHashOf(id, ROW), 'hex')] } : null),
  };
  const worker = createPublicAttestationWorker({
    store,
    tree: () => tree,
    findEntry: (id) => entryFor({ task_id: id, payment_ref: `base:0x${String(trees.get(id)).repeat(64)}` }),
    holderJws: (id) => holderJwsFor(issuer, { task_id: id, payment: { ...JSON.parse(Buffer.from(holderJwsFor(issuer).split('.')[1], 'base64url')).payment, ref: `base:0x${String(trees.get(id)).repeat(64)}` } }),
    now: () => Date.parse('2026-10-17T18:30:12.000Z'),
    env: { PUBLIC_ATTESTATION_SIGNS_PER_MIN: '2' },
    sign,
  });
  for (const id of many) await worker.enqueue(entryFor({ task_id: id, payment_ref: `base:0x${String(trees.get(id)).repeat(64)}` }));
  await Promise.all([worker.tick(), worker.tick(), worker.tick()]);
  assert.equal(store.counts().signed, 2);
  assert.equal(store.counts().pending, 3);
  assert.equal(maxInFlight, 1);
  assert.ok(worker.stats().throttled >= 1);
});

test('M7 attestation signing never consumes or waits on the receipt issuance cap', async () => {
  const saved = { h: process.env.ISSUER_CAP_RECEIPTS_PER_HOUR, d: process.env.ISSUER_CAP_RECEIPTS_PER_DAY };
  process.env.ISSUER_CAP_RECEIPTS_PER_HOUR = '1';
  process.env.ISSUER_CAP_RECEIPTS_PER_DAY = '100';
  try {
    consumeReceiptSlot(); // the cap is now full for receipts
    const usage = readCapUsage();
    assert.equal(usage.hour_used, 1);
    const { store, worker } = setup({ tree: treeWith(TASK, ROW), holder: holderJwsFor(issuer) });
    await worker.enqueue(entryFor());
    await worker.tick();
    assert.equal((await store.get(TASK)).state, 'signed');
    assert.deepEqual(readCapUsage(), usage);
  } finally {
    if (saved.h === undefined) delete process.env.ISSUER_CAP_RECEIPTS_PER_HOUR; else process.env.ISSUER_CAP_RECEIPTS_PER_HOUR = saved.h;
    if (saved.d === undefined) delete process.env.ISSUER_CAP_RECEIPTS_PER_DAY; else process.env.ISSUER_CAP_RECEIPTS_PER_DAY = saved.d;
  }
});

test('one attestation per task and per payment ref; a second different JWS is refused', async () => {
  const alerts = [];
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chit-pa046-store-')), 'public-attestations');
  const store = new storeMod.PublicAttestationStore({ dir, alert: (e) => alerts.push(e) });
  const ref = `base:${TX}`;
  assert.equal((await store.enqueue({ taskId: TASK, ref })).ok, true);
  assert.equal((await store.enqueue({ taskId: TASK, ref })).duplicate, true);
  const twin = await store.enqueue({ taskId: 'xfuel-11111111-4e5f-4a6b-8c7d-9e0f1a2b3c4d', ref });
  assert.equal(twin.ok, false);
  assert.equal(twin.reason, 'duplicate_ref');
  assert.ok(alerts.some((a) => a.event === 'public_attestation_duplicate_ref'));
  assert.deepEqual(await store.markSigned(TASK, { jws: 'a.b.c', kid: 'k' }), { ok: true, duplicate: false });
  assert.deepEqual(await store.markSigned(TASK, { jws: 'a.b.c', kid: 'k' }), { ok: true, duplicate: true });
  assert.deepEqual(await store.markSigned(TASK, { jws: 'x.y.z', kid: 'k' }), { ok: false, reason: 'conflict' });
  assert.ok(alerts.some((a) => a.event === 'public_attestation_conflict'));
  assert.equal((await store.get(TASK)).jws, 'a.b.c');
  // Durable on disk: a reload sees the same rows. The signed row is created
  // once and the pending row is gone. No temp file is left.
  const reloaded = new storeMod.PublicAttestationStore({ dir });
  assert.deepEqual(await reloaded.servedAttestation(TASK), { jws: 'a.b.c' });
  assert.equal(await reloaded.taskForRef(ref), TASK);
  assert.equal((await reloaded.get('xfuel-11111111-4e5f-4a6b-8c7d-9e0f1a2b3c4d')).state, 'skipped');
  assert.equal(reloaded.counts().pending, 0);
  const all = [];
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walk(f); else all.push(path.relative(dir, f)); } };
  walk(dir);
  assert.equal(all.filter((f) => f.endsWith('.tmp')).length, 0);
  assert.deepEqual(all.filter((f) => f.startsWith('pending')), []);
  assert.equal(all.filter((f) => f.startsWith('done')).length, 2);
  assert.equal(all.filter((f) => f.startsWith('refs')).length, 1);
  // File names never carry the task id or ref.
  assert.equal(all.some((f) => f.includes(TASK) || f.includes(TX.slice(2))), false);
  // Worker on a signed row is a no-op.
  const { worker } = setup({ tree: treeWith(TASK, ROW), holder: holderJwsFor(issuer) });
  assert.equal((await worker.enqueue(entryFor())).duplicate, false);
});

test('flags default off', () => {
  assert.equal(storeMod.publicAttestationSignEnabled({}), false);
  assert.equal(storeMod.publicAttestationServeEnabled({}), false);
  assert.equal(storeMod.publicAttestationSignEnabled({ PUBLIC_ATTESTATION_SIGN: '1' }), false);
  assert.equal(storeMod.publicAttestationServeEnabled({ PUBLIC_ATTESTATION_SERVE: 'true' }), true);
  // T10 bounds: 3 s sign timeout, 20 attempts, 30 s doubling to 30 min, 30 signs a minute.
  assert.equal(PUBLIC_ATTESTATION_DEFAULTS.signTimeoutMs, 3_000);
  assert.equal(PUBLIC_ATTESTATION_DEFAULTS.maxAttempts, 20);
  assert.equal(PUBLIC_ATTESTATION_DEFAULTS.baseDelayMs, 30_000);
  assert.equal(PUBLIC_ATTESTATION_DEFAULTS.maxDelayMs, 30 * 60_000);
  assert.equal(PUBLIC_ATTESTATION_DEFAULTS.ratePerMinute, 30);
});

test('read paths import no signer, and enqueue never signs inline', async () => {
  const storeSrc = fs.readFileSync(path.join(here, '..', 'src', 'public-attestation-store.js'), 'utf8');
  const pureSrc = fs.readFileSync(path.join(here, '..', 'src', 'public-attestation.js'), 'utf8');
  for (const src of [storeSrc, pureSrc]) {
    assert.doesNotMatch(src, /from '\.\/(issuer-key|issuer-signer|issuer-signer-kms|issuer-signer-state|public-attestation-worker)\.js'/);
  }
  const server = fs.readFileSync(path.join(here, '..', 'src', 'server.js'), 'utf8');
  const serve = server.slice(server.indexOf('async function sendPublicShell'), server.indexOf('function sendPublicMissing'));
  assert.match(serve, /servedAttestation/);
  assert.doesNotMatch(serve, /enqueue|signJws|publicAttestationWorker/);
  // The worker is queued only after a successful leaf append.
  const hook = server.slice(server.indexOf('setBookRowWrittenHook(async'), server.indexOf('setReceiptBoundHook('));
  assert.ok(hook.indexOf('appendReceipt') < hook.indexOf('publicAttestationWorker.enqueue'));
  assert.match(hook, /if \(leafAppended && publicAttestationWorker\)/);
  let signs = 0;
  const { worker } = setup({ tree: treeWith(TASK, ROW), holder: holderJwsFor(issuer), sign: async () => { signs += 1; throw new Error('x'); } });
  worker.stop();
  await worker.enqueue(entryFor());
  assert.equal(signs, 0);
});

// --- App: serve flag, pending page, repeat reads, no signing on read -------

let app;
let server;
let base;
const TASK_APP = TASK;
before(async () => {
  const { createApp } = await import('../src/server.js');
  const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
  await initAIListener();
  app = await createApp();
  getAIListener().activeTasks.set(TASK_APP, {
    taskId: TASK_APP,
    status: 'completed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    intent: { type: 'inference_request', amount: '2000', paymentRail: 'usdc', paymentRef: `base:${TX}`, model: MODEL },
    meta: { payerWallet: PAYER, agentId: 4, provider: 'hidden-provider', payTo: PAYEE },
    outputHash: `0x${'cd'.repeat(32)}`,
  });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});
after(() => {
  delete process.env.PUBLIC_ATTESTATION_SERVE;
  server?.close();
});

function publicSignCount() {
  return signLog.filter((s) => {
    try { return JSON.parse(Buffer.from(s.split('.')[0], 'base64url').toString()).typ === pa.PUBLIC_RECEIPT_TYP; } catch { return false; }
  }).length;
}

async function readShell(fmt = 'json') {
  const res = await fetch(`${base}/receipt/${TASK_APP}${fmt === 'json' ? '?format=json' : ''}`, fmt === 'json' ? {} : { headers: { accept: 'text/html' } });
  return { res, text: await res.text() };
}

test('serve flag off: no field; on: the stored JWS or pending; reads never sign', async () => {
  const store = app.locals.__test.publicAttestations;
  assert.ok(store, 'store configured');
  assert.equal(app.locals.__test.publicAttestationWorker, null, 'worker off by default');

  delete process.env.PUBLIC_ATTESTATION_SERVE;
  const off = await readShell();
  assert.equal(off.res.status, 200, off.text);
  assert.equal('public_attestation' in JSON.parse(off.text), false);
  const offCache = off.res.headers.get('cache-control');
  const offVary = off.res.headers.get('vary');

  process.env.PUBLIC_ATTESTATION_SERVE = 'true';
  const signsBefore = publicSignCount();
  const unknown = await readShell();
  assert.equal('public_attestation' in JSON.parse(unknown.text), false, 'no row: 0.4.5 shell');

  await store.enqueue({ taskId: TASK_APP, ref: `base:${TX}` });
  const pending = await readShell();
  assert.deepEqual(JSON.parse(pending.text).public_attestation, { status: 'pending' });
  const page = await readShell('html');
  assert.match(page.text, /Public attestation pending/);
  assert.doesNotMatch(page.text, /VERIFIED/);

  const shellNow = JSON.parse(off.text);
  const signedFor = (over = {}) => {
    const claims = {
      attested_at: '2026-10-17T18:30:00.000Z',
      iss: 'chit402',
      issued_at: shellNow.issued_at,
      log: { epoch: 1, leaf_hash: pa.leafHashOf(TASK_APP, ROW), leaf_index: 0 },
      payment: {
        asset: pa.BASE_USDC, gross_amount: String(shellNow.amount_gross ?? '2000'), payee: PAYEE, rail: 'usdc',
        ref: `base:${TX}`, settled_amount: String(shellNow.amount_settled ?? '2000'),
      },
      task_id: TASK_APP,
      ...over,
    };
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${b({ alg: 'ES256', typ: pa.PUBLIC_RECEIPT_TYP, kid: issuer.kid })}.${Buffer.from(pa.publicPayloadUtf8(claims)).toString('base64url')}`;
    return `${input}.${crypto.sign('sha256', Buffer.from(input), { key: issuer.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
  const goodJws = signedFor();
  await store.markSigned(TASK_APP, { jws: goodJws, kid: issuer.kid });
  const a = await readShell();
  const b = await readShell();
  assert.equal(a.text, b.text, 'identical repeat reads');
  assert.deepEqual(JSON.parse(a.text).public_attestation, { jws: goodJws });
  assert.equal(a.res.headers.get('cache-control'), offCache);
  assert.equal(a.res.headers.get('vary'), offVary);
  const signedPage = await readShell('html');
  assert.doesNotMatch(signedPage.text, /VERIFIED/);

  // No read created a row or signed an attestation.
  assert.deepEqual([store.counts().pending, store.counts().signed], [0, 1]);
  await readShell();
  await readShell('html');
  assert.equal(publicSignCount(), signsBefore, 'a GET never signs an attestation');

  // A stored attestation that no longer matches the shell is withheld, not served.
  const drifted = signedFor({ payment: { ...pa.attestationClaims(goodJws).payment, gross_amount: '1' } });
  store._cacheSet(TASK_APP, { jws: drifted });
  assert.equal('public_attestation' in JSON.parse((await readShell()).text), false);
  assert.equal(pa.attestationShellDrift(drifted, shellNow), 'amount_gross');
  assert.equal(pa.attestationShellDrift(goodJws, shellNow), null);
  store._cacheSet(TASK_APP, { jws: goodJws });
  assert.deepEqual(JSON.parse((await readShell()).text).public_attestation, { jws: goodJws });
  assert.deepEqual([store.counts().pending, store.counts().signed], [0, 1], 'reads created no row');
});

test('a gateway shell plus its attestation passes the verifier field binding (no claim_mismatch)', async () => {
  const { toPublicShell } = await import('../src/receipt-shell.js');
  const { verifyPublicShell } = await import(path.join(verifyDist, 'check-input.js'));
  const holder = holderJwsFor(issuer);
  const { store, worker } = setup({ tree: treeWith(TASK, ROW), holder });
  await worker.enqueue(entryFor());
  await worker.tick();
  const leafHex = pa.leafHashOf(TASK, ROW);
  const shell = toPublicShell(
    { task_id: TASK, payment: { network: 'base' }, issuer_signature: { jws: holder } },
    { inclusion: { leaf: leafHex, root: 'f'.repeat(64), tree_size: 4, proof: [] }, signedHead: null },
  );
  shell.public_attestation = await store.servedAttestation(TASK);
  const verdict = await verifyPublicShell(shell, {
    history: historyFor(issuer),
    requestedId: TASK.replace('xfuel-', 'chit-'),
    origin: 'http://127.0.0.1:9',
    rpcUrl: 'http://127.0.0.1:9/',
    trustedKids: [issuer.kid],
  });
  assert.equal(verdict.checks.signature, 'pass');
  assert.equal(verdict.checks.key_window, 'pass');
  assert.notEqual(verdict.reason, 'claim_mismatch');
  assert.notEqual(verdict.reason, 'leaf_not_bound');
  assert.equal(verdict.exit_code, 2, verdict.reason);
});
