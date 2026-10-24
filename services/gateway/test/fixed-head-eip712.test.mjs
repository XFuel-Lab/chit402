/**
 * Fixed tree heads (EIP-712 TreeHead next to the JWS head), the signer input
 * guard, and the quarantine list. Tests G1-G16 of the escrow v0 brief plus
 * the attack cases. Offline: synthetic key, local server, no network.
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
import { runScenario, stubSigner, SCENARIO_TIMES } from './helpers/fixed-head-scenario.mjs';

process.env.NODE_ENV = 'test';
process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();
const KEY = syntheticIssuerKey();
process.env.ISSUER_KID = KEY.kid;
delete process.env.RECEIPT_FIXED_HEAD_EIP712;
delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
delete process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS;

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'fixed-head-g1-main.json'), 'utf8'));
const VECTORS = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'escrow-eip712-vectors.json'), 'utf8'));

const E = await import('../src/eip712-p256.js');
const T = await import('../src/tree-head-eip712.js');
const Q = await import('../src/quarantine-list.js');
const guard = await import('../src/issuer-signer-guard.js');
const {
  ReceiptMerkleTree,
  rootOf,
  _setReceiptMerkleTreeForTest,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');
const { acquireReceiptLogLock, _releaseReceiptLogLocksForTest } = await import('../src/receipt-log-lock.js');
const { _setIssuerSignerForTest, createEnvSigner } = await import('../src/issuer-signer.js');
const { createKmsSigner } = await import('../src/issuer-signer-kms.js');
const { resetIssuerSigner } = await import('../src/issuer-signer-state.js');
const {
  _resetIssuerKey,
  computeJwkThumbprint,
  getJwks,
  signJwsAsync,
  signJws,
  getIssuerPublicKeyJwk,
  verifyJws,
  signWithIssuerKey,
  signWithIssuerKeyAsync,
} = await import('../src/issuer-key.js');
const { issuanceCapHealth } = await import('../src/issuance-cap.js');
const { jcsRfc8785 } = await import('../src/offer-receipt.js');
const { EPOCH1_FINAL_ROOT, EPOCH1_GENESIS_DIGEST } = await import('../src/receipt-log-epoch.js');
const { GetPublicKeyCommand, SignCommand } = await import('@aws-sdk/client-kms');

const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function tmp(prefix = 'fixed-head-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function withFlag(value, fn) {
  const prev = process.env.RECEIPT_FIXED_HEAD_EIP712;
  if (value == null) delete process.env.RECEIPT_FIXED_HEAD_EIP712;
  else process.env.RECEIPT_FIXED_HEAD_EIP712 = value;
  return Promise.resolve().then(fn).finally(() => {
    if (prev == null) delete process.env.RECEIPT_FIXED_HEAD_EIP712;
    else process.env.RECEIPT_FIXED_HEAD_EIP712 = prev;
  });
}

function installStub(opts = {}) {
  const signer = stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey, ...opts });
  _setIssuerSignerForTest(signer);
  return signer;
}

/** Ready for new artifacts: lock held, pin verified, real log identity. */
function makeReady(tree, dir) {
  const lock = acquireReceiptLogLock(dir);
  assert.equal(lock.held, true);
  tree.pinVerified = true;
  tree.logIdentity = { epoch1_root: EPOCH1_FINAL_ROOT, genesis_digest: EPOCH1_GENESIS_DIGEST };
}

function readFixedRows(dir) {
  const file = path.join(dir, T.FIXED_HEADS_FILE);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line).fixed_head);
}

function claimsFor({ epoch = 2, size = 11, root, published = '2026-10-09T10:23:55.000Z' } = {}) {
  return { epoch, tree_size: size, root, published_at: published };
}

function leavesN(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(crypto.createHash('sha256').update(`leaf-${i}`).digest());
  return out;
}

function ctxFor(leaves, { epoch = 2, store, quarantined = [], ready = { ok: true }, logIdentity } = {}) {
  return {
    ready,
    logIdentity: logIdentity === undefined
      ? { epoch1_root: EPOCH1_FINAL_ROOT, genesis_digest: EPOCH1_GENESIS_DIGEST }
      : logIdentity,
    currentEpoch: epoch,
    leafCount: leaves.length,
    rootAt: (size) => hex(rootOf(leaves.slice(0, size))),
    quarantined,
    store: store || T.openFixedHeadStore(tmp()),
    kid: KEY.kid,
  };
}

test.afterEach(() => {
  _releaseReceiptLogLocksForTest();
});

// ---------------------------------------------------------------- G1 / G2

test('G1: flag off, the publish path is byte-identical to main dab93caf and writes no fixed-heads file', async () => {
  await withFlag(null, async () => {
    installStub();
    const { out } = await runScenario({ ReceiptMerkleTree });
    assert.equal(out.journal, GOLDEN.journal);
    assert.deepEqual(out.heads, GOLDEN.heads);
    assert.deepEqual(out.latest, GOLDEN.latest);
    assert.deepEqual(out.files, GOLDEN.files);
    assert.equal(out.files.includes(T.FIXED_HEADS_FILE), false);
  });
  for (const value of ['1', 'TRUE', 'yes', ' true', 'true ', '']) {
    assert.equal(T.fixedHeadFlagOn({ RECEIPT_FIXED_HEAD_EIP712: value }), false, value);
  }
  assert.equal(T.fixedHeadFlagOn({ RECEIPT_FIXED_HEAD_EIP712: 'true' }), true);
});

test('G2: flag on, JWS signing inputs, heads and journal are unchanged; fixed heads go to their own file', async () => {
  const offSigner = installStub();
  await withFlag(null, async () => { await runScenario({ ReceiptMerkleTree, prepare: makeReady }); });
  _releaseReceiptLogLocksForTest();
  const offInputs = [];
  const onInputs = [];
  const record = (list) => async (message) => {
    if (message[0] !== 0x19) list.push(message.toString('latin1'));
  };
  installStub({ onSign: record(offInputs) });
  let off;
  await withFlag(null, async () => { off = (await runScenario({ ReceiptMerkleTree, prepare: makeReady })).out; });
  _releaseReceiptLogLocksForTest();
  const onSigner = installStub({ onSign: record(onInputs) });
  let on;
  let onDir;
  await withFlag('true', async () => {
    const res = await runScenario({ ReceiptMerkleTree, prepare: makeReady });
    on = res.out;
    onDir = res.dir;
  });
  assert.ok(offSigner.calls.length > 0);
  assert.deepEqual(onInputs, offInputs);
  assert.ok(onInputs.length >= 2);
  for (const input of onInputs) assert.equal(input.slice(0, 3), 'eyJ');
  assert.equal(on.journal, off.journal);
  assert.equal(on.journal, GOLDEN.journal);
  assert.deepEqual(on.heads, off.heads);
  assert.deepEqual(on.latest, GOLDEN.latest);
  for (const head of on.heads) assert.equal('fixed_head' in head, false);
  const rows = readFixedRows(onDir);
  assert.equal(rows.length, 2);
  assert.equal(onSigner.calls.filter((c) => c.typed).length, 2);
  assert.deepEqual(rows.map((r) => r.message.tree_size), [3, 4]);
});

