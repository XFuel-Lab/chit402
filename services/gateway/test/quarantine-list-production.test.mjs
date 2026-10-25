/**
 * Production signer for quarantine list v1 (scripts/sign-quarantine-list-production.mjs,
 * src/quarantine-list-production.js). Offline, generated test keys only. The
 * production allowlist is stubbed through the test-only entry points
 * (_runProductionListSignerForTest, _signProductionV1ForTest) with a test
 * key's x/y. The exported runner the script calls has no allowlist input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syntheticIssuerKey, syntheticIssuerKeyEnv } from '../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';
import { testIssuerKey } from './helpers/test-issuer-keys.mjs';
import { stubSigner } from './helpers/fixed-head-scenario.mjs';

process.env.NODE_ENV = 'test';
process.env.ISSUER_TEST_KEY = '1';
process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();
const KEY = syntheticIssuerKey();
process.env.ISSUER_KID = KEY.kid;
delete process.env.RECEIPT_LOG_DIR;
delete process.env.RECEIPT_FAILURES_FILE;

const here = path.dirname(fileURLToPath(import.meta.url));
const OLD_SCRIPT = path.join(here, '..', 'scripts', 'sign-quarantine-list.mjs');
const NEW_SCRIPT = path.join(here, '..', 'scripts', 'sign-quarantine-list-production.mjs');
const MODULE = path.join(here, '..', 'src', 'quarantine-list-production.js');

const Q = await import('../src/quarantine-list.js');
const P = await import('../src/quarantine-list-production.js');
const { buildUnsignedV1FromLog } = await import('../src/quarantine-list-from-log.js');
const { ReceiptMerkleTree, rootOf } = await import('../src/receipt-merkle.js');
const { appendJournal } = await import('../src/receipt-log-store.js');
const { resetIssuerSigner } = await import('../src/issuer-signer-state.js');
const { createEnvSigner } = await import('../src/issuer-signer.js');
const { _resetIssuerKey, signJws, getIssuerPublicKeyJwk, computeJwkThumbprint } = await import('../src/issuer-key.js');
const { PRODUCTION_ISSUER_PUBLIC_KEYS, PRODUCTION_ISSUER_KID } = await import('../src/production-process.js');
const RF = await import('../src/receipt-failures.js');

const OTHER = testIssuerKey(7);
/** The allowlist stub: the synthetic test key's x/y in place of the production key. */
const STUB_KEYS = [{ kty: 'EC', crv: 'P-256', x: KEY.publicJwk.x, y: KEY.publicJwk.y }];
const CONFIRM = P.PRODUCTION_SIGN_CONFIRM;

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** A log with the Oct 9 shape (a size-11 label on the size-10 root), acknowledged. */
async function raceLog() {
  resetIssuerSigner();
  _resetIssuerKey();
  const dir = tmp('qlprod-log-');
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  const publish = (now) => tree.publishHead({ force: true, now, sleep: async () => {}, send: async () => { throw new Error('no_send'); } });
  for (let i = 1; i <= 9; i += 1) await tree.appendReceipt(`row-${i}`, `hash-${i}`, { publish: false });
  await publish('2026-10-09T09:00:00.000Z');
  await tree.appendReceipt('row-10', 'hash-10', { publish: false });
  await tree.appendReceipt('row-11', 'hash-11', { publish: false });
  await publish('2026-10-09T10:00:00.000Z');
  const racedRoot = Buffer.from(rootOf(tree.leaves.slice(0, 10))).toString('hex');
  const tx = `0x${'cd'.repeat(32)}`;
  const claims = {
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: tree.epoch,
    prev_epoch_root: tree.prevEpochRoot,
    prev_epoch_size: tree.prevEpochSize,
    prev_root: '0'.repeat(64),
    tree_size: 11,
    root: racedRoot,
    anchor_status: 'anchored',
    anchor_tx: tx,
    anchor_from: `0x${'11'.repeat(20)}`,
    published_at: '2026-10-09T10:23:55.000Z',
    anchors: {
      base: { status: 'anchored', tx, chain_id: 8453, from: `0x${'11'.repeat(20)}` },
      solana: { status: 'pending', signature: null },
    },
  };
  const signed = signJws(claims, { typ: 'chit402-tree-head+jwt' });
  appendJournal(dir, {
    v: 1,
    op: 'head',
    epoch: tree.epoch,
    head: {
      ...claims,
      issuer_signature: { alg: 'ES256', typ: 'chit402-tree-head+jwt', payload_version: 2, jws: signed.jws, kid: signed.kid, issuer_jwk: getIssuerPublicKeyJwk() },
    },
  });
  const loaded = new ReceiptMerkleTree();
  loaded.load(dir);
  assert.equal(loaded.quarantinedHeads.length, 1);
  await loaded.acknowledgeQuarantinedHead(racedRoot);
  return dir;
}

/** The test-only script's dry run output, written to a file, as the operator would. */
function dryRunFile(logDir) {
  const env = { ...process.env, NODE_ENV: 'test', ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid };
  const dry = spawnSync(process.execPath, [OLD_SCRIPT, '--log-dir', logDir], { env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(dry.status, 0, dry.stderr);
  // The log loader's own log lines go to stdout too, and the logger writes
  // asynchronously, so they can land before or after the list. The list is
  // the one line that starts with its first key.
  const lines = dry.stdout.split('\n').filter((l) => l.startsWith('{"canonicalization":'));
  assert.equal(lines.length, 1, dry.stdout);
  const file = path.join(tmp('qlprod-in-'), 'quarantine-list-v1-dryrun.json');
  fs.writeFileSync(file, `${lines[0]}\n`);
  return { file, raw: dry.stdout };
}

let fixture = null;
async function setup() {
  if (!fixture) {
    const logDir = await raceLog();
    const { file, raw } = dryRunFile(logDir);
    fixture = { logDir, file, raw, bytes: fs.readFileSync(file) };
  }
  // Fresh copy of the log per test, so writes in one test never reach another.
  const logDir = tmp('qlprod-run-');
  fs.cpSync(fixture.logDir, logDir, { recursive: true });
  return { logDir, file: fixture.file, raw: fixture.raw, hash: sha256(fixture.bytes) };
}

function capture() {
  const out = [];
  const err = [];
  return { out, err, o: (l) => out.push(l), e: (l) => err.push(l) };
}

/**
 * RECEIPT_LOG_DIR is required, so unless a test names it in env (even as
 * undefined), it is set to the --log-dir value, as the runbook passes it.
 */
function withLogDirEnv(argv, env) {
  if (Object.prototype.hasOwnProperty.call(env, 'RECEIPT_LOG_DIR')) return env;
  const i = argv.indexOf('--log-dir');
  return i >= 0 && typeof argv[i + 1] === 'string' ? { ...env, RECEIPT_LOG_DIR: argv[i + 1] } : env;
}

/** N3 (649): a recorder run() passes to the test entry point; null otherwise. */
let throwingRecorder = null;

async function run(argv, { signer, keys = STUB_KEYS, env = {}, buildFromLog = (d) => buildUnsignedV1FromLog(d) } = {}) {
  const c = capture();
  const loads = [];
  const result = await P._runProductionListSignerForTest({
    argv,
    env: withLogDirEnv(argv, env),
    buildFromLog,
    loadSigner: async (e) => { loads.push(e); return signer; },
    out: c.o,
    err: c.e,
    // N3 (649): set only inside withThrowingRecorder.
    ...(throwingRecorder ? { recordRefusal: throwingRecorder } : {}),
  }, keys);
  return { result, out: c.out, err: c.err, loads };
}

function goodSigner(extra = {}) {
  return stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey, realJws: true, ...extra });
}

function listDirOf(logDir) {
  return Q.quarantineListDir(logDir);
}

function applyArgs(s, extra = []) {
  return ['--log-dir', s.logDir, '--list', s.file, '--list-sha256', s.hash, '--apply', '--confirm', CONFIRM, ...extra];
}

test('QP1: the rebuilt v1 equals the test-only script dry run byte for byte', async () => {
  const s = await setup();
  const built = await buildUnsignedV1FromLog(s.logDir);
  const { jcsRfc8785 } = await import('../src/offer-receipt.js');
  assert.equal(`${jcsRfc8785(built)}\n`, fs.readFileSync(s.file, 'utf8'));
  assert.equal(built.version, 1);
  assert.equal(built.entries.length, 1);
});

test('QP2: dry run by default shows the hash first, checks the signer, signs nothing and writes nothing', async () => {
  const s = await setup();
  const signer = goodSigner();
  const r = await run(['--log-dir', s.logDir, '--list', s.file], { signer });
  assert.equal(r.result.ok, true, r.err.join('\n'));
  assert.equal(r.result.state, 'dry_run');
  assert.equal(r.out[0], `LIST_SHA256=${s.hash}`);
  assert.ok(/dry run: version 1, 1 entries/.test(r.err.join('\n')), r.err.join('\n'));
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
  // --confirm alone, without --apply, is still a dry run.
  const r2 = await run(['--log-dir', s.logDir, '--list', s.file, '--confirm', CONFIRM, '--list-sha256', s.hash], { signer });
  assert.equal(r2.result.state, 'dry_run');
  assert.equal(signer.calls.length, 0);
});

test('QP3: apply signs once, verifies under the allowlisted key, writes v1 atomically and prints the pin hash; a rerun is a no-op', async () => {
  const s = await setup();
  const signer = goodSigner();
  const r = await run(applyArgs(s), { signer });
  assert.equal(r.result.ok, true, r.err.join('\n'));
  assert.equal(r.result.state, 'written');
  assert.equal(r.out[0], `LIST_SHA256=${s.hash}`);
  assert.equal(signer.calls.length, 1);
  const dir = listDirOf(s.logDir);
  assert.deepEqual(fs.readdirSync(dir), ['v1.json'], 'no temp file is left');
  const stored = fs.readFileSync(path.join(dir, 'v1.json'), 'utf8');
  const jwks = { keys: [{ ...KEY.publicJwk }] };
  const verdict = Q.verifyQuarantineList(stored, jwks);
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(JSON.parse(stored).issuer_signature.kid, KEY.kid);
  const { issuer_signature: _s, ...body } = JSON.parse(stored);
  const { jcsRfc8785 } = await import('../src/offer-receipt.js');
  assert.equal(`${jcsRfc8785(body)}\n`, fs.readFileSync(s.file, 'utf8'), 'the signed body is the input list');
  assert.ok(r.out.includes(`SIGNED_LIST_SHA256=${sha256(Buffer.from(stored, 'utf8'))}`));
  const entries = JSON.parse(r.out.find((l) => l.startsWith('LIST_ENTRIES=')).slice('LIST_ENTRIES='.length));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1], 11);
  assert.ok(/^0x[0-9a-f]{64}$/.test(entries[0][2]));
  // Nothing printed carries key material.
  const printed = [...r.out, ...r.err].join('\n');
  const pem = KEY.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const d = KEY.privateKey.export({ format: 'jwk' }).d;
  for (const secret of [syntheticIssuerKeyEnv(), pem.split('\n')[1], d]) assert.ok(!printed.includes(secret));
  // Idempotent: same input again does not sign and does not touch v1.
  const before = fs.readFileSync(path.join(dir, 'v1.json'));
  const again = await run(applyArgs(s), { signer });
  assert.equal(again.result.ok, true, again.err.join('\n'));
  assert.equal(again.result.state, 'same');
  assert.equal(signer.calls.length, 1, 'no second signature');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'v1.json')), before);
  // The GET route serves these bytes with the same hash.
  const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, type() { return this; }, status() { return this; }, send(b) { this.body = b; return this; }, json(b) { this.body = b; return this; } };
  Q.writeQuarantineListResponse(res, dir, {});
  assert.ok(r.out.includes(`SIGNED_LIST_SHA256=${res.headers['X-Chit-List-Hash']}`));
});

