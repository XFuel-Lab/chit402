/**
 * Operator alerts for refusals in the fixed-head, quarantine list signing and
 * payer binding paths. Each refusal writes one receipt-failure row (stage
 * `sign`, reason `<path>:<code>`) and bumps a per-reason count that only the
 * OPS_READ_TOKEN-gated ops route serves, as `escrow_refusals`. Offline: synthetic test key, local server, no
 * network, no production key.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { syntheticIssuerKey } from '../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';
import { stubSigner } from './helpers/fixed-head-scenario.mjs';

process.env.NODE_ENV = 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.M2M_DEMO_MODE = 'true';
process.env.OPS_READ_TOKEN = 'owner-test-token';
for (const name of [
  'ISSUER_PRIVATE_KEY', 'ISSUER_KID', 'ISSUER_KMS_KEY_ID', 'ISSUER_TEST_KEY', 'ISSUER_SIGNER',
  'ISSUER_HISTORY_EXTRA', 'RECEIPT_FAILURES_FILE', 'RECEIPT_FIXED_HEAD_EIP712',
  'RECEIPT_PAYER_BINDING_EIP712', 'RECEIPT_LOG_ACCEPT_FRESH_GENESIS', 'RECEIPT_ANCHOR_PRIVATE_KEY',
]) delete process.env[name];

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayDir = path.join(here, '..');
const KEY = syntheticIssuerKey();

const RF = await import('../src/receipt-failures.js');
const T = await import('../src/tree-head-eip712.js');
const Q = await import('../src/quarantine-list.js');
const W = await import('../src/payer-binding-worker.js');
const PP = await import('../src/production-process.js');
const { publicHealthBody } = await import('../src/public-metrics.js');
const { openPayerBindingStore } = await import('../src/payer-binding-store.js');
const { BASE_USDC, leafHashOf } = await import('../src/public-attestation.js');
const { ReceiptMerkleTree, rootOf } = await import('../src/receipt-merkle.js');
const { acquireReceiptLogLock, _releaseReceiptLogLocksForTest } = await import('../src/receipt-log-lock.js');
const { _setIssuerSignerForTest } = await import('../src/issuer-signer.js');
const { resetIssuerSigner } = await import('../src/issuer-signer-state.js');
const { _resetIssuerKey } = await import('../src/issuer-key.js');
const { EPOCH1_FINAL_ROOT, EPOCH1_GENESIS_DIGEST } = await import('../src/receipt-log-epoch.js');

const MADE = [];
function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  MADE.push(dir);
  return dir;
}
const hex = (buf) => Buffer.from(buf).toString('hex');

after(() => {
  _releaseReceiptLogLocksForTest();
  resetIssuerSigner();
  RF.resetReceiptFailuresForTests();
  for (const dir of MADE) fs.rmSync(dir, { recursive: true, force: true });
});

/** Rows and counts for one path, after the call. */
function escrowRows(pathName) {
  return RF.listReceiptFailures().filter((row) => row.reason.startsWith(`${pathName}:`));
}

function assertAlert(pathName, reason, { outcome = 'refused', rows = 1 } = {}) {
  const key = `${pathName}:${reason}`;
  const matched = RF.listReceiptFailures().filter((row) => row.reason === key);
  assert.equal(matched.length, rows, `${key}: ${rows} row(s)`);
  for (const row of matched) {
    assert.equal(row.stage, 'sign', key);
    assert.equal(row.outcome, outcome, key);
    assert.equal(row.tx, null, `${key}: no tx`);
    assert.equal(row.request_id, null, `${key}: no request id`);
    assert.equal(row.network, null, `${key}: no network`);
  }
  assert.equal(RF.escrowRefusalCounts()?.[pathName]?.[reason], rows, `${key}: per-reason count`);
}

// ---------------------------------------------------------------- fixed heads

function leavesN(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(crypto.createHash('sha256').update(`leaf-${i}`).digest());
  return out;
}

function fhClaims({ epoch = 2, size = 11, root, published = '2026-10-09T10:23:55.000Z' } = {}) {
  return { epoch, tree_size: size, root, published_at: published };
}

function fhCtx(leaves, overrides = {}) {
  return {
    ready: { ok: true },
    logIdentity: { epoch1_root: EPOCH1_FINAL_ROOT, genesis_digest: EPOCH1_GENESIS_DIGEST },
    currentEpoch: 2,
    leafCount: leaves.length,
    rootAt: (size) => hex(rootOf(leaves.slice(0, size))),
    quarantined: [],
    store: T.openFixedHeadStore(tmp('alerts-fh-')),
    kid: KEY.kid,
    signer: stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey }),
    ...overrides,
  };
}

test('fixed head: every refusal records one alert row and one per-reason count', async () => {
  RF.resetReceiptFailuresForTests();
  const leaves = leavesN(11);
  const root = hex(rootOf(leaves));
  const throwing = (code) => ({
    kind: 'env', kid: KEY.kid, publicJwk: KEY.publicJwk,
    async sign() { const err = new Error('down'); err.code = code; throw err; },
  });
  const cases = [
    ['log_lock_missing', fhClaims({ root }), fhCtx(leaves, { ready: { ok: false, reason: 'log_lock_missing' } })],
    ['log_not_ready', fhClaims({ root }), fhCtx(leaves, { ready: { ok: false } })],
    ['log_identity', fhClaims({ root }), fhCtx(leaves, { logIdentity: null })],
    ['field_range', fhClaims({ root, published: 'not-a-time' }), fhCtx(leaves)],
    ['not_open_epoch', fhClaims({ root, epoch: 1 }), fhCtx(leaves)],
    ['root_mismatch', fhClaims({ root: 'ab'.repeat(32) }), fhCtx(leaves)],
    ['quarantined', fhClaims({ root }), fhCtx(leaves, { quarantined: [{ epoch: 2, tree_size: 11, root }] })],
    ['store_unreadable', fhClaims({ root }), fhCtx(leaves, { store: { broken: true } })],
    ['signer_error', fhClaims({ root }), fhCtx(leaves, { signer: throwing('boom') })],
    ['signer_unavailable', fhClaims({ root }), fhCtx(leaves, { signer: throwing('issuer_sign_unavailable') })],
  ];
  for (const [reason, claims, ctx] of cases) {
    const out = await T.signFixedHead(claims, ctx);
    assert.equal(out.refused, reason, reason);
    assertAlert('fixed_head', reason);
  }
  // store_write: the append throws after a good signature.
  const good = fhCtx(leaves);
  const failingStore = { ...good.store, broken: false, conflicts: () => false, find: () => null, append() { throw new Error('disk'); } };
  assert.equal((await T.signFixedHead(fhClaims({ root }), { ...good, store: failingStore })).refused, 'store_write');
  assertAlert('fixed_head', 'store_write');
  // conflicting_root: a stored head for (epoch, size) with another root.
  const store = T.openFixedHeadStore(tmp('alerts-fh-conflict-'));
  const leaves2 = leavesN(11);
  leaves2[10] = crypto.createHash('sha256').update('other').digest();
  assert.ok((await T.signFixedHead(fhClaims({ root }), fhCtx(leaves, { store }))).fixed_head);
  const other = hex(rootOf(leaves2));
  assert.equal((await T.signFixedHead(fhClaims({ root: other }), fhCtx(leaves2, { store }))).refused, 'conflicting_root');
  assertAlert('fixed_head', 'conflicting_root');
  // A signed fixed head raises nothing.
  const before = RF.listReceiptFailures().length;
  assert.ok((await T.signFixedHead(fhClaims({ root }), fhCtx(leaves))).fixed_head);
  assert.equal(RF.listReceiptFailures().length, before, 'success adds no row');
  assert.equal(escrowRows('fixed_head').length, cases.length + 2);
});