// ---------------------------------------------------------------- G3 / G4 / G5

test('G3: type hashes, salt, domain separator, struct hash and e equal the shared vector file and the brief', () => {
  assert.equal(E.EIP712_DOMAIN_TYPE, VECTORS.domain_type);
  assert.equal(E.EIP712_DOMAIN_TYPEHASH, VECTORS.domain_typehash);
  assert.equal(E.EIP712_DOMAIN_TYPEHASH, '0xa604fff5a27d5951f334ccda7abff3286a8af29caeeb196a6f2b40a1dce7612b');
  assert.equal(E.TREE_HEAD_TYPE, VECTORS.tree_head.type);
  assert.equal(E.TREE_HEAD_TYPEHASH, VECTORS.tree_head.typehash);
  assert.equal(E.TREE_HEAD_TYPEHASH, '0xf80e0f8d60b561c1041da3667da6c960baaa52b6b5a8d3ec70e506a054d3b7c7');
  const salt = E.logIdSalt(VECTORS.log_id.epoch1_root, VECTORS.log_id.genesis_digest);
  assert.equal(salt, VECTORS.log_id.salt);
  assert.equal(salt, E.EXPECTED_LOG_SALT);
  assert.equal(salt, '0x7a92860b2db8dfee1901affef1a3352ab94a3b3bfcc410aef7238ef170435211');
  assert.equal(VECTORS.log_id.epoch1_root, EPOCH1_FINAL_ROOT);
  assert.equal(VECTORS.log_id.genesis_digest, EPOCH1_GENESIS_DIGEST);
  assert.equal(E.domainSeparator(E.TREE_HEAD_DOMAIN_NAME, salt), VECTORS.tree_head.domain_separator);
  assert.equal(VECTORS.tree_head.domain_separator, '0xf872d64db3e6a1016b2dbdef96c6065d8b1104416485c6ef465c2b9df8c4cbc9');
  assert.equal(E.kidBytes32(VECTORS.kid.base64url), VECTORS.kid.bytes32);
  for (const v of VECTORS.tree_head.vectors) {
    const d = E.typedDigest('TreeHead', v.message, salt);
    assert.equal(d.structHash, v.struct_hash);
    assert.equal(`0x${d.preimage.toString('hex')}`, v.preimage);
    assert.equal(d.e, v.e);
    assert.equal(T.publishedAtSeconds(v.published_at_iso), v.message.published_at);
  }
  const worked = VECTORS.tree_head.vectors[0];
  assert.equal(worked.struct_hash, '0x8a4bcea24e0fdbbed86c4a6036431d22443770c19efa88a021d3811b9442707c');
  assert.equal(worked.e, '0x2c7b0ae5fab76b2b6b13e6ef7ba99d0eb7e7df9e087102ad32b681ec7842412f');
  const msg = T.treeHeadMessageFromClaims({
    epoch: 2,
    tree_size: 39,
    root: '3471f0bafad7a6304773db19dfaf8edf1902c7aff3a826f7fee6ce1a88c2fb05',
    published_at: '2026-10-24T00:00:46.980Z',
  }, 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q');
  assert.deepEqual(msg, worked.message);
});

test('G4: the signature verifies with crypto.verify over the 66-byte preimage and is low-S even when the signer returns high-S', async () => {
  const signer = installStub({ highS: true });
  const leaves = leavesN(11);
  const root = hex(rootOf(leaves));
  const res = await T.signFixedHead(claimsFor({ root }), ctxFor(leaves));
  assert.ok(res.fixed_head, res.refused);
  const fh = res.fixed_head;
  assert.ok(BigInt(fh.s) <= N / 2n);
  const d = E.typedDigest('TreeHead', fh.message, fh.domain.salt);
  assert.equal(d.preimage.length, 66);
  const sig = Buffer.concat([Buffer.from(fh.r.slice(2), 'hex'), Buffer.from(fh.s.slice(2), 'hex')]);
  assert.equal(crypto.verify('sha256', d.preimage, { key: KEY.publicKey, dsaEncoding: 'ieee-p1363' }, sig), true);
  assert.deepEqual(T.verifyFixedHead(fh, KEY.publicJwk), { ok: true });
  assert.equal(signer.calls.at(-1).length, 66);
  assert.equal(signer.calls.at(-1).first, 0x19);
  assert.equal(fh.schema, 'chit402.tree_head_eip712.v1');
  assert.equal(fh.digest_alg, 'sha256(eip712_preimage)');
  assert.deepEqual(fh.domain, { name: 'Chit402TreeHead', version: '1', chainId: 84532, salt: E.EXPECTED_LOG_SALT });
});

test('G5: the bytes32 kid is base64url-decode(kid) = sha256 of the RFC 7638 JWK JSON', () => {
  const thumb = computeJwkThumbprint(KEY.publicJwk);
  assert.equal(thumb, KEY.kid);
  const rfc7638 = JSON.stringify({ crv: 'P-256', kty: 'EC', x: KEY.publicJwk.x, y: KEY.publicJwk.y });
  const sha = crypto.createHash('sha256').update(rfc7638).digest('hex');
  assert.equal(E.kidBytes32(KEY.kid), `0x${sha}`);
  for (const bad of ['', 'abc', `${KEY.kid}=`, `${KEY.kid.slice(0, -1)}+`, KEY.kid.slice(1)]) {
    assert.throws(() => E.kidBytes32(bad), (err) => err.code === 'eip712_kid');
  }
});

// ---------------------------------------------------------------- refusals

test('G6: a quarantined triple gets no fixed head; the JWS head is still published', async () => {
  installStub();
  const leaves = leavesN(11);
  const root = hex(rootOf(leaves));
  const res = await T.signFixedHead(claimsFor({ root }), ctxFor(leaves, {
    quarantined: [{ epoch: 2, tree_size: 11, root }],
  }));
  assert.deepEqual(res, { fixed_head: null, refused: 'quarantined' });

  // Through the publish path: the next head's triple is on a stored list.
  await withFlag('true', async () => {
    const signer = installStub();
    const { out, dir } = await runScenario({
      ReceiptMerkleTree,
      prepare: (tree, d) => {
        makeReady(tree, d);
        const nextRoot = hex(rootOf(tree.leaves.slice(0, 3)));
        tree.quarantinedHeads = [{ epoch: 1, tree_size: 3, prefix_size: 2, root: nextRoot }];
      },
    });
    assert.equal(out.heads.length, 2);
    assert.equal(out.journal, GOLDEN.journal);
    const rows = readFixedRows(dir);
    assert.deepEqual(rows.map((r) => r.message.tree_size), [4]);
    assert.equal(signer.calls.filter((c) => c.typed).length, 1);
  });
});

test('G7: the Oct 9 race shape (size 11 labeled on the size-10 root) gets no fixed head', async () => {
  installStub();
  const leaves = leavesN(11);
  const raced = hex(rootOf(leaves.slice(0, 10)));
  const res = await T.signFixedHead(claimsFor({ root: raced }), ctxFor(leaves));
  assert.deepEqual(res, { fixed_head: null, refused: 'root_mismatch' });
  const honest = hex(rootOf(leaves));
  const ok = await T.signFixedHead(claimsFor({ root: honest }), ctxFor(leaves));
  assert.ok(ok.fixed_head);
});

test('G8: a second root at the same (epoch, size) is refused, also after a restart', async () => {
  installStub();
  const dir = tmp();
  const leaves = leavesN(11);
  const first = await T.signFixedHead(claimsFor({ root: hex(rootOf(leaves)) }), ctxFor(leaves, { store: T.openFixedHeadStore(dir) }));
  assert.ok(first.fixed_head);
  const other = leavesN(12).slice(1);
  const reopened = T.openFixedHeadStore(dir);
  const second = await T.signFixedHead(claimsFor({ root: hex(rootOf(other)) }), ctxFor(other, { store: reopened }));
  assert.deepEqual(second, { fixed_head: null, refused: 'conflicting_root' });
  // Same root, later published_at is not a conflict.
  const later = await T.signFixedHead(
    claimsFor({ root: hex(rootOf(leaves)), published: '2026-10-09T11:00:00.000Z' }),
    ctxFor(leaves, { store: T.openFixedHeadStore(dir) }),
  );
  assert.ok(later.fixed_head);
  assert.equal(readFixedRows(dir).length, 2);
});

test('G11: no fixed head without a durable, pin-verified, locked log under the expected salt', async () => {
  installStub();
  const leaves = leavesN(5);
  const root = hex(rootOf(leaves));
  for (const reason of ['log_not_durable', 'log_boot_disabled', 'fresh_genesis', 'pin_unverified', 'log_lock_missing']) {
    const res = await T.signFixedHead(claimsFor({ size: 5, root }), ctxFor(leaves, { ready: { ok: false, reason } }));
    assert.deepEqual(res, { fixed_head: null, refused: reason });
  }
  for (const logIdentity of [
    null,
    { epoch1_root: 'ab'.repeat(32), genesis_digest: EPOCH1_GENESIS_DIGEST },
    { epoch1_root: EPOCH1_FINAL_ROOT, genesis_digest: 'cd'.repeat(32) },
    { epoch1_root: EPOCH1_FINAL_ROOT.toUpperCase(), genesis_digest: EPOCH1_GENESIS_DIGEST },
  ]) {
    const res = await T.signFixedHead(claimsFor({ size: 5, root }), ctxFor(leaves, { logIdentity }));
    assert.deepEqual(res, { fixed_head: null, refused: 'log_identity' });
  }

  // Through the tree: each missing precondition refuses, the JWS head is unchanged.
  const cases = [
    ['pin_unverified', (tree, d) => { makeReady(tree, d); tree.pinVerified = false; }],
    ['fresh_genesis', (tree, d) => { makeReady(tree, d); tree.allowFreshGenesis = true; }],
    ['log_lock_missing', (tree) => { tree.pinVerified = true; tree.logIdentity = { epoch1_root: EPOCH1_FINAL_ROOT, genesis_digest: EPOCH1_GENESIS_DIGEST }; }],
    ['log_identity', (tree, d) => { makeReady(tree, d); tree.logIdentity = null; }],
  ];
  for (const [label, prepare] of cases) {
    await withFlag('true', async () => {
      const signer = installStub();
      const { out, dir } = await runScenario({ ReceiptMerkleTree, prepare });
      assert.equal(out.journal.length > 0, true, label);
      assert.equal(readFixedRows(dir).length, 0, label);
      assert.equal(signer.calls.filter((c) => c.typed).length, 0, label);
      assert.equal(out.heads.length, 2, label);
    });
    _releaseReceiptLogLocksForTest();
  }
  await withFlag('true', async () => {
    const prev = process.env.RECEIPT_LOG_BOOT;
    process.env.RECEIPT_LOG_BOOT = '0';
    try {
      installStub();
      const { dir } = await runScenario({ ReceiptMerkleTree, prepare: makeReady });
      assert.equal(readFixedRows(dir).length, 0);
    } finally {
      if (prev == null) delete process.env.RECEIPT_LOG_BOOT;
      else process.env.RECEIPT_LOG_BOOT = prev;
    }
  });
});

test('G12: out-of-range or unparseable fields are refused', async () => {
  installStub();
  const leaves = leavesN(3);
  const root = hex(rootOf(leaves));
  const bad = [
    { epoch: 2 ** 32, tree_size: 3, root, published_at: '2026-10-09T10:23:55.000Z' },
    { epoch: -1, tree_size: 3, root, published_at: '2026-10-09T10:23:55.000Z' },
    { epoch: 1.5, tree_size: 3, root, published_at: '2026-10-09T10:23:55.000Z' },
    { epoch: '2', tree_size: 3, root, published_at: '2026-10-09T10:23:55.000Z' },
    { epoch: 2, tree_size: 2 ** 53, root, published_at: '2026-10-09T10:23:55.000Z' },
    { epoch: 2, tree_size: 3, root, published_at: '2026-02-30T00:00:00.000Z' },
    { epoch: 2, tree_size: 3, root, published_at: '2026-10-09 10:23:55Z' },
    { epoch: 2, tree_size: 3, root, published_at: '2026-10-09T10:23:55+00:00' },
    { epoch: 2, tree_size: 3, root, published_at: null },
    { epoch: 2, tree_size: 3, root: root.toUpperCase(), published_at: '2026-10-09T10:23:55.000Z' },
    { epoch: 2, tree_size: 3, root: root.slice(2), published_at: '2026-10-09T10:23:55.000Z' },
    { epoch: 2, tree_size: 3, root: `0x${root}`, published_at: '2026-10-09T10:23:55.000Z' },
  ];
  for (const claims of bad) {
    const res = await T.signFixedHead(claims, ctxFor(leaves));
    assert.deepEqual(res, { fixed_head: null, refused: 'field_range' }, JSON.stringify(claims));
  }
  assert.throws(() => E.uintWord(2 ** 32, 32), (err) => err.code === 'eip712_field_range');
  assert.throws(() => E.bytes32Word(`0x${'AB'.repeat(32)}`), (err) => err.code === 'eip712_field_range');
});

test('R-6: a head of another epoch, or larger than the leaves, is never fixed (no backfill)', async () => {
  installStub();
  const leaves = leavesN(4);
  const root = hex(rootOf(leaves));
  const closed = await T.signFixedHead(claimsFor({ epoch: 1, size: 4, root }), ctxFor(leaves, { epoch: 2 }));
  assert.deepEqual(closed, { fixed_head: null, refused: 'not_open_epoch' });
  const ahead = await T.signFixedHead(claimsFor({ epoch: 2, size: 5, root }), ctxFor(leaves, { epoch: 2 }));
  assert.deepEqual(ahead, { fixed_head: null, refused: 'not_open_epoch' });
});

// ---------------------------------------------------------------- G9 GET never signs

test('G9: no GET handler signs a fixed head or a quarantine list; stored fixed heads are served next to the JWS head', async () => {
  await withFlag('true', async () => {
    // Real signatures here: the ?tree_size path checks the stored JWS.
    resetIssuerSigner();
    _resetIssuerKey();
    const real = createEnvSigner(process.env);
    const signer = {
      ...real,
      calls: [],
      async sign(input, opts) {
        const message = Buffer.from(input);
        this.calls.push({ first: message[0], length: message.length, typed: Boolean(opts && opts.typedPreimage) });
        return real.sign(input, opts);
      },
    };
    _setIssuerSignerForTest(signer);
    const { tree, dir } = await runScenario({ ReceiptMerkleTree, prepare: makeReady });
    const prevBoot = process.env.RECEIPT_LOG_BOOT;
    const prevDir = process.env.RECEIPT_LOG_DIR;
    process.env.RECEIPT_LOG_BOOT = '0';
    delete process.env.RECEIPT_LOG_DIR;
    const { createApp } = await import('../src/server.js');
    const app = await createApp();
    _setReceiptMerkleTreeForTest(tree);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const before = signer.calls.length;
      const head = await (await fetch(`${base}/v1/receipts/tree/head`)).json();
      assert.ok(head.fixed_head);
      assert.equal(head.fixed_head.message.tree_size, head.tree_size);
      assert.deepEqual(T.verifyFixedHead(head.fixed_head, KEY.publicJwk), { ok: true });
      const { fixed_head: _f, receipt_log: _r, ...rest } = head;
      const { receipt_log: _r2, ...latest } = JSON.parse(JSON.stringify(tree.latestSignedHead()));
      assert.deepEqual(rest, latest);
      const at = await (await fetch(`${base}/v1/receipts/tree/head?tree_size=3`)).json();
      assert.equal(at.tree_size, 3, JSON.stringify(at).slice(0, 300));
      assert.equal(at.fixed_head?.message?.tree_size, 3, JSON.stringify(at).slice(0, 600));
      for (const url of [
        '/v1/receipts/tree/head',
        '/v1/receipts/tree/head?tree_size=4',
        '/v1/receipts/tree/epoch/1/head',
        '/v1/receipts/row-1/inclusion',
        '/.well-known/quarantine-list.json',
        '/.well-known/quarantine-list.json?version=1',
      ]) {
        await fetch(`${base}${url}`).then((r) => r.arrayBuffer());
      }
      assert.equal(signer.calls.slice(before).filter((c) => c.typed || c.first === 0x19).length, 0);
      assert.equal(readFixedRows(dir).length, 2);
      // Flag off at read time: the field is not served.
      process.env.RECEIPT_FIXED_HEAD_EIP712 = 'false';
      const plain = await (await fetch(`${base}/v1/receipts/tree/head`)).json();
      assert.equal('fixed_head' in plain, false);
      process.env.RECEIPT_FIXED_HEAD_EIP712 = 'true';
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
      else process.env.RECEIPT_LOG_BOOT = prevBoot;
      if (prevDir != null) process.env.RECEIPT_LOG_DIR = prevDir;
      resetReceiptMerkleTree();
    }
  });
});