test('QP4: --apply without the confirm word is refused before the log or signer is touched', async () => {
  const s = await setup();
  const signer = goodSigner();
  const base = ['--log-dir', s.logDir, '--list', s.file, '--list-sha256', s.hash, '--apply'];
  for (const extra of [[], ['--confirm', 'YES'], ['--confirm', CONFIRM.toLowerCase()], ['--confirm']]) {
    const r = await run([...base, ...extra], { signer, buildFromLog: () => { throw new Error('log read'); } });
    assert.deepEqual(r.result, { ok: false, reason: 'confirm_missing' }, extra.join(' '));
    assert.equal(r.out[0], `LIST_SHA256=${s.hash}`, 'the hash is shown first');
    assert.equal(r.loads.length, 0, 'signer not loaded');
  }
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP5: a missing or wrong list hash is refused', async () => {
  const s = await setup();
  const signer = goodSigner();
  const base = ['--log-dir', s.logDir, '--list', s.file, '--apply', '--confirm', CONFIRM];
  const flipped = `${s.hash.slice(0, 63)}${s.hash[63] === '0' ? '1' : '0'}`;
  const cases = [[], ['--list-sha256', flipped], ['--list-sha256', s.hash.toUpperCase()], ['--list-sha256', sha256(Buffer.from(fs.readFileSync(s.file, 'utf8').trimEnd()))]];
  for (const extra of cases) {
    const r = await run([...base, ...extra], { signer });
    assert.deepEqual(r.result, { ok: false, reason: 'list_hash_mismatch' }, extra.join(' '));
    assert.equal(r.loads.length, 0);
  }
  // A dry run with a wrong hash is refused too.
  const dry = await run(['--log-dir', s.logDir, '--list', s.file, '--list-sha256', flipped], { signer });
  assert.deepEqual(dry.result, { ok: false, reason: 'list_hash_mismatch' });
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP6: the input must be the exact canonical unsigned v1 the log builds today', async () => {
  const s = await setup();
  const signer = goodSigner();
  const text = fs.readFileSync(s.file, 'utf8');
  const doc = JSON.parse(text);
  const { jcsRfc8785 } = await import('../src/offer-receipt.js');
  const variants = [
    ['list_not_canonical', `${text}\n`],
    ['list_not_canonical', JSON.stringify(doc, null, 1)],
    ['list_not_canonical', `\ufeff${text}`],
    // The whole dry run stdout, log lines included, is not the list.
    ['list_not_canonical', s.raw],
    ['list_not_unsigned_v1', jcsRfc8785({ ...doc, version: 2, seq: 2 })],
    ['list_not_unsigned_v1', jcsRfc8785({ ...doc, issuer_signature: { jws: 'a.b.c' } })],
    ['list_not_unsigned_v1', jcsRfc8785({ ...doc, entries_hash: '00'.repeat(32) })],
    ['list_not_build_output', jcsRfc8785(Q.buildQuarantineList({ entries: [{ ...doc.entries[0], reason: 'other' }], highWater: doc.high_water }))],
    ['list_not_build_output', jcsRfc8785(Q.buildQuarantineList({ entries: [], highWater: [] }))],
  ];
  for (const [reason, bytes] of variants) {
    const file = path.join(tmp('qlprod-bad-'), 'list.json');
    fs.writeFileSync(file, bytes);
    const h = sha256(fs.readFileSync(file));
    const r = await run(['--log-dir', s.logDir, '--list', file, '--list-sha256', h, '--apply', '--confirm', CONFIRM], { signer });
    assert.deepEqual(r.result, { ok: false, reason }, `${reason}: ${r.err.join(' ')}`);
  }
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP7: an existing v1 or a later version is never overwritten', async () => {
  const s = await setup();
  const dir = listDirOf(s.logDir);
  fs.mkdirSync(dir, { recursive: true });
  const doc = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  const sign = async (d, signer, keys) => P._signProductionV1ForTest(d, signer, keys);
  // A v1 of a different list, validly signed.
  const otherDoc = Q.buildQuarantineList({ entries: [{ ...doc.entries[0], reason: 'other' }], highWater: doc.high_water });
  const otherBytes = await sign(otherDoc, goodSigner(), [...STUB_KEYS]);
  fs.writeFileSync(path.join(dir, 'v1.json'), otherBytes);
  const signer = goodSigner();
  let r = await run(applyArgs(s), { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'v1_exists_different' });
  assert.equal(fs.readFileSync(path.join(dir, 'v1.json'), 'utf8'), otherBytes);
  // A v1 with this exact list, signed by a key that is not on the allowlist.
  const offKey = await sign(doc, stubSigner({ kid: OTHER.kid, publicJwk: OTHER.publicJwk, privateKey: OTHER.privateKey, realJws: true }), [{ x: OTHER.publicJwk.x, y: OTHER.publicJwk.y }]);
  fs.writeFileSync(path.join(dir, 'v1.json'), offKey);
  r = await run(applyArgs(s), { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'v1_exists_different' });
  assert.equal(fs.readFileSync(path.join(dir, 'v1.json'), 'utf8'), offKey);
  // Unparseable v1.
  fs.writeFileSync(path.join(dir, 'v1.json'), 'not json');
  r = await run(applyArgs(s), { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'v1_exists_different' });
  // Any other version present.
  fs.rmSync(path.join(dir, 'v1.json'));
  fs.writeFileSync(path.join(dir, 'v2.json'), '{}');
  r = await run(applyArgs(s), { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'later_version_exists' });
  fs.writeFileSync(path.join(dir, 'v1.json'), offKey);
  r = await run(applyArgs(s), { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'later_version_exists' });
  assert.equal(signer.calls.length, 0);
  // The write itself: v1 appearing between the check and the link is refused, and no temp file stays.
  const raceDir = tmp('qlprod-race-');
  fs.writeFileSync(path.join(raceDir, 'v1.json'), 'first');
  assert.throws(() => P.writeV1Atomic(raceDir, 'second'), (e) => e.reason === 'v1_exists_different');
  assert.equal(fs.readFileSync(path.join(raceDir, 'v1.json'), 'utf8'), 'first');
  assert.deepEqual(fs.readdirSync(raceDir), ['v1.json']);
});

test('QP8: a signature that does not verify under the allowlisted key is refused as signer_mismatch and nothing is written', async () => {
  const s = await setup();
  // Reports the allowlisted key and kid, signs with another key.
  const liar = stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: OTHER.privateKey, realJws: true });
  let r = await run(applyArgs(s), { signer: liar });
  assert.deepEqual(r.result, { ok: false, reason: 'signer_mismatch' });
  assert.equal(liar.calls.length, 1);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
  // A stub that returns a well-formed but fake 64-byte signature.
  const fake = stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey, realJws: false });
  r = await run(applyArgs(s), { signer: fake });
  assert.deepEqual(r.result, { ok: false, reason: 'signer_mismatch' });
  // Wrong length, or not a Buffer.
  for (const sig of [Buffer.alloc(63), 'x'.repeat(64), null]) {
    const bad = { kind: 'env', kid: KEY.kid, publicJwk: { kty: 'EC', crv: 'P-256', x: KEY.publicJwk.x, y: KEY.publicJwk.y }, async sign() { return sig; } };
    r = await run(applyArgs(s), { signer: bad });
    assert.deepEqual(r.result, { ok: false, reason: 'issuer_sign_invalid' });
  }
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
  // The whole-document check after signing: a document that is not a valid list is not returned.
  const doc = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  const signer = goodSigner();
  await assert.rejects(P._signProductionV1ForTest({ ...doc, entries_hash: '00'.repeat(32) }, signer, STUB_KEYS), (e) => e.reason === 'verify_failed');
  await assert.rejects(P._signProductionV1ForTest(doc, liar, STUB_KEYS), (e) => e.reason === 'signer_mismatch');
  const ok = await P._signProductionV1ForTest(doc, signer, STUB_KEYS);
  // The exported signer has no allowlist input: a test key is refused there.
  await assert.rejects(P.signProductionV1(doc, signer, STUB_KEYS), (e) => e.reason === 'not_production_key');
  assert.equal(Q.verifyQuarantineList(ok, { keys: [{ ...KEY.publicJwk }] }).ok, true);
});

