/**
 * A journal that already holds a publish/append raced head must boot.
 * That head is quarantined and is not served. A root that matches no
 * prefix, and a tampered signature, still refuse the load.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const {
  ReceiptMerkleTree,
  resetReceiptMerkleTree,
  getReceiptMerkleTree,
  verifyInclusion,
  renderInclusionSection,
  rootOf,
} = await import('../src/receipt-merkle.js');
const { readReceiptLog, appendJournal, ReceiptLogRefused } = await import('../src/receipt-log-store.js');
const { signJws, getIssuerPublicKeyJwk } = await import('../src/issuer-key.js');

function tmp() {
  return mkdtempSync(join(tmpdir(), 'chit-quarantine-'));
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function journalHash(dir) {
  const body = fs.readFileSync(join(dir, 'journal.jsonl'));
  return createHash('sha256').update(body).digest('hex');
}

function withAnchorKey(fn) {
  const saved = { ...process.env };
  process.env.RECEIPT_LOG_BOOT = '0';
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.RECEIPT_LOG_DIR;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env = saved;
      resetReceiptMerkleTree();
    });
}

function publishOpts(now) {
  return {
    force: true,
    now,
    nonce: 4,
    blockTimestamp: Math.floor(Date.parse(now) / 1000),
    lookup: async (intent) => ({
      receiptOk: true,
      receiptStatus: '0x1',
      tx: intent.tx,
      root: intent.root,
      from: intent.from,
      to: intent.to,
      nonce: intent.nonce,
    }),
    send: async (args) => args.hash,
  };
}

function signHead(claims) {
  const { jws, kid } = signJws(claims, { typ: 'chit402-tree-head+jwt' });
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-tree-head+jwt',
      payload_version: 2,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
}

function racedClaims(tree, treeSize, root, { tx = `0x${'cd'.repeat(32)}` } = {}) {
  return {
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: tree.epoch,
    prev_epoch_root: tree.prevEpochRoot,
    prev_epoch_size: tree.prevEpochSize,
    prev_root: '0'.repeat(64),
    tree_size: treeSize,
    root,
    anchor_status: 'anchored',
    anchor_tx: tx,
    anchor_from: `0x${'11'.repeat(20)}`,
    published_at: '2026-10-09T10:23:55.000Z',
    anchors: {
      base: { status: 'anchored', tx, chain_id: 8453, from: `0x${'11'.repeat(20)}` },
      solana: { status: 'pending', signature: null },
    },
  };
}

async function journalWithGoodHead() {
  const dir = tmp();
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  for (const id of ['a', 'b', 'c']) tree.appendReceipt(id, `r${id}`, { publish: false });
  const good = await tree.publishHead(publishOpts('2026-10-08T05:32:00.000Z'));
  assert.equal(good.tree_size, 4);
  for (const id of ['d', 'e']) tree.appendReceipt(id, `r${id}`, { publish: false });
  assert.equal(tree.leaves.length, 6);
  return { dir, tree, good };
}

function noVerified(value) {
  assert.equal(JSON.stringify(value).includes('VERIFIED'), false);
}

test('a raced head is quarantined, /health shows it, and inclusion uses the last good head', async () => {
  await withAnchorKey(async () => {
    const { dir, tree, good } = await journalWithGoodHead();
    const prefixRoot = hex(rootOf(tree.leaves.slice(0, 5)));
    const raced = signHead(racedClaims(tree, 6, prefixRoot));
    appendJournal(dir, { v: 1, op: 'head', epoch: tree.epoch, head: raced });
    const before = journalHash(dir);

    const replayed = readReceiptLog(dir, { strict: true });
    const open = replayed.epochs[replayed.epochs.length - 1];
    assert.equal(open.quarantinedHeads.length, 1);
    assert.equal(open.quarantinedHeads[0].epoch, tree.epoch);
    assert.equal(open.quarantinedHeads[0].tree_size, 6);
    assert.equal(open.quarantinedHeads[0].prefix_size, 5);
    assert.equal(open.heads.some((head) => head.root === raced.root && head.tree_size === 6), false);

    resetReceiptMerkleTree();
    const loaded = getReceiptMerkleTree();
    loaded.load(dir);
    assert.equal(journalHash(dir), before);
    assert.equal(loaded.quarantinedHeads.length, 1);
    assert.ok(loaded.bootWarnings.some((line) => /QUARANTINE/.test(line)));
    assert.equal(loaded.heads.some((head) => head.root === raced.root), false);
    assert.equal(loaded.latestSignedHead().root, good.root);
    assert.equal(loaded.latestSignedHead().tree_size, 4);
    assert.equal(loaded.bundleStatus().quarantined_heads.count, 1);
    assert.deepEqual(loaded.bundleStatus().quarantined_heads.heads, [{
      epoch: tree.epoch,
      tree_size: 6,
      prefix_size: 5,
    }]);

    const inside = loaded.inclusion('b');
    assert.equal(inside.status, 'anchored');
    assert.equal(inside.root, good.root);
    assert.equal(inside.head.root, good.root);
    assert.equal(inside.head.tree_size, 4);
    assert.notEqual(inside.head.signature.jws, raced.issuer_signature.jws);
    const leaf = loaded.leaves[inside.leaf_index];
    assert.equal(verifyInclusion(leaf, inside.leaf_index, inside.tree_size, inside.root, inside.proof), true);
    noVerified(inside);
    assert.equal(renderInclusionSection(inside).includes('VERIFIED'), false);

    const past = loaded.inclusion('e');
    assert.equal(past.status, 'pending_anchor');
    assert.equal(past.head.root, good.root);
    assert.equal(past.head.tree_size, 4);
    assert.equal(past.proof, null);
    noVerified(past);
    assert.equal(renderInclusionSection(past).includes('VERIFIED'), false);

    assert.throws(
      () => loaded.inclusion('b', { treeSize: 6 }),
      (err) => err.code === 'no_signed_head',
    );

    const { createApp } = await import('../src/server.js');
    const app = createApp();
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const healthRes = await fetch(`${base}/health`);
      const health = await healthRes.json();
      assert.equal(health.status, 'degraded');
      assert.equal(health.quarantined_heads.count, 1);
      assert.deepEqual(health.quarantined_heads.heads, [{
        epoch: tree.epoch,
        tree_size: 6,
        prefix_size: 5,
      }]);
      assert.equal(JSON.stringify(health).includes('VERIFIED'), false);
      const inclusionRes = await fetch(`${base}/v1/receipts/b/inclusion`);
      const body = await inclusionRes.json();
      assert.equal(inclusionRes.status, 200);
      assert.equal(body.root, good.root);
      assert.equal(body.head.root, good.root);
      assert.equal(JSON.stringify(body).includes(raced.root), false);
      assert.equal(JSON.stringify(body).includes('VERIFIED'), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('a head whose root matches no prefix still throws ReceiptLogRefused', async () => {
  await withAnchorKey(async () => {
    const { dir, tree } = await journalWithGoodHead();
    const forged = signHead(racedClaims(tree, tree.leaves.length, 'ab'.repeat(32), {
      tx: `0x${'ee'.repeat(32)}`,
    }));
    appendJournal(dir, { v: 1, op: 'head', epoch: tree.epoch, head: forged });
    assert.throws(
      () => readReceiptLog(dir, { strict: true }),
      (err) => err instanceof ReceiptLogRefused && err.code === 'root_mismatch',
    );
    assert.throws(
      () => new ReceiptMerkleTree().load(dir),
      (err) => err instanceof ReceiptLogRefused && err.code === 'root_mismatch',
    );
  });
});

test('a tampered signature is refused and is not quarantined', async () => {
  await withAnchorKey(async () => {
    const matching = await journalWithGoodHead();
    const lines = fs.readFileSync(join(matching.dir, 'journal.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const headLine = lines.find((row) => row.op === 'head');
    headLine.head.issuer_signature.jws = `${headLine.head.issuer_signature.jws.slice(0, -4)}AAAA`;
    const tamperedDir = tmp();
    fs.writeFileSync(join(tamperedDir, 'journal.jsonl'), `${lines.map((row) => JSON.stringify(row)).join('\n')}\n`);
    assert.throws(
      () => new ReceiptMerkleTree().load(tamperedDir),
      (err) => err instanceof ReceiptLogRefused && err.code === 'head_signature',
    );

    const raced = await journalWithGoodHead();
    const prefixRoot = hex(rootOf(raced.tree.leaves.slice(0, 5)));
    const bad = signHead(racedClaims(raced.tree, 6, prefixRoot));
    bad.issuer_signature.jws = `${bad.issuer_signature.jws.slice(0, -4)}AAAA`;
    appendJournal(raced.dir, { v: 1, op: 'head', epoch: raced.tree.epoch, head: bad });
    assert.throws(
      () => readReceiptLog(raced.dir, { strict: true }),
      (err) => err instanceof ReceiptLogRefused && err.code === 'head_signature',
    );
  });
});

test('RECEIPT_LOG_STRICT still gates a missing journal and still refuses a bad root', async () => {
  await withAnchorKey(async () => {
    const missing = tmp();
    fs.writeFileSync(join(missing, 'anchor-state.json'), JSON.stringify({
      schema: 'chit402.receipt_anchor_state.v1',
      solana: { 'global|2026-10-05': { status: 'anchored', signature: 'sig' } },
      base: {},
    }));
    assert.throws(
      () => readReceiptLog(missing, { strict: true }),
      (err) => err.code === 'missing_log',
    );
    const loose = readReceiptLog(missing, { strict: false });
    assert.equal(loose.empty, true);
    assert.equal(loose.missingWhileAnchored, true);

    const { dir, tree } = await journalWithGoodHead();
    const forged = signHead(racedClaims(tree, tree.leaves.length, 'cd'.repeat(32)));
    appendJournal(dir, { v: 1, op: 'head', epoch: tree.epoch, head: forged });
    assert.throws(
      () => readReceiptLog(dir, { strict: false }),
      (err) => err.code === 'root_mismatch',
    );

    const unsigned = await journalWithGoodHead();
    const smaller = hex(rootOf(unsigned.tree.leaves.slice(0, 5)));
    appendJournal(unsigned.dir, {
      v: 1,
      op: 'head',
      epoch: unsigned.tree.epoch,
      head: {
        schema: 'chit402.tree_head.v2',
        epoch: unsigned.tree.epoch,
        tree_size: 6,
        root: smaller,
        signed: false,
      },
    });
    assert.throws(
      () => readReceiptLog(unsigned.dir, { strict: false }),
      (err) => err.code === 'root_mismatch',
    );
  });
});
