/**
 * Durable receipt log: restart, fail closed, no publish on read,
 * anchor guard, epoch rebuild, S3 bundle restore, book forks.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const gatewayRoot = fileURLToPath(new URL('..', import.meta.url));

const {
  ReceiptMerkleTree,
  bootReceiptLog,
  getReceiptMerkleTree,
  resetReceiptMerkleTree,
  baseAnchorSigner,
  assertAnchorFeeCaps,
  rootOf,
  anchorPrevRoot,
  ReceiptLogRefused,
  closedEpochAnchorPair,
  signPinnedClosedHead,
  EPOCH1_FINAL_SOLANA_MEMO,
  verifyTreeHead,
  readReceiptLogPin,
} = await import('../src/receipt-merkle.js');
const {
  EPOCH1_FINAL_ROOT,
  EPOCH1_GENESIS_DIGEST,
  EPOCH1_SIZE1_ROOT,
  EPOCH1_SIZE2_ROOT,
  matchEpoch1Prefix,
  EPOCH2_GENESIS_DIGEST,
  EPOCH2_OPENING_ROOT,
  checkEpochLinks,
  epochRecordClaims,
  epochRecordWithUnlogged,
  attestedUnloggedEntry,
  genesisBytes,
  epochLeafHash,
  rebuildEpoch1FromRows,
} = await import('../src/receipt-log-epoch.js');
const { writeRestoredEpochs } = await import('../src/receipt-log-store.js');
const {
  publishTreeBundle,
  restoreFromS3,
  bundleIndexHash,
  retentionPolicyFrom,
} = await import('../src/receipt-log-s3.js');
const { analyzeSeq } = await import('../src/book-seq.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');
const { signJws, getIssuerPublicKeyJwk } = await import('../src/issuer-key.js');
const { base58Encode } = await import('../src/solana-receipt-anchor.js');
const { assertLatestBaseAnchor, planReceiptBackfill } = await import('../src/receipt-log-anchor.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-log-'));
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function anchoredHead({ root, treeSize, bundleIndexHash, epoch = 1 }) {
  return {
    schema: 'chit402.tree_head.v2',
    epoch,
    root,
    tree_size: treeSize,
    bundle_index_hash: bundleIndexHash,
    anchors: { base: { status: 'anchored', tx: `0x${'11'.repeat(32)}` } },
    issuer_signature: { jws: 'a.b.c' },
  };
}

function lockingClient(objects, mode = 'COMPLIANCE') {
  return {
    async send(command) {
      const name = command.constructor?.name || '';
      const input = command.input || {};
      if (name === 'GetObjectRetentionCommand') {
        return { Retention: { Mode: mode, RetainUntilDate: new Date(Date.now() + 86400000) } };
      }
      if (name === 'HeadObjectCommand') {
        if (!objects.has(input.Key)) {
          const err = new Error('NotFound');
          err.name = 'NotFound';
          throw err;
        }
        return {};
      }
      if (input.Body) {
        if (mode === 'COMPLIANCE') {
          assert.equal(input.ObjectLockMode, 'COMPLIANCE');
          assert.ok(input.ObjectLockRetainUntilDate instanceof Date);
        }
        objects.set(input.Key, Buffer.from(input.Body));
        return {};
      }
      const body = objects.get(input.Key);
      if (!body) throw new Error(`missing ${input.Key}`);
      return { Body: { transformToByteArray: async () => body } };
    },
  };
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

test('an empty directory with the pin refuses to start', async () => {
  const dir = tmp();
  assert.throws(() => bootReceiptLog(dir), (err) => err.code === 'pin_unmet');
  const prev = process.env.RECEIPT_LOG_DIR;
  process.env.RECEIPT_LOG_DIR = dir;
  try {
    const { createApp } = await import('../src/server.js');
    assert.throws(() => createApp(), (err) => err.code === 'pin_unmet');
  } finally {
    if (prev == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prev;
    resetReceiptMerkleTree();
  }
});

test('an empty directory with the fresh-genesis flag boots and logs loudly', async () => {
  const dir = tmp();
  const prevFlag = process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS;
  const prevDir = process.env.RECEIPT_LOG_DIR;
  process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS = 'YES_I_ACCEPT_A_NEW_PUBLIC_RECEIPT_LOG';
  process.env.RECEIPT_LOG_DIR = dir;
  try {
    const { createApp } = await import('../src/server.js');
    const app = createApp();
    const tree = (await import('../src/receipt-merkle.js')).getReceiptMerkleTree();
    assert.equal(tree.allowFreshGenesis, true);
    assert.ok(tree.bootWarnings.some((line) => /FRESH GENESIS/.test(line)));
    assert.ok(tree.bootWarnings.some((line) => line.includes('YES_I_ACCEPT_A_NEW_PUBLIC_RECEIPT_LOG')));
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const res = await fetch(`${base}/v1/receipts/tree/head`);
      const body = await res.json();
      assert.equal(body.published, false);
      assert.equal(body.status, 'not_yet_published');
      assert.equal(body.issuer_signature, undefined);
      assert.equal(body.receipt_log.consecutive_failures, 0);
      assert.equal(body.receipt_log.last_bundle_ok_at, null);
      assert.equal(body.receipt_log.blocked_intents, 0);
      assert.equal(body.receipt_log.pending_intents, 0);
      assert.equal(body.receipt_log.oldest_blocked_age_s, null);
      assert.equal(body.receipt_log.last_anchored_root, null);
      assert.equal(body.receipt_log.last_anchored_tx, null);
      assert.equal(body.receipt_log.last_error, null);
      assert.equal(fs.existsSync(path.join(dir, 'journal.jsonl')), false);
      const health = await fetch(`${base}/health`);
      const healthBody = await health.json();
      assert.equal(healthBody.receipt_log.consecutive_failures, 0);
      assert.equal(healthBody.receipt_log.last_bundle_ok_at, null);
      assert.equal(healthBody.receipt_log.blocked_intents, 0);
      assert.equal(healthBody.receipt_log.pending_intents, 0);
      assert.equal(healthBody.receipt_log.last_error, null);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    if (prevFlag == null) delete process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS;
    else process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS = prevFlag;
    if (prevDir == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prevDir;
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
  const client = lockingClient(objects);
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
  const head = anchoredHead({
    root,
    treeSize: tree.leaves.length,
    bundleIndexHash: uploaded.index_hash,
    epoch: tree.epoch,
  });
  const restored = await restoreFromS3({
    client,
    bucket: 'receipt-log-test',
    prefix: 'receipt-log/',
    indexKey: uploaded.index_key,
    head,
    expectRoots: [{ epoch: 1, tree_size: tree.leaves.length, root }],
  });
  assert.equal(restored.epochs[0].root, root);
  objects.set(uploaded.key, Buffer.from('tampered'));
  await assert.rejects(
    () => restoreFromS3({
      client,
      bucket: 'receipt-log-test',
      prefix: 'receipt-log/',
      indexKey: uploaded.index_key,
      head,
    }),
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

test('a non-empty journal that is not the pinned epoch refuses to boot', () => {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('not-the-historical-log', 'zz', { publish: false });
  assert.throws(() => bootReceiptLog(dir), (err) => err.code === 'pin_unmet');
  resetReceiptMerkleTree();
});

test('anchor-state.json keys are not proof a root is in the log', async () => {
  const { knownHeadRoots } = await import('../src/receipt-log-anchor.js');
  const tree = new ReceiptMerkleTree();
  tree.anchorState.base['aa'.repeat(32)] = { status: 'anchored', tx: '0x' + '11'.repeat(32) };
  assert.equal(knownHeadRoots(tree).has('aa'.repeat(32)), false);
});

test('an on-chain root missing from the journal refuses boot', async () => {
  const tree = new ReceiptMerkleTree();
  tree.heads.push({ root: 'aa'.repeat(32), tree_size: 1, epoch: 2 });
  await assert.rejects(
    () => assertLatestBaseAnchor(tree, { readLatest: async () => ({ root: 'bb'.repeat(32), tx: '0x' + '11'.repeat(32) }) }),
    (err) => err.code === 'anchor_not_in_journal',
  );
  await assertLatestBaseAnchor(tree, { readLatest: async () => ({ root: 'aa'.repeat(32), tx: '0x' + '22'.repeat(32) }) });
  tree.allowFreshGenesis = true;
  const { finishReceiptLogBoot } = await import('../src/receipt-merkle.js');
  await finishReceiptLogBoot(tree, { readLatest: async () => ({ root: 'cc'.repeat(32) }) });
});

test('boot refuses when RECEIPT_ANCHOR_FROM disagrees with the private key', () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevFrom = process.env.RECEIPT_ANCHOR_FROM;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.RECEIPT_ANCHOR_FROM = '0x0000000000000000000000000000000000000001';
  try {
    assert.throws(() => bootReceiptLog(tmp()), (err) => err.code === 'anchor_sender_mismatch');
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevFrom == null) delete process.env.RECEIPT_ANCHOR_FROM;
    else process.env.RECEIPT_ANCHOR_FROM = prevFrom;
  }
});

test('the anchor sender is the private key when RECEIPT_ANCHOR_FROM is unset', async () => {
  const { resolveAnchorSender } = await import('../src/receipt-log-anchor.js');
  const { Wallet } = await import('ethers');
  const key = `0x${'ab'.repeat(32)}`;
  assert.equal(resolveAnchorSender({ RECEIPT_ANCHOR_PRIVATE_KEY: key }), new Wallet(key).address);
});

test('an anchor intent is fsynced before broadcast and a crash does not send twice', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  let sawIntent = false;
  try {
  const head = await tree.publishHead({
    force: true,
    now: '2026-10-06T12:00:00.000Z',
    nonce: 4,
    send: async (args) => {
      const journal = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8');
      sawIntent = journal.includes('"op":"anchor_intent"') && journal.includes('"nonce":4');
      assert.equal(args.nonce, 4);
      throw new Error('crash_before_hash');
    },
  });
  assert.equal(sawIntent, true);
  assert.equal(head.anchor_status, 'blocked');
  const restored = new ReceiptMerkleTree();
  restored.load(dir);
  const found = '0x' + 'ab'.repeat(32);
  await restored.reconcileAnchorIntents({
    lookup: async (intent) => {
      assert.equal(intent.nonce, 4);
      assert.equal(intent.root, root);
      assert.equal(intent.status === 'signed' || intent.status === 'blocked', true);
      assert.match(intent.raw, /^0x/);
      return { tx: found, root, nonce: 4, receiptOk: true, from: intent.from, to: intent.to };
    },
  });
  const again = await restored.publishHead({
    force: true,
    now: '2026-10-06T12:30:00.000Z',
    blockTimestamp: Math.floor(Date.parse('2026-10-06T12:30:00.000Z') / 1000),
    lookup: async (intent) => ({
      tx: found,
      root,
      nonce: 4,
      receiptOk: true,
      from: intent.from,
      to: intent.to,
    }),
  });
  assert.equal(again.anchor.tx, found);
  const intents = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('"op":"anchor_intent"') && line.includes('"status":"intent"'));
  assert.equal(intents.length, 1);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('backfill lists rows after epoch 1 and --apply writes them without publishing', () => {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('epoch1-leaf', 'h1', { publish: false });
  tree.closedEpochs.push({
    epoch: 1,
    status: 'closed',
    meta: tree.meta.map((row) => ({ ...row })),
    leaves: tree.leaves.slice(),
    heads: [],
    byTask: new Map(tree.byTask),
  });
  tree.epoch = 2;
  tree.leaves = [];
  tree.meta = [];
  tree.byTask = new Map();
  tree._epochOpened = false;
  const rows = [
    { agent_id: 7, task_id: 'before', seq: 1, prev_hash: null, row_hash: 'old' },
    { agent_id: 7, task_id: 'epoch1-leaf', seq: 2, prev_hash: 'old', row_hash: 'h1' },
    { agent_id: 7, task_id: 'after-1', seq: 3, prev_hash: 'h1', row_hash: 'n1' },
    { agent_id: 7, task_id: 'after-2', seq: 4, prev_hash: 'n1', row_hash: 'n2' },
  ];
  const plan = planReceiptBackfill(tree, rows);
  assert.deepEqual(plan.append.map((row) => row.task_id), ['after-1', 'after-2']);
  const headsBefore = tree.heads.length;
  for (const row of plan.append) tree.appendReceipt(row.task_id, row.row_hash, { publish: false });
  assert.equal(tree.heads.length, headsBefore);
  assert.equal(tree.inclusion('after-2').epoch, 2);
  assert.equal(tree.inclusion('after-1').leaf_index > 0, true);
});

test('a bundle upload failure is counted and a retention policy is hashed into the index', async () => {
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('bundled-fail', 'hh', { publish: false });
  await assert.rejects(
    () => publishTreeBundle(tree, {
      client: { send: async () => { throw new Error('s3 down'); } },
      bucket: 'receipt-log-test',
      prefix: 'receipt-log/',
      retentionDays: 30,
      now: new Date('2026-10-06T16:00:00.000Z'),
    }),
    /s3 down/,
  );
  tree.noteBundleFailure();
  assert.equal(tree.bundleStatus().consecutive_failures, 1);
  assert.equal(tree.bundleStatus().last_bundle_ok_at, null);
  const policy = retentionPolicyFrom({
    retentionPolicyId: 'retention-2026',
    retentionPolicySha256: 'ab'.repeat(32),
  });
  assert.equal(policy.id, 'retention-2026');
  const objects = new Map();
  const client = lockingClient(objects);
  const ok = new ReceiptMerkleTree();
  ok.appendReceipt('bundled-ok', 'hh', { publish: false });
  const uploaded = await publishTreeBundle(ok, {
    client,
    bucket: 'receipt-log-test',
    prefix: 'receipt-log/',
    retentionDays: 30,
    now: new Date('2026-10-06T16:10:00.000Z'),
    retentionPolicyId: 'retention-2026',
    retentionPolicySha256: 'ab'.repeat(32),
  });
  assert.equal(uploaded.index.retention_policy.sha256, 'ab'.repeat(32));
  assert.equal(bundleIndexHash(uploaded.index), uploaded.index_hash);
  assert.equal(typeof uploaded.index.last_bundle_ok_at, 'string');
  assert.equal(ok.bundleStatus().consecutive_failures, 0);
  const bare = { schema: uploaded.index.schema, bundles: uploaded.index.bundles };
  assert.notEqual(bundleIndexHash(bare), uploaded.index_hash);
});

function anchorIntentRows(dir) {
  return fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.op === 'anchor_intent');
}

test('a mined anchor is adopted only when calldata, sender, to, and receipt status match', async () => {
  const { lookupBaseTxByNonceOrHash } = await import('../src/receipt-log-anchor.js');
  const { Wallet } = await import('ethers');
  const root = 'ab'.repeat(32);
  const from = new Wallet(`0x${'ab'.repeat(32)}`).address.toLowerCase();
  const txHash = `0x${'11'.repeat(32)}`;
  const wrong = '0x2222222222222222222222222222222222222222';
  async function lookupInput(input, { txFrom = from, txTo = from, status = '0x1' } = {}) {
    return lookupBaseTxByNonceOrHash({
      txHash,
      nonce: 4,
      from,
      to: from,
      root,
      request: async (_url, method) => {
        if (method === 'eth_getTransactionByHash') {
          return { hash: txHash, from: txFrom, to: txTo, nonce: '0x4', input };
        }
        if (method === 'eth_getTransactionReceipt') return { status };
        throw new Error(`unexpected ${method}`);
      },
    });
  }
  const adopted = await lookupInput(`0x${root}`);
  assert.equal(adopted.receiptOk, true);
  assert.equal(adopted.tx, txHash);
  assert.equal(adopted.root, root);
  for (const input of ['0x', `0x${'ab'.repeat(80)}`]) {
    const mined = await lookupInput(input);
    assert.equal(mined.replaced, true);
    assert.equal(mined.receiptOk, undefined);
    assert.equal(mined.reason, 'calldata_replaced');
  }
  const wrongTo = await lookupInput(`0x${root}`, { txTo: wrong });
  assert.equal(wrongTo.replaced, true);
  assert.equal(wrongTo.reason, 'to_mismatch');
  const wrongFrom = await lookupInput(`0x${root}`, { txFrom: wrong });
  assert.equal(wrongFrom.replaced, true);
  assert.equal(wrongFrom.reason, 'from_mismatch');

  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.anchorIntents.push({
    chain: 'base',
    day: '2026-10-06',
    root,
    nonce: 4,
    tx: txHash,
    from,
    to: from,
    raw: '0x02',
    status: 'signed',
  });
  await tree.reconcileAnchorIntents({
    lookup: async () => lookupInput('0x'),
  });
  assert.equal(tree.anchorState.base[root], undefined);
  assert.equal(anchorIntentRows(dir).some((row) => row.status === 'replaced'), true);
  assert.equal(anchorIntentRows(dir).some((row) => row.status === 'anchored'), false);
});

test('ots is optional and a normal RPC recovers by hash and transaction count', async () => {
  const { lookupBaseTxByNonceOrHash } = await import('../src/receipt-log-anchor.js');
  const from = '0xe239cdc5fbe977a8a141b72194d3cf8c41bc5bc6';
  const root = 'ab'.repeat(32);
  const txHash = `0x${'11'.repeat(32)}`;
  const missing = await lookupBaseTxByNonceOrHash({
    txHash,
    nonce: 4,
    from,
    to: from,
    root,
    request: async (_url, method) => {
      if (method === 'eth_getTransactionByHash') return null;
      if (method === 'ots_getTransactionBySenderAndNonce') throw new Error('method not found');
      if (method === 'eth_getTransactionCount') return '0x4';
      throw new Error(`unexpected ${method}`);
    },
  });
  assert.equal(missing.rebroadcast, true);
  assert.equal(missing.replaced, undefined);
  const consumed = await lookupBaseTxByNonceOrHash({
    txHash,
    nonce: 4,
    from,
    to: from,
    root,
    request: async (_url, method) => {
      if (method === 'eth_getTransactionByHash') return null;
      if (method === 'eth_getTransactionCount') return '0x5';
      throw new Error(`unexpected ${method}`);
    },
  });
  assert.equal(consumed.replaced, true);
  assert.equal(consumed.reason, 'nonce_consumed');
  const errored = await lookupBaseTxByNonceOrHash({
    txHash,
    nonce: 4,
    from,
    to: from,
    root,
    request: async () => {
      throw new Error('connection refused');
    },
  });
  assert.equal(errored.blocked, true);
  assert.equal(errored.replaced, undefined);
  assert.equal(errored.rebroadcast, undefined);
});

test('crash after the signed raw tx is persisted and before send rebroadcasts that same raw tx', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  let persisted = null;
  try {
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async (args) => {
        persisted = anchorIntentRows(dir).find((row) => row.status === 'signed');
        assert.equal(args.nonce, 4);
        assert.equal(args.raw, persisted.raw);
        assert.equal(args.hash, persisted.tx);
        throw new Error('crash_before_send');
      },
    });
    assert.equal(head.anchor_status, 'blocked');
    assert.ok(persisted.raw);
    assert.match(persisted.tx, /^0x[0-9a-f]{64}$/);
    const { keccak256 } = await import('ethers');
    assert.equal(persisted.tx, keccak256(persisted.raw));
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    let resent = null;
    await restored.publishHead({
      force: true,
      now: '2026-10-06T12:30:00.000Z',
      nonce: 99,
      lookup: async (intent) => {
        assert.equal(intent.raw, persisted.raw);
        assert.equal(intent.tx, persisted.tx);
        assert.equal(intent.nonce, 4);
        return { rebroadcast: true, missing: true, tx: intent.tx, nonce: 4 };
      },
      send: async (args) => {
        resent = args.raw;
        assert.equal(args.nonce, 4);
        assert.equal(args.hash, persisted.tx);
        return args.hash;
      },
    });
    assert.equal(resent, persisted.raw);
    const signed = anchorIntentRows(dir).filter((row) => row.status === 'signed');
    assert.equal(signed.length, 1);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('crash after send and before the broadcast record still has the tx hash and does not sign again', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  let persisted = null;
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => {
        persisted = anchorIntentRows(dir).find((row) => row.status === 'signed');
        assert.ok(persisted.tx);
        assert.equal(anchorIntentRows(dir).some((row) => row.status === 'broadcast'), false);
        throw new Error('crash_after_send');
      },
    });
    const from = persisted.from.toLowerCase();
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    let sentAgain = false;
    const again = await restored.publishHead({
      force: true,
      now: '2026-10-06T12:30:00.000Z',
      nonce: 99,
      blockTimestamp: Math.floor(Date.parse('2026-10-06T12:30:00.000Z') / 1000),
      lookup: async (intent) => {
        assert.equal(intent.tx, persisted.tx);
        return {
          receiptOk: true,
          tx: intent.tx,
          root,
          nonce: 4,
          from,
          to: from,
        };
      },
      send: async () => {
        sentAgain = true;
        return `0x${'ee'.repeat(32)}`;
      },
    });
    assert.equal(sentAgain, false);
    assert.equal(again.anchor.tx, persisted.tx);
    assert.equal(anchorIntentRows(dir).filter((row) => row.status === 'signed').length, 1);
    assert.equal(restored.anchorState.base[root].calldata, `0x${root}`);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('an RPC error leaves the signed nonce blocked and does not sign a new transaction', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => {
        throw new Error('crash_before_send');
      },
    });
    const raw = anchorIntentRows(dir).find((row) => row.status === 'signed').raw;
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    let sent = false;
    const head = await restored.publishHead({
      force: true,
      now: '2026-10-06T12:30:00.000Z',
      nonce: 4,
      lookup: async () => {
        throw new Error('connection refused');
      },
      send: async () => {
        sent = true;
        return `0x${'ee'.repeat(32)}`;
      },
    });
    assert.equal(sent, false);
    assert.equal(head.anchor_status, 'blocked');
    const raws = new Set(anchorIntentRows(dir).map((row) => row.raw).filter(Boolean));
    assert.deepEqual([...raws], [raw]);
    assert.equal(anchorIntentRows(dir).filter((row) => row.status === 'signed').length, 1);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'blocked'), true);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'replaced'), false);
    const retry = new ReceiptMerkleTree();
    retry.load(dir);
    let resent = null;
    await retry.publishHead({
      force: true,
      now: '2026-10-06T12:40:00.000Z',
      nonce: 9,
      lookup: async (intent) => {
        assert.equal(intent.status, 'blocked');
        assert.equal(intent.raw, raw);
        assert.equal(intent.nonce, 4);
        return { rebroadcast: true, tx: intent.tx, nonce: intent.nonce };
      },
      send: async (args) => {
        resent = args;
        return args.hash;
      },
    });
    assert.equal(resent.raw, raw);
    assert.equal(resent.nonce, 4);
    assert.equal(anchorIntentRows(dir).filter((row) => row.status === 'signed').length, 1);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a crash after reserve and before sign reuses the nonce with no gap', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  try {
    tree._reserveBaseIntent({ root, day: '2026-10-06', nonce: 4 });
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'intent' && row.nonce === 4 && !row.raw), true);
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    await restored.reconcileAnchorIntents({
      lookup: async () => { throw new Error('connection refused'); },
    });
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'abandoned_unsigned' && row.nonce === 4), true);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'blocked'), false);
    let used = null;
    await restored.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async (args) => {
        used = args.nonce;
        return args.hash;
      },
    });
    assert.equal(used, 4);
    const signed = anchorIntentRows(dir).filter((row) => row.status === 'signed');
    assert.equal(signed.length, 1);
    assert.equal(signed[0].nonce, 4);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('an unsigned crash frees the nonce for the next root', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  try {
    tree._reserveBaseIntent({ root, day: '2026-10-06', nonce: 4 });
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    await restored.reconcileAnchorIntents({
      lookup: async () => ({ blocked: true, reason: 'rpc_error' }),
    });
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'abandoned_unsigned' && row.nonce === 4), true);
    restored.appendReceipt('row-2', 'hash-2', { publish: false });
    const root2 = hex(rootOf(restored.leaves));
    assert.notEqual(root2, root);
    let used = null;
    await restored.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async (args) => {
        used = args.nonce;
        return args.hash;
      },
    });
    assert.equal(used, 4);
    const signed = anchorIntentRows(dir).filter((row) => row.status === 'signed');
    assert.equal(signed.length, 1);
    assert.equal(signed[0].root, root2);
    assert.equal(signed[0].nonce, 4);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('health reports blocked and pending anchor intents', async () => {
  const prevDir = process.env.RECEIPT_LOG_DIR;
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  delete process.env.RECEIPT_LOG_DIR;
  delete process.env.RECEIPT_LOG_BOOT;
  resetReceiptMerkleTree();
  const tree = getReceiptMerkleTree();
  const anchoredRoot = 'cd'.repeat(32);
  const blockedRoot = 'ab'.repeat(32);
  tree.anchorIntents.push(
    {
      chain: 'base',
      day: '2026-10-06',
      root: anchoredRoot,
      nonce: 3,
      tx: `0x${'22'.repeat(32)}`,
      raw: '0x03',
      status: 'anchored',
    },
    {
      chain: 'base',
      day: '2026-10-06',
      root: blockedRoot,
      nonce: 4,
      tx: `0x${'11'.repeat(32)}`,
      raw: '0x02',
      status: 'blocked',
      reason: 'rpc_error',
      at: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      chain: 'base',
      day: '2026-10-06',
      root: 'ee'.repeat(32),
      nonce: 5,
      status: 'signed',
      raw: '0x04',
      tx: `0x${'33'.repeat(32)}`,
    },
  );
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const health = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    const body = await health.json();
    assert.equal(body.receipt_log.blocked_intents, 1);
    assert.equal(body.receipt_log.pending_intents, 1);
    assert.ok(body.receipt_log.oldest_blocked_age_s >= 3600);
    assert.equal(body.receipt_log.last_anchored_root, anchoredRoot);
    assert.equal(body.receipt_log.last_anchored_tx, `0x${'22'.repeat(32)}`);
    assert.equal(body.receipt_log.last_error, 'rpc_error');
    assert.equal(body.receipt_log.stuck_pending_age_s, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevDir == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prevDir;
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    resetReceiptMerkleTree();
  }
});

test('a nonce that landed as something else is replaced and is not sent again', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => {
        throw new Error('crash_before_send');
      },
    });
    const first = anchorIntentRows(dir).find((row) => row.status === 'signed');
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    let resentNonce = null;
    await restored.publishHead({
      force: true,
      now: '2026-10-06T12:30:00.000Z',
      nonce: 4,
      lookup: async (intent) => {
        if (intent.tx === first.tx) return { replaced: true, reason: 'nonce_consumed', tx: first.tx };
        return {
          receiptOk: true,
          tx: intent.tx,
          root: intent.root,
          from: intent.from,
          to: intent.to,
          nonce: intent.nonce,
        };
      },
      send: async (args) => {
        resentNonce = args.nonce;
        assert.notEqual(args.raw, first.raw);
        return args.hash;
      },
    });
    assert.equal(resentNonce, 5);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'replaced' && row.nonce === 4), true);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'signed' && row.nonce === 5), true);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a rejected broadcast is replaced at the same nonce for the next root', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => { throw new Error('broadcast_rejected'); },
    });
    const first = anchorIntentRows(dir).find((row) => row.status === 'signed' && row.raw);
    assert.equal(first.nonce, 4);
    assert.equal(tree.bundleStatus().blocked_intents >= 1, true);
    assert.equal(tree.bundleStatus().pending_intents, 0);
    assert.match(tree.bundleStatus().last_error, /broadcast_rejected/);
    tree.appendReceipt('row-2', 'hash-2', { publish: false });
    const nonces = [];
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:05:00.000Z',
      nonce: 4,
      lookup: async (intent) => ({ rebroadcast: true, missing: true, tx: intent.tx, nonce: intent.nonce }),
      send: async (args) => {
        nonces.push(args.nonce);
        if (args.raw === first.raw) throw new Error('broadcast_rejected');
        const rows = anchorIntentRows(dir);
        assert.ok(rows.some((row) => row.status === 'superseded' && row.superseded_by));
        assert.ok(rows.some((row) => row.raw === args.raw && row.nonce === 4 && row.status === 'signed'));
        return args.hash;
      },
    });
    assert.deepEqual(nonces, [4, 4]);
    const { Transaction } = await import('ethers');
    const oldTx = Transaction.from(first.raw);
    const replacement = anchorIntentRows(dir).find((row) => row.raw && row.raw !== first.raw && row.nonce === 4);
    const newTx = Transaction.from(replacement.raw);
    assert.ok(newTx.maxFeePerGas > oldTx.maxFeePerGas);
    assert.ok(newTx.maxPriorityFeePerGas > oldTx.maxPriorityFeePerGas);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a transient anchor error stays on its nonce across a new root', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => { throw new Error('connection refused'); },
    });
    const first = anchorIntentRows(dir).find((row) => row.raw);
    tree.appendReceipt('row-2', 'hash-2', { publish: false });
    let sent = false;
    const held = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:01.000Z',
      nonce: 4,
      lookup: async () => ({ rebroadcast: true, missing: true }),
      send: async () => { sent = true; return `0x${'11'.repeat(32)}`; },
    });
    assert.equal(sent, false);
    assert.equal(held.anchor_status, 'blocked');
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
    let resent = null;
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:02:00.000Z',
      nonce: 4,
      lookup: async () => ({ rebroadcast: true, missing: true }),
      send: async (args) => {
        resent = args;
        return args.hash;
      },
    });
    assert.equal(resent.raw, first.raw);
    assert.equal(resent.nonce, 4);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a replacement crash does not rebroadcast the superseded raw', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => { throw new Error('broadcast_rejected'); },
    });
    const first = anchorIntentRows(dir).find((row) => row.raw);
    tree.appendReceipt('row-2', 'hash-2', { publish: false });
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:05:00.000Z',
      nonce: 4,
      lookup: async () => ({ rebroadcast: true, missing: true }),
      send: async (args) => {
        if (args.raw === first.raw) throw new Error('broadcast_rejected');
        assert.ok(anchorIntentRows(dir).some((row) => row.status === 'superseded' && row.superseded_by));
        throw new Error('crash_after_replace_persist');
      },
    });
    const replacement = anchorIntentRows(dir).find((row) => row.raw && row.raw !== first.raw);
    assert.equal(replacement.nonce, 4);
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    const seen = [];
    await restored.publishHead({
      force: true,
      now: '2026-10-06T12:10:00.000Z',
      nonce: 4,
      lookup: async (intent) => {
        assert.notEqual(intent.raw, first.raw);
        return { rebroadcast: true, missing: true, tx: intent.tx, nonce: intent.nonce };
      },
      send: async (args) => {
        seen.push(args.raw);
        return args.hash;
      },
    });
    assert.deepEqual(seen, [replacement.raw]);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'superseded' && row.raw === first.raw), true);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a node that already has the signed raw is not replaced', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => { throw new Error('broadcast_rejected'); },
    });
    let sent = false;
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:05:00.000Z',
      nonce: 4,
      lookup: async (intent) => ({
        visible: true,
        tx: intent.tx,
        root: intent.root,
        from: intent.from,
        to: intent.to,
        nonce: intent.nonce,
      }),
      send: async () => { sent = true; return `0x${'11'.repeat(32)}`; },
    });
    assert.equal(sent, false);
    assert.equal(head.anchor_status, 'broadcast');
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'superseded'), false);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a BASE_RPC_URL that is not Base mainnet never receives signed bytes', async () => {
  const { finishReceiptLogBoot } = await import('../src/receipt-merkle.js');
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevRpc = process.env.BASE_RPC_URL;
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  const prevDir = process.env.RECEIPT_LOG_DIR;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.BASE_RPC_URL = 'http://127.0.0.1/not-base';
  delete process.env.RECEIPT_LOG_BOOT;
  delete process.env.RECEIPT_LOG_DIR;
  resetReceiptMerkleTree();
  const fresh = new ReceiptMerkleTree();
  fresh.allowFreshGenesis = true;
  await assert.rejects(
    () => finishReceiptLogBoot(fresh, {
      allowFreshGenesis: true,
      baseRpc: 'http://127.0.0.1/not-base',
      request: async (_url, method) => (method === 'eth_chainId' ? '0x89' : null),
    }),
    (err) => err.code === 'anchor_chain_mismatch',
  );
  assert.equal(fresh.bundleStatus().last_error, 'anchor_chain_mismatch');
  const tree = getReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  let sent = false;
  let chainCalls = 0;
  try {
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      request: async (_url, method) => {
        if (method === 'eth_chainId') {
          chainCalls += 1;
          return '0x1';
        }
        throw new Error(`unexpected ${method}`);
      },
      send: async () => { sent = true; return `0x${'11'.repeat(32)}`; },
    });
    assert.equal(sent, false);
    assert.equal(chainCalls >= 1, true);
    assert.equal(head.anchor_status, 'blocked');
    assert.equal(head.anchor.reason, 'anchor_chain_mismatch');
    assert.equal(anchorIntentRows(dir).some((row) => row.raw), false);
    assert.equal(tree.bundleStatus().last_error, 'anchor_chain_mismatch');
    const { createApp } = await import('../src/server.js');
    const app = createApp();
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const health = await fetch(`http://127.0.0.1:${server.address().port}/health`);
      const body = await health.json();
      assert.equal(body.receipt_log.last_error, 'anchor_chain_mismatch');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevRpc == null) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prevRpc;
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    if (prevDir == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prevDir;
    resetReceiptMerkleTree();
  }
});

function receiptFor(intent, extra = {}) {
  return {
    receiptOk: true,
    receiptStatus: '0x1',
    tx: intent.tx,
    root: intent.root,
    from: intent.from,
    to: intent.to,
    nonce: intent.nonce,
    ...extra,
  };
}

test('already known on the first send is not anchored, and a dropped tx is retried', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  try {
    const { classifyAnchorSendError } = await import('../src/receipt-merkle.js');
    assert.equal(classifyAnchorSendError(new Error('already known')), 'known');
    assert.equal(classifyAnchorSendError(new Error('nonce too low')), 'known');
    let raw = null;
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      lookup: async (intent) => ({ rebroadcast: true, tx: intent.tx, nonce: intent.nonce }),
      send: async (args) => {
        raw = args.raw;
        throw new Error('already known');
      },
    });
    assert.notEqual(head.anchor_status, 'anchored');
    assert.equal(head.anchor_status, 'broadcast');
    assert.equal(tree.anchorState.base[root], undefined);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'anchored'), false);
    let retried = null;
    const again = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:30:00.000Z',
      nonce: 4,
      lookup: async (intent) => ({ rebroadcast: true, tx: intent.tx, nonce: intent.nonce }),
      send: async (args) => {
        retried = args.raw;
        return args.hash;
      },
    });
    assert.equal(retried, raw);
    assert.notEqual(again.anchor_status, 'anchored');
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);

    const low = new ReceiptMerkleTree();
    const lowDir = tmp();
    low.dir = lowDir;
    low.appendReceipt('row-1', 'hash-1', { publish: false });
    const lowHead = await low.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      lookup: async () => ({ rebroadcast: true }),
      send: async () => { throw new Error('nonce too low'); },
    });
    assert.equal(lowHead.anchor_status, 'broadcast');
    assert.equal(low.anchorState.base[hex(rootOf(low.leaves))], undefined);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('already known on replace is not anchored', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      send: async () => { throw new Error('broadcast_rejected'); },
    });
    const first = anchorIntentRows(dir).find((row) => row.status === 'signed' && row.raw);
    tree.appendReceipt('row-2', 'hash-2', { publish: false });
    const root = hex(rootOf(tree.leaves));
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:05:00.000Z',
      nonce: 4,
      lookup: async () => ({ rebroadcast: true }),
      send: async (args) => {
        if (args.raw === first.raw) throw new Error('broadcast_rejected');
        throw new Error('already known');
      },
    });
    assert.notEqual(head.anchor_status, 'anchored');
    assert.equal(head.anchor_status, 'broadcast');
    assert.equal(tree.anchorState.base[root], undefined);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'anchored'), false);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'superseded' && row.raw === first.raw), true);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('an unreadable block time does not stay anchored and is looked up again', async () => {
  const { gatePublishedAnchor } = await import('../src/receipt-anchor-clock.js');
  const gated = await gatePublishedAnchor({
    status: 'anchored',
    chain: 'base',
    tx: '0xabc',
    receipt_confirmed: true,
  }, '2026-10-06T12:00:00.000Z', { blockTimestamp: null });
  assert.equal(gated.status, 'unconfirmed');
  assert.equal(gated.reason, 'block_time_unconfirmed');
  assert.equal(gated.tx, '0xabc');
  const bare = await gatePublishedAnchor({
    status: 'anchored',
    chain: 'base',
    tx: '0xabc',
  }, '2026-10-06T12:00:00.000Z', { blockTimestamp: 1 });
  assert.equal(bare.status, 'unconfirmed');
  assert.equal(bare.reason, 'receipt_unconfirmed');

  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  let lookups = 0;
  try {
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      blockTimestamp: null,
      lookup: async (intent) => {
        lookups += 1;
        return receiptFor(intent);
      },
      send: async (args) => args.hash,
    });
    assert.equal(head.anchor_status, 'unconfirmed');
    assert.equal(head.anchor.reason, 'block_time_unconfirmed');
    assert.equal(tree.anchorState.base[root], undefined);
    const again = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:10:00.000Z',
      nonce: 9,
      blockTimestamp: Math.floor(Date.parse('2026-10-06T12:10:00.000Z') / 1000),
      lookup: async (intent) => {
        lookups += 1;
        return receiptFor(intent);
      },
      send: async () => { throw new Error('should_not_resign'); },
    });
    assert.ok(lookups >= 2);
    assert.equal(again.anchor_status, 'anchored');
    assert.equal(again.anchor.receipt_confirmed, true);
    assert.equal(tree.anchorState.base[root].tx, again.anchor.tx);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a mined receipt outside the clock bound is replaced and the next publish advances', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  try {
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      blockTimestamp: 1,
      lookup: async (intent) => receiptFor(intent),
      send: async (args) => args.hash,
    });
    assert.equal(head.anchor_status, 'pending');
    assert.equal(head.anchor.reason, 'anchor_clock_drift');
    assert.equal(head.anchor.tx, null);
    assert.match(head.anchor.rejected_tx, /^0x[0-9a-f]{64}$/);
    assert.equal(tree.anchorState.base[root], undefined);
    assert.equal(anchorIntentRows(dir).some((row) => (
      row.nonce === 4 && row.status === 'replaced' && row.reason === 'anchor_clock_drift'
    )), true);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'broadcast'), false);
    const nonces = [];
    const again = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:10:00.000Z',
      nonce: 4,
      blockTimestamp: Math.floor(Date.parse('2026-10-06T12:10:00.000Z') / 1000),
      lookup: async (intent) => receiptFor(intent),
      send: async (args) => {
        nonces.push(args.nonce);
        return args.hash;
      },
    });
    assert.deepEqual(nonces, [5]);
    assert.equal(again.anchor_status, 'anchored');
    assert.equal(again.anchor.receipt_confirmed, true);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5 && row.status === 'anchored'), true);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a stored anchor without a receipt is looked up again and the dropped tx is retried', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const root = hex(rootOf(tree.leaves));
  const tx = `0x${'ab'.repeat(32)}`;
  const from = '0xe239cdc5fbe977a8a141b72194d3cf8c41bc5bc6';
  tree.anchorIntents.push({
    chain: 'base',
    root,
    day: '2026-10-06',
    nonce: 4,
    status: 'anchored',
    raw: '0xraw',
    tx,
    from,
    to: from,
    at: '2026-10-06T12:00:00.000Z',
  });
  tree.anchorState.base[root] = { status: 'anchored', tx, from, calldata: `0x${root}` };
  tree.heads.push({
    root,
    tree_size: tree.leaves.length,
    published_at: '2026-10-06T12:00:00.000Z',
    anchors: { base: { status: 'anchored', tx, from, chain: 'base' } },
    anchor: { status: 'anchored', tx, from },
  });
  try {
    let sent = null;
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:30:00.000Z',
      nonce: 4,
      lookup: async () => ({ rebroadcast: true, missing: true }),
      send: async (args) => {
        sent = args.raw;
        return args.hash;
      },
    });
    assert.equal(sent, '0xraw');
    assert.notEqual(head.anchor_status, 'anchored');
    assert.equal(tree.anchorState.base[root]?.status, undefined);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a mempool anchor stuck past ANCHOR_STUCK_MS is replaced at the same nonce', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  const sent = [];
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      lookup: async (intent) => ({
        visible: true,
        tx: intent.tx,
        root: intent.root,
        from: intent.from,
        to: intent.to,
        nonce: intent.nonce,
      }),
      send: async (args) => {
        sent.push(args);
        return args.hash;
      },
    });
    const health = tree.bundleStatus(new Date('2026-10-06T12:01:00.000Z'));
    assert.equal(health.last_error, 'prior_nonce_pending');
    assert.equal(health.stuck_pending_age_s, 60);
    const first = anchorIntentRows(dir).find((row) => row.raw);
    tree.appendReceipt('row-2', 'hash-2', { publish: false });
    const root2 = hex(rootOf(tree.leaves));
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:11:00.000Z',
      nonce: 4,
      lookup: async (intent) => {
        if (intent.raw === first.raw) {
          return {
            visible: true,
            tx: intent.tx,
            root: intent.root,
            from: intent.from,
            to: intent.to,
            nonce: intent.nonce,
          };
        }
        return { rebroadcast: true, tx: intent.tx, nonce: intent.nonce };
      },
      send: async (args) => {
        sent.push(args);
        return args.hash;
      },
    });
    assert.equal(sent.length, 2);
    assert.equal(sent[1].nonce, 4);
    assert.equal(sent[1].calldata, `0x${root2}`);
    assert.notEqual(sent[1].raw, first.raw);
    const { Transaction } = await import('ethers');
    assert.ok(Transaction.from(sent[1].raw).maxFeePerGas > Transaction.from(first.raw).maxFeePerGas);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'superseded' && row.raw === first.raw), true);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
    assert.notEqual(head.anchor_status, 'anchored');
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
  }
});

test('a stuck replacement stops when the fee cap is hit', async () => {
  const dir = tmp();
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevCap = process.env.ANCHOR_MAX_FEE_WEI;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.ANCHOR_MAX_FEE_WEI = '1000000000';
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('row-1', 'hash-1', { publish: false });
  let sends = 0;
  try {
    await tree.publishHead({
      force: true,
      now: '2026-10-06T12:00:00.000Z',
      nonce: 4,
      lookup: async (intent) => ({
        visible: true,
        tx: intent.tx,
        root: intent.root,
        from: intent.from,
        to: intent.to,
        nonce: intent.nonce,
      }),
      send: async (args) => {
        sends += 1;
        return args.hash;
      },
    });
    tree.appendReceipt('row-2', 'hash-2', { publish: false });
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-06T12:11:00.000Z',
      nonce: 4,
      lookup: async (intent) => ({
        visible: true,
        tx: intent.tx,
        root: intent.root,
        from: intent.from,
        to: intent.to,
        nonce: intent.nonce,
      }),
      send: async (args) => {
        sends += 1;
        return args.hash;
      },
    });
    assert.equal(sends, 1);
    assert.equal(head.anchor_status, 'blocked');
    assert.equal(head.anchor.reason, 'anchor_fee_cap');
    const health = tree.bundleStatus(new Date('2026-10-06T12:11:00.000Z'));
    assert.equal(health.last_error, 'anchor_fee_cap');
    assert.ok(health.stuck_pending_age_s >= 600);
    assert.equal(anchorIntentRows(dir).some((row) => row.status === 'superseded'), false);
    assert.equal(anchorIntentRows(dir).some((row) => row.nonce === 5), false);
  } finally {
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevCap == null) delete process.env.ANCHOR_MAX_FEE_WEI;
    else process.env.ANCHOR_MAX_FEE_WEI = prevCap;
  }
});

function quoteRequest(baseFee, tip) {
  return async (_url, method) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getBlockByNumber') return { baseFeePerGas: `0x${baseFee.toString(16)}` };
    if (method === 'eth_maxPriorityFeePerGas') return `0x${tip.toString(16)}`;
    throw new Error(`unexpected ${method}`);
  };
}

function installSignerSpy() {
  const real = baseAnchorSigner.sign;
  let calls = 0;
  baseAnchorSigner.sign = async (args) => {
    calls += 1;
    return real(args);
  };
  return {
    get calls() { return calls; },
    restore() { baseAnchorSigner.sign = real; },
  };
}

test('an RPC quote above either anchor fee cap is not signed or broadcast', async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevFee = process.env.ANCHOR_MAX_FEE_WEI;
  const prevPriority = process.env.ANCHOR_MAX_PRIORITY_WEI;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.ANCHOR_MAX_FEE_WEI = '1000000000';
  process.env.ANCHOR_MAX_PRIORITY_WEI = '100000000';
  const { default: logger } = await import('../src/logger.js');
  const originalError = logger.error;
  const alerts = [];
  logger.error = function (...args) {
    alerts.push(args);
    return originalError.apply(this, args);
  };
  const spy = installSignerSpy();
  try {
    const cases = [
      { baseFee: 600_000_000n, tip: 50_000_000n },
      { baseFee: 10n, tip: 150_000_000n },
    ];
    for (const { baseFee, tip } of cases) {
      const before = spy.calls;
      const dir = tmp();
      const tree = new ReceiptMerkleTree();
      tree.dir = dir;
      tree.appendReceipt('row-1', 'hash-1', { publish: false });
      let broadcasts = 0;
      const head = await tree.publishHead({
        force: true,
        now: '2026-10-06T12:00:00.000Z',
        nonce: 4,
        request: quoteRequest(baseFee, tip),
        send: async () => {
          broadcasts += 1;
          return `0x${'11'.repeat(32)}`;
        },
      });
      assert.equal(spy.calls, before);
      assert.equal(broadcasts, 0);
      assert.equal(head.anchor_status, 'pending');
      assert.equal(head.anchor.reason, 'anchor_fee_cap');
      assert.equal(head.anchor.tx, null);
      assert.equal(tree.bundleStatus().last_error, 'anchor_fee_cap');
      assert.equal(anchorIntentRows(dir).some((row) => row.raw), false);
      assert.equal(anchorIntentRows(dir).some((row) => row.status === 'signed' || row.status === 'broadcast'), false);
      assert.equal(anchorIntentRows(dir).some((row) => row.status === 'intent'), true);
    }
    assert.equal(alerts.some((args) => JSON.stringify(args).includes('anchor_fee_cap')), true);
  } finally {
    logger.error = originalError;
    spy.restore();
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevFee == null) delete process.env.ANCHOR_MAX_FEE_WEI;
    else process.env.ANCHOR_MAX_FEE_WEI = prevFee;
    if (prevPriority == null) delete process.env.ANCHOR_MAX_PRIORITY_WEI;
    else process.env.ANCHOR_MAX_PRIORITY_WEI = prevPriority;
  }
});

test('an RPC quote at or below the anchor fee caps is signed and broadcast', async () => {
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevFee = process.env.ANCHOR_MAX_FEE_WEI;
  const prevPriority = process.env.ANCHOR_MAX_PRIORITY_WEI;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.ANCHOR_MAX_FEE_WEI = '1000000000';
  process.env.ANCHOR_MAX_PRIORITY_WEI = '100000000';
  const spy = installSignerSpy();
  const { Transaction } = await import('ethers');
  try {
    const cases = [
      { baseFee: 450_000_000n, tip: 100_000_000n },
      { baseFee: 100_000_000n, tip: 10_000_000n },
    ];
    for (const { baseFee, tip } of cases) {
      const before = spy.calls;
      const dir = tmp();
      const tree = new ReceiptMerkleTree();
      tree.dir = dir;
      tree.appendReceipt('row-1', 'hash-1', { publish: false });
      let raw = null;
      const head = await tree.publishHead({
        force: true,
        now: '2026-10-06T12:00:00.000Z',
        nonce: 4,
        request: quoteRequest(baseFee, tip),
        lookup: async () => ({ rebroadcast: true }),
        send: async (args) => {
          raw = args.raw;
          return args.hash;
        },
      });
      assert.equal(spy.calls, before + 1);
      assert.ok(raw);
      const tx = Transaction.from(raw);
      assert.equal(tx.maxFeePerGas, baseFee * 2n + tip);
      assert.equal(tx.maxPriorityFeePerGas, tip);
      assert.equal(head.anchor.reason, 'unconfirmed');
      assert.notEqual(head.anchor_status, 'pending');
      assert.equal(anchorIntentRows(dir).some((row) => row.status === 'broadcast' && row.raw === raw), true);
    }
  } finally {
    spy.restore();
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevFee == null) delete process.env.ANCHOR_MAX_FEE_WEI;
    else process.env.ANCHOR_MAX_FEE_WEI = prevFee;
    if (prevPriority == null) delete process.env.ANCHOR_MAX_PRIORITY_WEI;
    else process.env.ANCHOR_MAX_PRIORITY_WEI = prevPriority;
  }
});

test('production refuses to boot when an anchor fee cap is missing or not numeric', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevKey = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevFee = process.env.ANCHOR_MAX_FEE_WEI;
  const prevPriority = process.env.ANCHOR_MAX_PRIORITY_WEI;
  const spy = installSignerSpy();
  process.env.NODE_ENV = 'production';
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  const cases = [
    { fee: undefined, priority: '100', name: 'ANCHOR_MAX_FEE_WEI' },
    { fee: '100', priority: undefined, name: 'ANCHOR_MAX_PRIORITY_WEI' },
    { fee: '', priority: '100', name: 'ANCHOR_MAX_FEE_WEI' },
    { fee: '100', priority: '', name: 'ANCHOR_MAX_PRIORITY_WEI' },
    { fee: 'nope', priority: '100', name: 'ANCHOR_MAX_FEE_WEI' },
    { fee: '100', priority: '1.5', name: 'ANCHOR_MAX_PRIORITY_WEI' },
    { fee: '10gwei', priority: '100', name: 'ANCHOR_MAX_FEE_WEI' },
  ];
  function apply(entry) {
    if (entry.fee == null) delete process.env.ANCHOR_MAX_FEE_WEI;
    else process.env.ANCHOR_MAX_FEE_WEI = entry.fee;
    if (entry.priority == null) delete process.env.ANCHOR_MAX_PRIORITY_WEI;
    else process.env.ANCHOR_MAX_PRIORITY_WEI = entry.priority;
  }
  try {
    for (const entry of cases) {
      apply(entry);
      assert.throws(
        () => bootReceiptLog(tmp()),
        (err) => err.code === 'anchor_fee_cap_config' && err.message.includes(entry.name),
      );
      assert.throws(
        () => assertAnchorFeeCaps(),
        (err) => err.code === 'anchor_fee_cap_config' && err.message.includes(entry.name),
      );
    }
    apply(cases[0]);
    const { startServer } = await import('../src/server.js');
    await assert.rejects(
      () => startServer(),
      (err) => err.code === 'anchor_fee_cap_config' && err.message.includes('ANCHOR_MAX_FEE_WEI'),
    );
    for (const entry of [cases[0], cases[4]]) {
      apply(entry);
      const dir = tmp();
      const tree = new ReceiptMerkleTree();
      tree.dir = dir;
      tree.appendReceipt('row-1', 'hash-1', { publish: false });
      let broadcasts = 0;
      await assert.rejects(
        () => tree.publishHead({
          force: true,
          now: '2026-10-06T12:00:00.000Z',
          nonce: 4,
          send: async () => {
            broadcasts += 1;
            return `0x${'11'.repeat(32)}`;
          },
        }),
        (err) => err.code === 'anchor_fee_cap_config' && err.message.includes(entry.name),
      );
      assert.equal(broadcasts, 0);
      assert.equal(anchorIntentRows(dir).some((row) => row.raw), false);
    }
    assert.equal(spy.calls, 0);
    process.env.NODE_ENV = 'test';
    delete process.env.ANCHOR_MAX_FEE_WEI;
    delete process.env.ANCHOR_MAX_PRIORITY_WEI;
    assert.doesNotThrow(() => assertAnchorFeeCaps());
    process.env.NODE_ENV = 'development';
    assert.doesNotThrow(() => assertAnchorFeeCaps());
  } finally {
    spy.restore();
    if (prevEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevKey == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevKey;
    if (prevFee == null) delete process.env.ANCHOR_MAX_FEE_WEI;
    else process.env.ANCHOR_MAX_FEE_WEI = prevFee;
    if (prevPriority == null) delete process.env.ANCHOR_MAX_PRIORITY_WEI;
    else process.env.ANCHOR_MAX_PRIORITY_WEI = prevPriority;
  }
});

test('a crash between the two journal writes broadcasts only the highest fee', async () => {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  const root = 'ab'.repeat(32);
  const from = '0xe239cdc5fbe977a8a141b72194d3cf8c41bc5bc6';
  const low = {
    chain: 'base',
    root,
    day: '2026-10-06',
    nonce: 4,
    status: 'signed',
    raw: '0xlow',
    tx: `0x${'11'.repeat(32)}`,
    from,
    to: from,
    max_fee: '1000',
    max_priority: '10',
    at: '2026-10-06T12:05:00.000Z',
  };
  const high = {
    ...low,
    raw: '0xhigh',
    tx: `0x${'22'.repeat(32)}`,
    max_fee: '5000',
    max_priority: '50',
    at: '2026-10-06T12:00:00.000Z',
  };
  tree.anchorIntents.push(low, high);
  const sent = [];
  await tree.reconcileAnchorIntents({
    lookup: async () => ({ rebroadcast: true }),
    rebroadcast: async (raw) => {
      const rows = anchorIntentRows(dir);
      assert.equal(rows.some((row) => row.status === 'superseded' && row.tx === low.tx && row.reason === 'lower_fee'), true);
      assert.equal(rows.some((row) => row.status === 'superseded' && row.tx === high.tx), false);
      sent.push(raw);
    },
  });
  assert.deepEqual(sent, ['0xhigh']);
});

test('every anchored transition goes through confirmAnchor', async () => {
  const { confirmAnchor } = await import('../src/receipt-merkle.js');
  const from = '0xe239cdc5fbe977a8a141b72194d3cf8c41bc5bc6';
  const root = 'ab'.repeat(32);
  const tx = `0x${'11'.repeat(32)}`;
  const ok = confirmAnchor({
    receiptStatus: '0x1',
    root,
    from,
    to: from,
    wantRoot: root,
    wantFrom: from,
    wantTo: from,
    tx,
  });
  assert.equal(ok.status, 'anchored');
  assert.equal(ok.receipt_confirmed, true);
  assert.equal(confirmAnchor({ ...ok, receiptStatus: '0x0', wantRoot: root, wantFrom: from, wantTo: from }), null);
  assert.equal(confirmAnchor({
    receiptStatus: '0x1', root: 'cd'.repeat(32), from, to: from, wantRoot: root, wantFrom: from, wantTo: from, tx,
  }), null);
  assert.equal(confirmAnchor({
    receiptStatus: '0x1', root, from: '0x1111111111111111111111111111111111111111', to: from, wantRoot: root, wantFrom: from, wantTo: from, tx,
  }), null);
  assert.equal(confirmAnchor({
    receiptStatus: '0x1', root, from, to: '0x1111111111111111111111111111111111111111', wantRoot: root, wantFrom: from, wantTo: from, tx,
  }), null);

  const srcDir = path.join(gatewayRoot, 'src');
  const files = ['receipt-merkle.js', 'receipt-anchor-clock.js', 'receipt-log-anchor.js', 'receipt-log-store.js'];
  const statusLines = [];
  const markLines = [];
  for (const name of files) {
    const text = fs.readFileSync(path.join(srcDir, name), 'utf8');
    text.split('\n').forEach((line, index) => {
      if (/status:\s*'anchored'/.test(line)) statusLines.push(`${name}:${index + 1}:${line.trim()}`);
      if (/_markIntent\([^)]*'anchored'/.test(line)) markLines.push(`${name}:${index + 1}:${line.trim()}`);
    });
  }
  assert.equal(statusLines.length, 1, statusLines.join('\n'));
  const merkle = fs.readFileSync(path.join(srcDir, 'receipt-merkle.js'), 'utf8');
  const confirmBody = merkle.slice(merkle.indexOf('export function confirmAnchor'), merkle.indexOf('export function dailyAnchorDue'));
  assert.match(confirmBody, /status: 'anchored'/);
  assert.equal(markLines.length, 1, markLines.join('\n'));
  const commitBody = merkle.slice(merkle.indexOf('  _commitAnchored('), merkle.indexOf('  _reopenAnchored('));
  assert.match(commitBody, /confirmAnchor\(/);
  assert.match(commitBody, /_markIntent\(intent, 'anchored'/);
  assert.ok(commitBody.indexOf('confirmAnchor(') < commitBody.indexOf("_markIntent(intent, 'anchored'"));
  const solana = fs.readFileSync(path.join(srcDir, 'solana-receipt-anchor.js'), 'utf8');
  const solanaHits = solana.split('\n').filter((line) => /status:\s*'anchored'/.test(line));
  assert.equal(solanaHits.length, 1);
});

test('a row with no task_id keeps its row_hash in the chain', () => {
  const tree = new ReceiptMerkleTree();
  tree.closedEpochs = [{
    epoch: 1,
    meta: [
      { task_id: 'genesis', kind: 'genesis' },
      { task_id: 'leaf-1', kind: 'receipt' },
    ],
  }];
  const rows = [
    { agent_id: 4, task_id: 'leaf-1', seq: 1, prev_hash: null, row_hash: 'aa' },
    { agent_id: 13, task_id: 'before-note', seq: 1, prev_hash: null, row_hash: 'n1' },
    { agent_id: 13, seq: 2, prev_hash: 'n1', row_hash: 'n2' },
    { agent_id: 13, task_id: 'after-note', seq: 3, prev_hash: 'n2', row_hash: 'n3' },
  ];
  const plan = planReceiptBackfill(tree, rows);
  assert.deepEqual(plan.append.map((row) => [row.task_id, row.row_hash]), [
    ['before-note', 'n1'],
    ['after-note', 'n3'],
  ]);
  assert.deepEqual(plan.unlogged, []);
});

test('an untasked row with an empty hash breaks the chain', () => {
  const tree = new ReceiptMerkleTree();
  tree.closedEpochs = [{
    epoch: 1,
    meta: [
      { task_id: 'genesis', kind: 'genesis' },
      { task_id: 'leaf-1', kind: 'receipt' },
    ],
  }];
  const rows = [
    { agent_id: 4, task_id: 'leaf-1', seq: 1, prev_hash: null, row_hash: 'aa' },
    { agent_id: 14, task_id: 'before-blank', seq: 1, prev_hash: null, row_hash: 'b1' },
    { agent_id: 14, seq: 2, prev_hash: 'b1', row_hash: '' },
    { agent_id: 14, task_id: 'after-blank', seq: 3, prev_hash: null, row_hash: 'b3' },
  ];
  const plan = planReceiptBackfill(tree, rows);
  assert.deepEqual(plan.append.map((row) => row.task_id), ['before-blank']);
  assert.deepEqual(plan.unlogged.map((row) => [row.task_id, row.reason]), [
    ['after-blank', 'depends_on_refused'],
  ]);
});

test('a leading seq gap is depends_on_refused and taints the rest of the chain', () => {
  const tree = new ReceiptMerkleTree();
  tree.closedEpochs = [{
    epoch: 1,
    meta: [
      { task_id: 'genesis', kind: 'genesis' },
      { task_id: 'leaf-1', kind: 'receipt' },
    ],
  }];
  const rows = [
    { agent_id: 4, task_id: 'leaf-1', seq: 1, prev_hash: null, row_hash: 'aa' },
    { agent_id: 11, task_id: 'gap-start', seq: 3, prev_hash: null, row_hash: 'g3' },
    { agent_id: 11, task_id: 'gap-next', seq: 4, prev_hash: 'g3', row_hash: 'g4' },
  ];
  const plan = planReceiptBackfill(tree, rows);
  assert.deepEqual(plan.append, []);
  assert.deepEqual(plan.unlogged.map((row) => [row.task_id, row.reason]), [
    ['gap-start', 'depends_on_refused'],
    ['gap-next', 'depends_on_refused'],
  ]);
});

test('a row whose parent is missing is depends_on_refused', () => {
  const tree = new ReceiptMerkleTree();
  tree.closedEpochs = [{
    epoch: 1,
    meta: [
      { task_id: 'genesis', kind: 'genesis' },
      { task_id: 'leaf-1', kind: 'receipt' },
    ],
  }];
  const rows = [
    { agent_id: 4, task_id: 'leaf-1', seq: 1, prev_hash: null, row_hash: 'aa' },
    { agent_id: 12, task_id: 'chain-start', seq: 1, prev_hash: null, row_hash: 'p1' },
    { agent_id: 12, task_id: 'missing-parent', seq: 3, prev_hash: 'not-a-parent', row_hash: 'p3' },
  ];
  const plan = planReceiptBackfill(tree, rows);
  assert.deepEqual(plan.append.map((row) => row.task_id), ['chain-start']);
  assert.equal(plan.append[0].row_hash, 'p1');
  assert.deepEqual(plan.unlogged.map((row) => [row.task_id, row.reason]), [
    ['missing-parent', 'depends_on_refused'],
  ]);
});

test('backfill lists a forked agent instead of aborting the file', () => {
  const tree = new ReceiptMerkleTree();
  tree.closedEpochs = [{
    epoch: 1,
    meta: [
      { task_id: 'genesis', kind: 'genesis' },
      { task_id: 'leaf-1', kind: 'receipt' },
    ],
  }];
  const rows = [
    { agent_id: 3, task_id: 'leaf-1', seq: 1, prev_hash: null, row_hash: 'aa' },
    { agent_id: 3, task_id: 'dup-a', seq: 2, prev_hash: 'aa', row_hash: 'bb' },
    { agent_id: 3, task_id: 'dup-b', seq: 2, prev_hash: 'aa', row_hash: '' },
    { agent_id: 8, task_id: 'clean-after', seq: 1, prev_hash: null, row_hash: 'cc' },
  ];
  const plan = planReceiptBackfill(tree, rows);
  assert.deepEqual(plan.append.map((row) => row.task_id), ['clean-after']);
  assert.deepEqual(plan.unlogged.map((row) => [row.task_id, row.reason]), [
    ['dup-a', 'forked'],
    ['dup-b', 'forked'],
  ]);
  assert.equal(plan.append[0].row_hash, 'cc');
});

test('restore checks the signed bundle index hash and object lock compliance', async () => {
  const { uploadHourlyBundle, buildBundle } = await import('../src/receipt-log-s3.js');
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('later-leaf', 'row', { publish: false });
  const view = tree.bundleView([], new Date('2026-10-06T18:00:00.000Z'));
  const bundle = buildBundle({
    hour: view.hour,
    epoch: view.epoch,
    leaves: view.leaves,
    heads: [],
    receipts: [],
    added: view.added,
  });
  const governance = lockingClient(new Map(), 'GOVERNANCE');
  await assert.rejects(
    () => uploadHourlyBundle({
      client: governance,
      bucket: 'b',
      prefix: 'receipt-log/',
      retentionDays: 30,
      bundle,
      index: { schema: 'chit402.receipt_log_bundle_index.v1', bundles: [] },
    }),
    /object_lock_not_compliance/,
  );
  const objects = new Map();
  const client = lockingClient(objects);
  const uploaded = await uploadHourlyBundle({
    client,
    bucket: 'b',
    prefix: 'receipt-log/',
    retentionDays: 30,
    bundle,
    index: { schema: 'chit402.receipt_log_bundle_index.v1', bundles: [] },
  });
  await assert.rejects(
    () => uploadHourlyBundle({
      client,
      bucket: 'b',
      prefix: 'receipt-log/',
      retentionDays: 30,
      bundle,
      index: uploaded.index,
    }),
    /index_already_published/,
  );
  const fullRoot = hex(rootOf(tree.leaves));
  const prefixRoot = hex(rootOf(tree.leaves.slice(0, 1)));
  await assert.rejects(
    () => restoreFromS3({
      client,
      bucket: 'b',
      prefix: 'receipt-log/',
      indexKey: uploaded.index_key,
      head: anchoredHead({
        root: fullRoot,
        treeSize: tree.leaves.length,
        bundleIndexHash: '00'.repeat(32),
        epoch: tree.epoch,
      }),
      expectRoots: [{ epoch: tree.epoch, tree_size: tree.leaves.length, root: fullRoot }],
    }),
    /bundle_index_hash/,
  );
  await assert.rejects(
    () => restoreFromS3({
      client,
      bucket: 'b',
      prefix: 'receipt-log/',
      indexKey: uploaded.index_key,
      head: anchoredHead({
        root: prefixRoot,
        treeSize: 1,
        bundleIndexHash: uploaded.index_hash,
        epoch: tree.epoch,
      }),
      expectRoots: [{ epoch: tree.epoch, tree_size: 1, root: prefixRoot }],
    }),
    /anchored_root/,
  );
});

test('the committed pin passes the boot gate when RPC returns those transactions', async () => {
  const { readReceiptLogPin, assertKnownAnchorTxs } = await import('../src/receipt-log-anchor.js');
  const { finishReceiptLogBoot } = await import('../src/receipt-merkle.js');
  const pin = readReceiptLogPin({});
  assert.ok(pin.anchors.length > 0);
  assert.equal(pin.anchors.every((row) => typeof row.tx === 'string' && row.tx.length > 0), true);
  const baseOnly = pin.anchors.filter((row) => row.solana === 'absent').map((row) => row.root);
  assert.deepEqual(baseOnly, ['ff950e7204762565751e1c7a6bfbdb167c15452f26259a97f63a2c90b2f61ec3']);
  assert.equal(pin.anchors.some((row) => row.chain === 'solana' && row.root === baseOnly[0]), false);
  const tree = new ReceiptMerkleTree();
  const journalRoots = new Set(pin.anchors.filter((row) => row.in_journal !== false).map((row) => row.root));
  for (const root of journalRoots) {
    tree.heads.push({ root, tree_size: 1 });
  }
  const seen = new Set();
  const request = async (_url, method, params) => {
    const hash = params[0];
    const anchor = pin.anchors.find((row) => row.tx === hash);
    assert.ok(anchor, hash);
    seen.add(hash);
    if (method === 'eth_getTransactionByHash') {
      assert.equal(anchor.chain, 'base');
      return { hash, input: `0x${anchor.root}` };
    }
    if (method === 'getTransaction') {
      assert.equal(anchor.chain, 'solana');
      return { slot: anchor.slot, memo: anchor.root };
    }
    throw new Error(method);
  };
  await assertKnownAnchorTxs(pin, { request, tree });
  const claims = epochRecordClaims();
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-epoch+jwt' });
  tree.epochRecord = {
    ...claims,
    issuer_signature: { jws, kid },
  };
  const prevFlag = process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS;
  delete process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS;
  try {
    await finishReceiptLogBoot(tree, { request, pin });
  } finally {
    if (prevFlag == null) delete process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS;
    else process.env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS = prevFlag;
  }
  assert.equal(seen.size, pin.anchors.length);
});

test('an env root cannot replace the committed pin or skip RPC', async () => {
  const { readReceiptLogPin } = await import('../src/receipt-log-anchor.js');
  assert.throws(
    () => readReceiptLogPin({
      RECEIPT_LOG_EXPECTED_EPOCH: '1',
      RECEIPT_LOG_EXPECTED_ROOT: 'ab'.repeat(32),
    }),
    (err) => err.code === 'bad_pin',
  );
  const pin = readReceiptLogPin({
    RECEIPT_LOG_EXPECTED_EPOCH: '2',
    RECEIPT_LOG_EXPECTED_ROOT: EPOCH2_OPENING_ROOT,
  });
  assert.ok(pin.anchors.length >= 19);
  assert.ok(pin.epochs.some((row) => Number(row.epoch) === 2 && Number(row.opening_size) === 1));
  const tree = new ReceiptMerkleTree();
  for (const root of new Set(pin.anchors.filter((row) => row.in_journal !== false).map((row) => row.root))) {
    tree.heads.push({ root });
  }
  await assert.rejects(
    () => assertLatestBaseAnchor(tree, { pin, request: async () => null }),
    (err) => err.code === 'anchor_rpc_missing',
  );
});

test('epoch 2 opening is checked after the tree grows past one leaf', () => {
  const dir = tmp();
  const claims = epochRecordClaims();
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-epoch+jwt' });
  const record = {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-epoch+jwt',
      payload_version: 1,
      jws,
      kid,
    },
  };
  const lines = [
    {
      v: 1,
      op: 'epoch_open',
      epoch: 2,
      prev_epoch_root: EPOCH1_FINAL_ROOT,
      prev_epoch_size: 4,
    },
    {
      v: 1,
      op: 'leaf',
      epoch: 2,
      index: 0,
      task_id: 'genesis',
      kind: 'genesis',
      preimage_b64: Buffer.from('not-the-epoch-2-opening').toString('base64'),
    },
    {
      v: 1,
      op: 'leaf',
      epoch: 2,
      index: 1,
      task_id: 'later',
      kind: 'receipt',
      preimage_b64: Buffer.from('later-leaf|hh').toString('base64'),
    },
    { v: 1, op: 'epoch_record', record },
  ];
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${lines.map((row) => JSON.stringify(row)).join('\n')}\n`);
  assert.throws(() => new ReceiptMerkleTree().load(dir), (err) => err.code === 'root_mismatch');
});

test('backfill refuses duplicate seq rows whose agent_id was stripped', () => {
  const tree = new ReceiptMerkleTree();
  tree.closedEpochs = [{
    epoch: 1,
    meta: [
      { task_id: 'genesis', kind: 'genesis' },
      { task_id: 'leaf-1', kind: 'receipt' },
    ],
  }];
  const rows = [
    { task_id: 'leaf-1', seq: 1, prev_hash: null, row_hash: 'aa' },
    { task_id: 'dup-a', seq: 2, prev_hash: 'aa', row_hash: 'bb' },
    { task_id: 'dup-b', seq: 2, prev_hash: 'aa', row_hash: 'cc' },
  ];
  assert.throws(() => planReceiptBackfill(tree, rows), (err) => {
    assert.equal(err.code, 'backfill_refused');
    assert.ok(err.refusals.some((row) => row.reason === 'missing_agent_id' || row.reason === 'FORKED'));
    return true;
  });
});

test('epoch 1 inclusion prefixes are the pinned roots, and size 3 is not pinned', () => {
  const size1 = epochLeafHash(genesisBytes(EPOCH1_GENESIS_DIGEST)).toString('hex');
  assert.equal(size1, EPOCH1_SIZE1_ROOT);
  assert.equal(matchEpoch1Prefix(1, size1).ok, true);
  assert.equal(matchEpoch1Prefix(2, EPOCH1_SIZE2_ROOT).ok, true);
  assert.equal(matchEpoch1Prefix(2, 'ab'.repeat(32)).reason, 'epoch1_prefix');
  assert.equal(matchEpoch1Prefix(4, EPOCH1_FINAL_ROOT).ok, true);
  assert.equal(matchEpoch1Prefix(3, EPOCH1_FINAL_ROOT).reason, 'epoch1_prefix');
  assert.equal(matchEpoch1Prefix(5, EPOCH1_SIZE1_ROOT).reason, 'epoch1_prefix');
});

test('a gateway epoch-1 record at size 3 is not final', () => {
  const forged = {
    epochs: [{
      epoch: 1,
      status: 'closed',
      final_root: 'ab'.repeat(32),
      final_size: 3,
      genesis_digest: EPOCH1_GENESIS_DIGEST,
      prev_epoch_root: null,
      prev_epoch_size: 0,
    }],
    orphans: [],
  };
  const result = checkEpochLinks(forged);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'epoch1_root');
});

test('boot refuses a non-empty journal with no epoch record', () => {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('local-only', 'hh', { publish: false });
  assert.throws(() => bootReceiptLog(dir, { pin: null }), (err) => err.code === 'epoch_record_missing');
  resetReceiptMerkleTree();
});

test('a known anchor transaction the RPC does not return refuses boot', async () => {
  const { assertKnownAnchorTxs } = await import('../src/receipt-log-anchor.js');
  const root = 'aa'.repeat(32);
  const pin = { anchors: [{ chain: 'base', root, tx: `0x${'11'.repeat(32)}` }] };
  await assert.rejects(
    () => assertKnownAnchorTxs(pin, { request: async () => null, tree: new ReceiptMerkleTree() }),
    (err) => err.code === 'anchor_rpc_missing',
  );
  const tree = new ReceiptMerkleTree();
  tree.anchorState.base[root] = { status: 'anchored', tx: pin.anchors[0].tx };
  await assert.rejects(
    () => assertKnownAnchorTxs(pin, {
      tree,
      request: async () => ({ hash: pin.anchors[0].tx, input: `0x${root}` }),
    }),
    (err) => err.code === 'anchor_not_in_journal',
  );
});

test('a forged epoch record is not a pinned epoch', async () => {
  const { assertPinnedEpochRecord } = await import('../src/receipt-log-epoch.js');
  const forged = epochRecordClaims({ epoch1Root: 'ab'.repeat(32) });
  forged.issuer_signature = { jws: 'a.b.c' };
  assert.equal(assertPinnedEpochRecord(forged).reason, 'epoch1_root');
  const pinned = epochRecordClaims();
  pinned.issuer_signature = { jws: 'a.b.c' };
  assert.equal(assertPinnedEpochRecord(pinned).ok, true);
  assert.equal(pinned.orphans.find((row) => row.root_prefix === 'd7f6c548').unrecoverable, true);
  const legacy = epochRecordClaims();
  legacy.payload_version = 1;
  legacy.orphans = legacy.orphans
    .filter((row) => row.root !== 'ff950e7204762565751e1c7a6bfbdb167c15452f26259a97f63a2c90b2f61ec3')
    .map((row) => (row.root_prefix === 'd7f6c548' || String(row.root || '').startsWith('20d88791')
      ? { ...row, chain: 'base' }
      : row));
  legacy.issuer_signature = { jws: 'a.b.c' };
  assert.equal(assertPinnedEpochRecord(legacy).ok, true);
  const dropped = epochRecordWithUnlogged(epochRecordClaims(), []);
  dropped.orphans = dropped.orphans.filter((row) => row.root !== 'ff950e7204762565751e1c7a6bfbdb167c15452f26259a97f63a2c90b2f61ec3');
  dropped.issuer_signature = { jws: 'a.b.c' };
  assert.equal(assertPinnedEpochRecord(dropped).reason, 'orphan_ff950e72_missing');
});

test('backfill dry-run lists each refusal', () => {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  tree.appendReceipt('leaf-1', 'aa', { publish: false });
  const jsonl = path.join(dir, 'rows.jsonl');
  const rows = [
    { agent_id: 3, task_id: 'leaf-1', seq: 1, prev_hash: null, row_hash: 'aa' },
    { agent_id: 3, task_id: 'dup-a', seq: 2, prev_hash: 'aa', row_hash: 'bb' },
    { agent_id: 3, task_id: 'dup-b', seq: 2, prev_hash: 'aa', row_hash: '' },
  ];
  fs.writeFileSync(jsonl, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const out = spawnSync(process.execPath, [
    'scripts/backfill-receipt-log.mjs',
    '--jsonl', jsonl,
    '--dir', dir,
  ], { cwd: gatewayRoot, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /would list as unlogged dup-a forked/);
  assert.match(out.stdout, /would list as unlogged dup-b forked/);
  assert.match(out.stderr, /would list as unlogged 2 row\(s\)/);
  assert.doesNotMatch(out.stdout + out.stderr, /epoch1_has_no_receipt_leaf/);
});

test('clean rows append and the pinned epoch bytes stay put', () => {
  const anchor = 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af';
  const rows = [
    { agent_id: 7, task_id: 'older', seq: 1, prev_hash: null, row_hash: 'h0' },
    { agent_id: 7, task_id: anchor, seq: 2, prev_hash: 'h0', row_hash: 'h1' },
    { agent_id: 7, task_id: 'leaf-2', seq: 3, prev_hash: 'h1', row_hash: 'h2' },
    { agent_id: 7, task_id: 'leaf-3', seq: 4, prev_hash: 'h2', row_hash: 'h3' },
    { agent_id: 9, task_id: 'openai-old', seq: 1, prev_hash: null, row_hash: '' },
    { agent_id: 9, task_id: 'openai-next', seq: 2, prev_hash: null, row_hash: 'stored-next' },
    { agent_id: 149, task_id: 'fork-149-a', seq: 1, prev_hash: null, row_hash: 'fa' },
    { agent_id: 149, task_id: 'fork-149-b', seq: 1, prev_hash: null, row_hash: 'fb' },
    { agent_id: 187, task_id: 'fork-187-a', seq: 2, prev_hash: 'gone', row_hash: 'ga' },
    { agent_id: 187, task_id: 'fork-187-b', seq: 1, prev_hash: null, row_hash: 'gb' },
    { agent_id: 8, task_id: 'board-clean', seq: 1, prev_hash: null, row_hash: 'clean-hash' },
    { agent_id: 7, task_id: 'xfuel-clean', seq: 5, prev_hash: 'h3', row_hash: 'h4' },
  ];
  const tree = new ReceiptMerkleTree();
  tree.closedEpochs = [{
    epoch: 1,
    status: 'closed',
    root: EPOCH1_FINAL_ROOT,
    meta: [
      { task_id: 'genesis', kind: 'genesis' },
      { task_id: anchor, kind: 'receipt' },
      { task_id: 'leaf-2', kind: 'receipt' },
      { task_id: 'leaf-3', kind: 'receipt' },
    ],
    leaves: [Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)],
  }];
  tree.epoch = 2;
  tree.prevEpochRoot = EPOCH1_FINAL_ROOT;
  tree.prevEpochSize = 4;
  const opening = epochLeafHash(genesisBytes(EPOCH2_GENESIS_DIGEST));
  tree.leaves = [opening];
  tree.meta = [{ task_id: 'genesis', kind: 'genesis', epoch: 2 }];
  tree.byTask = new Map([['genesis', 0]]);
  tree.epochRecord = epochRecordClaims();
  const plan = planReceiptBackfill(tree, rows);
  const again = planReceiptBackfill(tree, rows);
  assert.deepEqual(again, plan);
  assert.deepEqual(plan.append.map((row) => row.task_id), ['board-clean', 'xfuel-clean']);
  assert.deepEqual(plan.append.map((row) => row.row_hash), ['clean-hash', 'h4']);
  assert.deepEqual(plan.unlogged.map((row) => [row.task_id, row.reason]), [
    ['openai-old', 'missing_row_hash'],
    ['openai-next', 'depends_on_refused'],
    ['fork-149-a', 'forked'],
    ['fork-149-b', 'forked'],
    ['fork-187-a', 'forked'],
    ['fork-187-b', 'forked'],
  ]);
  const v1 = epochRecordClaims();
  const v2 = epochRecordWithUnlogged(v1, plan.unlogged);
  assert.equal(v1.payload_version, 1);
  assert.equal(v1.unlogged, undefined);
  assert.equal(v2.payload_version, 2);
  assert.equal(JSON.stringify(v2.epochs), JSON.stringify(v1.epochs));
  assert.equal(JSON.stringify(v2.orphans), JSON.stringify(v1.orphans));
  const stale = epochRecordClaims();
  stale.orphans = stale.orphans.filter((row) => row.root !== 'ff950e7204762565751e1c7a6bfbdb167c15452f26259a97f63a2c90b2f61ec3')
    .map((row) => (row.root_prefix === 'd7f6c548' || String(row.root || '').startsWith('20d88791')
      ? { ...row, chain: 'base' }
      : row));
  const corrected = epochRecordWithUnlogged(stale, plan.unlogged);
  assert.equal(JSON.stringify(corrected.epochs), JSON.stringify(stale.epochs));
  assert.notEqual(JSON.stringify(corrected.orphans), JSON.stringify(stale.orphans));
  assert.equal(corrected.orphans.find((row) => String(row.root || '').startsWith('ff950e72')).chain, 'base');
  assert.equal(corrected.orphans.find((row) => String(row.root || '').startsWith('ff950e72')).solana, 'absent');
  assert.equal(corrected.orphans.find((row) => String(row.root || '').startsWith('20d88791')).chain, 'base_and_solana');
  assert.equal(corrected.orphans.find((row) => row.root_prefix === 'd7f6c548').chain, 'base_and_solana');
  assert.equal(corrected.orphans.find((row) => row.root_prefix === 'd7f6c548').root, null);
  assert.equal(v2.epochs[0].final_root, EPOCH1_FINAL_ROOT);
  assert.equal(v2.epochs[0].final_size, 4);
  assert.equal(v2.epochs[1].opening_root, EPOCH2_OPENING_ROOT);
  assert.equal(v2.unlogged.count, plan.unlogged.length);
  assert.equal(v2.unlogged.hash.length, 64);
  const epoch1Before = tree.closedEpochs[0].root;
  const openingBefore = Buffer.from(tree.leaves[0]).toString('hex');
  assert.equal(openingBefore, EPOCH2_OPENING_ROOT);
  for (const row of plan.append) tree.appendReceipt(row.task_id, row.row_hash, { publish: false });
  assert.equal(tree.closedEpochs[0].root, epoch1Before);
  assert.equal(tree.closedEpochs[0].root, EPOCH1_FINAL_ROOT);
  assert.equal(Buffer.from(tree.leaves[0]).toString('hex'), EPOCH2_OPENING_ROOT);
  assert.equal(tree.epoch, 2);
  assert.equal(tree.leaves.length, 3);
  assert.equal(tree.heads.length, 0);
  const listed = attestedUnloggedEntry({ ...v2, payload_version: 2 }, 'openai-next');
  assert.equal(listed.reason, 'depends_on_refused');
  assert.equal(attestedUnloggedEntry(v1, 'openai-next'), null);
});

test('inclusion of an unlogged id returns the signed reason', async () => {
  const claims = epochRecordWithUnlogged(epochRecordClaims(), [
    { task_id: 'openai-old', agent_id: 4, reason: 'missing_row_hash' },
  ]);
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-epoch+jwt' });
  const record = { ...claims, issuer_signature: { jws, kid } };
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  const prevDir = process.env.RECEIPT_LOG_DIR;
  delete process.env.RECEIPT_LOG_BOOT;
  delete process.env.RECEIPT_LOG_DIR;
  resetReceiptMerkleTree();
  let server;
  try {
    const { createApp } = await import('../src/server.js');
    const app = createApp();
    getReceiptMerkleTree().epochRecord = record;
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const port = server.address().port;
    const inclusion = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/v1/receipts/openai-old/inclusion`, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode,
          json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      }).on('error', reject);
    });
    assert.equal(inclusion.status, 404);
    assert.equal(inclusion.json.error, 'not_in_tree');
    assert.equal(inclusion.json.reason, 'missing_row_hash');
    assert.equal(inclusion.json.agent_id, 4);
    const epoch = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/v1/receipts/tree/epoch`, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      }).on('error', reject);
    });
    assert.equal(epoch.payload_version, 2);
    assert.equal(epoch.epochs[0].final_root, EPOCH1_FINAL_ROOT);
    assert.equal(epoch.epochs[1].opening_root, EPOCH2_OPENING_ROOT);
    assert.equal(epoch.unlogged.rows[0].reason, 'missing_row_hash');
    assert.equal(JSON.stringify(epoch.orphans), JSON.stringify(epochRecordClaims().orphans));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    if (prevDir == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prevDir;
    resetReceiptMerkleTree();
  }
});

test('rebuild refuses to sign when ISSUER_PRIVATE_KEY is unset', () => {
  const dir = tmp();
  const jsonl = path.join(dir, 'book.jsonl');
  const outDir = path.join(dir, 'receipt-log');
  fs.writeFileSync(jsonl, '{}\n');
  const env = { ...process.env, ISSUER_PRIVATE_KEY: '' };
  const out = spawnSync(process.execPath, [
    'scripts/rebuild-receipt-epoch1.mjs',
    '--jsonl', jsonl,
    '--out', outDir,
  ], { cwd: gatewayRoot, encoding: 'utf8', env });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /REFUSED: ISSUER_PRIVATE_KEY is not set/);
  assert.match(out.stderr, /ephemeral key/);
  assert.match(out.stderr, /no_matching_key/);
  assert.equal(fs.existsSync(path.join(outDir, 'journal.jsonl')), false);
  assert.doesNotMatch(out.stderr, /epoch record signed: true/);
});

test('rebuild with a configured key still refuses a book that is not epoch 1', () => {
  const dir = tmp();
  const jsonl = path.join(dir, 'book.jsonl');
  const outDir = path.join(dir, 'receipt-log');
  fs.writeFileSync(jsonl, JSON.stringify({
    agent_id: 1,
    task_id: 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af',
    row_hash: 'not-the-historical-row',
  }) + '\n');
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const env = { ...process.env, ISSUER_PRIVATE_KEY: Buffer.from(pem).toString('base64') };
  const out = spawnSync(process.execPath, [
    'scripts/rebuild-receipt-epoch1.mjs',
    '--jsonl', jsonl,
    '--out', outDir,
  ], { cwd: gatewayRoot, encoding: 'utf8', env });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /REFUSED:/);
  assert.match(out.stderr, /epoch1_root_mismatch|epoch 1 must recompute/);
  assert.doesNotMatch(out.stderr, /ephemeral key/);
  assert.doesNotMatch(out.stderr, /epoch record signed: true/);
  assert.equal(fs.existsSync(path.join(outDir, 'journal.jsonl')), false);
});

test('backfill names a directory that has no journal', () => {
  const dir = tmp();
  const jsonl = path.join(dir, 'book.jsonl');
  const logDir = path.join(dir, 'receipt-log');
  fs.writeFileSync(jsonl, '{}\n');
  fs.mkdirSync(logDir);
  const out = spawnSync(process.execPath, [
    'scripts/backfill-receipt-log.mjs',
    '--jsonl', jsonl,
    '--dir', logDir,
  ], { cwd: gatewayRoot, encoding: 'utf8' });
  assert.notEqual(out.status, 0);
  assert.ok(out.stderr.includes(`REFUSED: no journal at ${logDir}`), out.stderr);
  assert.doesNotMatch(out.stderr, /epoch1_has_no_receipt_leaf/);
});

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('xfuel-verify --rpc accepts a published v2 head and rejects a forged epoch', async () => {
  const dir = tmp();
  const claims = epochRecordClaims();
  const signed = signJws(claims, { typ: 'chit402-tree-epoch+jwt' });
  const jwk = { ...getIssuerPublicKeyJwk(), kid: signed.kid };
  const record = {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-epoch+jwt',
      payload_version: 1,
      jws: signed.jws,
      kid: signed.kid,
      issuer_jwk: jwk,
    },
  };
  const genesis = genesisBytes(EPOCH2_GENESIS_DIGEST);
  const lines = [
    { v: 1, op: 'epoch_open', epoch: 2, prev_epoch_root: EPOCH1_FINAL_ROOT, prev_epoch_size: 4 },
    {
      v: 1, op: 'leaf', epoch: 2, index: 0, task_id: 'genesis', kind: 'genesis',
      preimage_b64: genesis.toString('base64'),
    },
    {
      v: 1, op: 'leaf', epoch: 2, index: 1, task_id: 'cli-row', kind: 'receipt',
      preimage_b64: Buffer.from('cli-row|cli-hash').toString('base64'),
    },
    { v: 1, op: 'epoch_record', record },
  ];
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${lines.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const prevSol = process.env.SOLANA_ANCHOR_SECRET_KEY;
  const prevCluster = process.env.SOLANA_ANCHOR_CLUSTER;
  const prevBase = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  const prevLogDir = process.env.RECEIPT_LOG_DIR;
  process.env.SOLANA_ANCHOR_SECRET_KEY = solanaKeypair().json;
  process.env.SOLANA_ANCHOR_CLUSTER = 'devnet';
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  delete process.env.RECEIPT_LOG_BOOT;
  delete process.env.RECEIPT_LOG_DIR;
  resetReceiptMerkleTree();
  const tree = getReceiptMerkleTree();
  tree.load(dir);
  const baseTx = `0x${'44'.repeat(32)}`;
  const head = await tree.publishHead({
    force: true,
    now: '2026-10-06T12:00:00.000Z',
    nonce: 7,
    blockTimestamp: Math.floor(Date.parse('2026-10-06T12:00:00.000Z') / 1000),
    solanaBlockTime: null,
    solanaConnection: mockConnection(),
    lookup: async (intent) => ({
      receiptOk: true,
      tx: intent.tx,
      root: intent.root,
      from: intent.from,
      to: intent.to,
      nonce: intent.nonce,
    }),
    send: async () => baseTx,
  });
  assert.equal(head.schema, 'chit402.tree_head.v2');
  assert.equal(head.epoch, 2);
  assert.ok(head.anchors.base.from);
  assert.ok(head.anchors.solana.fee_payer);
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const gateway = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const gatewayPort = gateway.address().port;
  const rpc = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const msg = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      let result = null;
      if (msg.method === 'eth_chainId') result = '0x2105';
      else       if (msg.method === 'eth_getTransactionByHash') {
        result = { hash: baseTx, input: `0x${head.root}`, from: head.anchors.base.from };
      } else if (msg.method === 'getTransaction') {
        result = {
          slot: head.anchors.solana.slot,
          meta: { err: null },
          transaction: {
            message: {
              accountKeys: [{ pubkey: head.anchors.solana.fee_payer, signer: true, writable: true }],
              instructions: [{ program: 'spl-memo', parsed: head.anchors.solana.memo }],
            },
          },
        };
      } else if (msg.method === 'getGenesisHash') {
        result = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      } else if (msg.method === 'getSignaturesForAddress') {
        result = [{ signature: head.anchors.solana.signature, err: null }];
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  const rpcPort = await listen(rpc);
  const work = tmp();
  const receiptPath = path.join(work, 'receipt.json');
  const inclusionPath = path.join(work, 'inclusion.json');
  const headPath = path.join(work, 'head.json');
  const jwksPath = path.join(work, 'jwks.json');
  // Log mode fails a receipt that has no issuer signature, even when the anchor matches.
  // verify_url stays outside the signature so the epoch fetch is not a signed claim.
  const receiptClaims = {
    task_id: 'cli-row',
    row_hash: 'cli-hash',
  };
  const receiptSig = signJws(receiptClaims, { typ: 'chit402-receipt+jwt' });
  const verifyUrl = `http://127.0.0.1:${gatewayPort}/receipt/cli-row`;
  fs.writeFileSync(receiptPath, JSON.stringify({
    ...receiptClaims,
    verify_url: verifyUrl,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-receipt+jwt',
      jws: receiptSig.jws,
      kid: receiptSig.kid,
      issuer_jwk: jwk,
    },
  }));
  const unsignedPath = path.join(work, 'receipt-unsigned.json');
  fs.writeFileSync(unsignedPath, JSON.stringify({
    ...receiptClaims,
    verify_url: verifyUrl,
  }));
  fs.writeFileSync(inclusionPath, JSON.stringify(tree.inclusion('cli-row')));
  fs.writeFileSync(headPath, JSON.stringify(head));
  fs.writeFileSync(jwksPath, JSON.stringify({ keys: [jwk] }));
  const { currentAnchorWallets, resetAnchorWalletCache } = await import('../src/anchor-wallets.js');
  resetAnchorWalletCache();
  const walletsPath = path.join(work, 'wallets.json');
  fs.writeFileSync(walletsPath, JSON.stringify(currentAnchorWallets()));
  const verifyRoot = path.resolve(gatewayRoot, '../../packages/verify');
  const built = spawnSync(path.join(verifyRoot, 'node_modules/.bin/tsc'), [], { cwd: verifyRoot, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const cli = path.join(verifyRoot, 'dist/cli.js');
  const args = [
    cli, receiptPath, inclusionPath, headPath,
    '--rpc', `http://127.0.0.1:${rpcPort}`,
    '--solana-rpc', `http://127.0.0.1:${rpcPort}`,
    '--jwks-file', jwksPath,
    '--trusted-kid', signed.kid,
    '--anchor-wallets-file', walletsPath,
    '--no-issuer-history',
    '--no-preimage',
    '--json',
  ];
  try {
    const unsigned = await runCli([cli, unsignedPath, ...args.slice(2)]);
    assert.equal(unsigned.status, 1, unsigned.stdout + unsigned.stderr);
    const unsignedBody = JSON.parse(unsigned.stdout);
    assert.equal(unsignedBody.overall, 'failed');
    assert.equal(unsignedBody.receipt_check.overall, 'partial');
    assert.ok(
      unsignedBody.errors.includes('No issuer signature present on receipt'),
      unsignedBody.errors.join(','),
    );
    const ok = await runCli(args);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const forgedClaims = epochRecordClaims({ epoch1Root: 'ab'.repeat(32) });
    const forgedSig = signJws(forgedClaims, { typ: 'chit402-tree-epoch+jwt' });
    tree.epochRecord = {
      ...forgedClaims,
      issuer_signature: {
        alg: 'ES256',
        typ: 'chit402-tree-epoch+jwt',
        payload_version: 1,
        jws: forgedSig.jws,
        kid: forgedSig.kid,
        issuer_jwk: jwk,
      },
    };
    const forged = await runCli(args);
    assert.notEqual(forged.status, 0);
    assert.match(forged.stdout + forged.stderr, /epoch1_root|epoch_record_missing|epoch_signature/);
  } finally {
    await new Promise((resolve) => gateway.close(resolve));
    await new Promise((resolve) => rpc.close(resolve));
    if (prevSol == null) delete process.env.SOLANA_ANCHOR_SECRET_KEY;
    else process.env.SOLANA_ANCHOR_SECRET_KEY = prevSol;
    if (prevCluster == null) delete process.env.SOLANA_ANCHOR_CLUSTER;
    else process.env.SOLANA_ANCHOR_CLUSTER = prevCluster;
    if (prevBase == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevBase;
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    if (prevLogDir == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prevLogDir;
    resetReceiptMerkleTree();
  }
});

test('epoch 1 inclusion names the pin anchors and the closed head is signed', async () => {
  const pin = readReceiptLogPin();
  const pair = closedEpochAnchorPair(pin, 1, EPOCH1_FINAL_ROOT, 4);
  assert.equal(pair.base.tx, '0x1d8d7ea255170c8d4b87bef9382e13555dded2072fd877ce35f995f1ab54ee09');
  assert.equal(pair.solana.tx, '61RHMsPPseUc35v5oxDEtANEDCvXk5fmxZdrFDMknGWc5m7U8YhMfz4En1eFFj3z9n67ZtMiha1zkwnneL2LUiXk');
  assert.equal(pair.solana.slot, 452921175);
  const historical = signPinnedClosedHead({
    epoch: 1,
    root: EPOCH1_FINAL_ROOT,
    treeSize: 4,
    prevEpochRoot: null,
    prevEpochSize: 0,
    base: pair.base,
    solana: pair.solana,
  });
  assert.equal(historical.root, EPOCH1_FINAL_ROOT);
  assert.equal(historical.tree_size, 4);
  assert.equal(historical.anchors.base.status, 'anchored');
  assert.equal(historical.anchors.base.tx, pair.base.tx);
  assert.equal(historical.anchors.solana.signature, pair.solana.tx);
  assert.equal(historical.anchors.solana.cluster, 'mainnet-beta');
  assert.equal(historical.anchors.solana.memo, EPOCH1_FINAL_SOLANA_MEMO);
  assert.equal(historical.anchors.solana.slot, 452921175);
  assert.equal(historical.anchors.base.from, '0x1844D1F5FE42aff1Cce6F776514Fd40374079582');
  assert.equal(historical.anchor_from, '0x1844D1F5FE42aff1Cce6F776514Fd40374079582');
  assert.equal(historical.anchors.solana.fee_payer, 'BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD');
  assert.equal(verifyTreeHead(historical).valid, true);
  const epochClaims = epochRecordClaims();
  assert.equal(JSON.stringify(epochClaims.epochs).includes('fee_payer'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(epochClaims, 'fee_payer'), false);
  assert.equal(epochClaims.epochs[0].final_root, EPOCH1_FINAL_ROOT);
  assert.equal(epochClaims.epochs[1].opening_root, EPOCH2_OPENING_ROOT);

  const rows = [
    { task_id: 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af', row_hash: 'row-1' },
    { task_id: 'leaf-2', row_hash: 'row-2' },
    { task_id: 'leaf-3', row_hash: 'row-3' },
  ];
  const preimages = [
    genesisBytes(EPOCH1_GENESIS_DIGEST),
    Buffer.from(`${rows[0].task_id}|${rows[0].row_hash}`),
    Buffer.from(`${rows[1].task_id}|${rows[1].row_hash}`),
    Buffer.from(`${rows[2].task_id}|${rows[2].row_hash}`),
  ];
  const want = hex(rootOf(preimages.map((body) => epochLeafHash(body))));
  const rebuilt = rebuildEpoch1FromRows(rows, { expectRoot: want });
  assert.notEqual(rebuilt.root, EPOCH1_FINAL_ROOT);

  const prevBoot = process.env.RECEIPT_LOG_BOOT;
  const prevDir = process.env.RECEIPT_LOG_DIR;
  const prevPin = process.env.RECEIPT_LOG_PIN_FILE;
  process.env.RECEIPT_LOG_BOOT = '0';
  delete process.env.RECEIPT_LOG_DIR;
  delete process.env.RECEIPT_LOG_PIN_FILE;
  resetReceiptMerkleTree();
  const tree = getReceiptMerkleTree();
  const dir = tmp();
  tree.dir = dir;
  const meta = rebuilt.preimages.map((body, index) => ({
    task_id: index === 0 ? 'genesis' : String(rebuilt.rows[index - 1].task_id),
    index,
    kind: index === 0 ? 'genesis' : 'receipt',
    preimage_b64: Buffer.from(body).toString('base64'),
    epoch: 1,
  }));
  const byTask = new Map();
  meta.forEach((item, index) => {
    if (item.task_id) byTask.set(String(item.task_id), index);
  });
  tree.closedEpochs = [{
    epoch: 1,
    status: 'closed',
    prevEpochRoot: null,
    prevEpochSize: 0,
    leaves: rebuilt.leaves,
    meta,
    byTask,
    heads: [],
  }];
  tree.epoch = 2;
  tree.prevEpochRoot = rebuilt.root;
  tree.prevEpochSize = 4;
  tree.leaves = [epochLeafHash(genesisBytes(EPOCH2_GENESIS_DIGEST))];
  tree.heads = [];
  tree.byTask = new Map();
  assert.equal(hex(rootOf(tree.leaves)), EPOCH2_OPENING_ROOT);
  assert.equal(tree.signedClosedEpochHead(1), null);
  const pending = tree.inclusion(rows[0].task_id);
  assert.equal(pending.epoch, 1);
  assert.equal(pending.root, want);
  assert.equal(pending.anchor_status, 'pending');
  assert.equal(pending.anchor_tx, null);

  const baseTx = `0x${'ab'.repeat(32)}`;
  const solSig = 'SyntheticSig111111111111111111111111111111111111111111111111111111111111111111111';
  const pinPath = path.join(dir, 'pin.json');
  fs.writeFileSync(pinPath, JSON.stringify({
    epochs: [{ epoch: 1, root: want, tree_size: 4 }],
    anchors: [
      { chain: 'base', root: want, tx: baseTx, epoch: 1, tree_size: 4, in_journal: true },
      { chain: 'solana', root: want, tx: solSig, slot: 7, epoch: 1, tree_size: 4, in_journal: true },
    ],
  }));
  process.env.RECEIPT_LOG_PIN_FILE = pinPath;
  const head = tree.signedClosedEpochHead(1);
  const again = tree.signedClosedEpochHead(1);
  assert.equal(head.issuer_signature.jws, again.issuer_signature.jws);
  assert.equal(head.root, want);
  assert.equal(head.tree_size, 4);
  assert.equal(head.anchors.base.tx, baseTx);
  assert.equal(head.anchors.solana.signature, solSig);
  assert.equal(verifyTreeHead(head).valid, true);
  const inc = tree.inclusion(rows[0].task_id);
  assert.equal(inc.anchor_status, 'anchored');
  assert.equal(inc.anchor_tx, baseTx);
  assert.equal(inc.solana_signature, solSig);
  assert.equal(fs.existsSync(path.join(dir, 'journal.jsonl')), false);

  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const served = await fetch(`${base}/v1/receipts/tree/epoch/1/head`);
    const body = await served.json();
    assert.equal(served.status, 200);
    assert.equal(body.root, want);
    assert.equal(body.tree_size, 4);
    assert.equal(body.anchors.base.tx, baseTx);
    assert.equal(body.anchors.solana.signature, solSig);
    assert.equal(body.issuer_signature.jws, head.issuer_signature.jws);
    const live = await fetch(`${base}/v1/receipts/tree/head`);
    const liveBody = await live.json();
    assert.equal(liveBody.status, 'not_yet_published');
    assert.equal(liveBody.epoch, 2);
    assert.equal(liveBody.root, EPOCH2_OPENING_ROOT);
    const openEpoch = await fetch(`${base}/v1/receipts/tree/epoch/2/head`);
    const openBody = await openEpoch.json();
    assert.equal(openBody.status, 'not_yet_published');
    const inclusionRes = await fetch(`${base}/v1/receipts/${rows[0].task_id}/inclusion`);
    const inclusionBody = await inclusionRes.json();
    assert.equal(inclusionBody.anchor_status, 'anchored');
    assert.equal(inclusionBody.anchor_tx, baseTx);
    assert.equal(inclusionBody.solana_signature, solSig);
    assert.equal(fs.existsSync(path.join(dir, 'journal.jsonl')), false);
    assert.equal(epochRecordClaims().epochs[0].final_root, EPOCH1_FINAL_ROOT);
    assert.equal(epochRecordClaims().epochs[1].opening_root, EPOCH2_OPENING_ROOT);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevBoot == null) delete process.env.RECEIPT_LOG_BOOT;
    else process.env.RECEIPT_LOG_BOOT = prevBoot;
    if (prevDir == null) delete process.env.RECEIPT_LOG_DIR;
    else process.env.RECEIPT_LOG_DIR = prevDir;
    if (prevPin == null) delete process.env.RECEIPT_LOG_PIN_FILE;
    else process.env.RECEIPT_LOG_PIN_FILE = prevPin;
    resetReceiptMerkleTree();
  }
});