test('QP9: only an allowlisted key signs: the real allowlist refuses every test key, and kid, accessor and missing-key cases are refused', async () => {
  const s = await setup();
  // Real allowlist (the default): a test key is not the production key.
  const signer = goodSigner();
  const c = capture();
  const real = await P.runProductionListSigner({
    argv: applyArgs(s), env: { RECEIPT_LOG_DIR: s.logDir }, buildFromLog: (d) => buildUnsignedV1FromLog(d), loadSigner: async () => signer, out: c.o, err: c.e,
  });
  assert.deepEqual(real, { ok: false, reason: 'not_production_key' });
  assert.equal(signer.calls.length, 0);
  // Another test key, not in the stub allowlist.
  let r = await run(applyArgs(s), { signer: stubSigner({ kid: OTHER.kid, publicJwk: OTHER.publicJwk, privateKey: OTHER.privateKey, realJws: true }) });
  assert.deepEqual(r.result, { ok: false, reason: 'not_production_key' });
  // Allowlisted x/y under a different kid label.
  for (const kid of [PRODUCTION_ISSUER_KID, OTHER.kid, null]) {
    r = await run(applyArgs(s), { signer: goodSigner({ kid }) });
    assert.deepEqual(r.result, { ok: false, reason: 'kid_mismatch' }, String(kid));
  }
  // A getter anywhere on the signer or its key.
  const getter = goodSigner();
  const pub = getter.publicJwk;
  Object.defineProperty(getter, 'publicJwk', { get: () => pub });
  r = await run(applyArgs(s), { signer: getter });
  assert.deepEqual(r.result, { ok: false, reason: 'signer_accessor' });
  const xGetter = goodSigner();
  const x = xGetter.publicJwk.x;
  Object.defineProperty(xGetter.publicJwk, 'x', { get: () => x });
  r = await run(applyArgs(s), { signer: xGetter });
  assert.deepEqual(r.result, { ok: false, reason: 'signer_accessor' });
  // No public key, or a malformed one.
  r = await run(applyArgs(s), { signer: { kind: 'env', kid: KEY.kid, async sign() { return Buffer.alloc(64); } } });
  assert.deepEqual(r.result, { ok: false, reason: 'no_public_key' });
  r = await run(applyArgs(s), { signer: goodSigner({ publicJwk: { x: `${KEY.publicJwk.x}=`, y: KEY.publicJwk.y } }) });
  assert.deepEqual(r.result, { ok: false, reason: 'no_public_key' });
  // A KMS-kind signer with the allowlisted key is accepted (dry run).
  const kms = goodSigner();
  kms.kind = 'kms';
  r = await run(['--log-dir', s.logDir, '--list', s.file], { signer: kms });
  assert.equal(r.result.state, 'dry_run', r.err.join(' '));
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP10: refused outside a production process, and for an ephemeral key even if it were allowlisted', async () => {
  const s = await setup();
  const signer = goodSigner();
  const r = await run(applyArgs(s), { signer, env: { NODE_ENV: 'test', ISSUER_TEST_KEY: '1' } });
  assert.deepEqual(r.result, { ok: false, reason: 'not_production_process' });
  const saved = { k: process.env.ISSUER_PRIVATE_KEY, kid: process.env.ISSUER_KID };
  try {
    const built = await buildUnsignedV1FromLog(s.logDir);
    delete process.env.ISSUER_PRIVATE_KEY;
    delete process.env.ISSUER_KID;
    resetIssuerSigner();
    _resetIssuerKey();
    const eph = createEnvSigner(process.env);
    const ephKeys = [{ x: eph.publicJwk.x, y: eph.publicJwk.y }];
    const c = capture();
    const out = await P._runProductionListSignerForTest({
      argv: applyArgs(s), env: { RECEIPT_LOG_DIR: s.logDir }, buildFromLog: async () => built, loadSigner: async () => eph, out: c.o, err: c.e,
    }, ephKeys);
    assert.deepEqual(out, { ok: false, reason: 'not_production_key' });
  } finally {
    process.env.ISSUER_PRIVATE_KEY = saved.k;
    process.env.ISSUER_KID = saved.kid;
    resetIssuerSigner();
    _resetIssuerKey();
  }
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP11: the script is a thin entry point with the real allowlist; the test-only signer still refuses the production key', { timeout: 120_000 }, async () => {
  const src = fs.readFileSync(NEW_SCRIPT, 'utf8');
  assert.ok(!/productionKeys/.test(src), 'the script never passes an allowlist');
  assert.ok(/initIssuerSigner\(env\)/.test(src), 'the key loads through the gateway signer');
  const mod = fs.readFileSync(MODULE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/console\.|logger|\.export\(/.test(mod), 'the module neither logs nor exports key material');
  assert.ok(!/env\.ISSUER_PRIVATE_KEY|\[['"]ISSUER_PRIVATE_KEY/.test(mod), 'the module never reads key material');
  assert.ok(!/quarantineSignGuard|signQuarantineList\(/.test(mod), 'the test-only guard is not called or bypassed here');
  // The production key's thumbprint is the production kid, so the header kid is the published one.
  const k = PRODUCTION_ISSUER_PUBLIC_KEYS[0];
  assert.equal(computeJwkThumbprint({ kty: 'EC', crv: 'P-256', x: k.x, y: k.y }), PRODUCTION_ISSUER_KID);
  // The test-only guard still refuses the production key by x/y and the production env, whatever word is passed.
  assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test' }, publicJwk: { x: k.x, y: k.y } }), { ok: false, reason: 'production_key' });
  const s = await setup();
  const env = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid };
  delete env.NODE_ENV;
  for (const confirm of ['YES', CONFIRM]) {
    const old = spawnSync(process.execPath, [OLD_SCRIPT, '--log-dir', s.logDir, '--apply', '--confirm', confirm], { env, encoding: 'utf8', timeout: 20_000 });
    assert.notEqual(old.status, 0);
    // YES reaches the guard and is refused there; the new confirm word is not accepted by the old script at all.
    const want = confirm === 'YES' ? /refused: production_env/ : /--apply needs --confirm YES/;
    assert.ok(want.test(old.stderr), old.stderr);
  }
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP12: the script end to end in a production env with a test key: hash first, confirm refused, real allowlist refuses the key, nothing written', { timeout: 120_000 }, async () => {
  const s = await setup();
  const env = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid, RECEIPT_LOG_DIR: s.logDir };
  delete env.NODE_ENV;
  delete env.ISSUER_TEST_KEY;
  const go = (args) => spawnSync(process.execPath, [NEW_SCRIPT, '--log-dir', s.logDir, '--list', s.file, ...args], { env, encoding: 'utf8', timeout: 30_000 });
  const noConfirm = go(['--list-sha256', s.hash, '--apply']);
  assert.equal(noConfirm.status, 1);
  assert.equal(noConfirm.stdout.split('\n')[0], `LIST_SHA256=${s.hash}`);
  assert.ok(/refused: confirm_missing/.test(noConfirm.stderr), noConfirm.stderr);
  const dry = go([]);
  assert.equal(dry.status, 1);
  assert.equal(dry.stdout.split('\n')[0], `LIST_SHA256=${s.hash}`);
  assert.ok(/refused: not_production_key/.test(dry.stderr), dry.stderr);
  const apply = go(['--list-sha256', s.hash, '--apply', '--confirm', CONFIRM]);
  assert.equal(apply.status, 1);
  assert.ok(/refused: not_production_key/.test(apply.stderr), apply.stderr);
  for (const out of [noConfirm, dry, apply]) {
    assert.ok(!`${out.stdout}${out.stderr}`.includes(syntheticIssuerKeyEnv()));
  }
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP13: --log-dir and RECEIPT_LOG_DIR must name the same real directory when both are set', async () => {
  const s = await setup();
  const signer = goodSigner();
  const other = tmp('qlprod-other-');
  fs.cpSync(s.logDir, other, { recursive: true });
  let r = await run(applyArgs(s), { signer, env: { RECEIPT_LOG_DIR: other } });
  assert.deepEqual(r.result, { ok: false, reason: 'log_dir_mismatch' });
  r = await run(applyArgs(s), { signer, env: { RECEIPT_LOG_DIR: path.join(other, 'missing') } });
  assert.deepEqual(r.result, { ok: false, reason: 'log_dir_mismatch' });
  // Both set to the same path that does not exist: refused, not resolved later.
  const missing = path.join(other, 'missing');
  r = await run(['--log-dir', missing, '--list', s.file], { signer, env: { RECEIPT_LOG_DIR: missing } });
  assert.deepEqual(r.result, { ok: false, reason: 'log_dir_mismatch' });
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
  assert.equal(fs.existsSync(listDirOf(other)), false);
  // The same directory by another spelling (trailing slash, a dot component) is fine.
  r = await run(['--log-dir', s.logDir, '--list', s.file], { signer, env: { RECEIPT_LOG_DIR: `${path.dirname(s.logDir)}${path.sep}.${path.sep}${path.basename(s.logDir)}${path.sep}` } });
  assert.equal(r.result.state, 'dry_run', r.err.join(' '));
  // A symlink to it is not: see QP27.
  const link = path.join(tmp('qlprod-link-'), 'logdir');
  fs.symlinkSync(s.logDir, link);
  r = await run(['--log-dir', s.logDir, '--list', s.file], { signer, env: { RECEIPT_LOG_DIR: `${link}/` } });
  assert.deepEqual(r.result, { ok: false, reason: 'log_dir_symlink' });
  // RECEIPT_LOG_DIR alone is used when --log-dir is absent.
  r = await run(['--list', s.file], { signer, env: { RECEIPT_LOG_DIR: s.logDir } });
  assert.equal(r.result.state, 'dry_run', r.err.join(' '));
});

/** Swap fs.readFileSync for reads of v1.json only, for one call of fn. */
async function withV1Read(fake, fn) {
  const real = fs.readFileSync;
  fs.readFileSync = function patched(file, ...rest) {
    if (String(file).endsWith(`${path.sep}v1.json`)) return fake(real, file, ...rest);
    return real.call(fs, file, ...rest);
  };
  try {
    return await fn();
  } finally {
    fs.readFileSync = real;
  }
}

test('QP14: after v1 is linked, any failure says v1 was written (rerun advice except on write_mismatch); a rerun recovers to same', async () => {
  // Read-back differs from the signed bytes: write_mismatch, v1 on disk.
  let s = await setup();
  let signer = goodSigner();
  let r = await withV1Read((real, file, ...rest) => `${real.call(fs, file, ...rest)} `, () => run(applyArgs(s), { signer }));
  assert.deepEqual(r.result, { ok: false, reason: 'write_mismatch', written: true });
  const v1 = path.join(listDirOf(fs.realpathSync(s.logDir)), 'v1.json');
  assert.ok(fs.existsSync(v1));
  assert.ok(r.out.includes(`FILE=${v1}`));
  assert.ok(!r.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')), 'no pin hash on a mismatch');
  let text = r.err.join('\n');
  assert.ok(/v1 was written/.test(text), text);
  // D5 (644): write_mismatch is a refusal, so no rerun advice.
  assert.ok(/Do not pin\. Inspect .*v1\.json before any rerun\./.test(text), text);
  assert.ok(!/Rerun/.test(text), text);
  assert.ok(!/Nothing written/.test(text), text);
  // Read-back throws (EIO): the message says v1 WAS written, never "Nothing written".
  s = await setup();
  signer = goodSigner();
  r = await withV1Read(() => { const e = new Error('io'); e.code = 'EIO'; throw e; }, () => run(applyArgs(s), { signer }));
  assert.deepEqual(r.result, { ok: false, reason: 'error', written: true });
  text = r.err.join('\n');
  assert.ok(/failed after writing: EIO\. v1 WAS written to /.test(text), text);
  assert.ok(!/Nothing written/.test(text), text);
  // The rerun recovers: same, and the pin hash is printed.
  const again = await run(applyArgs(s), { signer });
  assert.equal(again.result.state, 'same', again.err.join(' '));
  assert.ok(again.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')));
  assert.equal(signer.calls.length, 1);
  // Before the link, a failure still says nothing was written.
  s = await setup();
  r = await run(applyArgs(s), { signer: stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey, realJws: true, onSign: () => { const e = new Error('kms'); e.code = 'ThrottlingException'; throw e; } }) });
  assert.deepEqual(r.result, { ok: false, reason: 'error' });
  assert.ok(/failed: ThrottlingException\. Nothing written\./.test(r.err.join('\n')));
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
}

test('QP15: the allowlist cannot come from a caller, env or issuer history: source scans', async () => {
  const mod = stripComments(fs.readFileSync(MODULE, 'utf8'));
  const script = stripComments(fs.readFileSync(NEW_SCRIPT, 'utf8'));
  // The module reads exactly one env value, RECEIPT_LOG_DIR. env otherwise only
  // goes to isProductionProcess and loadSigner (initIssuerSigner's own path).
  assert.ok(!/process\s*\.\s*env|process\s*\[|globalThis|Reflect\./.test(mod), 'the module never touches process.env');
  const reads = [...mod.matchAll(/\benv\b\s*(\??\.)?\s*(\[|[A-Za-z_$][\w$]*)?/g)].map((m) => m[0].replace(/\s+/g, ''));
  const allowed = new Set(['env', 'env.RECEIPT_LOG_DIR']);
  for (const r of reads) assert.ok(allowed.has(r), `unexpected env use: ${r}`);
  assert.equal(reads.filter((r) => r === 'env.RECEIPT_LOG_DIR').length, 1, 'RECEIPT_LOG_DIR is read once');
  const bare = mod.match(/\benv\b(?!\s*\.\s*RECEIPT_LOG_DIR)/g) || [];
  const contexts = [...mod.matchAll(/^.*\benv\b(?!\s*\.\s*RECEIPT_LOG_DIR).*$/gm)].map((m) => m[0].trim());
  const okContexts = [
    /^const RUN_OPTIONS = Object\.freeze\(\['argv', 'env', 'buildFromLog', 'loadSigner', 'out', 'err'\]\);$/,
    /^env,$/,
    /^if \(!isProductionProcess\(env\)\) refuse\(/,
    /^const signer = await loadSigner\(env\);$/,
  ];
  for (const line of contexts) assert.ok(okContexts.some((re) => re.test(line)), `env used outside the allowed places: ${line}`);
  assert.equal(bare.length, contexts.length, 'one bare env per allowed line');
  assert.ok(!/ISSUER_HISTORY_EXTRA|issuer-history|historyExtra/.test(mod), 'issuer history is not an allowlist source');
  // The production allowlist is named in three places only: the import, the exported runner, the exported signer.
  assert.equal((mod.match(/PRODUCTION_ISSUER_PUBLIC_KEYS/g) || []).length, 3);
  const runner = /\nexport async function runProductionListSigner\(opts\) \{\n([\s\S]*?)\n\}\n/.exec(mod);
  assert.ok(runner, 'the exported runner takes one opts argument');
  assert.ok(/\n  return runWith\(opts, PRODUCTION_ISSUER_PUBLIC_KEYS\);$/.test(runner[1]), 'the exported runner pins the production allowlist');
  assert.equal((runner[1].match(/runWith\(/g) || []).length, 1);
  assert.ok(/export async function signProductionV1\(doc, signer\) \{\n  return signWithSnapshot\(doc, snapshot\(signer\), decodedKeys\(PRODUCTION_ISSUER_PUBLIC_KEYS\)\);\n\}/.test(mod), 'the exported signer pins the production allowlist');
  assert.ok(/^const RUN_OPTIONS = Object\.freeze\(\['argv', 'env', 'buildFromLog', 'loadSigner', 'out', 'err'\]\);$/m.test(mod), 'the runner takes no allowlist option');
  // The script names only the exported runner, with the four fixed options.
  assert.ok(!/ForTest|productionKeys|runWith|_sign|_run/.test(script), 'the script never names a test entry point or an allowlist');
  assert.ok(/const \{ runProductionListSigner \} = await import\('\.\.\/src\/quarantine-list-production\.js'\);/.test(script));
  assert.ok(/runProductionListSigner\(\{\n  argv: process\.argv\.slice\(2\),\n  env: process\.env,\n  buildFromLog: \(logDir\) => buildUnsignedV1FromLog\(logDir\),\n  loadSigner: \(env\) => initIssuerSigner\(env\),\n\}\);/.test(script), 'the script passes exactly argv, env, buildFromLog and loadSigner');
  // No source or script file calls the test-only entry points.
  for (const dirName of ['src', 'scripts']) {
    const dir = path.join(here, '..', dirName);
    for (const name of fs.readdirSync(dir).filter((n) => /\.(m?js|cjs)$/.test(n))) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const hits = (text.match(/_(run|sign)ProductionV?1?\w*ForTest/g) || []);
      const own = name === 'quarantine-list-production.js' ? 2 : 0;
      assert.equal(hits.length, own, `${dirName}/${name} names a test-only entry point`);
    }
  }
  // At runtime the exported runner refuses an allowlist option outright.
  const s = await setup();
  await assert.rejects(
    P.runProductionListSigner({ argv: ['--list', s.file, '--log-dir', s.logDir], env: {}, buildFromLog: buildUnsignedV1FromLog, loadSigner: async () => goodSigner(), productionKeys: STUB_KEYS }),
    /unknown option productionKeys/,
  );
});

test('QP16: the script refuses a test key also listed in ISSUER_HISTORY_EXTRA and in allowlist-looking env vars', { timeout: 120_000 }, async () => {
  const s = await setup();
  const stub = JSON.stringify(STUB_KEYS);
  const env = {
    ...process.env,
    ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(),
    ISSUER_KID: KEY.kid,
    RECEIPT_LOG_DIR: s.logDir,
    ISSUER_HISTORY_EXTRA: JSON.stringify([{ kid: KEY.kid, jwk: { kty: 'EC', crv: 'P-256', x: KEY.publicJwk.x, y: KEY.publicJwk.y }, alg: 'ES256', status: 'retired' }]),
    QL_ALLOW: stub,
    QLX: stub,
    PRODUCTION_ISSUER_PUBLIC_KEYS: stub,
    productionKeys: stub,
    QUARANTINE_PRODUCTION_KEYS: stub,
  };
  delete env.NODE_ENV;
  delete env.ISSUER_TEST_KEY;
  const go = (args) => spawnSync(process.execPath, [NEW_SCRIPT, '--log-dir', s.logDir, '--list', s.file, ...args], { env, encoding: 'utf8', timeout: 30_000 });
  for (const args of [[], ['--list-sha256', s.hash, '--apply', '--confirm', CONFIRM]]) {
    const out = go(args);
    assert.equal(out.status, 1, out.stderr);
    assert.equal(out.stdout.split('\n')[0], `LIST_SHA256=${s.hash}`);
    assert.ok(/refused: not_production_key/.test(out.stderr), out.stderr);
  }
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP17: a symlinked or non-directory quarantine-list path, or a relative log dir, is refused', async () => {
  const signer = goodSigner();
  // Symlink to an empty directory elsewhere: nothing is written through it.
  let s = await setup();
  const target = tmp('qlprod-target-');
  fs.symlinkSync(target, listDirOf(s.logDir));
  let r = await run(applyArgs(s), { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'list_dir_not_directory' });
  assert.deepEqual(fs.readdirSync(target), []);
  // A regular file where the directory should be.
  s = await setup();
  fs.writeFileSync(listDirOf(s.logDir), 'x');
  r = await run(applyArgs(s), { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'list_dir_not_directory' });
  // The write helper refuses a symlinked directory on its own too.
  const linkDir = path.join(tmp('qlprod-wlink-'), 'quarantine-list');
  fs.symlinkSync(target, linkDir);
  assert.throws(() => P.writeV1Atomic(linkDir, 'bytes'), (e) => e.reason === 'list_dir_not_directory');
  assert.deepEqual(fs.readdirSync(target), []);
  // A relative log directory.
  s = await setup();
  const rel = path.relative(process.cwd(), s.logDir);
  r = await run(['--log-dir', rel, '--list', s.file], { signer });
  assert.deepEqual(r.result, { ok: false, reason: 'usage' });
  assert.equal(signer.calls.length, 0);
});

test('QP18: every flag may be given once only', async () => {
  const s = await setup();
  const signer = goodSigner();
  const cases = [
    [...applyArgs(s), '--confirm', 'YES'],
    ['--confirm', 'YES', ...applyArgs(s)],
    [...applyArgs(s), '--list', s.file],
    [...applyArgs(s), '--list-sha256', s.hash],
    [...applyArgs(s), '--log-dir', s.logDir],
    [...applyArgs(s), '--apply'],
  ];
  for (const argv of cases) {
    const r = await run(argv, { signer });
    assert.deepEqual(r.result, { ok: false, reason: 'usage' }, argv.join(' '));
  }
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP19: v1.json is mode 0644 even under umask 077', async () => {
  const s = await setup();
  const prev = process.umask(0o077);
  try {
    const r = await run(applyArgs(s), { signer: goodSigner() });
    assert.equal(r.result.state, 'written', r.err.join(' '));
  } finally {
    process.umask(prev);
  }
  assert.equal(fs.statSync(path.join(listDirOf(s.logDir), 'v1.json')).mode & 0o777, 0o644);
});

test('QP20: a log with two raced heads: the rebuilt v1 still equals the test-only script dry run, and both entries are signed', { timeout: 120_000 }, async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  const dir = tmp('qlprod-two-');
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  const publish = (now) => tree.publishHead({ force: true, now, sleep: async () => {}, send: async () => { throw new Error('no_send'); } });
  for (let i = 1; i <= 9; i += 1) await tree.appendReceipt(`row-${i}`, `hash-${i}`, { publish: false });
  await publish('2026-10-09T09:00:00.000Z');
  for (let i = 10; i <= 13; i += 1) await tree.appendReceipt(`row-${i}`, `hash-${i}`, { publish: false });
  const honest = await publish('2026-10-09T10:00:00.000Z');
  assert.equal(honest.tree_size, 14);
  const raced = [];
  for (const [label, prefix, at] of [[11, 10, '2026-10-09T10:23:55.000Z'], [13, 12, '2026-10-09T10:24:55.000Z']]) {
    const root = Buffer.from(rootOf(tree.leaves.slice(0, prefix))).toString('hex');
    const claims = {
      schema: 'chit402.tree_head.v2',
      payload_version: 2,
      epoch: tree.epoch,
      prev_epoch_root: tree.prevEpochRoot,
      prev_epoch_size: tree.prevEpochSize,
      prev_root: '0'.repeat(64),
      tree_size: label,
      root,
      anchor_status: 'pending',
      anchor_tx: null,
      anchor_from: null,
      published_at: at,
      anchors: { base: { status: 'pending', tx: null }, solana: { status: 'pending', signature: null } },
    };
    const signed = signJws(claims, { typ: 'chit402-tree-head+jwt' });
    appendJournal(dir, {
      v: 1,
      op: 'head',
      epoch: tree.epoch,
      head: { ...claims, issuer_signature: { alg: 'ES256', typ: 'chit402-tree-head+jwt', payload_version: 2, jws: signed.jws, kid: signed.kid, issuer_jwk: getIssuerPublicKeyJwk() } },
    });
    raced.push(root);
  }
  const loaded = new ReceiptMerkleTree();
  loaded.load(dir);
  assert.equal(loaded.quarantinedHeads.length, 2);
  for (const root of raced) await loaded.acknowledgeQuarantinedHead(root);
  const { file } = dryRunFile(dir);
  const { jcsRfc8785 } = await import('../src/offer-receipt.js');
  const built = await buildUnsignedV1FromLog(dir);
  assert.equal(`${jcsRfc8785(built)}\n`, fs.readFileSync(file, 'utf8'));
  assert.deepEqual(built.entries.map((e) => [e.tree_size, e.prefix_size, e.consistency.second]), [[11, 10, 14], [13, 12, 14]]);
  const hash = sha256(fs.readFileSync(file));
  const r = await run(['--log-dir', dir, '--list', file, '--list-sha256', hash, '--apply', '--confirm', CONFIRM], { signer: goodSigner() });
  assert.equal(r.result.state, 'written', r.err.join(' '));
  const entries = JSON.parse(r.out.find((l) => l.startsWith('LIST_ENTRIES=')).slice('LIST_ENTRIES='.length));
  assert.equal(entries.length, 2);
});

test('QP21: RECEIPT_LOG_DIR is required; --log-dir alone is refused as log_dir_env_unset before anything is read', { timeout: 120_000 }, async () => {
  const s = await setup();
  const signer = goodSigner();
  for (const env of [{ RECEIPT_LOG_DIR: undefined }, { RECEIPT_LOG_DIR: '' }]) {
    for (const argv of [applyArgs(s), ['--log-dir', s.logDir, '--list', s.file]]) {
      const r = await run(argv, { signer, env });
      assert.deepEqual(r.result, { ok: false, reason: 'log_dir_env_unset' }, argv.join(' '));
      assert.ok(!r.out.some((l) => l.startsWith('LIST_SHA256=')), 'refused before the input is read');
      assert.equal(r.loads.length, 0, 'the signer is never loaded');
      assert.ok(/refused: log_dir_env_unset\. RECEIPT_LOG_DIR must be set/.test(r.err.join('\n')), r.err.join('\n'));
    }
  }
  // Neither given: the same refusal.
  const none = await run(['--list', s.file], { signer, env: { RECEIPT_LOG_DIR: undefined } });
  assert.deepEqual(none.result, { ok: false, reason: 'log_dir_env_unset' });
  // The real script in a production env with RECEIPT_LOG_DIR unset.
  const env = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid };
  delete env.NODE_ENV;
  delete env.ISSUER_TEST_KEY;
  delete env.RECEIPT_LOG_DIR;
  const out = spawnSync(process.execPath, [NEW_SCRIPT, '--log-dir', s.logDir, '--list', s.file], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(out.status, 1, out.stderr);
  assert.ok(/refused: log_dir_env_unset/.test(out.stderr), out.stderr);
  assert.ok(!/LIST_SHA256=/.test(out.stdout), out.stdout);
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP22: the log directory is resolved once; the log is built and v1 written from that one canonical path', async () => {
  for (const via of ['flag', 'env']) {
    const s = await setup();
    const real = fs.realpathSync(s.logDir);
    // A non-canonical spelling of the same directory (dot component, trailing slash).
    const spelled = `${path.dirname(real)}${path.sep}.${path.sep}${path.basename(real)}${path.sep}`;
    const seen = [];
    const buildFromLog = async (d) => { seen.push(d); return buildUnsignedV1FromLog(d); };
    const argv = via === 'flag'
      ? ['--log-dir', spelled, '--list', s.file, '--list-sha256', s.hash, '--apply', '--confirm', CONFIRM]
      : ['--list', s.file, '--list-sha256', s.hash, '--apply', '--confirm', CONFIRM];
    const env = { RECEIPT_LOG_DIR: via === 'flag' ? real : spelled };
    const r = await run(argv, { signer: goodSigner(), env, buildFromLog });
    assert.equal(r.result.state, 'written', `${via}: ${r.err.join(' ')}`);
    assert.deepEqual(seen, [real], `${via}: the log is built from the resolved path`);
    const v1 = path.join(listDirOf(real), 'v1.json');
    assert.ok(fs.existsSync(v1), via);
    assert.ok(r.out.includes(`FILE=${v1}`), `${via}: ${r.out.join(' ')}`);
  }
  // RECEIPT_LOG_DIR alone naming a path that does not resolve.
  const s = await setup();
  const r = await run(['--list', s.file], { signer: goodSigner(), env: { RECEIPT_LOG_DIR: path.join(s.logDir, 'missing') } });
  assert.deepEqual(r.result, { ok: false, reason: 'log_dir_unresolved' });
});

test('QP23: a temp-file cleanup failure after the link reports v1 as written, never "Nothing written"', async () => {
  const s = await setup();
  const signer = goodSigner();
  const realRm = fs.rmSync;
  let thrown = 0;
  fs.rmSync = function patched(p, ...rest) {
    if (String(p).includes('.v1.json.tmp-')) {
      thrown += 1;
      const e = new Error('busy');
      e.code = 'EBUSY';
      throw e;
    }
    return realRm.call(fs, p, ...rest);
  };
  let r;
  try {
    r = await run(applyArgs(s), { signer });
  } finally {
    fs.rmSync = realRm;
  }
  assert.equal(thrown, 1);
  assert.deepEqual(r.result, { ok: false, reason: 'error', written: true });
  const v1 = path.join(listDirOf(fs.realpathSync(s.logDir)), 'v1.json');
  assert.ok(fs.existsSync(v1));
  assert.ok(r.out.includes(`FILE=${v1}`), r.out.join(' '));
  const text = r.err.join('\n');
  assert.ok(/failed after writing: EBUSY\. v1 WAS written to /.test(text), text);
  assert.ok(/Do not pin yet\. Rerun the same command/.test(text), text);
  assert.ok(!/Nothing written/.test(text), text);
  // The rerun verifies v1 (the leftover temp link is not a version) and prints the pin hash.
  const again = await run(applyArgs(s), { signer });
  assert.equal(again.result.state, 'same', again.err.join(' '));
  assert.ok(again.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')));
  assert.equal(signer.calls.length, 1);
  // writeV1Atomic on its own: onLinked runs before the cleanup throws.
  const dir = path.join(tmp('qlprod-onlinked-'), 'quarantine-list');
  const linked = [];
  fs.rmSync = function patched(p, ...rest) {
    if (String(p).includes('.v1.json.tmp-')) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
    return realRm.call(fs, p, ...rest);
  };
  try {
    assert.throws(() => P.writeV1Atomic(dir, 'bytes', { onLinked: (f) => linked.push(f) }), (e) => e.code === 'EBUSY');
  } finally {
    fs.rmSync = realRm;
  }
  assert.deepEqual(linked, [path.join(dir, 'v1.json')]);
});

test('QP24: the test-only entry points refuse to run in a production process, however they are found', { timeout: 120_000 }, async () => {
  const s = await setup();
  const signer = goodSigner();
  const built = await buildUnsignedV1FromLog(s.logDir);
  const savedNodeEnv = process.env.NODE_ENV;
  // In this process, with NODE_ENV unset (production by isProductionProcess).
  delete process.env.NODE_ENV;
  try {
    await assert.rejects(
      P._runProductionListSignerForTest({
        argv: applyArgs(s), env: { RECEIPT_LOG_DIR: s.logDir }, buildFromLog: async () => built, loadSigner: async () => signer, out: () => {}, err: () => {},
      }, STUB_KEYS),
      /test-only entry point: refused in a production process/,
    );
    await assert.rejects(P._signProductionV1ForTest(built, signer, STUB_KEYS), /test-only entry point: refused in a production process/);
    // Found by enumerating the module namespace instead of by name: the same refusal.
    const found = Object.keys(P).filter((k) => k.startsWith('_') && typeof P[k] === 'function');
    assert.equal(found.length, 2, found.join(','));
    for (const k of found) await assert.rejects(P[k]({ argv: [], env: {} }, STUB_KEYS), /refused in a production process/, k);
  } finally {
    process.env.NODE_ENV = savedNodeEnv;
  }
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
  // A separate production process (gateway-like env with a test key) that
  // discovers the entry through Object.keys and passes a test allowlist.
  const probe = [
    `const m = await import(${JSON.stringify(new URL(`file://${MODULE}`).href)});`,
    "const name = Object.keys(m).find((k) => k.startsWith('_') && k.includes('Signer'));",
    "try { const r = await m[name]({ argv: JSON.parse(process.env.QARGV), env: process.env, buildFromLog: async () => { throw new Error('reached'); }, loadSigner: async () => { throw new Error('reached'); } }, JSON.parse(process.env.QLX)); console.log('RESULT', JSON.stringify(r)); }",
    "catch (e) { console.log('THREW', e.message); }",
  ].join('\n');
  const env = {
    ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid, RECEIPT_LOG_DIR: s.logDir,
    QLX: JSON.stringify(STUB_KEYS), QARGV: JSON.stringify(applyArgs(s)),
  };
  delete env.NODE_ENV;
  delete env.ISSUER_TEST_KEY;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(/^THREW test-only entry point: refused in a production process$/m.test(out.stdout), out.stdout + out.stderr);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

test('QP25: the public runner reads no env name beyond RECEIPT_LOG_DIR and what isProductionProcess reads', async () => {
  const s = await setup();
  const { isProductionProcess } = await import('../src/production-process.js');
  const base = { RECEIPT_LOG_DIR: s.logDir };
  // Baseline: the env names isProductionProcess itself touches for this env.
  const baseline = new Set(['RECEIPT_LOG_DIR']);
  const rec = new Proxy({ ...base }, {
    get: (t, k) => { if (typeof k === 'string') baseline.add(k); return t[k]; },
    has: (t, k) => { if (typeof k === 'string') baseline.add(k); return k in t; },
    ownKeys: (t) => { baseline.add('<ownKeys>'); return Reflect.ownKeys(t); },
  });
  isProductionProcess(rec);
  // The run: any other name read returns a test allowlist, in every shape a
  // mutant might parse, so reading one would let the test key sign.
  const stub = JSON.stringify(STUB_KEYS);
  const stray = [];
  const env = new Proxy({ ...base }, {
    get: (t, k) => {
      if (typeof k !== 'string' || baseline.has(k)) return t[k];
      stray.push(k);
      return stub;
    },
    has: (t, k) => {
      if (typeof k === 'string' && !baseline.has(k)) { stray.push(`in:${k}`); return true; }
      return k in t;
    },
    ownKeys: (t) => {
      if (!baseline.has('<ownKeys>')) stray.push('<ownKeys>');
      return [...Reflect.ownKeys(t), 'QLX'];
    },
    getOwnPropertyDescriptor: (t, k) => (k === 'QLX' ? { value: stub, enumerable: true, configurable: true, writable: true } : Reflect.getOwnPropertyDescriptor(t, k)),
  });
  const signer = goodSigner();
  const c = capture();
  const r = await P.runProductionListSigner({
    argv: applyArgs(s), env, buildFromLog: (d) => buildUnsignedV1FromLog(d), loadSigner: async () => signer, out: c.o, err: c.e,
  });
  assert.deepEqual(stray, [], `env names read outside the allowed set: ${stray.join(',')}`);
  assert.deepEqual(r, { ok: false, reason: 'not_production_key' });
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

/** Run fn with fs.openSync / fs.linkSync hooked for the v1 temp file and link only. */
async function withWriteHooks({ beforeOpen, afterLink }, fn) {
  const realOpen = fs.openSync;
  const realLink = fs.linkSync;
  fs.openSync = function patched(p, ...rest) {
    if (beforeOpen && String(p).includes('.v1.json.tmp-')) beforeOpen(p);
    return realOpen.call(fs, p, ...rest);
  };
  fs.linkSync = function patched(a, b, ...rest) {
    const out = realLink.call(fs, a, b, ...rest);
    if (afterLink && String(b).endsWith(`${path.sep}v1.json`)) afterLink(b);
    return out;
  };
  try {
    return await fn();
  } finally {
    fs.openSync = realOpen;
    fs.linkSync = realLink;
  }
}

test('QP26: a quarantine-list directory swapped between the check and the link fails closed as list_dir_changed, reported as written', async () => {
  const check = (r, label) => {
    assert.deepEqual(r.result, { ok: false, reason: 'list_dir_changed', written: true }, `${label}: ${r.err.join(' ')}`);
    assert.ok(!r.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')), `${label}: no pin hash`);
    const text = r.err.join('\n');
    assert.ok(/refused: list_dir_changed\./.test(text), `${label}: ${text}`);
    assert.ok(/Do not pin\. v1 was written, but not necessarily to /.test(text), `${label}: ${text}`);
    assert.ok(!/Nothing written/.test(text), `${label}: ${text}`);
  };
  const prepared = async () => {
    const s = await setup();
    const listDir = listDirOf(fs.realpathSync(s.logDir));
    fs.mkdirSync(listDir, { mode: 0o700 });
    return { s, listDir, target: tmp('qlprod-swap-'), aside: `${listDir}.aside` };
  };
  // (a) Swapped for a symlink before the temp open: the write lands in the target.
  let { s, listDir, target, aside } = await prepared();
  let r = await withWriteHooks({
    beforeOpen: () => { fs.renameSync(listDir, aside); fs.symlinkSync(target, listDir); },
  }, () => run(applyArgs(s), { signer: goodSigner() }));
  check(r, 'symlink');
  assert.ok(fs.existsSync(path.join(target, 'v1.json')), 'the write went through the swapped link');
  // (b) Replaced by another real directory: a different inode.
  ({ s, listDir, target, aside } = await prepared());
  r = await withWriteHooks({
    beforeOpen: () => { fs.renameSync(listDir, aside); fs.mkdirSync(listDir, { mode: 0o700 }); },
  }, () => run(applyArgs(s), { signer: goodSigner() }));
  check(r, 'replaced');
  // (c) Swapped for a symlink before the open and swapped back after the link:
  // the directory is the checked one again, but v1.json in it is not ours.
  ({ s, listDir, target, aside } = await prepared());
  r = await withWriteHooks({
    beforeOpen: () => { fs.renameSync(listDir, aside); fs.symlinkSync(target, listDir); },
    afterLink: () => { fs.unlinkSync(listDir); fs.renameSync(aside, listDir); },
  }, () => run(applyArgs(s), { signer: goodSigner() }));
  check(r, 'swapped back');
  assert.equal(fs.existsSync(path.join(listDir, 'v1.json')), false);
  assert.ok(fs.existsSync(path.join(target, 'v1.json')));
  // (d) As (c), and a different v1.json is left in the checked directory: the
  // directory matches, but the file there is not the one just written.
  ({ s, listDir, target, aside } = await prepared());
  r = await withWriteHooks({
    beforeOpen: () => { fs.renameSync(listDir, aside); fs.symlinkSync(target, listDir); },
    afterLink: () => { fs.unlinkSync(listDir); fs.renameSync(aside, listDir); fs.writeFileSync(path.join(listDir, 'v1.json'), 'planted'); },
  }, () => run(applyArgs(s), { signer: goodSigner() }));
  check(r, 'planted');
  assert.equal(fs.readFileSync(path.join(listDir, 'v1.json'), 'utf8'), 'planted');
  // No swap: the identity check passes and v1 is written as usual.
  ({ s } = await prepared());
  r = await run(applyArgs(s), { signer: goodSigner() });
  assert.equal(r.result.state, 'written', r.err.join(' '));
});

test('QP27: a symlink in any component of RECEIPT_LOG_DIR or --log-dir is refused as log_dir_symlink before anything is read', { timeout: 120_000 }, async () => {
  const s = await setup();
  const real = fs.realpathSync(s.logDir);
  const signer = goodSigner();
  const holder = tmp('qlprod-sym-');
  const finalLink = path.join(holder, 'logdir');
  fs.symlinkSync(real, finalLink);
  // A link in the middle: <holder>/parent -> dirname(real), then basename(real).
  const parentLink = path.join(holder, 'parent');
  fs.symlinkSync(path.dirname(real), parentLink);
  const midPath = path.join(parentLink, path.basename(real));
  const cases = [
    ['final link in the flag', ['--log-dir', finalLink], { RECEIPT_LOG_DIR: real }],
    ['final link in the env', [], { RECEIPT_LOG_DIR: finalLink }],
    ['final link in the env, real flag', ['--log-dir', real], { RECEIPT_LOG_DIR: finalLink }],
    ['middle link in the flag', ['--log-dir', midPath], { RECEIPT_LOG_DIR: real }],
    ['middle link in the env', [], { RECEIPT_LOG_DIR: midPath }],
    ['middle link, trailing slash', ['--log-dir', `${midPath}${path.sep}`], { RECEIPT_LOG_DIR: real }],
    ['both links', ['--log-dir', finalLink], { RECEIPT_LOG_DIR: midPath }],
  ];
  for (const [label, dirArgs, env] of cases) {
    const r = await run([...dirArgs, '--list', s.file, '--list-sha256', s.hash, '--apply', '--confirm', CONFIRM], { signer, env });
    assert.deepEqual(r.result, { ok: false, reason: 'log_dir_symlink' }, `${label}: ${r.err.join(' ')}`);
    assert.ok(!r.out.some((l) => l.startsWith('LIST_SHA256=')), `${label}: refused before the input is read`);
    assert.equal(r.loads.length, 0, `${label}: the signer is never loaded`);
    assert.ok(/refused: log_dir_symlink\. (RECEIPT_LOG_DIR|--log-dir) goes through a symlink at /.test(r.err.join('\n')), r.err.join('\n'));
  }
  // The real path itself is accepted.
  const ok = await run(['--log-dir', real, '--list', s.file], { signer, env: { RECEIPT_LOG_DIR: real } });
  assert.equal(ok.result.state, 'dry_run', ok.err.join(' '));
  // The real script, production env, RECEIPT_LOG_DIR through a symlink.
  const env = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid, RECEIPT_LOG_DIR: finalLink };
  delete env.NODE_ENV;
  delete env.ISSUER_TEST_KEY;
  const out = spawnSync(process.execPath, [NEW_SCRIPT, '--log-dir', finalLink, '--list', s.file], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(out.status, 1, out.stderr);
  assert.ok(/refused: log_dir_symlink/.test(out.stderr), out.stderr);
  assert.equal(signer.calls.length, 0);
  assert.equal(fs.existsSync(listDirOf(real)), false);
});

test('QP28: the list dir removed and replaced by a symlink that reuses its inode is still list_dir_changed', async () => {
  const s = await setup();
  const listDir = listDirOf(fs.realpathSync(s.logDir));
  fs.mkdirSync(listDir, { mode: 0o700 });
  const target = tmp('qlprod-reuse-');
  const before = fs.lstatSync(listDir, { bigint: true });
  // ext4 often hands the freed inode straight to the new symlink. So that the
  // test does not depend on the filesystem, the symlink's lstat reports the
  // removed directory's dev/ino either way: only isSymbolicLink() tells them apart.
  const realLstat = fs.lstatSync;
  let reused = null;
  fs.lstatSync = function patched(p, ...rest) {
    const st = realLstat.call(fs, p, ...rest);
    if (String(p) === listDir && st.isSymbolicLink()) {
      if (reused === null) reused = st.ino === before.ino || BigInt(st.ino) === before.ino;
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { dev: before.dev, ino: before.ino });
    }
    return st;
  };
  let r;
  try {
    r = await withWriteHooks({
      beforeOpen: () => { fs.rmdirSync(listDir); fs.symlinkSync(target, listDir); },
    }, () => run(applyArgs(s), { signer: goodSigner() }));
  } finally {
    fs.lstatSync = realLstat;
  }
  assert.notEqual(reused, null, 'the swapped symlink was examined');
  assert.deepEqual(r.result, { ok: false, reason: 'list_dir_changed', written: true }, r.err.join(' '));
  assert.ok(fs.existsSync(path.join(target, 'v1.json')), 'the write went through the swapped link');
  assert.ok(!r.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')));
  const text = r.err.join('\n');
  assert.ok(/refused: list_dir_changed\./.test(text), text);
  assert.ok(/Do not pin\. v1 was written, but not necessarily to /.test(text), text);
  assert.ok(!/Rerun the same command/.test(text), text);
});

test('QP29: a temp cleanup failure after list_dir_changed keeps that reason and its inspect advice, with the cleanup error as detail', async () => {
  const s = await setup();
  const listDir = listDirOf(fs.realpathSync(s.logDir));
  fs.mkdirSync(listDir, { mode: 0o700 });
  const target = tmp('qlprod-swapclean-');
  const aside = `${listDir}.aside`;
  const realRm = fs.rmSync;
  let thrown = 0;
  fs.rmSync = function patched(p, ...rest) {
    if (String(p).includes('.v1.json.tmp-')) {
      thrown += 1;
      const e = new Error('busy');
      e.code = 'EBUSY';
      throw e;
    }
    return realRm.call(fs, p, ...rest);
  };
  let r;
  try {
    r = await withWriteHooks({
      beforeOpen: () => { fs.renameSync(listDir, aside); fs.symlinkSync(target, listDir); },
    }, () => run(applyArgs(s), { signer: goodSigner() }));
  } finally {
    fs.rmSync = realRm;
  }
  assert.equal(thrown, 1);
  assert.deepEqual(r.result, { ok: false, reason: 'list_dir_changed', written: true }, r.err.join(' '));
  const text = r.err.join('\n');
  assert.ok(/refused: list_dir_changed\. .*\(temp file cleanup also failed: EBUSY\)/.test(text), text);
  assert.ok(/Do not pin\. v1 was written, but not necessarily to .*inspect the log directory/.test(text), text);
  assert.ok(!/Rerun the same command/.test(text), text);
  assert.ok(!/failed after writing: EBUSY/.test(text), text);
  assert.ok(!r.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')));
  // With no earlier error, the cleanup failure is still the failure (QP23 shape).
  const dir = path.join(tmp('qlprod-cleanonly-'), 'quarantine-list');
  fs.rmSync = function patched(p, ...rest) {
    if (String(p).includes('.v1.json.tmp-')) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
    return realRm.call(fs, p, ...rest);
  };
  try {
    assert.throws(() => P.writeV1Atomic(dir, 'bytes'), (e) => e.code === 'EBUSY');
  } finally {
    fs.rmSync = realRm;
  }
});

// ------------------------------------------------- SF-A: refusals reach the receipt-failure log

const PROD_PATH = 'quarantine_production_sign';

function fileRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Temp paths differ per setup; everything else in the output must match. */
function normalized(r) {
  const strip = (l) => String(l).replace(/[^\s'"`]*qlprod-[a-z]+-[A-Za-z0-9]+[^\s'"`]*/g, '<TMP>');
  return { result: r.result, out: r.out.map(strip), err: r.err.map(strip) };
}

/**
 * Run `scenario()` with RECEIPT_FAILURES_FILE unset ('none'), set to the
 * gateway's existing (empty) file ('file'), set to a path that does not exist
 * ('missing'), or set under a regular file ('unwritable'). The host signer
 * appends only to an existing regular file and never touches this process's
 * receipt-failure store, so `reload` is what a gateway reload of the file
 * sees afterwards: its rows and per-reason counts. Module state is reset
 * before and after.
 */
async function withFailureFile(mode, scenario) {
  const saved = process.env.RECEIPT_FAILURES_FILE;
  const dir = tmp('qlprod-rf-');
  let file = path.join(dir, 'receipt-failures.jsonl');
  if (mode === 'file') fs.writeFileSync(file, '');
  if (mode === 'unwritable') {
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    file = path.join(blocker, 'receipt-failures.jsonl');
  }
  if (mode === 'none') delete process.env.RECEIPT_FAILURES_FILE;
  else process.env.RECEIPT_FAILURES_FILE = file;
  RF.resetReceiptFailuresForTests();
  try {
    const r = await scenario();
    const rows = fileRows(file);
    // Gateway reload: a fresh store reads the file once.
    RF.resetReceiptFailuresForTests();
    const memory = RF.listReceiptFailures().filter((row) => row.reason.startsWith(`${PROD_PATH}:`));
    const counts = (RF.escrowRefusalCounts() || {})[PROD_PATH] || {};
    return { r, memory, counts, rows, file, dir };
  } finally {
    if (saved == null) delete process.env.RECEIPT_FAILURES_FILE;
    else process.env.RECEIPT_FAILURES_FILE = saved;
    RF.resetReceiptFailuresForTests();
  }
}

function assertOneRow(rows, code, label) {
  assert.equal(rows.length, 1, `${label}: exactly one row (${rows.map((r) => r.reason).join(',')})`);
  const [row] = rows;
  assert.equal(row.reason, `${PROD_PATH}:${code}`, label);
  assert.equal(row.stage, 'sign', label);
  assert.equal(row.outcome, 'refused', label);
  assert.equal(row.tx, null, `${label}: no tx`);
  assert.equal(row.network, null, `${label}: no network`);
  assert.equal(row.request_id, null, `${label}: no request id`);
}

/** Each scenario builds its own fresh log copy, so it can run once per mode. */
const SFA_SCENARIOS = [
  ['usage', async () => { const s = await setup(); return run(['--log-dir', s.logDir]); }],
  ['usage', async () => { const s = await setup(); return run(['--list', s.file, '--list', s.file, '--log-dir', s.logDir]); }],
  ['log_dir_env_unset', async () => { const s = await setup(); return run(['--log-dir', s.logDir, '--list', s.file], { env: { RECEIPT_LOG_DIR: undefined } }); }],
  ['log_dir_unresolved', async () => { const s = await setup(); return run(['--list', s.file], { env: { RECEIPT_LOG_DIR: path.join(s.logDir, 'missing') } }); }],
  ['log_dir_mismatch', async () => {
    const s = await setup();
    const other = tmp('qlprod-other-');
    return run(applyArgs(s), { signer: goodSigner(), env: { RECEIPT_LOG_DIR: other } });
  }],
  ['log_dir_symlink', async () => {
    const s = await setup();
    const link = path.join(tmp('qlprod-sym-'), 'logdir');
    fs.symlinkSync(fs.realpathSync(s.logDir), link);
    return run(['--log-dir', link, '--list', s.file], { signer: goodSigner(), env: { RECEIPT_LOG_DIR: fs.realpathSync(s.logDir) } });
  }],
  ['confirm_missing', async () => { const s = await setup(); return run(['--log-dir', s.logDir, '--list', s.file, '--list-sha256', s.hash, '--apply'], { signer: goodSigner() }); }],
  ['list_hash_mismatch', async () => { const s = await setup(); return run(['--log-dir', s.logDir, '--list', s.file, '--apply', '--confirm', CONFIRM], { signer: goodSigner() }); }],
  ['not_production_process', async () => { const s = await setup(); return run(applyArgs(s), { signer: goodSigner(), env: { NODE_ENV: 'test' } }); }],
  ['not_production_key', async () => {
    const s = await setup();
    return run(applyArgs(s), { signer: stubSigner({ kid: OTHER.kid, publicJwk: OTHER.publicJwk, privateKey: OTHER.privateKey, realJws: true }) });
  }],
  ['list_not_build_output', async () => {
    const s = await setup();
    return run(applyArgs(s), { signer: goodSigner(), buildFromLog: async () => ({ different: true }) });
  }],
  ['write_mismatch', async () => {
    const s = await setup();
    return withV1Read((real, file, ...rest) => `${real.call(fs, file, ...rest)} `, () => run(applyArgs(s), { signer: goodSigner() }));
  }],
  ['list_dir_changed', async () => {
    const s = await setup();
    const listDir = listDirOf(fs.realpathSync(s.logDir));
    fs.mkdirSync(listDir, { mode: 0o700 });
    return withWriteHooks({
      beforeOpen: () => { fs.renameSync(listDir, `${listDir}.aside`); fs.mkdirSync(listDir, { mode: 0o700 }); },
    }, () => run(applyArgs(s), { signer: goodSigner() }));
  }],
  ['error', async () => {
    const s = await setup();
    const throttled = stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey, realJws: true, onSign: () => { const e = new Error('kms'); e.code = 'ThrottlingException'; throw e; } });
    return run(applyArgs(s), { signer: throttled });
  }],
  ['error', async () => {
    const s = await setup();
    return withV1Read(() => { const e = new Error('io'); e.code = 'EIO'; throw e; }, () => run(applyArgs(s), { signer: goodSigner() }));
  }],
];

test('QP30 / SF-A / SF-1: every refusal appends one quarantine_production_sign row to an existing file, a gateway reload counts it, and the refusal is unchanged with the file set, unset, missing or unwritable', { timeout: 180_000 }, async () => {
  for (const [code, scenario] of SFA_SCENARIOS) {
    const none = await withFailureFile('none', scenario);
    const file = await withFailureFile('file', scenario);
    const missing = await withFailureFile('missing', scenario);
    const broken = await withFailureFile('unwritable', scenario);
    const label = `${code}: ${JSON.stringify(none.r.result)}`;
    assert.equal(none.r.result.ok, false, label);
    assert.equal(none.r.result.reason, code, label);
    // Same result, stdout and stderr whatever happens to the row.
    assert.deepEqual(normalized(file.r), normalized(none.r), `${label}: file set`);
    assert.deepEqual(normalized(missing.r), normalized(none.r), `${label}: file missing`);
    assert.deepEqual(normalized(broken.r), normalized(none.r), `${label}: file unwritable`);
    // The row: appended to the existing file, and a gateway reload counts it once.
    assertOneRow(file.rows, code, `${label} (file)`);
    assertOneRow(file.memory, code, `${label} (file, reload)`);
    assert.deepEqual(file.counts, { [code]: 1 }, `${label} (file, reload counts)`);
    // Otherwise nothing is written anywhere and nothing is created.
    for (const [mode, got] of [['none', none], ['missing', missing], ['unwritable', broken]]) {
      assert.deepEqual(got.memory, [], `${label} (${mode}): no row`);
      assert.deepEqual(got.counts, {}, `${label} (${mode}): no count`);
    }
    assert.equal(fs.existsSync(missing.file), false, `${label}: a missing file is never created`);
    assert.equal(fs.existsSync(broken.file), false, `${label}: nothing written under the blocker`);
  }
});

test('QP31 / SF-A: a success writes no row; a dry run writes no row', async () => {
  const dry = await withFailureFile('file', async () => { const s = await setup(); return run(['--log-dir', s.logDir, '--list', s.file], { signer: goodSigner() }); });
  assert.equal(dry.r.result.state, 'dry_run', dry.r.err.join(' '));
  assert.deepEqual(dry.rows, []);
  assert.deepEqual(dry.memory, []);
  const written = await withFailureFile('file', async () => { const s = await setup(); return run(applyArgs(s), { signer: goodSigner() }); });
  assert.equal(written.r.result.state, 'written', written.r.err.join(' '));
  assert.deepEqual(written.rows, []);
});

test('QP32 / SF-A: refuse() records before it throws, and every refusal code in the module is on the path list (never other)', () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  assert.ok(/\nfunction refuse\(reason, message\) \{\n  recordRefusal\(reason\);\n  throw new ProductionListRefused\(reason, message\);\n\}\n/.test(src), 'refuse() records, then throws the same error');
  assert.ok(/let refusalRecorder = appendHostEscrowRefusal;/.test(src), 'the recorder is the host-only append');
  assert.ok(/refusalRecorder\(\{ path: 'quarantine_production_sign', reason \}\);/.test(src), 'recordRefusal appends the quarantine_production_sign path through the recorder');
  assert.ok(/import \{ appendHostEscrowRefusal \} from '\.\/receipt-failure-host-append\.js';/.test(src), 'the host-only append is imported');
  assert.ok(!/from '\.\/receipt-failures\.js'/.test(src), 'the host signer does not import the gateway store (no startup read, mkdir or rotation)');
  assert.ok(/if \(!\(e instanceof ProductionListRefused\)\) recordRefusal\('error'\);/.test(src), 'a failure that is not a refusal is recorded as error');
  const codes = new Set();
  for (const m of src.matchAll(/refuse\('([a-z0-9_]+)'/g)) codes.add(m[1]);
  for (const m of src.matchAll(/realDir\([^)]*'([a-z0-9_]+)'\)/g)) codes.add(m[1]);
  for (const m of src.matchAll(/function realDir\(dir, reason = '([a-z0-9_]+)'\)/g)) codes.add(m[1]);
  codes.add('error');
  for (const named of ['log_dir_env_unset', 'log_dir_unresolved', 'log_dir_mismatch', 'log_dir_symlink', 'usage', 'list_dir_changed', 'write_mismatch', 'list_not_unsigned_v1', 'v1_exists_different']) {
    assert.ok(codes.has(named), `scan finds ${named}`);
  }
  assert.ok(codes.size >= 26, `found ${codes.size} codes`);
  assert.ok(RF.ESCROW_REFUSAL_PATHS.includes(PROD_PATH));
  RF.resetReceiptFailuresForTests();
  try {
    for (const code of codes) {
      const row = RF.recordEscrowRefusal({ path: PROD_PATH, reason: code });
      assert.ok(row, `${code}: a row`);
      assert.equal(row.reason, `${PROD_PATH}:${code}`, `${code} is listed, not other`);
    }
    assert.equal(RF.recordEscrowRefusal({ path: PROD_PATH, reason: 'made_up_code' }).reason, `${PROD_PATH}:other`);
    assert.equal(RF.receiptFailureCount(), 0, 'alert rows stay out of the public total');
  } finally {
    RF.resetReceiptFailuresForTests();
  }
});

test('QP33 / SF-A / SF-1: the script end to end: a refusal appends its row to the existing RECEIPT_FAILURES_FILE, exit and stderr unchanged when the file is missing or cannot be written', { timeout: 120_000 }, async () => {
  const s = await setup();
  const dir = tmp('qlprod-rfscript-');
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  const base = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid };
  delete base.NODE_ENV;
  delete base.ISSUER_TEST_KEY;
  delete base.RECEIPT_LOG_DIR;
  delete base.RECEIPT_FAILURES_FILE;
  const cases = [
    ['usage', ['--log-dir', s.logDir], { RECEIPT_LOG_DIR: s.logDir }],
    ['log_dir_env_unset', ['--log-dir', s.logDir, '--list', s.file], {}],
  ];
  for (const [code, argv, extra] of cases) {
    const runScript = (env) => spawnSync(process.execPath, [NEW_SCRIPT, ...argv], { env: { ...base, ...extra, ...env }, encoding: 'utf8', timeout: 60_000 });
    const file = path.join(dir, `${code}.jsonl`);
    fs.writeFileSync(file, '');
    const absent = path.join(dir, `${code}-absent.jsonl`);
    const withFile = runScript({ RECEIPT_FAILURES_FILE: file });
    const unset = runScript({});
    const broken = runScript({ RECEIPT_FAILURES_FILE: path.join(blocker, 'rf.jsonl') });
    const missing = runScript({ RECEIPT_FAILURES_FILE: absent });
    assert.equal(fs.existsSync(absent), false, `${code}: the script never creates the file`);
    assert.deepEqual([missing.status, missing.stdout, missing.stderr], [unset.status, unset.stdout, unset.stderr], `${code}: missing file, byte-identical refusal`);
    for (const [label, res] of [['file', withFile], ['unset', unset], ['unwritable', broken]]) {
      assert.equal(res.status, 1, `${code} ${label}: ${res.stderr}`);
      assert.ok(new RegExp(`refused: ${code}`).test(res.stderr), `${code} ${label}: ${res.stderr}`);
    }
    const refusalLine = (res) => res.stderr.split('\n').filter((l) => l.startsWith('refused: '));
    assert.deepEqual(refusalLine(withFile), refusalLine(unset), `${code}: same refusal line`);
    assert.deepEqual(refusalLine(broken), refusalLine(unset), `${code}: same refusal line, unwritable file`);
    assertOneRow(fileRows(file), code, `${code} (script)`);
  }
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

// ------------------------------------------------- SF-1: host-only append, never the gateway store

const HA = await import('../src/receipt-failure-host-append.js');

test('QP34 / SF-1: the host append writes the gateway\'s own row, only to an existing regular file, with no read, mkdir or rotation', () => {
  const dir = tmp('qlprod-ha-');
  const at = Date.parse('2026-10-24T12:00:00.000Z');
  const now = () => at;
  // Same row, field for field and in the same order, as the gateway writes.
  RF.resetReceiptFailuresForTests();
  try {
    RF.setEscrowAlertClockForTests(now);
    const gw = RF.recordEscrowRefusal({ path: PROD_PATH, reason: 'write_mismatch' });
    assert.equal(JSON.stringify(RF.escrowAlertRow({ path: PROD_PATH, reason: 'write_mismatch', time: new Date(at).toISOString() })), JSON.stringify(gw));
  } finally {
    RF.resetReceiptFailuresForTests();
  }
  // Existing file with gateway rows: one line appended, nothing else changed.
  const file = path.join(dir, 'rf.jsonl');
  const prior = `${JSON.stringify({ time: '2026-10-24T11:00:00.000Z', network: 'base', stage: 'settle', reason: 'settle_failed', tx: null, outcome: 'refused', request_id: null })}\n`;
  fs.writeFileSync(file, prior);
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file, now }), true);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith(prior), 'prior bytes untouched');
  const added = text.slice(prior.length);
  assert.equal(added, `\n${JSON.stringify({ time: new Date(at).toISOString(), network: null, stage: 'sign', reason: `${PROD_PATH}:usage`, tx: null, outcome: 'refused', request_id: null })}\n`);
  // An unknown code is `other`; an unknown path writes nothing.
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'free text /tmp/x' }, { file, now }), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop()).reason, `${PROD_PATH}:other`);
  const size = fs.statSync(file).size;
  assert.equal(HA.appendHostEscrowRefusal({ path: 'nope', reason: 'usage' }, { file, now }), false);
  assert.equal(fs.statSync(file).size, size);
  // A gateway reload counts the host rows next to its own, in file order.
  process.env.RECEIPT_FAILURES_FILE = file;
  RF.resetReceiptFailuresForTests();
  try {
    assert.deepEqual(RF.listReceiptFailures().map((r) => r.reason), ['settle_failed', `${PROD_PATH}:usage`, `${PROD_PATH}:other`]);
    assert.deepEqual(RF.escrowRefusalCounts()[PROD_PATH], { other: 1, usage: 1 });
    assert.equal(RF.receiptFailureCount(), 1, 'host rows stay out of the public total');
  } finally {
    delete process.env.RECEIPT_FAILURES_FILE;
    RF.resetReceiptFailuresForTests();
  }
  // Missing file, missing parent: false, nothing created, no mkdir.
  const absent = path.join(dir, 'absent.jsonl');
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file: absent, now }), false);
  assert.equal(fs.existsSync(absent), false);
  const deep = path.join(dir, 'no', 'such', 'dir', 'rf.jsonl');
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file: deep, now }), false);
  assert.equal(fs.existsSync(path.join(dir, 'no')), false, 'no directory created');
  // Unset or blank: false.
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file: '', now }), false);
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file: undefined, now }), false);
  // 5 MB or more: appended, never rotated (the gateway rotates its own file).
  const big = path.join(dir, 'big.jsonl');
  fs.writeFileSync(big, Buffer.alloc(RF.RECEIPT_FAILURE_FILE_BYTES + 10, 0x20));
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file: big, now }), true);
  assert.equal(fs.existsSync(`${big}.1`), false, 'no rotation');
  assert.equal(fs.statSync(big).size, RF.RECEIPT_FAILURE_FILE_BYTES + 10 + added.length);
});

