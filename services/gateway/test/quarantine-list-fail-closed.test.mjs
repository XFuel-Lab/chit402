/**
 * The quarantine list is a deny list: a list that exists but cannot be read
 * never reads as empty. Readers throw quarantine_list_unreadable, the route
 * answers 500 (never 404 or an empty list), and fixed-head signing refuses
 * and records a receipt failure. Offline: synthetic
 * key, local server, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syntheticIssuerKey, syntheticIssuerKeyEnv } from '../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';

process.env.NODE_ENV = 'test';
process.env.ISSUER_TEST_KEY = '1';
process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();
const KEY = syntheticIssuerKey();
process.env.ISSUER_KID = KEY.kid;
delete process.env.RECEIPT_FAILURES_FILE;

const Q = await import('../src/quarantine-list.js');
const { ReceiptMerkleTree, _setReceiptMerkleTreeForTest, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const { _setIssuerSignerForTest, createEnvSigner } = await import('../src/issuer-signer.js');
const { resetIssuerSigner } = await import('../src/issuer-signer-state.js');
const { _resetIssuerKey, getJwks } = await import('../src/issuer-key.js');
const { jcsRfc8785 } = await import('../src/offer-receipt.js');
const { listReceiptFailures, resetReceiptFailuresForTests } = await import('../src/receipt-failures.js');

const unreadable = (err) => err?.code === 'quarantine_list_unreadable';

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function entry(overrides = {}) {
  return {
    epoch: 2,
    tree_size: 11,
    root: 'cf'.repeat(32),
    prefix_size: 10,
    reason: 'publish_append_race',
    consistency: { first: 10, second: 39, second_root: '34'.repeat(32), proof: ['aa'.repeat(32)] },
    quarantine_ack_jws: 'eyJhbGciOiJFUzI1NiJ9.e30.c2ln',
    ...overrides,
  };
}

async function signedV1() {
  resetIssuerSigner();
  _resetIssuerKey();
  _setIssuerSignerForTest(createEnvSigner(process.env));
  const doc = Q.buildQuarantineList({ entries: [entry()], highWater: [{ epoch: 2, tree_size: 39, root: '34'.repeat(32) }] });
  return Q.signQuarantineList(doc, { env: { NODE_ENV: 'test' } });
}

/** A list dir holding v1 and v2 (v2 is the one that must not be lost). */
async function twoVersions() {
  const logDir = tmp('qlfc-');
  const dir = Q.quarantineListDir(logDir);
  const v1 = await signedV1();
  Q.writeQuarantineListVersion(dir, v1);
  const doc2 = Q.buildQuarantineList({
    entries: [entry(), entry({ epoch: 3, tree_size: 7, prefix_size: 6, root: 'de'.repeat(32), consistency: { first: 6, second: 9, second_root: 'ef'.repeat(32), proof: [] } })],
    highWater: [{ epoch: 2, tree_size: 39, root: '34'.repeat(32) }, { epoch: 3, tree_size: 9, root: 'ef'.repeat(32) }],
    prevBytes: v1,
  });
  Q.writeQuarantineListVersion(dir, await Q.signQuarantineList(doc2, { env: { NODE_ENV: 'test' } }));
  return { logDir, dir };
}

/** Run fn with dir mode changed, restoring it after. */
async function withMode(p, mode, fn) {
  const prev = fs.statSync(p).mode & 0o7777;
  fs.chmodSync(p, mode);
  try {
    return await fn();
  } finally {
    fs.chmodSync(p, prev);
  }
}

/** Whether this process is stopped by a mode-000 file (false when running as root). */
function permissionsBite() {
  const f = path.join(tmp('qlfc-probe-'), 'x');
  fs.writeFileSync(f, 'x');
  fs.chmodSync(f, 0);
  try {
    fs.readFileSync(f);
    return false;
  } catch {
    return true;
  } finally {
    fs.chmodSync(f, 0o600);
  }
}
const PERMS = permissionsBite();

test('FC1: a missing list directory is the only "no list"', async () => {
  const missing = path.join(tmp('qlfc-none-'), 'quarantine-list');
  assert.deepEqual(Q.quarantineListVersions(missing), []);
  assert.equal(Q.readQuarantineList(missing), null);
  assert.deepEqual(Q.quarantinedTriples(missing), []);
});

test('FC2: an unreadable list directory with v2 present throws, never reads as empty', { skip: PERMS ? false : 'running as root: mode bits do not stop reads' }, async () => {
  const { dir } = await twoVersions();
  assert.deepEqual(Q.quarantineListVersions(dir), [1, 2]);
  await withMode(dir, 0o300, () => {
    assert.throws(() => Q.quarantineListVersions(dir), unreadable);
    assert.throws(() => Q.readQuarantineList(dir), unreadable);
    assert.throws(() => Q.readQuarantineList(dir, 1), unreadable);
    assert.throws(() => Q.quarantinedTriples(dir), unreadable);
  });
});