test('fixed head: the publish-path catch (internal) records an alert', async () => {
  RF.resetReceiptFailuresForTests();
  const broken = Object.create(ReceiptMerkleTree.prototype);
  Object.defineProperty(broken, 'leaves', { get() { throw new Error('torn'); } });
  const out = await ReceiptMerkleTree.prototype._signFixedHead.call(broken, fhClaims({ root: 'ab'.repeat(32) }), KEY.kid);
  assert.equal(out.refused, 'internal');
  assertAlert('fixed_head', 'internal');
});

// ---------------------------------------------------------------- quarantine list signing

function listDoc() {
  return Q.buildQuarantineList({
    entries: [{
      epoch: 2,
      tree_size: 11,
      root: 'cf'.repeat(32),
      prefix_size: 10,
      reason: 'publish_append_race',
      consistency: { first: 10, second: 39, second_root: '34'.repeat(32), proof: ['aa'.repeat(32), 'bb'.repeat(32)] },
      quarantine_ack_jws: 'eyJhbGciOiJFUzI1NiJ9.e30.c2ln',
    }],
    highWater: [{ epoch: 2, tree_size: 39, root: '34'.repeat(32) }],
    prevBytes: null,
  });
}

async function refusedWith(env, reason, label = reason) {
  await assert.rejects(
    Q.signQuarantineList(listDoc(), { env }),
    (err) => err.code === 'quarantine_sign_refused' && err.reason === reason,
    label,
  );
}

test('quarantine signing: every refusal reason records one alert row and one per-reason count', async () => {
  RF.resetReceiptFailuresForTests();
  resetIssuerSigner();
  _resetIssuerKey();
  const k2 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const k2Jwk = k2.publicKey.export({ format: 'jwk' });
  const plain = (fields) => ({ kind: 'env', ...fields });
  try {
    // Environment refusals (no signer needed).
    await refusedWith({ NODE_ENV: 'production' }, 'production_env');
    assertAlert('quarantine_sign', 'production_env');
    await refusedWith({ NODE_ENV: 'test', ISSUER_SIGNER: 'kms' }, 'kms_signer');
    assertAlert('quarantine_sign', 'kms_signer');
    await refusedWith({ NODE_ENV: 'test', ISSUER_HISTORY_EXTRA: 'not json' }, 'history_extra_malformed');
    assertAlert('quarantine_sign', 'history_extra_malformed');

    // Signer refusals.
    const prodPub = PP.PRODUCTION_ISSUER_PUBLIC_KEYS[0];
    _setIssuerSignerForTest(plain({ kid: 'any-label', publicJwk: { kty: 'EC', crv: 'P-256', x: prodPub.x, y: prodPub.y }, async sign() { throw new Error('not reached'); } }));
    await refusedWith({ NODE_ENV: 'test' }, 'production_key');
    assertAlert('quarantine_sign', 'production_key');

    _setIssuerSignerForTest(stubSigner({ kid: 'stub-kid', publicJwk: { x: k2Jwk.x, y: k2Jwk.y }, privateKey: k2.privateKey }));
    await refusedWith({ NODE_ENV: 'test' }, 'not_test_key');
    assertAlert('quarantine_sign', 'not_test_key');

    _setIssuerSignerForTest(plain({ kid: KEY.kid, publicJwk: null, async sign() { throw new Error('not reached'); } }));
    await refusedWith({ NODE_ENV: 'test' }, 'no_public_key');
    assertAlert('quarantine_sign', 'no_public_key');

    const accessor = plain({ publicJwk: { kty: 'EC', crv: 'P-256', x: KEY.publicJwk.x, y: KEY.publicJwk.y }, async sign() { throw new Error('not reached'); } });
    Object.defineProperty(accessor, 'kid', { enumerable: true, get: () => KEY.kid });
    _setIssuerSignerForTest(accessor);
    await refusedWith({ NODE_ENV: 'test' }, 'signer_accessor');
    assertAlert('quarantine_sign', 'signer_accessor');

    // Reports the known test key, signs with K2.
    _setIssuerSignerForTest(plain({
      kid: KEY.kid,
      publicJwk: { kty: 'EC', crv: 'P-256', x: KEY.publicJwk.x, y: KEY.publicJwk.y },
      async sign(input) { return crypto.sign('sha256', Buffer.from(input), { key: k2.privateKey, dsaEncoding: 'ieee-p1363' }); },
    }));
    await refusedWith({ NODE_ENV: 'test' }, 'signer_mismatch');
    assertAlert('quarantine_sign', 'signer_mismatch');

    _setIssuerSignerForTest(plain({ kid: KEY.kid, publicJwk: { x: KEY.publicJwk.x, y: KEY.publicJwk.y }, async sign() { return Buffer.alloc(10); } }));
    await refusedWith({ NODE_ENV: 'test' }, 'issuer_sign_invalid');
    assertAlert('quarantine_sign', 'issuer_sign_invalid');

    // An honest stub on the known test key signs and raises nothing.
    const before = RF.listReceiptFailures().length;
    _setIssuerSignerForTest(stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey, realJws: true }));
    const bytes = await Q.signQuarantineList(listDoc(), { env: { NODE_ENV: 'test' } });
    assert.equal(JSON.parse(bytes).issuer_signature.kid, KEY.kid);
    assert.equal(RF.listReceiptFailures().length, before, 'a good signature adds no row');
  } finally {
    resetIssuerSigner();
    _resetIssuerKey();
  }
});