test('QP35 / SF-1: the host append source: lstat before open, O_APPEND|O_NOFOLLOW without O_CREAT, no read, mkdir or rotation', () => {
  const raw = fs.readFileSync(path.join(here, '..', 'src', 'receipt-failure-host-append.js'), 'utf8');
  // Code only: the header comment names the flags it never uses.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(/const before = fs\.lstatSync\(real\);\n\s+if \(!before\.isFile\(\)\) return false;/.test(src), 'lstat, regular file only');
  assert.ok(/fs\.openSync\(real, O_WRONLY \| O_APPEND \| O_NOFOLLOW \| O_NONBLOCK\)/.test(src), 'append-only open flags');
  assert.ok(!/O_CREAT|O_TRUNC/.test(src), 'never creates or truncates');
  assert.ok(!/readFileSync|readSync|mkdirSync|renameSync|rmSync|appendFileSync|unlinkSync/.test(src), 'no read, mkdir, rotation or create-by-append');
  assert.ok(/after\.dev !== before\.dev \|\| after\.ino !== before\.ino/.test(src), 'the opened file is the one checked');
});

// ------------------------------------------------- 649 nits: N3 (throwing recorder), N4 (pathological paths)

test('N3 (649): a recorder that throws never changes the refusal, its output or its result', { timeout: 120_000 }, async () => {
  const picks = SFA_SCENARIOS.filter(([code], i, all) => all.findIndex(([c]) => c === code) === i)
    .filter(([code]) => ['usage', 'log_dir_symlink', 'confirm_missing', 'not_production_key', 'write_mismatch', 'list_dir_changed', 'error'].includes(code));
  assert.equal(picks.length, 7);
  for (const [code, scenario] of picks) {
    const none = await withFailureFile('none', scenario);
    const calls = [];
    const thrown = await withFailureFile('none', () => withThrowingRecorder(calls, scenario));
    const label = `${code}: ${JSON.stringify(none.r.result)}`;
    assert.deepEqual(normalized(thrown.r), normalized(none.r), `${label}: same result and output with a throwing recorder`);
    assert.deepEqual(calls, [code], `${label}: recorded once, with the code`);
  }
});