// ---------------------------------------------------------------- G10 guard

test('G10: the signer refuses 0x19 input outside the typed path and a bad typed input; raw exports refuse', async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  const env = createEnvSigner(process.env);
  const preimage = E.typedDigest('TreeHead', {
    epoch: 2, tree_size: 1, root: `0x${'11'.repeat(32)}`, published_at: 1, kid: E.kidBytes32(KEY.kid),
  }, E.EXPECTED_LOG_SALT).preimage;
  await assert.rejects(env.sign(preimage), (err) => err.code === 'issuer_sign_refused');
  await assert.rejects(env.sign(preimage, { typedPreimage: {} }), (err) => err.code === 'issuer_sign_refused');
  await assert.rejects(env.sign(Buffer.from([0x19, 0x00, 1, 2])), (err) => err.code === 'issuer_sign_refused');
  await assert.rejects(env.sign(Buffer.concat([preimage, Buffer.from([0])]), { typedPreimage: Symbol('x') }), (err) => err.code === 'issuer_sign_refused');
  // A JWS signing input still signs.
  const jws = await env.sign(Buffer.from('eyJhbGciOiJFUzI1NiJ9.e30'));
  assert.equal(jws.length, 64);
  // Shape rule for the typed path.
  assert.equal(guard.typedPreimageShapeOk(preimage), true);
  assert.equal(guard.typedPreimageShapeOk(preimage.subarray(0, 65)), false);
  assert.equal(guard.typedPreimageShapeOk(Buffer.concat([preimage, Buffer.from([0])])), false);
  const wrongVersion = Buffer.from(preimage);
  wrongVersion[1] = 0x00;
  assert.equal(guard.typedPreimageShapeOk(wrongVersion), false);
  // The capability was claimed by eip712-p256.js at import; no second claim.
  assert.throws(() => guard.claimTypedPreimageCapability(), (err) => err.code === 'issuer_typed_capability_claimed');
  // Only allowlisted struct kinds; no raw-bytes entry point.
  assert.deepEqual(E.allowedTypedStructs().map((s) => s.kind), ['TreeHead', 'ReceiptBinding']);
  await assert.rejects(E.signTypedStruct('Other', {}, { salt: E.EXPECTED_LOG_SALT }), (err) => err.code === 'eip712_type_not_allowed');
  await assert.rejects(E.signTypedStruct('__proto__', {}, { salt: E.EXPECTED_LOG_SALT }), (err) => err.code === 'eip712_type_not_allowed');
  assert.throws(() => signWithIssuerKey('x'), (err) => err.code === 'issuer_raw_sign_removed');
  await assert.rejects(signWithIssuerKeyAsync('x'), (err) => err.code === 'issuer_raw_sign_removed');
  // The real env signer signs a typed struct end to end.
  const out = await E.signTypedStruct('TreeHead', {
    epoch: 2, tree_size: 1, root: `0x${'11'.repeat(32)}`, published_at: 1, kid: E.kidBytes32(KEY.kid),
  }, { salt: E.EXPECTED_LOG_SALT, signer: env });
  assert.equal(E.verifyTypedSignature(out.preimage, out.r, out.s, KEY.publicJwk), true);
});