test('quarantine signing: signer_changed and every other guard throw go through the alerting guardError', () => {
  const src = fs.readFileSync(path.join(gatewayDir, 'src', 'quarantine-list.js'), 'utf8');
  assert.ok(/function guardError\(reason\) \{\n\s*recordEscrowRefusal\(\{ path: 'quarantine_sign', reason \}\);/.test(src), 'guardError records the alert first');
  assert.ok(/\n\s*assertJwsKid\(jws, snap\.kid\);/.test(src), 'signQuarantineList checks the JWS kid with assertJwsKid');
  const lines = src.split('\n');
  const rawThrows = lines.filter((line) => /\bthrow\b/.test(line) && /quarantine_sign_refused/.test(line));
  assert.equal(rawThrows.length, 0, 'no refusal is thrown around guardError');
  const codeSites = lines.filter((line) => /err\.code = 'quarantine_sign_refused'/.test(line));
  assert.equal(codeSites.length, 1, 'only guardError builds a refusal error');
});

test('quarantine signing: assertJwsKid refuses a mismatched, missing or unreadable kid with signer_changed and an alert', () => {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const jwsWith = (header) => `${b64(header)}.${b64({ a: 1 })}.c2ln`;
  const refused = (jws, kid, label) => {
    assert.throws(() => Q.assertJwsKid(jws, kid), (err) => err.code === 'quarantine_sign_refused' && err.reason === 'signer_changed', label);
  };
  RF.resetReceiptFailuresForTests();
  let clock = Date.parse('2026-10-24T12:00:00.000Z');
  RF.setEscrowAlertClockForTests(() => clock);
  const cases = [
    [jwsWith({ alg: 'ES256', kid: 'other-kid' }), KEY.kid, 'another kid'],
    [jwsWith({ alg: 'ES256' }), KEY.kid, 'no kid in the header'],
    [jwsWith({ alg: 'ES256', kid: `${KEY.kid} ` }), KEY.kid, 'kid with a trailing space'],
    ['not-base64!.e30.c2ln', KEY.kid, 'unreadable header'],
    [jwsWith({ alg: 'ES256', kid: '' }), '', 'empty kid'],
    [jwsWith({ alg: 'ES256' }), undefined, 'undefined kid on both sides'],
    [jwsWith({ alg: 'ES256', kid: null }), null, 'null kid on both sides'],
  ];
  for (const [jws, kid, label] of cases) {
    refused(jws, kid, label);
    clock += RF.ESCROW_ALERT_DEDUP_MS;
  }
  assertAlert('quarantine_sign', 'signer_changed', { rows: cases.length });
  // The matching kid passes and raises nothing.
  const before = RF.listReceiptFailures().length;
  assert.doesNotThrow(() => Q.assertJwsKid(jwsWith({ alg: 'ES256', typ: Q.QUARANTINE_LIST_TYP, kid: KEY.kid }), KEY.kid));
  assert.equal(RF.listReceiptFailures().length, before);
});

test('quarantine signing: the script pre-check refusal writes an alert row to RECEIPT_FAILURES_FILE', () => {
  const dir = tmp('alerts-script-');
  const file = path.join(dir, 'receipt-failures.jsonl');
  const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: process.env.TMPDIR || os.tmpdir(), NODE_ENV: 'production', RECEIPT_FAILURES_FILE: file, HUB_CATALOG_OFFLINE: 'true' };
  const res = spawnSync(process.execPath, ['scripts/sign-quarantine-list.mjs', '--log-dir', dir, '--apply', '--confirm', 'YES'], {
    cwd: gatewayDir, env, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(res.status, 1, res.stderr);
  assert.ok(/refused: production_env/.test(res.stderr), 'stderr names the refusal');
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'quarantine_sign:production_env');
  assert.equal(rows[0].stage, 'sign');
  assert.equal(rows[0].outcome, 'refused');
});

// ---------------------------------------------------------------- payer binding

async function readyTree() {
  const dir = tmp('alerts-pb-log-');
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.durable = true;
  tree.allowFreshGenesis = true;
  tree._now = () => new Date('2026-10-20T09:00:00.000Z');
  tree.genesisLeaf = () => ({
    task_id: 'genesis',
    bytes: Buffer.from('{"schema":"chit402.tree_genesis.v1","payload_version":1,"verifier_binary_build_digest":null}'),
    kind: 'genesis',
  });
  await tree.appendReceipt('seed-1', 'hash-1', { publish: false });
  tree.allowFreshGenesis = false;
  assert.equal(acquireReceiptLogLock(dir).held, true);
  tree.pinVerified = true;
  tree.logIdentity = { epoch1_root: EPOCH1_FINAL_ROOT, genesis_digest: EPOCH1_GENESIS_DIGEST };
  return tree;
}

const payer = Wallet.createRandom();
const ROW = (n) => crypto.createHash('sha256').update(`alert-row-${n}`).digest('hex');
const GOOD_REF = `base:0x${'e1'.repeat(32)}`;

function pbClaims(taskId, { ref = GOOD_REF, asset = BASE_USDC, gross = '2000', payerWallet = payer.address, payment = true } = {}) {
  return {
    task_id: taskId,
    caller_binding: { payer_wallet: payerWallet },
    ...(payment ? { payment: { rail: 'usdc', ...(ref === null ? {} : { ref }), asset, gross_amount: gross, settled_amount: gross } } : {}),
  };
}

function fakeJws(c) {
  return `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(c)).toString('base64url')}.c2ln`;
}

function pbWorker({ store, tree, byTask, signer, now, maxAttempts }) {
  return W.createPayerBindingWorker({
    store,
    tree: () => tree,
    holderJws: (id) => {
      if (byTask[id] === 'throw') throw new Error('holder lookup crashed');
      return byTask[id] ? fakeJws(byTask[id]) : null;
    },
    signer: () => (signer === undefined ? stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey }) : signer),
    env: { RECEIPT_PAYER_BINDING_EIP712: 'true' },
    now,
    maxAttempts,
    baseDelayMs: 1000,
  });
}

async function appendAndEnqueue(worker, tree, taskId, rowHash) {
  await tree.appendReceipt(taskId, rowHash, { publish: false });
  return worker.enqueueAppended({ taskId, rowHash, leafHash: W.appendedLeafHash(tree, taskId) });
}

test('payer binding: amount raises an alert; no_payment_ref, network (incl. non-string ref), asset, no_payer and no_payment are counted only', async () => {
  RF.resetReceiptFailuresForTests();
  _releaseReceiptLogLocksForTest();
  const tree = await readyTree();
  const store = openPayerBindingStore(tmp('alerts-pb-store-'));
  const byTask = {
    'xfuel-alert-noref': pbClaims('xfuel-alert-noref', { ref: null }),
    'xfuel-alert-blankref': pbClaims('xfuel-alert-blankref', { ref: '   ' }),
    'xfuel-alert-sepolia': pbClaims('xfuel-alert-sepolia', { ref: `base-sepolia:0x${'e1'.repeat(32)}` }),
    'xfuel-alert-84532': pbClaims('xfuel-alert-84532', { ref: `eip155:84532:0x${'e1'.repeat(32)}` }),
    'xfuel-alert-arrayref': pbClaims('xfuel-alert-arrayref', { ref: [GOOD_REF] }),
    'xfuel-alert-asset': pbClaims('xfuel-alert-asset', { asset: '0x0000000000000000000000000000000000000001' }),
    'xfuel-alert-amount': pbClaims('xfuel-alert-amount', { gross: '0' }),
    'xfuel-alert-nopayer': pbClaims('xfuel-alert-nopayer', { payerWallet: null }),
    'xfuel-alert-nopayment': pbClaims('xfuel-alert-nopayment', { payment: false }),
  };
  const worker = pbWorker({ store, tree, byTask });
  let n = 0;
  for (const id of Object.keys(byTask)) await appendAndEnqueue(worker, tree, id, ROW(n += 1));
  const results = await worker.tick();
  assert.deepEqual(results, Object.keys(byTask).map(() => 'skipped'));
  assertAlert('payer_binding', 'amount');
  // Not a Base mainnet USDC paid receipt: routine, counted, no alert row.
  for (const [reason, n] of [['no_payment_ref', 2], ['network', 3], ['asset', 1], ['no_payer', 1], ['no_payment', 1]]) {
    assert.equal(RF.listReceiptFailures().filter((r) => r.reason === `payer_binding:${reason}`).length, 0, `${reason}: no row`);
    assert.equal(RF.escrowRefusalCounts().payer_binding[reason], n, `${reason}: counted`);
  }
  assert.equal(escrowRows('payer_binding').length, 1);
  // No payer address or task id anywhere in the rows or the counts.
  const dump = JSON.stringify([RF.listReceiptFailures(), RF.escrowRefusalCounts()]);
  assert.equal(dump.toLowerCase().includes(payer.address.toLowerCase().slice(2)), false, 'no payer address');
  assert.equal(dump.includes('xfuel-alert'), false, 'no task id');
});