/** Run a scenario whose run() goes through a throwing recordRefusal. */
async function withThrowingRecorder(calls, scenario) {
  throwingRecorder = ({ reason }) => { calls.push(reason); throw new Error('recorder exploded'); };
  try {
    return await scenario();
  } finally {
    throwingRecorder = null;
  }
}

const FIFO_OK = process.platform === 'linux' && spawnSync('mkfifo', ['--help'], { encoding: 'utf8' }).status === 0;

/** RECEIPT_FAILURES_FILE values the host append must refuse, each with what must stay true. */
function pathologicalFiles() {
  const dir = tmp('qlprod-patho-');
  const regular = path.join(dir, 'gateway-rf.jsonl');
  fs.writeFileSync(regular, 'gateway bytes\n');
  const link = path.join(dir, 'link.jsonl');
  fs.symlinkSync(regular, link);
  const devLink = path.join(dir, 'devlink.jsonl');
  const adir = path.join(dir, 'adir');
  fs.mkdirSync(adir);
  const cases = [
    ['missing', path.join(dir, 'missing.jsonl')],
    ['missing parent', path.join(dir, 'no', 'such', 'rf.jsonl')],
    ['directory', adir],
    ['symlink to a regular file', link],
  ];
  if (process.platform === 'linux') {
    fs.symlinkSync('/dev/full', devLink);
    cases.push(['char device /dev/full', '/dev/full']);
    cases.push(['char device /dev/null', '/dev/null']);
    cases.push(['symlink to /dev/full', devLink]);
    cases.push(['/proc path', '/proc/self/nope/rf.jsonl']);
    cases.push(['/proc regular-looking file', '/proc/self/status']);
    // Regular-looking and writable by its owner: only the /proc guard stops it.
    cases.push(['/proc writable file', '/proc/self/comm']);
    // N-1 (649): the path is not under /proc, but its real parent is.
    const pp = path.join(dir, 'pp');
    fs.symlinkSync('/proc/self', pp);
    cases.push(['symlinked parent to /proc/self, then comm', path.join(pp, 'comm')]);
  }
  if (FIFO_OK) {
    const fifo = path.join(dir, 'fifo.jsonl');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    cases.push(['FIFO', fifo]);
  }
  return { dir, regular, cases };
}

