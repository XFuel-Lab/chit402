/**
 * Durable receipt log: restart, fail closed, no publish on read,
 * anchor guard, epoch rebuild, S3 bundle restore, book forks.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  ReceiptMerkleTree,
  bootReceiptLog,
  resetReceiptMerkleTree,
  rootOf,
  anchorPrevRoot,
  ReceiptLogRefused,
} = await import('../src/receipt-merkle.js');
const {
  EPOCH1_FINAL_ROOT,
  EPOCH1_GENESIS_DIGEST,
  EPOCH2_OPENING_ROOT,
  checkEpochLinks,
  epochRecordClaims,
  genesisBytes,
  epochLeafHash,
  rebuildEpoch1FromRows,
} = await import('../src/receipt-log-epoch.js');
const { writeRestoredEpochs } = await import('../src/receipt-log-store.js');
const {
  publishTreeBundle,
  restoreFromS3,
  bundleIndexHash,
} = await import('../src/receipt-log-s3.js');
const { analyzeSeq } = await import('../src/book-seq.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');
const { signJws, getIssuerPublicKeyJwk } = await import('../src/issuer-key.js');
const { base58Encode } = await import('../src/solana-receipt-anchor.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-log-'));
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function solanaKeypair() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const spki = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const publicKey = Buffer.from(spki.subarray(spki.length - 32));
  const secret = Buffer.concat([Buffer.from(seed), publicKey]);
  return { json: JSON.stringify([...secret]) };
}

function mockConnection() {
  const sent = [];
  return {
    sent,
    async getLatestBlockhash() {
      return { blockhash: base58Encode(Buffer.alloc(32, 7)) };
    },
    async sendRawTransaction(raw) {
      sent.push(Buffer.from(raw));
      return base58Encode(Buffer.alloc(64, sent.length));
    },
    async confirmTransaction() {
      return { slot: 7 };
    },
  };
}

test('append, restart, and the recomputed root matches', () => {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('r1', 'h1');
  tree.appendReceipt('r2', 'h2');
  const root = hex(rootOf(tree.leaves));
  const again = new ReceiptMerkleTree();
  again.load(dir);
  assert.equal(hex(rootOf(again.leaves)), root);
  assert.equal(again.leaves.length, tree.leaves.length);
  const genesis = JSON.parse(Buffer.from(again.meta[0].preimage_b64, 'base64').toString('utf8'));
  assert.equal(genesis.verifier_binary_build_digest, JSON.parse(tree.genesisLeaf().bytes.toString()).verifier_binary_build_digest);
  assert.equal(again.inclusion('r2').root, root);
});

test('a corrupt journal refuses to load and the server refuses to start', async () => {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('r1', 'h1');
  fs.appendFileSync(path.join(dir, 'journal.jsonl'), '{not-json\n');
  assert.throws(() => new ReceiptMerkleTree().load(dir), (err) => {
    assert.equal(err instanceof ReceiptLogRefused, true);
    assert.equal(err.code, 'corrupt_journal');
    return true;
  });
  const prev = process.env.RECEIPT_LOG_DIR;
  process.env.RECEIPT_LOG_DIR = dir;
  try {
    const { createApp } = await import('../src/server.js');
    assert.throws(() => createApp(), (err) => err.code === 'corrupt_journal');
  } finally {
    if (prev == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prev;
    resetReceiptMerkleTree();
  }
});

test('missing journal beside an anchored head refuses to start', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'anchor-state.json'), JSON.stringify({
    schema: 'chit402.receipt_anchor_state.v1',
    solana: { 'global|2026-10-05': { status: 'anchored', signature: 'sig' } },
    base: {},
  }));
  assert.throws(() => bootReceiptLog(dir), (err) => err.code === 'missing_log');
  resetReceiptMerkleTree();
});

test('a public head read on an empty log does not publish', async () => {
  const dir = tmp();
  const prev = process.env.RECEIPT_LOG_DIR;
  process.env.RECEIPT_LOG_DIR = dir;
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/v1/receipts/tree/head`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.published, false);
    assert.equal(body.status, 'not_yet_published');
    assert.equal(body.issuer_signature, undefined);
    assert.equal(fs.existsSync(path.join(dir, 'journal.jsonl')), false);
    const inclusion = await fetch(`${base}/v1/receipts/not-a-leaf/inclusion`);
    assert.equal(inclusion.status, 404);
    const consistency = await fetch(`${base}/v1/receipts/tree/consistency?first=1&second=1`);
    assert.equal(consistency.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prev == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prev;
    resetReceiptMerkleTree();
  }
});

test('the one-anchor-per-day guard survives a restart', async () => {
  const dir = tmp();
  const kp = solanaKeypair();
  const prevKey = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevRpc = process.env.SOLANA_RPC_URL;
  const prevCluster = process.env.SOLANA_ANCHOR_CLUSTER;
  process.env.SOLANA_ANCHOR_SECRET_KEY = kp.json;
  process.env.SOLANA_ANCHOR_CLUSTER = 'devnet';
  delete process.env.SOLANA_RPC_URL;
  delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  try {
    const firstConn = mockConnection();
    const tree = new ReceiptMerkleTree();
    tree.dir = dir;
    tree.appendReceipt('row-1', 'hash-1');
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      solanaConnection: firstConn,
    });
    assert.equal(head.anchors.solana.status, 'anchored');
    assert.equal(firstConn.sent.length, 1);
    assert.equal(anchorPrevRoot([], head.root), '0'.repeat(64));
    const secondConn = mockConnection();
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    assert.equal(hex(rootOf(restored.leaves)), head.root);
    const again = await restored.publishHead({
      force: true,
      now: '2026-10-06T18:00:00.000Z',
      solanaConnection: secondConn,
    });
    assert.equal(secondConn.sent.length, 0);
    assert.equal(again.anchors.solana.signature, head.anchors.solana.signature);
  } finally {
    if (prevKey == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
    else process.env.SOLANA_ANCHOR_SECRET_KEY = prevKey;
    if (prevRpc == null) delete process.env.SOLANA_RPC_URL;
    else process.env.SOLANA_RPC_URL = prevRpc;
    if (prevCluster == null) delete process.env.SOLANA_ANCHOR_CLUSTER;
    else process.env.SOLANA_ANCHOR_CLUSTER = prevCluster;
  }
});

test('epoch 1 rebuild matches a synthetic fixture and refuses the historical root', () => {
  const rows = [
    { task_id: 'older', row_hash: 'nope' },
    { task_id: 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af', row_hash: 'row-1' },
    { task_id: 'leaf-2', row_hash: 'row-2' },
    { task_id: 'leaf-3', row_hash: 'row-3' },
  ];
  const preimages = [
    genesisBytes(EPOCH1_GENESIS_DIGEST),
    Buffer.from(`${rows[1].task_id}|${rows[1].row_hash}`),
    Buffer.from(`${rows[2].task_id}|${rows[2].row_hash}`),
    Buffer.from(`${rows[3].task_id}|${rows[3].row_hash}`),
  ];
  const want = hex(rootOf(preimages.map((body) => epochLeafHash(body))));
  const rebuilt = rebuildEpoch1FromRows(rows, { expectRoot: want });
  assert.equal(rebuilt.root, want);
  assert.equal(rebuilt.tree_size, 4);
  assert.equal(rebuilt.rows[0].task_id, rows[1].task_id);
  assert.throws(() => rebuildEpoch1FromRows(rows), (err) => err.code === 'epoch1_root_mismatch');
  assert.equal(EPOCH1_FINAL_ROOT, 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973');
  assert.equal(epochLeafHash(genesisBytes('847edd6698d938721c0c59466a601d65cb82c1fdc0abd80104e1132f0cbaa576')).toString('hex'), EPOCH2_OPENING_ROOT);

  const dir = tmp();
  const claims = epochRecordClaims({ epoch1Root: want, epoch1Size: 4 });
  claims.epochs = [claims.epochs[0]];
  claims.orphans = [];
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-epoch+jwt' });
  const record = writeRestoredEpochs(dir, rebuilt, {
    signRecord: () => ({
      ...claims,
      issuer_signature: {
        alg: 'ES256',
        typ: 'chit402-tree-epoch+jwt',
        payload_version: 1,
        jws,
        kid,
        issuer_jwk: getIssuerPublicKeyJwk(),
      },
    }),
  });
  assert.equal(record.issuer_signature.jws, jws);
  const loaded = new ReceiptMerkleTree();
  loaded.load(dir);
  assert.equal(hex(rootOf(loaded.leaves)), want);
  assert.equal(loaded.epoch, 1);
  const links = checkEpochLinks(epochRecordClaims());
  assert.equal(links.ok, true);
  assert.equal(epochRecordClaims().epochs[1].prev_epoch_root, EPOCH1_FINAL_ROOT);
  assert.equal(epochRecordClaims().epochs[1].prev_epoch_size, 4);
  assert.equal(epochRecordClaims().orphans.some((row) => row.root_prefix === 'd7f6c548'), true);
  assert.equal(epochRecordClaims().orphans.some((row) => row.root === EPOCH2_OPENING_ROOT), true);
});

test('S3 bundle round-trip restores the log and checks the anchored root', async () => {
  const objects = new Map();
  const client = {
    async send(command) {
      const input = command.input;
      if (input.Body) {
        assert.equal(input.ObjectLockMode, 'COMPLIANCE');
        assert.ok(input.ObjectLockRetainUntilDate instanceof Date);
        objects.set(input.Key, Buffer.from(input.Body));
        return {};
      }
      const body = objects.get(input.Key);
      if (!body) throw new Error(`missing ${input.Key}`);
      return { Body: { transformToByteArray: async () => body } };
    },
  };
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('bundled', 'hh');
  const root = hex(rootOf(tree.leaves));
  const uploaded = await publishTreeBundle(tree, {
    client,
    bucket: 'receipt-log-test',
    prefix: 'receipt-log/',
    retentionDays: 30,
    receipts: [{ task_id: 'bundled', row_hash: 'hh' }],
    now: new Date('2026-10-06T15:10:00.000Z'),
  });
  assert.equal(objects.size, 2);
  assert.equal(uploaded.index.bundles[0].sha256.length, 64);
  assert.equal(bundleIndexHash(uploaded.index), uploaded.index_hash);
  const restored = await restoreFromS3({
    client,
    bucket: 'receipt-log-test',
    prefix: 'receipt-log/',
    expectRoots: [{ epoch: 1, tree_size: tree.leaves.length, root }],
  });
  assert.equal(restored.epochs[0].root, root);
  objects.set(uploaded.key, Buffer.from('tampered'));
  await assert.rejects(
    () => restoreFromS3({ client, bucket: 'receipt-log-test', prefix: 'receipt-log/' }),
    /bundle_hash_mismatch/,
  );
});

test('duplicate seq and a prev_hash mismatch mark the book FORKED', () => {
  const chain = analyzeSeq([
    { seq: 1, prev_hash: null, row_hash: 'aa' },
    { seq: 2, prev_hash: 'aa', row_hash: 'bb' },
  ]);
  assert.equal(chain.gapless, true);
  assert.equal(chain.status, 'ok');

  const dup = analyzeSeq([
    { seq: 1, prev_hash: null, row_hash: 'aa', task_id: 'a' },
    { seq: 1, prev_hash: null, row_hash: 'zz', task_id: 'b' },
  ]);
  assert.equal(dup.forked, true);
  assert.equal(dup.status, 'FORKED');
  assert.equal(dup.gapless, false);
  assert.deepEqual(dup.duplicates, [1]);

  const mismatch = analyzeSeq([
    { seq: 1, prev_hash: null, row_hash: 'aa' },
    { seq: 2, prev_hash: 'not-aa', row_hash: 'bb' },
  ]);
  assert.equal(mismatch.status, 'FORKED');
  assert.equal(mismatch.prev_hash_mismatches.length, 1);

  const dir = tmp();
  const first = { agent_id: 7, task_id: 't-tip', payment_ref: 'base:0x1', seq: 2, prev_hash: 'aa', row_hash: 'bb', event: 'collected' };
  const earlier = { agent_id: 7, task_id: 't-early', payment_ref: 'base:0x0', seq: 1, prev_hash: null, row_hash: 'aa', event: 'collected' };
  const copy = { agent_id: 7, task_id: 't-tip', payment_ref: 'base:0x1', seq: 2, prev_hash: 'aa', row_hash: 'cc', event: 'collected' };
  fs.writeFileSync(
    path.join(dir, 'usage-settled.jsonl'),
    [first, earlier, copy].map((row) => JSON.stringify(row)).join('\n') + '\n',
  );
  const ledger = new UsageSettledLedger({ dir, persist: true });
  assert.equal(ledger.findByTask('t-tip').row_hash, 'bb');
  const stamped = { agent_id: 7, task_id: 't-next', payment_ref: 'base:0x2', event: 'collected' };
  ledger._stampSeq(stamped);
  assert.equal(stamped.seq, 3);
  assert.equal(stamped.prev_hash, 'bb');
  const report = ledger.seqReport(7);
  assert.equal(report.status, 'FORKED');
  assert.ok(report.duplicate_rows.some((row) => row.kind === 'duplicate_seq' || row.kind === 'duplicate_task_id'));
});