test('payer binding: leaf_mismatch, leaf_conflict on enqueue and a crashed job (internal) each raise an alert', async () => {
  RF.resetReceiptFailuresForTests();
  _releaseReceiptLogLocksForTest();
  const tree = await readyTree();
  const store = openPayerBindingStore(tmp('alerts-pb-store-'));
  const byTask = {
    'xfuel-alert-leaf': pbClaims('xfuel-alert-leaf'),
    'xfuel-alert-crash': 'throw',
    'xfuel-alert-conflict': pbClaims('xfuel-alert-conflict'),
  };
  const worker = pbWorker({ store, tree, byTask });
  await tree.appendReceipt('xfuel-alert-leaf', ROW(50), { publish: false });
  worker.enqueueAppended({ taskId: 'xfuel-alert-leaf', rowHash: ROW(50), leafHash: leafHashOf('xfuel-alert-leaf', ROW(999)) });
  await appendAndEnqueue(worker, tree, 'xfuel-alert-crash', ROW(51));
  // Both jobs can share one created_at millisecond; the store then lists them
  // in directory order, so compare the results as a set.
  assert.deepEqual((await worker.tick()).sort(), ['error', 'failed']);
  assertAlert('payer_binding', 'leaf_mismatch');
  assertAlert('payer_binding', 'internal');
  // Enqueue refusal: the store already holds another leaf for the task.
  await appendAndEnqueue(worker, tree, 'xfuel-alert-conflict', ROW(52));
  const res = worker.enqueueAppended({ taskId: 'xfuel-alert-conflict', rowHash: ROW(52), leafHash: 'ee'.repeat(32) });
  assert.deepEqual(res, { queued: false, reason: 'leaf_conflict' });
  assertAlert('payer_binding', 'leaf_conflict');
});

test('payer binding: a retried refusal alerts once (pending) on the first attempt and once more (refused) when the job fails', async () => {
  RF.resetReceiptFailuresForTests();
  _releaseReceiptLogLocksForTest();
  const tree = await readyTree();
  const store = openPayerBindingStore(tmp('alerts-pb-store-'));
  let clock = 1_000_000;
  const worker = pbWorker({ store, tree, byTask: { 'xfuel-alert-retry': pbClaims('xfuel-alert-retry') }, signer: null, now: () => clock, maxAttempts: 4 });
  await appendAndEnqueue(worker, tree, 'xfuel-alert-retry', ROW(60));
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    seen.push(...await worker.tick());
    clock += 10 * 60_000;
  }
  assert.deepEqual(seen, ['retry', 'retry', 'retry', 'failed']);
  const rows = RF.listReceiptFailures().filter((r) => r.reason === 'payer_binding:signer_unavailable');
  assert.deepEqual(rows.map((r) => r.outcome), ['pending', 'refused']);
  assert.equal(RF.escrowRefusalCounts().payer_binding.signer_unavailable, 2);
});

test('payer binding: kid_mismatch is a listed, alerting reason (not other, not count-only)', () => {
  RF.resetReceiptFailuresForTests();
  const row = RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'kid_mismatch' });
  assert.equal(row?.reason, 'payer_binding:kid_mismatch', 'a row under its own code');
  assertAlert('payer_binding', 'kid_mismatch');
  assert.equal(RF.escrowRefusalCounts().payer_binding.other, undefined, 'not mapped to other');
  // Only the payer binding path lists it.
  RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'kid_mismatch' });
  assert.deepEqual(RF.escrowRefusalCounts().fixed_head, { other: 1 });
});

test('payer binding: the flag-on boot without a store raises no_store', () => {
  const src = fs.readFileSync(path.join(gatewayDir, 'src', 'server.js'), 'utf8');
  const re = /without a persistent store; payer binding stays off'\);\n\s*recordEscrowRefusal\(\{ path: 'payer_binding', reason: 'no_store' \}\);/;
  assert.ok(re.test(src), 'server.js raises payer_binding:no_store next to the boot error');
  RF.resetReceiptFailuresForTests();
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'no_store' });
  assertAlert('payer_binding', 'no_store');
});

// ---------------------------------------------------------------- shape, persistence, /health

test('alert rows carry only a listed code: unknown, free-text or address-like reasons become other', () => {
  RF.resetReceiptFailuresForTests();
  let clock = Date.parse('2026-10-24T12:00:00.000Z');
  RF.setEscrowAlertClockForTests(() => clock);
  const addr = Wallet.createRandom().address;
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: addr });
  clock += RF.ESCROW_ALERT_DEDUP_MS;
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'network\nsecret' });
  RF.recordEscrowRefusal({ path: 'fixed_head', reason: { toString: () => 'root_mismatch' } });
  assert.equal(RF.recordEscrowRefusal({ path: 'elsewhere', reason: 'network' }), null, 'unknown path: no row');
  const reasons = RF.listReceiptFailures().map((r) => r.reason);
  assert.deepEqual(reasons, ['payer_binding:other', 'payer_binding:other', 'fixed_head:other']);
  assert.deepEqual(RF.escrowRefusalCounts(), { fixed_head: { other: 1 }, payer_binding: { other: 2 } });
  assert.equal(JSON.stringify(RF.listReceiptFailures()).includes(addr.slice(2)), false);
});

test('alert rows persist in RECEIPT_FAILURES_FILE and per-reason counts reload from it', () => {
  const dir = tmp('alerts-file-');
  const file = path.join(dir, 'receipt-failures.jsonl');
  process.env.RECEIPT_FAILURES_FILE = file;
  try {
    RF.resetReceiptFailuresForTests();
    RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'root_mismatch' });
    RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'amount' });
    RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'network' });
    RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'no_payer' });
    RF.recordReceiptFailure({ stage: 'sign', reason: 'unrelated', outcome: 'refused' });
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 3, 'not-applicable skips are not written');
    RF.resetReceiptFailuresForTests();
    assert.deepEqual(RF.escrowRefusalCounts(), { fixed_head: { root_mismatch: 1 }, payer_binding: { amount: 1 } });
    assert.equal(RF.listReceiptFailures().length, 3, 'rows reload');
    assert.equal(RF.receiptFailureCount(), 1, 'the public total counts only the non-alert row');
  } finally {
    delete process.env.RECEIPT_FAILURES_FILE;
    RF.resetReceiptFailuresForTests();
  }
});

test('publicHealthBody: no per-reason escrow counts, whatever the caller passes', () => {
  const clean = publicHealthBody({});
  const passed = publicHealthBody({ escrowRefusals: { fixed_head: { root_mismatch: 2 }, payer_binding: { network: 1 } } });
  assert.deepEqual(passed, clean, 'an escrowRefusals input changes nothing');
  assert.equal(/escrow|root_mismatch|payer_binding/.test(JSON.stringify(passed)), false);
});

let server;
let base;
before(async () => {
  const { createApp } = await import('../src/server.js');
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});
after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /health and GET /v1/ops/receipt-failures (local server): rows and per-reason counts on the ops route only, /health keeps its clean shape', async () => {
  RF.resetReceiptFailuresForTests();
  const clean = await (await fetch(`${base}/health`)).json();
  assert.equal('escrow_refusals' in clean, false, 'clean: no key');
  const startCount = clean.receipt_failures;
  RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'quarantined' });
  RF.recordEscrowRefusal({ path: 'quarantine_sign', reason: 'not_test_key' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'amount' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'leaf_mismatch' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'network' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'no_payer' });
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.receipt_failures, startCount, 'alert rows and skips leave the public total alone');
  assert.deepEqual(Object.keys(health).sort(), Object.keys(clean).sort(), '/health keeps the clean key set');
  const text = JSON.stringify(health);
  assert.equal(/escrow|fixed_head|quarantine_sign|payer_binding|no_payer|network"?:\s*\d/.test(text), false, 'no per-path or per-reason detail on /health');
  assert.equal(text.includes('owner-test-token'), false);
  assert.equal(/0x[0-9a-fA-F]{40}/.test(text), false, 'no address-shaped value');
  const ops = await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } });
  assert.equal(ops.status, 200);
  const body = await ops.json();
  const reasons = body.failures.map((r) => r.reason);
  for (const r of ['fixed_head:quarantined', 'quarantine_sign:not_test_key', 'payer_binding:amount', 'payer_binding:leaf_mismatch']) {
    assert.ok(reasons.includes(r), r);
  }
  assert.deepEqual(body.escrow_refusals, {
    fixed_head: { quarantined: 1 },
    payer_binding: { amount: 1, leaf_mismatch: 1, network: 1, no_payer: 1 },
    quarantine_sign: { not_test_key: 1 },
  }, 'per-reason counts, count-only skips included, on the ops route');
  const anon = await fetch(`${base}/v1/ops/receipt-failures`);
  assert.equal(anon.status, 401, 'OPS_READ_TOKEN-gated');
});