test('attack: a fixed-head signature never verifies as a JWS, and a JWS signature never verifies as a fixed head', async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  _setIssuerSignerForTest(createEnvSigner(process.env));
  const leaves = leavesN(3);
  const root = hex(rootOf(leaves));
  const res = await T.signFixedHead(claimsFor({ size: 3, root }), ctxFor(leaves));
  assert.ok(res.fixed_head);
  const fh = res.fixed_head;
  const sig64 = Buffer.concat([Buffer.from(fh.r.slice(2), 'hex'), Buffer.from(fh.s.slice(2), 'hex')]);
  const { jws } = await signJwsAsync({ epoch: 2, tree_size: 3, root }, { typ: 'chit402-tree-head+jwt' });
  const [h, p] = jws.split('.');
  const forged = `${h}.${p}.${sig64.toString('base64url')}`;
  const jwk = getJwks().keys.find((k) => k.kid === KEY.kid);
  assert.equal(verifyJws(forged, jwk).valid, false);
  const jwsSig = Buffer.from(jws.split('.')[2], 'base64url');
  const d = E.typedDigest('TreeHead', fh.message, fh.domain.salt);
  assert.equal(E.verifyTypedSignature(d.preimage, `0x${hex(jwsSig.subarray(0, 32))}`, `0x${hex(jwsSig.subarray(32))}`, KEY.publicJwk), false);
  // Replay under another chain or log salt fails the reference check.
  assert.equal(T.verifyFixedHead({ ...fh, domain: { ...fh.domain, chainId: 8453 } }, KEY.publicJwk).ok, false);
  const otherSalt = E.logIdSalt('ab'.repeat(32), EPOCH1_GENESIS_DIGEST);
  assert.equal(T.verifyFixedHead({ ...fh, domain: { ...fh.domain, salt: otherSalt } }, KEY.publicJwk, { salt: otherSalt }).reason, 'signature');
  assert.equal(T.verifyFixedHead({ ...fh, message: { ...fh.message, tree_size: 4 } }, KEY.publicJwk).reason, 'signature');
  resetIssuerSigner();
});

