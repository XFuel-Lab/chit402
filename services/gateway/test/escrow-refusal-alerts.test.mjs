/**
 * Operator alerts for refusals in the fixed-head, quarantine list signing and
 * payer binding paths. Each refusal writes one receipt-failure row (stage
 * `sign`, reason `<path>:<code>`) and bumps a per-reason count that /health
 * serves as `escrow_refusals`. Offline: synthetic test key, local server, no
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
  const before = RF.receiptFailureCount();
  assert.ok((await T.signFixedHead(fhClaims({ root }), fhCtx(leaves))).fixed_head);
  assert.equal(RF.receiptFailureCount(), before, 'success adds no row');
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
    const before = RF.receiptFailureCount();
    _setIssuerSignerForTest(stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey, realJws: true }));
    const bytes = await Q.signQuarantineList(listDoc(), { env: { NODE_ENV: 'test' } });
    assert.equal(JSON.parse(bytes).issuer_signature.kid, KEY.kid);
    assert.equal(RF.receiptFailureCount(), before, 'a good signature adds no row');
  } finally {
    resetIssuerSigner();
    _resetIssuerKey();
  }
});

test('quarantine signing: signer_changed and every other guard throw go through the alerting guardError', () => {
  const src = fs.readFileSync(path.join(gatewayDir, 'src', 'quarantine-list.js'), 'utf8');
  assert.ok(/function guardError\(reason\) \{\n\s*recordEscrowRefusal\(\{ path: 'quarantine_sign', reason \}\);/.test(src), 'guardError records the alert first');
  assert.ok(/throw guardError\('signer_changed'\)/.test(src), 'signer_changed is thrown through guardError');
  const lines = src.split('\n');
  const rawThrows = lines.filter((line) => /\bthrow\b/.test(line) && /quarantine_sign_refused/.test(line));
  assert.equal(rawThrows.length, 0, 'no refusal is thrown around guardError');
  const codeSites = lines.filter((line) => /err\.code = 'quarantine_sign_refused'/.test(line));
  assert.equal(codeSites.length, 1, 'only guardError builds a refusal error');
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
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
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

test('payer binding: no_payment_ref, network (incl. non-string ref), asset and amount skips each raise an alert; no_payer and no_payment are counted only', async () => {
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
  assertAlert('payer_binding', 'no_payment_ref', { rows: 2 });
  assertAlert('payer_binding', 'network', { rows: 3 });
  assertAlert('payer_binding', 'asset');
  assertAlert('payer_binding', 'amount');
  // Not a Base USDC paid receipt at all: counted on /health, no alert row.
  assert.equal(RF.listReceiptFailures().filter((r) => /no_payer|no_payment$/.test(r.reason)).length, 0);
  assert.equal(RF.escrowRefusalCounts().payer_binding.no_payer, 1);
  assert.equal(RF.escrowRefusalCounts().payer_binding.no_payment, 1);
  assert.equal(escrowRows('payer_binding').length, 7);
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
  assert.deepEqual(await worker.tick(), ['failed', 'error']);
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
  const addr = Wallet.createRandom().address;
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: addr });
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
    RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'network' });
    RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'no_payer' });
    RF.recordReceiptFailure({ stage: 'sign', reason: 'unrelated', outcome: 'refused' });
    assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 3, 'not-applicable skips are not written');
    RF.resetReceiptFailuresForTests();
    assert.deepEqual(RF.escrowRefusalCounts(), { fixed_head: { root_mismatch: 1 }, payer_binding: { network: 1 } });
    assert.equal(RF.receiptFailureCount(), 3);
  } finally {
    delete process.env.RECEIPT_FAILURES_FILE;
    RF.resetReceiptFailuresForTests();
  }
});

test('publicHealthBody: escrow_refusals is absent when there are none and carries only codes and counts', () => {
  assert.equal('escrow_refusals' in publicHealthBody({}), false);
  assert.equal('escrow_refusals' in publicHealthBody({ escrowRefusals: null }), false);
  assert.equal('escrow_refusals' in publicHealthBody({ escrowRefusals: { fixed_head: { root_mismatch: 0 } } }), false);
  const body = publicHealthBody({
    escrowRefusals: {
      fixed_head: { root_mismatch: 2 },
      payer_binding: { network: 1, '0xABC': 5, 'with space': 1 },
      quarantine_sign: { not_test_key: '3' },
      elsewhere: { network: 9 },
    },
  });
  assert.deepEqual(body.escrow_refusals, {
    fixed_head: { root_mismatch: 2 },
    quarantine_sign: { not_test_key: 3 },
    payer_binding: { network: 1 },
  });
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

test('GET /health and GET /v1/ops/receipt-failures (local server) show the alerts, with no payer and no secret', async () => {
  RF.resetReceiptFailuresForTests();
  const clean = await (await fetch(`${base}/health`)).json();
  assert.equal('escrow_refusals' in clean, false, 'clean: no key');
  const startCount = clean.receipt_failures;
  RF.recordEscrowRefusal({ path: 'fixed_head', reason: 'quarantined' });
  RF.recordEscrowRefusal({ path: 'quarantine_sign', reason: 'not_test_key' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'no_payment_ref' });
  RF.recordEscrowRefusal({ path: 'payer_binding', reason: 'network' });
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.receipt_failures, startCount + 4);
  assert.deepEqual(health.escrow_refusals, {
    fixed_head: { quarantined: 1 },
    payer_binding: { network: 1, no_payment_ref: 1 },
    quarantine_sign: { not_test_key: 1 },
  });
  const text = JSON.stringify(health);
  assert.equal(text.includes('owner-test-token'), false);
  assert.equal(/0x[0-9a-fA-F]{40}/.test(text), false, 'no address-shaped value');
  const ops = await fetch(`${base}/v1/ops/receipt-failures`, { headers: { authorization: 'Bearer owner-test-token' } });
  assert.equal(ops.status, 200);
  const reasons = (await ops.json()).failures.map((r) => r.reason);
  for (const r of ['fixed_head:quarantined', 'quarantine_sign:not_test_key', 'payer_binding:no_payment_ref', 'payer_binding:network']) {
    assert.ok(reasons.includes(r), r);
  }
  const anon = await fetch(`${base}/v1/ops/receipt-failures`);
  assert.equal(anon.status, 401, 'owner-only');
});