test('GET /v1/ops/receipt-failures: escrow_refusals is an empty object when there are none', async () => {
  RF.resetReceiptFailuresForTests();
  const body = await (await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } })).json();
  assert.deepEqual(body.escrow_refusals, {});
});

test('SF1: 5000 routine payer binding skips plus one real settle failure: the settle row stays in the ops export and the public count is unaffected', async () => {
  RF.resetReceiptFailuresForTests();
  const startCount = (await (await fetch(`${base}/health`)).json()).receipt_failures;
  RF.recordReceiptFailure({ stage: 'settle', reason: 'settle_failed', outcome: 'refused', network: 'base' });
  const skips = ['network', 'asset', 'no_payment_ref', 'no_payer', 'no_payment'];
  for (let i = 0; i < 5000; i += 1) {
    assert.equal(RF.recordEscrowRefusal({ path: 'payer_binding', reason: skips[i % skips.length] }), null, 'skip: no row');
  }
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.receipt_failures, startCount + 1, 'only the settle failure counts');
  const ops = await (await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } })).json();
  assert.deepEqual(ops.failures.map((r) => r.reason), ['settle_failed'], 'settle row kept, no skip rows');
});

test('SF1: a flood of alert rows is capped on its own and never evicts a settle failure', async () => {
  RF.resetReceiptFailuresForTests();
  RF.recordReceiptFailure({ stage: 'settle', reason: 'settle_failed', outcome: 'refused', network: 'base' });
  let clock = Date.parse('2026-10-24T12:00:00.000Z');
  RF.setEscrowAlertClockForTests(() => clock);
  for (let i = 0; i < RF.RECEIPT_FAILURE_ROW_CAP + 1; i += 1) {
    RF.recordEscrowRefusal({ path: 'fixed_head', reason: i % 2 ? 'log_not_ready' : 'log_lock_lost' });
    clock += RF.ESCROW_ALERT_DEDUP_MS;
  }
  const list = RF.listReceiptFailures();
  assert.equal(list.filter((r) => r.reason === 'settle_failed').length, 1, 'settle row kept');
  assert.ok(list.filter((r) => r.reason.startsWith('fixed_head:')).length <= RF.RECEIPT_FAILURE_ALERT_ROW_CAP, 'alert rows capped');
  assert.ok(RF.RECEIPT_FAILURE_ALERT_ROW_CAP < RF.RECEIPT_FAILURE_ROW_CAP, 'alert cap is its own, smaller cap');
  const ops = await (await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } })).json();
  assert.ok(ops.failures.some((r) => r.reason === 'settle_failed'), 'settle row in the ops export');
});

test('dedup: one row per (path, reason, outcome) per 15 minutes, with a repeat count; every refusal still counted', () => {
  RF.resetReceiptFailuresForTests();
  const t0 = Date.parse('2026-10-24T12:00:00.000Z');
  let clock = t0;
  RF.setEscrowAlertClockForTests(() => clock);
  // A log_* refusal at a 60 s publish tick for one hour: 60 refusals.
  for (let i = 0; i < 60; i += 1) {
    RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_not_ready' });
    clock += 60_000;
  }
  const rows = RF.listReceiptFailures().filter((r) => r.reason === 'fixed_head:log_not_ready');
  assert.equal(rows.length, 4, 'one row per 15 minutes');
  assert.equal(rows[0].repeat, undefined, 'the first row has no repeat');
  assert.deepEqual(rows.slice(1).map((r) => r.repeat), [14, 14, 14], 'each later row carries the folded count');
  assert.deepEqual(rows.map((r) => Date.parse(r.time) - t0), [0, 15, 30, 45].map((m) => m * 60_000));
  assert.equal(RF.escrowRefusalCounts().fixed_head.log_not_ready, 60, 'every refusal counted');
  assert.equal(RF.receiptFailureCount(), 0, 'alert rows stay out of the public total');
  // The window is per (path, reason, outcome).
  clock = t0 + 10 * 60 * 60_000;
  RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_lock_lost' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'log_lock_lost' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'log_lock_lost', outcome: 'pending' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'log_lock_lost' });
  const keys = RF.listReceiptFailures().slice(4).map((r) => `${r.reason}|${r.outcome}`);
  assert.deepEqual(keys, ['fixed_head:log_lock_lost|refused', 'payer_binding:log_lock_lost|refused', 'payer_binding:log_lock_lost|pending']);
  // Just inside the window folds; exactly at 15 minutes writes; a clock step back writes.
  clock += RF.ESCROW_ALERT_DEDUP_MS - 1;
  assert.equal(RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_lock_lost' }), null, 'inside the window: folded');
  clock += 1;
  assert.equal(RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_lock_lost' })?.repeat, 1, 'at 15 minutes: a row with repeat 1');
  clock -= 60_000;
  assert.ok(RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_lock_lost' }), 'clock stepped back: a fresh row');
});

test('dedup: a day of 60 s fixed-head log refusals stays far under the alert cap, and repeats reload into the counts', () => {
  const dir = tmp('alerts-dedup-file-');
  process.env.RECEIPT_FAILURES_FILE = path.join(dir, 'receipt-failures.jsonl');
  try {
    RF.resetReceiptFailuresForTests();
    let clock = Date.parse('2026-10-24T00:00:00.000Z');
    RF.setEscrowAlertClockForTests(() => clock);
    for (let i = 0; i < 1440; i += 1) {
      RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_lock_lost' });
      clock += 60_000;
    }
    const rows = RF.listReceiptFailures();
    assert.equal(rows.length, 96, '96 rows for 1,440 refusals');
    assert.ok(rows.length < RF.RECEIPT_FAILURE_ALERT_ROW_CAP / 10);
    assert.equal(RF.escrowRefusalCounts().fixed_head.log_lock_lost, 1440);
    RF.resetReceiptFailuresForTests();
    // 96 rows: the first, plus 95 that each fold 14. The last 14 refusals after the
    // final row are only in memory, so the reload count is 1440 - 14.
    assert.equal(RF.escrowRefusalCounts().fixed_head.log_lock_lost, 1426, 'reload counts 1 + repeat per row');
    assert.equal(RF.listReceiptFailures().length, 96);
    assert.equal(RF.receiptFailureCount(), 0);
  } finally {
    delete process.env.RECEIPT_FAILURES_FILE;
    RF.resetReceiptFailuresForTests();
  }
});

test('N1: an unwritable RECEIPT_FAILURES_FILE never makes a refusal throw; the row stays in memory and is counted', async () => {
  const dir = tmp('alerts-unwritable-');
  const plainFile = path.join(dir, 'not-a-dir');
  fs.writeFileSync(plainFile, 'x');
  process.env.RECEIPT_FAILURES_FILE = path.join(plainFile, 'receipt-failures.jsonl');
  try {
    RF.resetReceiptFailuresForTests();
    assert.doesNotThrow(() => RF.recordEscrowRefusal({ path: 'quarantine_sign', reason: 'not_test_key' }));
    assertAlert('quarantine_sign', 'not_test_key');
    // A real refusal path still returns its refusal.
    const leaves = leavesN(11);
    const out = await T.signFixedHead(fhClaims({ root: 'ab'.repeat(32) }), fhCtx(leaves));
    assert.equal(out.refused, 'root_mismatch');
    assertAlert('fixed_head', 'root_mismatch');
    assert.equal(fs.readFileSync(plainFile, 'utf8'), 'x', 'nothing written');
  } finally {
    delete process.env.RECEIPT_FAILURES_FILE;
    RF.resetReceiptFailuresForTests();
  }
});

test('N2: alert rows stop at RECEIPT_FAILURE_ALERT_ROW_CAP, oldest dropped, settle rows untouched, and the reload keeps the cap', () => {
  const dir = tmp('alerts-cap-');
  process.env.RECEIPT_FAILURES_FILE = path.join(dir, 'receipt-failures.jsonl');
  try {
    RF.resetReceiptFailuresForTests();
    const t0 = Date.parse('2026-10-24T00:00:00.000Z');
    let clock = t0;
    RF.setEscrowAlertClockForTests(() => clock);
    RF.recordReceiptFailure({ stage: 'settle', reason: 'settle_failed', outcome: 'refused', network: 'base', time: '2026-10-23T00:00:00.000Z' });
    const cap = RF.RECEIPT_FAILURE_ALERT_ROW_CAP;
    assert.equal(cap, 1000);
    for (let i = 0; i < cap + 1; i += 1) {
      RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_not_ready' });
      clock += RF.ESCROW_ALERT_DEDUP_MS;
    }
    const check = (label) => {
      const list = RF.listReceiptFailures();
      const alerts = list.filter((r) => r.reason === 'fixed_head:log_not_ready');
      assert.equal(alerts.length, cap, `${label}: alert rows capped`);
      assert.equal(Date.parse(alerts[0].time), t0 + RF.ESCROW_ALERT_DEDUP_MS, `${label}: the oldest alert row dropped`);
      assert.equal(list.filter((r) => r.reason === 'settle_failed').length, 1, `${label}: the settle row kept`);
      assert.equal(list[0].reason, 'settle_failed', `${label}: rows stay in record order`);
    };
    check('memory');
    assert.equal(RF.receiptFailureCount(), 1, 'only the settle row is in the public total');
    RF.resetReceiptFailuresForTests();
    check('reload');
  } finally {
    delete process.env.RECEIPT_FAILURES_FILE;
    RF.resetReceiptFailuresForTests();
  }
});

test('N4: the ops route 401 and 503 responses are private, no-store', async () => {
  const anon = await fetch(`${base}/v1/ops/receipt-failures`);
  assert.equal(anon.status, 401);
  assert.equal(anon.headers.get('cache-control'), 'private, no-store', '401');
  const saved = process.env.OPS_READ_TOKEN;
  delete process.env.OPS_READ_TOKEN;
  try {
    const off = await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } });
    assert.equal(off.status, 503);
    assert.equal(off.headers.get('cache-control'), 'private, no-store', '503');
  } finally {
    process.env.OPS_READ_TOKEN = saved;
  }
});