test('attack: an unreadable or torn fixed-heads.jsonl refuses every new fixed head', async () => {
  installStub();
  const dir = tmp();
  const leaves = leavesN(3);
  const ok = await T.signFixedHead(claimsFor({ size: 3, root: hex(rootOf(leaves)) }), ctxFor(leaves, { store: T.openFixedHeadStore(dir) }));
  assert.ok(ok.fixed_head);
  fs.appendFileSync(path.join(dir, T.FIXED_HEADS_FILE), '{"v":1,"fixed_he');
  const torn = T.openFixedHeadStore(dir);
  assert.equal(torn.broken, true);
  const more = leavesN(4);
  const res = await T.signFixedHead(claimsFor({ size: 4, root: hex(rootOf(more)) }), ctxFor(more, { store: torn }));
  assert.deepEqual(res, { fixed_head: null, refused: 'store_unreadable' });
});

test('attack: a struct kid that is not the signer kid is refused', async () => {
  installStub();
  const leaves = leavesN(3);
  const ctx = ctxFor(leaves);
  const other = syntheticIssuerKey('another seed');
  ctx.kid = other.kid;
  const res = await T.signFixedHead(claimsFor({ size: 3, root: hex(rootOf(leaves)) }), ctx);
  assert.deepEqual(res, { fixed_head: null, refused: 'signer_error' });
});

// ---------------------------------------------------------------- G13 old verifier

test('G13: chit402-verify gives the same tree-head verdict with and without fixed_head', async () => {
  const { verifyTreeHeadTrust } = await import('../../../packages/verify/dist/index.js');
  resetIssuerSigner();
  _resetIssuerKey();
  await withFlag('true', async () => {
    _setIssuerSignerForTest(createEnvSigner(process.env));
    const { tree } = await runScenario({ ReceiptMerkleTree, prepare: makeReady });
    const head = JSON.parse(JSON.stringify(tree.latestSignedHead()));
    const fixed = tree.fixedHeadFor(head);
    assert.ok(fixed);
    const opts = { jwks: getJwks(), trustedKids: [KEY.kid] };
    const without = verifyTreeHeadTrust(head, opts);
    const withField = verifyTreeHeadTrust({ ...head, fixed_head: fixed }, opts);
    assert.deepEqual(withField, without);
  });
  resetIssuerSigner();
});

// ---------------------------------------------------------------- G14 quarantine list

function listEntry(overrides = {}) {
  return {
    epoch: 2,
    tree_size: 11,
    root: 'cf'.repeat(32),
    prefix_size: 10,
    reason: 'publish_append_race',
    consistency: { first: 10, second: 39, second_root: '34'.repeat(32), proof: ['aa'.repeat(32), 'bb'.repeat(32)] },
    quarantine_ack_jws: 'eyJhbGciOiJFUzI1NiJ9.e30.c2ln',
    ...overrides,
  };
}

const PROD_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
/** Every flag and env combination an operator might try. None of them is an override. */
const OVERRIDE_FLAGS = [[], ['--allow-production-issuer'], ['--force'], ['--allow-production-issuer', '--force', '--yes']];
const OVERRIDE_ENVS = [{}, { QUARANTINE_SIGN_ALLOW_PRODUCTION: '1' }, { QUARANTINE_SIGN_ALLOW_PRODUCTION: 'true', QUARANTINE_SIGN_FORCE: '1' }];