function listing(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      out.push(`${path.relative(dir, p)}|${st.isFile() ? st.size : st.isDirectory() ? 'dir' : 'other'}`);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

test('N4 (649): the host append refuses a char device, FIFO, /proc path, symlink, directory or missing file: false, no hang, nothing created or changed', { timeout: 60_000 }, () => {
  const { dir, regular, cases } = pathologicalFiles();
  const before = listing(dir);
  for (const [label, file] of cases) {
    const t = Date.now();
    assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file }), false, label);
    assert.ok(Date.now() - t < 5_000, `${label}: returns at once`);
  }
  assert.deepEqual(listing(dir), before, 'nothing created, nothing appended');
  assert.equal(fs.readFileSync(regular, 'utf8'), 'gateway bytes\n', 'a symlink target is never written');
});

test('N4 (649): in the module, every pathological RECEIPT_FAILURES_FILE leaves the refusal byte-identical to an unset file', { timeout: 120_000 }, async () => {
  const { dir, cases } = pathologicalFiles();
  const before = listing(dir);
  const saved = process.env.RECEIPT_FAILURES_FILE;
  try {
    const picks = SFA_SCENARIOS.filter(([code], i, all) => all.findIndex(([c]) => c === code) === i)
      .filter(([code]) => ['usage', 'log_dir_env_unset', 'confirm_missing', 'write_mismatch', 'error'].includes(code));
    assert.equal(picks.length, 5);
    for (const [code, scenario] of picks) {
      const none = await withFailureFile('none', scenario);
      for (const [label, file] of cases) {
        process.env.RECEIPT_FAILURES_FILE = file;
        RF.resetReceiptFailuresForTests();
        const r = await scenario();
        assert.deepEqual(normalized(r), normalized(none.r), `${code} / ${label}`);
      }
    }
  } finally {
    if (saved == null) delete process.env.RECEIPT_FAILURES_FILE;
    else process.env.RECEIPT_FAILURES_FILE = saved;
    RF.resetReceiptFailuresForTests();
  }
  assert.deepEqual(listing(dir), before, 'nothing created, nothing appended');
});