test('N6: the ops route 401 and 503 bodies carry no row data and no counts', async () => {
  RF.resetReceiptFailuresForTests();
  RF.recordReceiptFailure({ stage: 'settle', reason: 'settle_failed', outcome: 'refused', network: 'base', tx: `0x${'ab'.repeat(32)}`, requestId: 'req-n6' });
  RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'quarantined' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'no_payer' });
  const leak = /settle_failed|fixed_head|payer_binding|quarantined|no_payer|req-n6|abab|failures|refusal_counts|escrow_refusals/;
  const check = async (res, status) => {
    assert.equal(res.status, status);
    const text = await res.text();
    assert.equal(leak.test(text), false, `${status} body carries no row data`);
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['error', 'message'], `${status} body is error and message only`);
  };
  await check(await fetch(`${base}/v1/ops/receipt-failures`), 401);
  await check(await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer wrong-token' } }), 401);
  const saved = process.env.OPS_READ_TOKEN;
  delete process.env.OPS_READ_TOKEN;
  try {
    await check(await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } }), 503);
  } finally {
    process.env.OPS_READ_TOKEN = saved;
    RF.resetReceiptFailuresForTests();
  }
});

/** Every number anywhere in a JSON value, with its key path. */
function numericLeaves(value, at = '') {
  if (typeof value === 'number') return [[at, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => numericLeaves(v, `${at}.${k}`));
}

test('public /health carries no numeric refusal data: a flood of alerts and skips leaves every number and key unchanged', async () => {
  RF.resetReceiptFailuresForTests();
  const clean = await (await fetch(`${base}/health`)).json();
  let clock = Date.parse('2026-10-24T12:00:00.000Z');
  RF.setEscrowAlertClockForTests(() => clock);
  const reasons = {
    fixed_head: ['log_not_ready', 'log_lock_lost', 'root_mismatch', 'quarantined', 'internal'],
    quarantine_sign: ['production_env', 'not_test_key', 'signer_changed'],
    payer_binding: ['amount', 'leaf_mismatch', 'kid_mismatch', 'network', 'asset', 'no_payment_ref', 'no_payer', 'no_payment'],
  };
  for (let i = 0; i < 300; i += 1) {
    for (const [p, list] of Object.entries(reasons)) {
      for (const r of list) {
        RF.recordEscrowRefusal({ path: p, reason: r });
        RF.recordEscrowRefusal({ path: p, reason: r, outcome: 'pending' });
      }
    }
    clock += RF.ESCROW_ALERT_DEDUP_MS;
  }
  assert.equal(RF.listReceiptFailures().length, RF.RECEIPT_FAILURE_ALERT_ROW_CAP, 'alert rows were written, up to the cap');
  const after = await (await fetch(`${base}/health`)).json();
  assert.deepEqual(Object.keys(after).sort(), Object.keys(clean).sort(), 'no new key');
  assert.deepEqual(numericLeaves(after), numericLeaves(clean), 'every number on /health is unchanged');
  assert.equal(after.receipt_failures, clean.receipt_failures);
  assert.equal(/escrow|refus|fixed_head|quarantine_sign|payer_binding/i.test(JSON.stringify(after)), false, 'no refusal key or code');
  // The ops route has them all.
  const ops = await (await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } })).json();
  assert.equal(ops.escrow_refusals.payer_binding.no_payer, 600);
  assert.equal(ops.escrow_refusals.fixed_head.log_not_ready, 600);
  RF.resetReceiptFailuresForTests();
});

// ---------------------------------------------------------------- SF-A follow-ups (#645 review)