test('G14: quarantine list JCS bytes are deterministic, the JWS verifies, versions are sealed and append-only (Oct 9 head)', async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  _setIssuerSignerForTest(createEnvSigner(process.env));
  const oct9 = listEntry();
  const hw = [{ epoch: 2, tree_size: 39, root: '34'.repeat(32) }];
  const doc1 = Q.buildQuarantineList({ entries: [oct9], highWater: hw });
  assert.equal(doc1.version, 1);
  assert.equal(doc1.prev_list_hash, null);
  assert.equal(doc1.canonicalization, 'RFC 8785 (jcsRfc8785)');
  assert.equal(jcsRfc8785(doc1), jcsRfc8785(Q.buildQuarantineList({ entries: [listEntry()], highWater: hw })));
  assert.equal(doc1.entries_hash, crypto.createHash('sha256').update(jcsRfc8785([oct9])).digest('hex'));
  const bytes1 = await Q.signQuarantineList(doc1);
  assert.equal(jcsRfc8785(JSON.parse(bytes1)), bytes1);
  assert.equal(Q.verifyQuarantineList(bytes1, getJwks()).ok, true);
  const payload = JSON.parse(Buffer.from(JSON.parse(bytes1).issuer_signature.jws.split('.')[1], 'base64url').toString());
  assert.deepEqual(Object.keys(payload).sort(), ['entries_hash', 'entry_count', 'high_water', 'prev_list_hash', 'schema', 'seq', 'version']);
  assert.equal(payload.entry_count, 1);

  const logDir = tmp();
  const dir = Q.quarantineListDir(logDir);
  Q.writeQuarantineListVersion(dir, bytes1);
  assert.throws(() => Q.writeQuarantineListVersion(dir, bytes1), (err) => err.code === 'quarantine_list_version');

  const second = listEntry({ epoch: 3, tree_size: 7, prefix_size: 6, root: 'de'.repeat(32), consistency: { first: 6, second: 9, second_root: 'ef'.repeat(32), proof: [] } });
  const hw2 = [...hw, { epoch: 3, tree_size: 9, root: 'ef'.repeat(32) }];
  assert.throws(() => Q.buildQuarantineList({ entries: [second], highWater: hw2, prevBytes: bytes1 }), (err) => err.code === 'quarantine_list_append_only');
  assert.throws(() => Q.buildQuarantineList({ entries: [listEntry({ reason: 'edited' }), second], highWater: hw2, prevBytes: bytes1 }), (err) => err.code === 'quarantine_list_append_only');
  const doc2 = Q.buildQuarantineList({ entries: [oct9, second], highWater: hw2, prevBytes: bytes1 });
  assert.equal(doc2.version, 2);
  assert.equal(doc2.prev_list_hash, crypto.createHash('sha256').update(bytes1).digest('hex'));
  const bytes2 = await Q.signQuarantineList(doc2);
  assert.equal(Q.verifyQuarantineList(bytes2, getJwks(), { prevBytes: bytes1 }).ok, true);
  assert.equal(jcsRfc8785(JSON.parse(bytes2).entries[0]), jcsRfc8785(JSON.parse(bytes1).entries[0]));
  Q.writeQuarantineListVersion(dir, bytes2);

  // An entry above the high-water mark cannot be listed.
  assert.throws(() => Q.buildQuarantineList({ entries: [listEntry({ tree_size: 40 })], highWater: hw }), (err) => err.code === 'quarantine_list_high_water');
  // Tampering is caught.
  const tampered = bytes1.replace('"prefix_size":10', '"prefix_size":9');
  assert.equal(Q.verifyQuarantineList(tampered, getJwks()).ok, false);

  // Route: stored bytes, byte-identical reads, sealed versions, strict query.
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
    const a = await fetch(base);
    const b = await fetch(base);
    const ta = await a.text();
    assert.equal(a.status, 200);
    assert.equal(ta, await b.text());
    assert.equal(ta, bytes2);
    assert.equal(a.headers.get('x-chit-list-version'), '2');
    const v1 = await fetch(`${base}?version=1`);
    assert.equal(await v1.text(), bytes1);
    assert.match(v1.headers.get('cache-control'), /immutable/);
    for (const q of ['?seq=1', '?version=01', '?version=0', '?version=1&x=1', '?hash=abc']) {
      assert.equal((await fetch(`${base}${q}`)).status, 400, q);
    }
    assert.equal((await fetch(`${base}?version=3`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    resetReceiptMerkleTree();
    resetIssuerSigner();
  }
  // R-2 reads the stored list too.
  assert.deepEqual(Q.quarantinedTriples(dir).map((r) => r.tree_size), [11, 7]);
});

test('G14: the ops script builds, signs and seals a list from a journal with a raced head (synthetic key, dry run first)', async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  const dir = tmp('quarantine-script-');
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  const publish = (now) => tree.publishHead({ force: true, now, sleep: async () => {}, send: async () => { throw new Error('no_send'); } });
  for (let i = 1; i <= 9; i += 1) await tree.appendReceipt(`row-${i}`, `hash-${i}`, { publish: false });
  assert.equal(tree.leaves.length, 10);
  await publish('2026-10-09T09:00:00.000Z');
  await tree.appendReceipt('row-10', 'hash-10', { publish: false });
  await tree.appendReceipt('row-11', 'hash-11', { publish: false });
  const honest = await publish('2026-10-09T10:00:00.000Z');
  assert.equal(honest.tree_size, 12);
  // The Oct 9 shape: a size-11 label on the size-10 root.
  const { appendJournal } = await import('../src/receipt-log-store.js');
  const racedRoot = hex(rootOf(tree.leaves.slice(0, 10)));
  const tx = `0x${'cd'.repeat(32)}`;
  const racedClaims = {
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
  const signed = signJws(racedClaims, { typ: 'chit402-tree-head+jwt' });
  const raced = {
    ...racedClaims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-head+jwt',
      payload_version: 2,
      jws: signed.jws,
      kid: signed.kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
  appendJournal(dir, { v: 1, op: 'head', epoch: tree.epoch, head: raced });
  const loaded = new ReceiptMerkleTree();
  loaded.load(dir);
  assert.equal(loaded.quarantinedHeads.length, 1);
  await loaded.acknowledgeQuarantinedHead(racedRoot);

  const script = path.join(here, '..', 'scripts', 'sign-quarantine-list.mjs');
  const env = { ...process.env, NODE_ENV: 'test', ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid };
  delete env.RECEIPT_LOG_DIR;
  const journalBefore = fs.readFileSync(path.join(dir, 'journal.jsonl'));
  const dry = spawnSync(process.execPath, [script, '--log-dir', dir], { env, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stderr, /dry run: version 1, 1 entries/);
  assert.equal(fs.existsSync(Q.quarantineListDir(dir)), false);
  const refused = spawnSync(process.execPath, [script, '--log-dir', dir, '--apply'], { env, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  // Asking for the production kid at the script level fails under every flag and env
  // combination, and nothing is signed or written. (A synthetic key cannot carry the
  // production kid, so the key loader refuses first; the in-process guard test covers
  // a signer that reports it.)
  for (const flags of OVERRIDE_FLAGS) {
    for (const extraEnv of OVERRIDE_ENVS) {
      const out = spawnSync(process.execPath, [script, '--log-dir', dir, '--apply', '--confirm', 'YES', ...flags], {
        env: { ...env, ISSUER_KID: PROD_KID, ...extraEnv },
        encoding: 'utf8',
        timeout: 20_000,
      });
      assert.notEqual(out.status, 0, `${flags.join(' ')} ${JSON.stringify(extraEnv)}`);
      assert.match(out.stderr, /production_kid|issuer_kid_mismatch/);
    }
  }
  assert.equal(fs.existsSync(Q.quarantineListDir(dir)), false);
  const applied = spawnSync(process.execPath, [script, '--log-dir', dir, '--apply', '--confirm', 'YES'], { env, encoding: 'utf8' });
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'journal.jsonl')), journalBefore);
  const stored = Q.readQuarantineList(Q.quarantineListDir(dir));
  assert.equal(stored.version, 1);
  const verdict = Q.verifyQuarantineList(stored.bytes, getJwks());
  assert.equal(verdict.ok, true, verdict.reason);
  const [entry] = verdict.doc.entries;
  assert.equal(entry.tree_size, 11);
  assert.equal(entry.prefix_size, 10);
  assert.equal(entry.root, racedRoot);
  assert.equal(entry.consistency.second, 12);
  assert.equal(entry.consistency.second_root, honest.root);
  assert.deepEqual(verdict.doc.high_water, [{ epoch: tree.epoch, tree_size: 12, root: honest.root }]);
  const again = spawnSync(process.execPath, [script, '--log-dir', dir, '--apply', '--confirm', 'YES'], { env, encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /no change since version 1/);
});

// ---------------------------------------------------------------- quarantine signing guard

test('quarantine guard: the script hard-refuses a production env and KMS under every flag and env combination', { timeout: 120_000 }, () => {
  const script = path.join(here, '..', 'scripts', 'sign-quarantine-list.mjs');
  // An empty dir: a refusal happens before the log is read, so nothing is read or written.
  const dir = tmp('quarantine-guard-');
  const base = { ...process.env, ISSUER_PRIVATE_KEY: syntheticIssuerKeyEnv(), ISSUER_KID: KEY.kid };
  delete base.RECEIPT_LOG_DIR;
  delete base.QUARANTINE_SIGN_ALLOW_PRODUCTION;
  delete base.ISSUER_SIGNER;
  const unset = { ...base };
  delete unset.NODE_ENV;
  const kms = { ISSUER_SIGNER: 'kms', ISSUER_KMS_KEY_ID: 'alias/chit402-quarantine-guard-test' };
  const targets = [
    ['production env', { ...base, NODE_ENV: 'production' }, 'production_env'],
    ['NODE_ENV unset counts as production', unset, 'production_env'],
    ['KMS signer in a test env', { ...base, NODE_ENV: 'test', ...kms }, 'kms_signer'],
    ['KMS signer in production', { ...base, NODE_ENV: 'production', ...kms }, 'production_env'],
  ];
  let runs = 0;
  for (const [label, env] of targets) {
    for (const flags of OVERRIDE_FLAGS) {
      for (const extraEnv of OVERRIDE_ENVS) {
        const out = spawnSync(process.execPath, [script, '--log-dir', dir, '--apply', '--confirm', 'YES', ...flags], {
          env: { ...env, ...extraEnv },
          encoding: 'utf8',
          timeout: 20_000,
        });
        const what = `${label} ${flags.join(' ')} ${JSON.stringify(extraEnv)}`;
        assert.notEqual(out.status, 0, what);
        assert.match(out.stderr, /refused: (production_env|kms_signer)\. This script signs only with a stub or test signer; there is no override\./, what);
        runs += 1;
      }
    }
  }
  assert.equal(runs, 48);
  for (const [label, env, reason] of targets) {
    const out = spawnSync(process.execPath, [script, '--log-dir', dir, '--apply', '--confirm', 'YES'], { env, encoding: 'utf8', timeout: 20_000 });
    assert.match(out.stderr, new RegExp(`refused: ${reason}`), label);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
  // The pure guard has no allow input at all.
  for (const extraEnv of OVERRIDE_ENVS) {
    assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'production', ...extraEnv } }), { ok: false, reason: 'production_env' });
    assert.deepEqual(Q.quarantineSignGuard({ env: { ...extraEnv } }), { ok: false, reason: 'production_env' });
    assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test', ISSUER_SIGNER: ' KMS ', ...extraEnv } }), { ok: false, reason: 'kms_signer' });
    assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test', ...extraEnv }, signerKind: 'kms' }), { ok: false, reason: 'kms_signer' });
    assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test', ...extraEnv }, kid: PROD_KID }), { ok: false, reason: 'production_kid' });
  }
  assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test' }, kid: KEY.kid }), { ok: true });
  assert.equal(Q.QUARANTINE_SIGN_ALLOW_ENV, undefined, 'no allow env exists');
  assert.equal(Q.QUARANTINE_SIGN_ALLOW_FLAG, undefined, 'no allow flag exists');
});

