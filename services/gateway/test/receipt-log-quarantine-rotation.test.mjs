/**
 * Stored heads survive an issuer key rotation. A matching head is not
 * re-verified at boot. A raced head signed by a retired key listed in
 * ISSUER_HISTORY_EXTRA stays quarantined. A revoked key, a wrong typ and an
 * empty-prefix root still refuse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

const { ReceiptMerkleTree, resetReceiptMerkleTree, rootOf } = await import('../src/receipt-merkle.js');
const { epochRootOf } = await import('../src/receipt-log-epoch.js');
const { readReceiptLog, appendJournal } = await import('../src/receipt-log-store.js');
const { signJws, getIssuerPublicKeyJwk, _resetIssuerKey } = await import('../src/issuer-key.js');

const hex = (b) => Buffer.from(b).toString('hex');
const pem = () => Buffer.from(crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64');
const KEY_A = pem();
const KEY_B = pem();

function useKey(k) {
  process.env.ISSUER_PRIVATE_KEY = k;
  _resetIssuerKey();
}

function opts(now, nonce) {
  return {
    force: true,
    now,
    nonce,
    blockTimestamp: Math.floor(Date.parse(now) / 1000),
    lookup: async (i) => ({ receiptOk: true, receiptStatus: '0x1', tx: i.tx, root: i.root, from: i.from, to: i.to, nonce: i.nonce }),
    send: async (a) => a.hash,
  };
}

function racedHead(tree, size, root, typ = 'chit402-tree-head+jwt') {
  const claims = {
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: tree.epoch,
    prev_epoch_root: tree.prevEpochRoot,
    prev_epoch_size: tree.prevEpochSize,
    prev_root: '0'.repeat(64),
    tree_size: size,
    root,
    anchor_status: 'anchored',
    published_at: '2026-10-09T10:23:55.000Z',
  };
  const { jws, kid } = signJws(claims, { typ });
  return { ...claims, issuer_signature: { alg: 'ES256', typ, payload_version: 2, jws, kid } };
}

async function journal({ raced = true, typ } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chit-rotation-'));
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  for (const id of ['a', 'b', 'c']) tree.appendReceipt(id, `r${id}`, { publish: false });
  await tree.publishHead(opts('2026-10-08T05:32:00.000Z', 4));
  for (const id of ['d', 'e']) tree.appendReceipt(id, `r${id}`, { publish: false });
  if (raced) {
    const head = racedHead(tree, 6, hex(rootOf(tree.leaves.slice(0, 5))), typ);
    appendJournal(dir, { v: 1, op: 'head', epoch: tree.epoch, head });
  }
  await tree.publishHead(opts('2026-10-09T10:23:56.000Z', 5));
  return { dir, tree };
}

function withEnv(fn) {
  const saved = { ...process.env };
  process.env.RECEIPT_LOG_BOOT = '0';
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.ISSUER_HISTORY_EXTRA;
  useKey(KEY_A);
  return Promise.resolve().then(fn).finally(() => {
    process.env = saved;
    _resetIssuerKey();
    resetReceiptMerkleTree();
  });
}

test('matching heads signed by a rotated-out key still load', () => withEnv(async () => {
  const { dir } = await journal({ raced: false });
  useKey(KEY_B);
  const loaded = readReceiptLog(dir);
  assert.deepEqual(loaded.epochs.at(-1).heads.map((h) => h.tree_size), [4, 6]);
}));

test('a raced head signed by a retired key in ISSUER_HISTORY_EXTRA stays quarantined', () => withEnv(async () => {
  const { dir } = await journal();
  const retired = getIssuerPublicKeyJwk();
  useKey(KEY_B);
  assert.throws(() => readReceiptLog(dir), (err) => err.code === 'head_signature');
  process.env.ISSUER_HISTORY_EXTRA = JSON.stringify([{ kid: retired.kid, jwk: retired, status: 'retired' }]);
  const loaded = readReceiptLog(dir);
  assert.equal(loaded.epochs.at(-1).quarantinedHeads.length, 1);
  process.env.ISSUER_HISTORY_EXTRA = JSON.stringify([{ kid: retired.kid, jwk: retired, status: 'revoked' }]);
  assert.throws(() => readReceiptLog(dir), (err) => err.code === 'head_signature');
}));

test('a raced head with a non tree-head typ refuses', () => withEnv(async () => {
  const { dir } = await journal({ typ: 'chit402-tree-epoch+jwt' });
  assert.throws(() => readReceiptLog(dir), (err) => err.code === 'head_signature' && /wrong_typ/.test(err.message));
}));

test('a head whose root is the empty-prefix root refuses', () => withEnv(async () => {
  const { dir, tree } = await journal({ raced: false });
  const head = racedHead(tree, 6, hex(epochRootOf([])));
  appendJournal(dir, { v: 1, op: 'head', epoch: tree.epoch, head });
  assert.throws(() => readReceiptLog(dir), (err) => err.code === 'root_mismatch');
}));