test('FC3: a list path that is not a directory throws (any uid)', () => {
  const logDir = tmp('qlfc-file-');
  const dir = Q.quarantineListDir(logDir);
  fs.writeFileSync(dir, 'not a directory');
  assert.throws(() => Q.quarantineListVersions(dir), unreadable);
  assert.throws(() => Q.quarantinedTriples(dir), unreadable);
});

test('FC4: an unreadable list file throws', async () => {
  // A version file that is a directory: unreadable for every uid.
  let { dir } = await twoVersions();
  fs.rmSync(path.join(dir, 'v2.json'));
  fs.mkdirSync(path.join(dir, 'v2.json'));
  assert.throws(() => Q.readQuarantineList(dir), unreadable);
  assert.throws(() => Q.quarantinedTriples(dir), unreadable);
  // Mode 000 on the latest version.
  if (PERMS) {
    ({ dir } = await twoVersions());
    await withMode(path.join(dir, 'v2.json'), 0, () => {
      assert.throws(() => Q.readQuarantineList(dir), unreadable);
      assert.throws(() => Q.quarantinedTriples(dir), unreadable);
    });
  }
});

test('FC5: a latest version that does not parse, or has no entries list, throws for R-2', async () => {
  let { dir } = await twoVersions();
  fs.writeFileSync(path.join(dir, 'v3.json'), '{"entries":');
  assert.throws(() => Q.quarantinedTriples(dir), unreadable);
  ({ dir } = await twoVersions());
  fs.writeFileSync(path.join(dir, 'v3.json'), '{"schema":"chit402.quarantine_list.v1"}');
  assert.throws(() => Q.quarantinedTriples(dir), unreadable);
  // A readable list still gives its triples.
  ({ dir } = await twoVersions());
  assert.deepEqual(Q.quarantinedTriples(dir).map((r) => r.tree_size), [11, 7]);
});

test('FC6: the route answers 500 for an unreadable list and 404 only when there is none (local server)', async () => {
  const { logDir, dir } = await twoVersions();
  const tree = new ReceiptMerkleTree();
  tree.dir = logDir;
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  process.env.RECEIPT_LOG_BOOT = '0';
  const { createApp } = await import('../src/server.js');
  const app = await createApp();
  _setReceiptMerkleTreeForTest(tree);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/.well-known/quarantine-list.json`;
  try {
    assert.equal((await fetch(base)).headers.get('x-chit-list-version'), '2');
    // The latest version file unreadable (a directory): 500, not v1 and not 404.
    fs.renameSync(path.join(dir, 'v2.json'), path.join(dir, 'v2.bak'));
    fs.mkdirSync(path.join(dir, 'v2.json'));
    for (const q of ['', '?version=2']) {
      const res = await fetch(`${base}${q}`);
      assert.equal(res.status, 500, q);
      assert.equal(res.headers.get('x-chit-list-hash'), null);
    }
    fs.rmdirSync(path.join(dir, 'v2.json'));
    fs.renameSync(path.join(dir, 'v2.bak'), path.join(dir, 'v2.json'));
    if (PERMS) {
      await withMode(dir, 0o300, async () => {
        for (const q of ['', '?version=1', '?version=2']) assert.equal((await fetch(`${base}${q}`)).status, 500, q);
      });
    }
    // No list at all: 404.
    fs.rmSync(dir, { recursive: true });
    assert.equal((await fetch(base)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    resetReceiptMerkleTree();
    resetIssuerSigner();
  }
});

test('FC7: fixed-head signing refuses when the list cannot be read, and records a receipt failure', async () => {
  resetReceiptFailuresForTests();
  const logDir = tmp('qlfc-fixed-');
  fs.writeFileSync(Q.quarantineListDir(logDir), 'not a directory');
  const tree = new ReceiptMerkleTree();
  tree.dir = logDir;
  const res = await tree._signFixedHead({ epoch: 2, tree_size: 11, root: 'cf'.repeat(32), published_at: '2026-10-09T10:23:55.000Z' }, KEY.kid);
  assert.deepEqual(res, { fixed_head: null, refused: 'quarantine_list_unreadable' });
  const rows = listReceiptFailures();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stage, 'sign');
  assert.equal(rows[0].reason, 'quarantine_list_unreadable');
  assert.equal(rows[0].outcome, 'refused');
  resetReceiptFailuresForTests();
});