test('N4 (649): the script end to end: exit code, stdout and stderr byte-identical to an unset file for each pathological path, with no hang', { timeout: 300_000 }, async () => {
  const s = await setup();
  const { dir, cases } = pathologicalFiles();
  const before = listing(dir);
  const base = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid, RECEIPT_LOG_DIR: s.logDir };
  delete base.NODE_ENV;
  delete base.ISSUER_TEST_KEY;
  delete base.RECEIPT_FAILURES_FILE;
  for (const argv of [['--log-dir', s.logDir], ['--log-dir', s.logDir, '--list', s.file, '--list-sha256', s.hash, '--apply']]) {
    const runScript = (extra) => spawnSync(process.execPath, [NEW_SCRIPT, ...argv], { env: { ...base, ...extra }, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    const unset = runScript({});
    assert.equal(unset.status, 1, unset.stderr);
    for (const [label, file] of cases) {
      const res = runScript({ RECEIPT_FAILURES_FILE: file });
      assert.equal(res.signal, null, `${label}: not killed (no hang)`);
      assert.deepEqual([res.status, res.stdout, res.stderr], [unset.status, unset.stdout, unset.stderr], `${argv.join(' ')} / ${label}`);
    }
  }
  assert.deepEqual(listing(dir), before, 'nothing created, nothing appended');
  assert.equal(fs.existsSync(listDirOf(s.logDir)), false);
});

// N-1 (649): behavioural tests for the host append's race guards.
// Each hook runs once, right after the module's own lstat of the target.
function hookLstatOnce(after) {
  const original = fs.lstatSync;
  let fired = false;
  fs.lstatSync = function hooked(p, ...rest) {
    const st = original.call(fs, p, ...rest);
    if (!fired) {
      fired = true;
      after(p);
    }
    return st;
  };
  return () => { fs.lstatSync = original; };
}

test('B-R2 (649 N-1): a file unlinked between lstat and open is not recreated', () => {
  const dir = tmp('qlprod-br2-');
  const file = path.join(dir, 'rf.jsonl');
  fs.writeFileSync(file, '');
  const restore = hookLstatOnce(() => fs.unlinkSync(file));
  try {
    assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file }), false);
  } finally {
    restore();
  }
  assert.equal(fs.existsSync(file), false, 'no O_CREAT: the file is not recreated');
});