/** Write JSONL rows to a fresh RECEIPT_FAILURES_FILE and reload the module from it. */
function reloadFrom(lines) {
  const dir = tmp('alerts-reload-');
  const file = path.join(dir, 'receipt-failures.jsonl');
  fs.writeFileSync(file, `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
  process.env.RECEIPT_FAILURES_FILE = file;
  RF.resetReceiptFailuresForTests();
  return file;
}

function clearReload() {
  delete process.env.RECEIPT_FAILURES_FILE;
  RF.resetReceiptFailuresForTests();
}

const plainRow = (reason, time) => ({ time, network: 'base', stage: 'settle', reason, tx: null, outcome: 'refused', request_id: null });
const alertRow = (reason, time, extra = {}) => ({ time, network: null, stage: 'sign', reason, tx: null, outcome: 'refused', request_id: null, ...extra });

test('Bugbot / N-d: a reload keeps the file order of interleaved plain and alert rows, on the list and the ops route', async () => {
  // File order, with one alert row timed before the plain row it follows:
  // the export follows the file (record) order, not the time field.
  const lines = [
    plainRow('settle_failed', '2026-10-24T10:00:00.000Z'),
    alertRow('fixed_head:quarantined', '2026-10-24T10:01:00.000Z'),
    plainRow('confirm_timeout', '2026-10-24T10:02:00.000Z'),
    alertRow('payer_binding:amount', '2026-10-24T09:00:00.000Z'),
    alertRow('quarantine_sign:not_test_key', '2026-10-24T10:04:00.000Z'),
    plainRow('settle_failed', '2026-10-24T10:05:00.000Z'),
    alertRow('quarantine_production_sign:write_mismatch', '2026-10-24T10:06:00.000Z'),
  ];
  const expected = lines.map((l) => `${l.stage}|${l.reason}|${l.time}`);
  reloadFrom(lines);
  try {
    const got = RF.listReceiptFailures().map((r) => `${r.stage}|${r.reason}|${r.time}`);
    assert.deepEqual(got, expected, 'exact file order after reload');
    assert.equal(RF.receiptFailureCount(), 3, 'only the plain rows are in the public total');
    // A row recorded after the reload comes last.
    RF.recordReceiptFailure({ stage: 'settle', reason: 'settle_failed', outcome: 'refused', network: 'base', time: '2026-10-24T08:00:00.000Z' });
    RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'root_mismatch' });
    const after = RF.listReceiptFailures().map((r) => r.reason);
    assert.deepEqual(after.slice(-2), ['settle_failed', 'fixed_head:root_mismatch']);
    const ops = await (await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } })).json();
    assert.deepEqual(ops.failures.slice(0, lines.length).map((r) => `${r.stage}|${r.reason}|${r.time}`), expected, 'the ops export keeps the order');
  } finally {
    clearReload();
  }
});

test('N-a / N-c: alert rows dropped by the cap are counted (live and on reload) and served as alert_rows_dropped; the reload caps alerts on their own list', async () => {
  const cap = RF.RECEIPT_FAILURE_ALERT_ROW_CAP;
  RF.resetReceiptFailuresForTests();
  try {
    assert.equal(RF.alertRowsDropped(), 0);
    let clock = Date.parse('2026-10-24T00:00:00.000Z');
    RF.setEscrowAlertClockForTests(() => clock);
    for (let i = 0; i < cap + 3; i += 1) {
      RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_not_ready' });
      clock += RF.ESCROW_ALERT_DEDUP_MS;
    }
    assert.equal(RF.alertRowsDropped(), 3, 'live overflow counted');
    const ops = await (await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } })).json();
    assert.equal(ops.alert_rows_dropped, 3, 'served on the ops route');
    RF.resetReceiptFailuresForTests();
    assert.equal(RF.alertRowsDropped(), 0, 'reset');
    const empty = await (await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } })).json();
    assert.equal(empty.alert_rows_dropped, 0);
    // Reload: one plain row, then cap + 5 alert rows.
    const lines = [plainRow('settle_failed', '2026-10-23T00:00:00.000Z')];
    for (let i = 0; i < cap + 5; i += 1) lines.push(alertRow('fixed_head:log_not_ready', new Date(Date.parse('2026-10-24T00:00:00.000Z') + i * 1000).toISOString()));
    reloadFrom(lines);
    const list = RF.listReceiptFailures();
    assert.equal(list.length, cap + 1, 'the plain row plus exactly cap alert rows');
    assert.equal(list[0].reason, 'settle_failed', 'the plain row is kept and first');
    assert.equal(list.filter((r) => r.stage === 'sign').length, cap, 'alerts capped on their own list');
    assert.equal(list[1].time, lines[6].time, 'the oldest five alert rows were dropped');
    assert.equal(RF.receiptFailureCount(), 1, 'public total: the plain row only');
    assert.equal(RF.alertRowsDropped(), 5, 'reload overflow counted');
    // Reloaded alerts sit on the alert list: a full settle list does not evict them.
    for (let i = 0; i < RF.RECEIPT_FAILURE_ROW_CAP; i += 1) {
      RF.recordReceiptFailure({ stage: 'settle', reason: 'settle_failed', outcome: 'refused', network: 'base' });
    }
    assert.equal(RF.listReceiptFailures().filter((r) => r.stage === 'sign').length, cap, 'settle rows never push reloaded alerts out');
  } finally {
    clearReload();
  }
});

test('N-b: a fold still open is written by flushEscrowAlertFolds, and a reload counts every folded refusal', () => {
  const dir = tmp('alerts-flush-');
  const file = path.join(dir, 'receipt-failures.jsonl');
  process.env.RECEIPT_FAILURES_FILE = file;
  try {
    RF.resetReceiptFailuresForTests();
    const t0 = Date.parse('2026-10-24T12:00:00.000Z');
    let clock = t0;
    RF.setEscrowAlertClockForTests(() => clock);
    assert.equal(RF.flushEscrowAlertFolds(), 0, 'nothing open, nothing written');
    assert.ok(RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_not_ready' }), 'the first refusal writes a row');
    for (let i = 1; i <= 5; i += 1) {
      clock = t0 + i * 60_000;
      assert.equal(RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_not_ready' }), null, 'folded');
    }
    // A single fold (folded 1) on another key: its row carries no repeat.
    RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'amount', outcome: 'pending' });
    clock = t0 + 6 * 60_000;
    RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'amount', outcome: 'pending' });
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 2, 'two rows before the flush');
    assert.equal(RF.flushEscrowAlertFolds(), 2, 'one row per open fold');
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(rows.length, 4);
    const fh = rows.filter((r) => r.reason === 'fixed_head:log_not_ready');
    assert.equal(fh.length, 2);
    assert.equal(fh[1].repeat, 4, 'the flush row is the latest folded refusal and repeats the other four');
    assert.equal(fh[1].time, new Date(t0 + 5 * 60_000).toISOString(), 'at the latest folded refusal');
    const pb = rows.filter((r) => r.reason === 'payer_binding:amount');
    assert.equal(pb.length, 2);
    assert.equal(pb[1].outcome, 'pending');
    assert.equal('repeat' in pb[1], false, 'one folded refusal: no repeat');
    assert.equal(RF.flushEscrowAlertFolds(), 0, 'a second flush writes nothing');
    // The window restarts at the flush row: a refusal inside it folds again.
    clock = t0 + 7 * 60_000;
    assert.equal(RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'log_not_ready' }), null);
    const live = RF.escrowRefusalCounts();
    assert.equal(live.fixed_head.log_not_ready, 7);
    // Reload: the counts from the file equal the counts in memory before the last fold.
    RF.resetReceiptFailuresForTests();
    const reloaded = RF.escrowRefusalCounts();
    assert.equal(reloaded.fixed_head.log_not_ready, 6, 'every refusal up to the flush survives the restart');
    assert.equal(reloaded.payer_binding.amount, 2);
    // A flush with an unwritable file never throws and keeps the row in memory.
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'x');
    process.env.RECEIPT_FAILURES_FILE = path.join(blocker, 'rf.jsonl');
    RF.resetReceiptFailuresForTests();
    clock = t0;
    RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'quarantined' });
    clock = t0 + 1000;
    RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'quarantined' });
    let n;
    assert.doesNotThrow(() => { n = RF.flushEscrowAlertFolds(); });
    assert.equal(n, 1);
    assert.equal(RF.listReceiptFailures().filter((r) => r.reason === 'fixed_head:quarantined').length, 2);
  } finally {
    delete process.env.RECEIPT_FAILURES_FILE;
    RF.resetReceiptFailuresForTests();
  }
});

test('N-b: the gateway shutdown flushes open alert folds before closing the server', () => {
  const src = fs.readFileSync(path.join(gatewayDir, 'src', 'server.js'), 'utf8');
  assert.ok(/const shutdown = \(signal\) => \{[\s\S]*?flushEscrowAlertFolds\(\);[\s\S]*?server\.close\(/.test(src), 'shutdown calls flushEscrowAlertFolds before server.close');
  assert.ok(/import \{[^}]*\bflushEscrowAlertFolds\b[^}]*\} from '\.\/receipt-failures\.js';/.test(src), 'imported from receipt-failures.js');
});

test('N1 (649): shutdown flushes open folds again right before every exit, after the drain and on the forced exit', () => {
  const src = fs.readFileSync(path.join(gatewayDir, 'src', 'server.js'), 'utf8');
  assert.ok(/const flushAgain = \(\) => \{\n\s+try \{\n\s+flushEscrowAlertFolds\(\);\n\s+\} catch \{/.test(src), 'flushAgain wraps flushEscrowAlertFolds and never throws');
  assert.ok(/logger\.warn\('Forced shutdown after 10s drain timeout'\);\n\s+flushAgain\(\);\n\s+process\.exit\(1\);/.test(src), 'the forced exit flushes first');
  assert.ok(/server\.close\(\(err\) => \{\n\s+flushAgain\(\);\n\s+if \(err\) \{/.test(src), 'the close callback flushes before either exit');
});

test('N2 (649): a reload keeps up to RECEIPT_FAILURE_ROW_CAP plain rows, not the alert cap, and drops only the oldest beyond it', () => {
  const alertCap = RF.RECEIPT_FAILURE_ALERT_ROW_CAP;
  const plainCap = RF.RECEIPT_FAILURE_ROW_CAP;
  const t0 = Date.parse('2026-10-20T00:00:00.000Z');
  const at = (i) => new Date(t0 + i * 1000).toISOString();
  // More plain rows than the alert cap, under the plain cap, with two alert rows.
  const some = [];
  for (let i = 0; i < alertCap + 200; i += 1) some.push(plainRow('settle_failed', at(i)));
  some.splice(10, 0, alertRow('fixed_head:quarantined', at(10)));
  some.push(alertRow('payer_binding:amount', at(alertCap + 300)));
  reloadFrom(some);
  try {
    const list = RF.listReceiptFailures();
    assert.equal(list.filter((r) => r.stage === 'settle').length, alertCap + 200, 'every plain row is kept');
    assert.equal(list.length, alertCap + 202);
    assert.equal(list[0].time, at(0), 'the oldest plain row is still first');
    assert.equal(RF.receiptFailureCount(), alertCap + 200);
    assert.equal(RF.alertRowsDropped(), 0);
  } finally {
    clearReload();
  }
  // Over the plain cap: exactly the oldest three plain rows dropped.
  const many = [];
  for (let i = 0; i < plainCap + 3; i += 1) many.push(plainRow('settle_failed', at(i)));
  reloadFrom(many);
  try {
    const list = RF.listReceiptFailures();
    assert.equal(list.length, plainCap);
    assert.equal(list[0].time, at(3), 'the oldest three were dropped');
    assert.equal(list[list.length - 1].time, at(plainCap + 2));
    assert.equal(RF.alertRowsDropped(), 0, 'plain drops are not alert drops');
  } finally {
    clearReload();
  }
});

test('N-c: repeat on a reloaded row: positive safe integers only, clamped to 1e9', () => {
  reloadFrom([
    alertRow('fixed_head:root_mismatch', '2026-10-24T00:00:01.000Z', { repeat: 1e15 }),
    alertRow('fixed_head:quarantined', '2026-10-24T00:00:02.000Z', { repeat: 2.5 }),
    alertRow('fixed_head:internal', '2026-10-24T00:00:03.000Z', { repeat: '5' }),
    alertRow('fixed_head:store_write', '2026-10-24T00:00:04.000Z', { repeat: -3 }),
    alertRow('fixed_head:signer_error', '2026-10-24T00:00:05.000Z', { repeat: 0 }),
    alertRow('fixed_head:field_range', '2026-10-24T00:00:06.000Z', { repeat: 7 }),
  ]);
  try {
    const byReason = Object.fromEntries(RF.listReceiptFailures().map((r) => [r.reason, r]));
    assert.equal(byReason['fixed_head:root_mismatch'].repeat, 1_000_000_000, 'clamped');
    for (const r of ['fixed_head:quarantined', 'fixed_head:internal', 'fixed_head:store_write', 'fixed_head:signer_error']) {
      assert.equal('repeat' in byReason[r], false, `${r}: dropped`);
    }
    assert.equal(byReason['fixed_head:field_range'].repeat, 7);
    assert.deepEqual(RF.escrowRefusalCounts().fixed_head, {
      field_range: 8, internal: 1, quarantined: 1, root_mismatch: 1_000_000_001, signer_error: 1, store_write: 1,
    });
  } finally {
    clearReload();
  }
});

test('N-c: every method other than GET on the ops route is 405, Allow GET, private, no-store', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await fetch(`${base}/v1/ops/receipt-failures`, { method, headers: { authorization: 'Bearer owner-test-token' } });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET', method);
    assert.equal(res.headers.get('cache-control'), 'private, no-store', `${method}: no-store`);
    assert.deepEqual(await res.json(), { error: 'method_not_allowed' });
  }
});

test('N-e: a reloaded alert row with a code not on its path list reads <path>:other, matching its count; listed codes, digits included, are kept', () => {
  reloadFrom([
    alertRow('payer_binding:__proto__', '2026-10-24T00:00:01.000Z'),
    alertRow('quarantine_sign:made_up', '2026-10-24T00:00:02.000Z'),
    alertRow('fixed_head:x9', '2026-10-24T00:00:03.000Z'),
    alertRow('quarantine_production_sign:list_not_unsigned_v1', '2026-10-24T00:00:04.000Z'),
    alertRow('payer_binding:kid_mismatch', '2026-10-24T00:00:05.000Z'),
    plainRow('settle_failed', '2026-10-24T00:00:06.000Z'),
  ]);
  try {
    assert.deepEqual(RF.listReceiptFailures().map((r) => r.reason), [
      'payer_binding:other', 'quarantine_sign:other', 'fixed_head:other',
      'quarantine_production_sign:list_not_unsigned_v1', 'payer_binding:kid_mismatch', 'settle_failed',
    ]);
    assert.deepEqual(RF.escrowRefusalCounts(), {
      fixed_head: { other: 1 },
      payer_binding: { kid_mismatch: 1, other: 1 },
      quarantine_production_sign: { list_not_unsigned_v1: 1 },
      quarantine_sign: { other: 1 },
    });
    assert.equal(RF.receiptFailureCount(), 1, 'a digit code reloads as an alert row, not into the public total');
  } finally {
    clearReload();
  }
});