test('quarantine guard: signQuarantineList refuses production, KMS and the production kid with no override, and still signs with a stub signer', async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  const doc = Q.buildQuarantineList({ entries: [listEntry()], highWater: [{ epoch: 2, tree_size: 39, root: '34'.repeat(32) }], prevBytes: null });
  // Stub signer under the synthetic key: signs in a test env.
  const stub = installStub();
  const bytes = await Q.signQuarantineList(doc, { env: { NODE_ENV: 'test' } });
  const parsed = JSON.parse(bytes);
  assert.equal(parsed.issuer_signature.kid, KEY.kid);
  assert.equal(parsed.issuer_signature.typ, Q.QUARANTINE_LIST_TYP);
  assert.ok(stub.calls.length >= 1);
  const before = stub.calls.length;
  for (const extraEnv of OVERRIDE_ENVS) {
    await assert.rejects(
      Q.signQuarantineList(doc, { env: { NODE_ENV: 'production', ...extraEnv }, argv: ['--allow-production-issuer'] }),
      (err) => err.code === 'quarantine_sign_refused' && err.reason === 'production_env',
    );
    await assert.rejects(
      Q.signQuarantineList(doc, { env: { NODE_ENV: 'test', ISSUER_SIGNER: 'kms', ...extraEnv } }),
      (err) => err.code === 'quarantine_sign_refused' && err.reason === 'kms_signer',
    );
  }
  assert.equal(stub.calls.length, before);
  // An active signer that is KMS, or that reports the production kid, is refused in a test env too.
  const kmsKind = stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey });
  kmsKind.kind = 'kms';
  _setIssuerSignerForTest(kmsKind);
  await assert.rejects(
    Q.signQuarantineList(doc, { env: { NODE_ENV: 'test', QUARANTINE_SIGN_ALLOW_PRODUCTION: '1' } }),
    (err) => err.code === 'quarantine_sign_refused' && err.reason === 'kms_signer',
  );
  assert.equal(kmsKind.calls.length, 0);
  const prodKid = stubSigner({ kid: PROD_KID, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey });
  _setIssuerSignerForTest(prodKid);
  for (const extraEnv of OVERRIDE_ENVS) {
    await assert.rejects(
      Q.signQuarantineList(doc, { env: { NODE_ENV: 'test', ...extraEnv } }),
      (err) => err.code === 'quarantine_sign_refused' && err.reason === 'production_kid',
    );
  }
  assert.equal(prodKid.calls.length, 0);
  resetIssuerSigner();
});

const PP = await import('../src/production-process.js');

test('quarantine guard: a NODE_ENV=production process calling the module directly with env {NODE_ENV:test} is refused', async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  const doc = Q.buildQuarantineList({ entries: [listEntry()], highWater: [{ epoch: 2, tree_size: 39, root: '34'.repeat(32) }], prevBytes: null });
  const stub = installStub();
  const saved = { NODE_ENV: process.env.NODE_ENV, ISSUER_SIGNER: process.env.ISSUER_SIGNER };
  try {
    process.env.NODE_ENV = 'production';
    for (const extraEnv of OVERRIDE_ENVS) {
      assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test', ...extraEnv } }), { ok: false, reason: 'production_env' });
      assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test', ...extraEnv }, kid: KEY.kid, publicJwk: KEY.publicJwk }), { ok: false, reason: 'production_env' });
      await assert.rejects(
        Q.signQuarantineList(doc, { env: { NODE_ENV: 'test', ...extraEnv } }),
        (err) => err.code === 'quarantine_sign_refused' && err.reason === 'production_env',
      );
    }
    process.env.NODE_ENV = 'test';
    process.env.ISSUER_SIGNER = 'kms';
    assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test' } }), { ok: false, reason: 'kms_signer' }, 'a KMS process env is refused whatever env is passed');
    await assert.rejects(
      Q.signQuarantineList(doc, { env: { NODE_ENV: 'test' } }),
      (err) => err.code === 'quarantine_sign_refused' && err.reason === 'kms_signer',
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.equal(stub.calls.length, 0, 'the signer is never called');
  assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test' }, kid: KEY.kid, publicJwk: KEY.publicJwk }), { ok: true });
  resetIssuerSigner();
});

test('quarantine guard: a relabelled stand-in key whose public key matches a production key is refused (production_key)', async () => {
  resetIssuerSigner();
  _resetIssuerKey();
  const doc = Q.buildQuarantineList({ entries: [listEntry()], highWater: [{ epoch: 2, tree_size: 39, root: '34'.repeat(32) }], prevBytes: null });
  // 1. The published production public key (public x/y only) under another kid label. Holds no private key.
  const prodPub = PP.PRODUCTION_ISSUER_PUBLIC_KEYS[0];
  for (const label of ['relabelled-kid', PROD_KID.toLowerCase(), ` ${PROD_KID}`, KEY.kid]) {
    assert.deepEqual(
      Q.quarantineSignGuard({ env: { NODE_ENV: 'test' }, kid: label, publicJwk: { kty: 'EC', crv: 'P-256', x: prodPub.x, y: prodPub.y } }),
      { ok: false, reason: 'production_key' },
      label,
    );
  }
  const relabelled = stubSigner({ kid: 'relabelled-kid', publicJwk: { x: prodPub.x, y: prodPub.y }, privateKey: KEY.privateKey });
  _setIssuerSignerForTest(relabelled);
  await assert.rejects(
    Q.signQuarantineList(doc, { env: { NODE_ENV: 'test' } }),
    (err) => err.code === 'quarantine_sign_refused' && err.reason === 'production_key',
  );
  assert.equal(relabelled.calls.length, 0);
  resetIssuerSigner();

  // 2. A stand-in for a rotated or second production key: a throwaway test key listed as an issuer history entry.
  const standIn = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = standIn.publicKey.export({ format: 'jwk' });
  const extra = JSON.stringify([{ kid: 'stand-in-production', jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } }]);
  assert.deepEqual(
    Q.quarantineSignGuard({ env: { NODE_ENV: 'test', ISSUER_HISTORY_EXTRA: extra }, kid: 'any-label', publicJwk: jwk }),
    { ok: false, reason: 'production_key' },
  );
  const saved = process.env.ISSUER_HISTORY_EXTRA;
  const standInSigner = stubSigner({ kid: 'any-label', publicJwk: { x: jwk.x, y: jwk.y }, privateKey: standIn.privateKey });
  _setIssuerSignerForTest(standInSigner);
  try {
    process.env.ISSUER_HISTORY_EXTRA = extra;
    await assert.rejects(
      Q.signQuarantineList(doc, { env: { NODE_ENV: 'test' } }),
      (err) => err.code === 'quarantine_sign_refused' && err.reason === 'production_key',
      'a key named in this process\'s issuer history is refused even when the passed env omits it',
    );
  } finally {
    if (saved === undefined) delete process.env.ISSUER_HISTORY_EXTRA;
    else process.env.ISSUER_HISTORY_EXTRA = saved;
  }
  assert.equal(standInSigner.calls.length, 0);
  assert.deepEqual(Q.quarantineSignGuard({ env: { NODE_ENV: 'test' }, kid: 'any-label', publicJwk: jwk }), { ok: true }, 'not listed: a plain test key');
  resetIssuerSigner();
});

