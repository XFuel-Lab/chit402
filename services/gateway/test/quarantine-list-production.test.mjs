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

async function run(argv, { signer, keys = STUB_KEYS, env = {}, buildFromLog = (d) => buildUnsignedV1FromLog(d) } = {}) {
  const c = capture();
  const loads = [];
  const result = await P._runProductionListSignerForTest({
    argv,
    env,
    buildFromLog,
    loadSigner: async (e) => { loads.push(e); return signer; },
    out: c.o,
    err: c.e,
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
    argv: applyArgs(s), env: {}, buildFromLog: (d) => buildUnsignedV1FromLog(d), loadSigner: async () => signer, out: c.o, err: c.e,
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
      argv: applyArgs(s), env: {}, buildFromLog: async () => built, loadSigner: async () => eph, out: c.o, err: c.e,
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
  const env = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid };
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
  // The same directory by another spelling (trailing slash, a symlink to it) is fine.
  const link = path.join(tmp('qlprod-link-'), 'logdir');
  fs.symlinkSync(s.logDir, link);
  r = await run(['--log-dir', s.logDir, '--list', s.file], { signer, env: { RECEIPT_LOG_DIR: `${link}/` } });
  assert.equal(r.result.state, 'dry_run', r.err.join(' '));
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

test('QP14: after v1 is linked, any failure says v1 was written and to rerun; a rerun recovers to same', async () => {
  // Read-back differs from the signed bytes: write_mismatch, v1 on disk.
  let s = await setup();
  let signer = goodSigner();
  let r = await withV1Read((real, file, ...rest) => `${real.call(fs, file, ...rest)} `, () => run(applyArgs(s), { signer }));
  assert.deepEqual(r.result, { ok: false, reason: 'write_mismatch', written: true });
  const v1 = path.join(listDirOf(s.logDir), 'v1.json');
  assert.ok(fs.existsSync(v1));
  assert.ok(r.out.includes(`FILE=${v1}`));
  assert.ok(!r.out.some((l) => l.startsWith('SIGNED_LIST_SHA256=')), 'no pin hash on a mismatch');
  let text = r.err.join('\n');
  assert.ok(/v1 was written/.test(text), text);
  assert.ok(/Do not pin yet\. Rerun the same command/.test(text), text);
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
    ISSUER_HISTORY_EXTRA: JSON.stringify([{ kid: KEY.kid, jwk: { kty: 'EC', crv: 'P-256', x: KEY.publicJwk.x, y: KEY.publicJwk.y }, alg: 'ES256', status: 'retired' }]),
    QL_ALLOW: stub,
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