test('B-R6 (649 N-1): a regular file swapped in after lstat gets nothing (dev/ino recheck)', () => {
  const dir = tmp('qlprod-br6-');
  const file = path.join(dir, 'rf.jsonl');
  const other = path.join(dir, 'other.jsonl');
  fs.writeFileSync(file, 'gateway\n');
  fs.writeFileSync(other, 'someone else\n');
  const restore = hookLstatOnce(() => fs.renameSync(other, file));
  try {
    assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file }), false);
  } finally {
    restore();
  }
  assert.equal(fs.readFileSync(file, 'utf8'), 'someone else\n', 'the swapped-in file is unchanged');
});

test('B-R8 (649 N-1): a FIFO swapped in after lstat does not block (O_NONBLOCK)', { skip: !FIFO_OK && 'mkfifo not available', timeout: 30_000 }, () => {
  const dir = tmp('qlprod-br8-');
  const file = path.join(dir, 'rf.jsonl');
  fs.writeFileSync(file, '');
  const mod = path.join(here, '..', 'src', 'receipt-failure-host-append.js');
  const script = `
    import fs from 'node:fs';
    import { spawnSync } from 'node:child_process';
    const file = ${JSON.stringify(file)};
    const original = fs.lstatSync;
    let fired = false;
    fs.lstatSync = function hooked(p, ...rest) {
      const st = original.call(fs, p, ...rest);
      if (!fired) { fired = true; fs.unlinkSync(file); spawnSync('mkfifo', [file]); }
      return st;
    };
    const { appendHostEscrowRefusal } = await import(${JSON.stringify(pathToFileURLString(mod))});
    process.stdout.write('RESULT=' + String(appendHostEscrowRefusal({ path: 'quarantine_production_sign', reason: 'usage' }, { file })));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(r.signal, null, `no hang: ${r.stderr}`);
  assert.ok(/RESULT=false$/.test(r.stdout), `${r.stdout} ${r.stderr}`);
  assert.ok(fs.lstatSync(file).isFIFO(), 'the FIFO is still there and was not written');
});

function pathToFileURLString(p) {
  return new URL(`file://${path.resolve(p)}`).href;
}

test('B-R5b (649 N-1): a symlinked parent that resolves under /proc writes nothing to /proc/self/comm', { skip: process.platform !== 'linux' && 'linux only' }, () => {
  const dir = tmp('qlprod-br5b-');
  const pp = path.join(dir, 'pp');
  fs.symlinkSync('/proc/self', pp);
  const before = fs.readFileSync('/proc/self/comm', 'utf8');
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file: path.join(pp, 'comm') }), false);
  assert.equal(fs.readFileSync('/proc/self/comm', 'utf8'), before, '/proc/self/comm unchanged');
});

test('N-2 (649): a file owned by another user gets nothing', { skip: typeof process.geteuid !== 'function' && 'no geteuid' }, () => {
  const dir = tmp('qlprod-uid-');
  const file = path.join(dir, 'rf.jsonl');
  fs.writeFileSync(file, 'gateway\n');
  const original = fs.fstatSync;
  fs.fstatSync = function hooked(fd, ...rest) {
    const st = original.call(fs, fd, ...rest);
    return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { uid: process.geteuid() + 1 });
  };
  try {
    assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file }), false);
  } finally {
    fs.fstatSync = original;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), 'gateway\n');
  assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file }), true, 'own file still appends');
});

test('N-3 (649): a torn tail does not swallow the next row, for the gateway writer and the host append', () => {
  const dir = tmp('qlprod-torn-');
  const file = path.join(dir, 'rf.jsonl');
  const settle = { time: '2026-10-24T11:00:00.000Z', network: 'base', stage: 'settle', reason: 'settle_failed', tx: null, outcome: 'refused', request_id: null };
  fs.writeFileSync(file, `${JSON.stringify(settle)}\n{"time":"2026-10-24T11:30:00.000Z","netw`);
  const saved = process.env.RECEIPT_FAILURES_FILE;
  process.env.RECEIPT_FAILURES_FILE = file;
  RF.resetReceiptFailuresForTests();
  try {
    // Gateway writer first, straight after a torn fragment.
    RF.recordEscrowRefusal({ path: PROD_PATH, reason: 'write_mismatch' });
    RF.flushEscrowAlertFolds();
    let text = fs.readFileSync(file, 'utf8');
    assert.ok(/"netw\n\{"time"/.test(text), 'the gateway row starts on its own line after the torn fragment');
    // Then the host append, straight after another torn fragment.
    fs.appendFileSync(file, '{"time":"2026-10-24T11:45:00.000Z","sta');
    const at = Date.parse('2026-10-24T12:00:00.000Z');
    assert.equal(HA.appendHostEscrowRefusal({ path: PROD_PATH, reason: 'usage' }, { file, now: () => at }), true);
    text = fs.readFileSync(file, 'utf8');
    assert.ok(/"sta\n\{"time"/.test(text), 'the host row starts on its own line after the torn fragment');
    RF.resetReceiptFailuresForTests();
    const reasons = RF.listReceiptFailures().map((r) => r.reason);
    assert.ok(reasons.includes('settle_failed'), reasons.join(','));
    assert.ok(reasons.includes(`${PROD_PATH}:usage`), reasons.join(','));
    assert.ok(reasons.includes(`${PROD_PATH}:write_mismatch`), reasons.join(','));
  } finally {
    if (saved == null) delete process.env.RECEIPT_FAILURES_FILE;
    else process.env.RECEIPT_FAILURES_FILE = saved;
    RF.resetReceiptFailuresForTests();
  }
});

test('N-6 (649): after a run with a test recorder, the default host recorder is back', async () => {
  const calls = [];
  const swapped = await withFailureFile('file', () => withThrowingRecorder(calls, async () => { const s = await setup(); return run(['--log-dir', s.logDir]); }));
  assert.deepEqual(swapped.r.result, { ok: false, reason: 'usage' });
  assert.deepEqual(calls, ['usage'], 'the test recorder saw the refusal');
  assert.equal(swapped.rows.length, 0, 'the test recorder replaced the file append');
  const restored = await withFailureFile('file', async () => { const s = await setup(); return run(['--log-dir', s.logDir]); });
  assert.deepEqual(restored.r.result, { ok: false, reason: 'usage' });
  assert.deepEqual(calls, ['usage'], 'the test recorder is not called again');
  assert.deepEqual(restored.rows.map((r) => r.reason), [`${PROD_PATH}:usage`], 'the default host recorder appended the row');
});

test('QP36 / N11 (644): a signer reporting a key type other than EC P-256 is refused before any signature, even with the allowlisted x/y', async () => {
  for (const [label, jwk] of [
    ['crv secp256k1', { kty: 'EC', crv: 'secp256k1' }],
    ['kty OKP', { kty: 'OKP', crv: 'P-256' }],
    ['kty RSA, no crv', { kty: 'RSA', crv: undefined }],
  ]) {
    const s = await setup();
    const signer = goodSigner();
    signer.publicJwk = { ...signer.publicJwk, ...jwk };
    if (jwk.crv === undefined) delete signer.publicJwk.crv;
    const r = await run(applyArgs(s), { signer });
    assert.equal(r.result.reason, 'not_production_key', `${label}: ${r.err.join(' ')}`);
    assert.equal(signer.calls.length, 0, `${label}: nothing signed`);
    assert.ok(!fs.existsSync(path.join(listDirOf(s.logDir), 'v1.json')), `${label}: nothing written`);
  }
  // A getter on kty or crv is an accessor, refused like x/y.
  const s = await setup();
  const signer = goodSigner();
  const pub = { ...signer.publicJwk };
  Object.defineProperty(pub, 'crv', { get: () => 'P-256', enumerable: true });
  signer.publicJwk = pub;
  const r = await run(applyArgs(s), { signer });
  assert.equal(r.result.reason, 'signer_accessor');
  // Control: kty and crv absent still matches on x/y.
  const s2 = await setup();
  const bare = goodSigner();
  bare.publicJwk = { x: bare.publicJwk.x, y: bare.publicJwk.y };
  const ok = await run(applyArgs(s2), { signer: bare });
  assert.equal(ok.result.state, 'written', ok.err.join(' '));
});

test('QP37 / D2 (644): the log directory turned into a symlink after the link is list_dir_changed, with no pin hash and no rerun advice', async () => {
  const s = await setup();
  const signer = goodSigner();
  const moved = `${s.logDir}-moved`;
  const realLink = fs.linkSync;
  fs.linkSync = function swapAfterLink(...args) {
    const out = realLink.apply(this, args);
    if (String(args[1]).endsWith(`${path.sep}v1.json`)) {
      fs.renameSync(s.logDir, moved);
      fs.symlinkSync(moved, s.logDir);
    }
    return out;
  };
  let r;
  try {
    r = await run(applyArgs(s), { signer });
  } finally {
    fs.linkSync = realLink;
  }
  assert.deepEqual(r.result, { ok: false, reason: 'list_dir_changed', written: true }, r.err.join(' '));
  assert.ok(!r.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')), 'no pin hash');
  const text = r.err.join('\n');
  assert.ok(/the log directory changed during the run/.test(text), text);
  assert.ok(/Do not pin\. v1 was written, but not necessarily to /.test(text), text);
  assert.ok(!/Rerun/.test(text), text);
  // Control: the same run with no swap writes and prints the pin hash.
  const c = await setup();
  const ok = await run(applyArgs(c), { signer: goodSigner() });
  assert.equal(ok.result.state, 'written', ok.err.join(' '));
});

test('QP38 / N13 (644): the no-op path prints the hash of the bytes the route serves (utf8 round trip), also when v1.json holds an invalid UTF-8 byte', async () => {
  const s = await setup();
  const signer = goodSigner();
  const w = await run(applyArgs(s), { signer });
  assert.equal(w.result.state, 'written', w.err.join(' '));
  const dir = listDirOf(s.logDir);
  const file = path.join(dir, 'v1.json');
  const good = fs.readFileSync(file, 'utf8');
  // An extra field inside issuer_signature holding the raw byte 0xff. Decoded
  // as utf8 it is U+FFFD, so the decoded text is still canonical and
  // verifies, and the run is a no-op.
  const { jcsRfc8785 } = await import('../src/offer-receipt.js');
  const doc = JSON.parse(good);
  const text = jcsRfc8785({ ...doc, issuer_signature: { ...doc.issuer_signature, zz: '\ufffd' } }) + (good.endsWith('\n') ? '\n' : '');
  const raw0 = Buffer.from(text, 'utf8');
  const at = raw0.indexOf(Buffer.from('"zz":"\ufffd"', 'utf8'));
  assert.ok(at > 0, 'the field is in the canonical text');
  const raw = Buffer.concat([raw0.subarray(0, at + 6), Buffer.from([0xff]), raw0.subarray(at + 9)]);
  assert.equal(raw.toString('utf8'), text, 'the invalid byte decodes to U+FFFD');
  fs.writeFileSync(file, raw);
  const again = await run(applyArgs(s), { signer });
  assert.equal(again.result.state, 'same', again.err.join(' '));
  assert.equal(signer.calls.length, 1, 'no second signature');
  const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, type() { return this; }, status() { return this; }, send(b) { this.body = b; return this; }, json(b) { this.body = b; return this; } };
  Q.writeQuarantineListResponse(res, dir, {});
  const printed = again.out.find((l) => l.startsWith('SIGNED_LIST_SHA256=')).slice('SIGNED_LIST_SHA256='.length);
  assert.equal(printed, res.headers['X-Chit-List-Hash'], 'the pin hash is the served hash');
  assert.equal(printed, sha256(Buffer.from(fs.readFileSync(file, 'utf8'), 'utf8')));
  assert.notEqual(printed, sha256(fs.readFileSync(file)), 'not the raw file bytes');
});