test('production keys: PRODUCTION_ISSUER_PUBLIC_KEYS holds every key in the published issuer history and JWKS', () => {
  const fixtures = path.join(here, '..', '..', '..', 'packages', 'verify', 'test', 'fixtures');
  const history = JSON.parse(fs.readFileSync(path.join(fixtures, 'public', 'issuer-history-v1.json'), 'utf8'));
  const jwks = JSON.parse(fs.readFileSync(path.join(fixtures, 'chit402-jwks.json'), 'utf8'));
  const published = [...history.entries.map((e) => ({ kid: e.kid, ...e.jwk })), ...jwks.keys];
  assert.ok(published.length >= 2);
  for (const key of published) {
    assert.equal(PP.isProductionIssuerPublicKey(key), true, key.kid);
    assert.ok(PP.PRODUCTION_ISSUER_PUBLIC_KEYS.some((k) => k.kid === key.kid), key.kid);
  }
  for (const k of PP.PRODUCTION_ISSUER_PUBLIC_KEYS) {
    const thumb = crypto.createHash('sha256').update(JSON.stringify({ crv: k.crv, kty: k.kty, x: k.x, y: k.y })).digest('base64url');
    assert.equal(thumb, k.kid, 'each listed key is its own RFC 7638 kid');
  }
  assert.equal(PP.isProductionIssuerPublicKey(KEY.publicJwk), false);
});

// ---------------------------------------------------------------- G15 KMS

function spki(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' });
}

function kmsClient({ throttleTyped = false } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      const input = command.input || {};
      calls.push({ name: command.constructor.name, MessageType: input.MessageType, length: input.Message ? input.Message.length : null, first: input.Message ? input.Message[0] : null });
      if (command instanceof GetPublicKeyCommand) {
        return { KeySpec: 'ECC_NIST_P256', KeyUsage: 'SIGN_VERIFY', SigningAlgorithms: ['ECDSA_SHA_256'], PublicKey: spki(KEY.publicKey) };
      }
      if (command instanceof SignCommand) {
        const message = Buffer.from(input.Message);
        if (throttleTyped && message[0] === 0x19) {
          const err = new Error('Rate exceeded');
          err.name = 'ThrottlingException';
          throw err;
        }
        return { Signature: crypto.sign('sha256', message, { key: KEY.privateKey, dsaEncoding: 'der' }) };
      }
      throw new Error('unexpected');
    },
  };
}

test('G15: the KMS signer sends the 66-byte preimage RAW + ECDSA_SHA_256; throttling gives no fixed head and the JWS head is unaffected', async () => {
  const saved = { ...process.env };
  process.env.ISSUER_SIGNER = 'kms';
  process.env.ISSUER_KMS_KEY_ID = 'alias/chit402-fixed-head-test';
  process.env.ISSUER_KMS_REGION = 'us-east-1';
  try {
    const client = kmsClient();
    const kms = await createKmsSigner({ client, env: process.env });
    _setIssuerSignerForTest(kms);
    const leaves = leavesN(3);
    const res = await T.signFixedHead(claimsFor({ size: 3, root: hex(rootOf(leaves)) }), ctxFor(leaves));
    assert.ok(res.fixed_head, res.refused);
    const typed = client.calls.filter((c) => c.name === 'SignCommand' && c.first === 0x19);
    assert.equal(typed.length, 1);
    assert.equal(typed[0].MessageType, 'RAW');
    assert.equal(typed[0].length, 66);
    assert.equal(client.calls.some((c) => c.MessageType === 'DIGEST'), false);
    await assert.rejects(kms.sign(Buffer.alloc(66, 0x19)), (err) => err.code === 'issuer_sign_refused');

    await withFlag('true', async () => {
      const throttled = kmsClient({ throttleTyped: true });
      const kms2 = await createKmsSigner({ client: throttled, env: process.env });
      _setIssuerSignerForTest(kms2);
      const { out, dir } = await runScenario({ ReceiptMerkleTree, prepare: makeReady });
      assert.equal(out.heads.length, 2);
      for (const head of out.heads) assert.ok(head.issuer_signature.jws);
      assert.equal(readFixedRows(dir).length, 0);
    });
  } finally {
    process.env = saved;
    resetIssuerSigner();
  }
});

// ---------------------------------------------------------------- G16 cap

test('G16: fixed-head signs do not change the receipt issuance cap', async () => {
  installStub();
  const before = issuanceCapHealth();
  const leaves = leavesN(6);
  for (let n = 1; n <= 6; n += 1) {
    const res = await T.signFixedHead(claimsFor({ size: n, root: hex(rootOf(leaves.slice(0, n))) }), ctxFor(leaves));
    assert.ok(res.fixed_head);
  }
  const after = issuanceCapHealth();
  assert.equal(after.hour_used, before.hour_used);
  assert.equal(after.day_used, before.day_used);
});

test('scenario times are fixed', () => {
  assert.equal(SCENARIO_TIMES.first < SCENARIO_TIMES.second, true);
});
