/**
 * Inclusion default fix. T1–T21 from the security review.
 * A broadcast head is served as anchored only from tracker facts.
 * Stored heads and the journal are not re-signed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_LOG_BOOT = '0';
delete process.env.RECEIPT_LOG_DIR;
delete process.env.SOLANA_ANCHOR_SECRET_KEY;
delete process.env.SOLANA_RPC_URL;
delete process.env.BASE_RPC_URL;
delete process.env.SETTLEMENT_RPC_URL;

const {
  ReceiptMerkleTree,
  confirmAnchor,
  headAnchorFacts,
  headChainFacts,
  inclusionHeadUrl,
  latestBaseIntentForRoot,
  resetReceiptMerkleTree,
  getReceiptMerkleTree,
  verifyInclusion,
  rootOf,
  signPinnedClosedHead,
  closedEpochAnchorPair,
} = await import('../src/receipt-merkle.js');
const { readReceiptLogPin } = await import('../src/receipt-log-anchor.js');
const { appendJournal, writeAnchorState, ANCHOR_STATE_NAME, JOURNAL_NAME } = await import('../src/receipt-log-store.js');
const { signJws, getIssuerPublicKeyJwk, _resetIssuerKey } = await import('../src/issuer-key.js');
const { renderReceiptShellHtml, toPublicShell, shellProofLinks } = await import('../src/receipt-shell.js');
const {
  EPOCH1_ANCHOR_TASK,
  EPOCH1_GENESIS_DIGEST,
  EPOCH2_GENESIS_DIGEST,
  EPOCH2_OPENING_ROOT,
  genesisBytes,
  epochLeafHash,
  rebuildEpoch1FromRows,
  EPOCH1_FINAL_ROOT,
} = await import('../src/receipt-log-epoch.js');

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

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

function visibleFor(intent) {
  return {
    visible: true,
    tx: intent.tx,
    root: intent.root,
    from: intent.from,
    to: intent.to,
    nonce: intent.nonce,
  };
}

function withAnchorKey(fn) {
  const saved = { ...process.env };
  process.env.RECEIPT_LOG_BOOT = '0';
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  delete process.env.SOLANA_ANCHOR_SECRET_KEY;
  delete process.env.SOLANA_RPC_URL;
  delete process.env.BASE_RPC_URL;
  delete process.env.SETTLEMENT_RPC_URL;
  delete process.env.RECEIPT_LOG_DIR;
  return Promise.resolve().then(fn).finally(() => {
    process.env = saved;
    resetReceiptMerkleTree();
  });
}

function treeAt(dir) {
  const tree = new ReceiptMerkleTree();
  tree.dir = dir;
  return tree;
}

function grow(tree, n, prefix) {
  const ids = [];
  while (tree.leaves.length < n) {
    const id = `${prefix}-${tree.leaves.length}`;
    tree.appendReceipt(id, `row-${id}`, { publish: false });
    ids.push(id);
  }
  return ids;
}

async function publishAnchored(tree, now, nonce = 4) {
  const blockTimestamp = Math.floor(Date.parse(now) / 1000);
  return tree.publishHead({
    force: true,
    now,
    nonce,
    blockTimestamp,
    sleep: async () => {},
    lookup: async (intent) => receiptFor(intent, { blockTimestamp }),
    send: async (args) => args.hash,
  });
}

async function publishBroadcast(tree, now, nonce = 5) {
  return tree.publishHead({
    force: true,
    now,
    nonce,
    sleep: async () => {},
    lookup: async (intent) => visibleFor(intent),
    send: async (args) => args.hash,
  });
}

function stampUpgrade(tree, head, { blockTs, receipt = true, status = 'anchored', tx, from, chainId = 8453, nonce } = {}) {
  const root = String(head.root).replace(/^0x/, '');
  const base = head.anchors.base;
  const useTx = tx === undefined ? base.tx : tx;
  const useFrom = from === undefined ? base.from : from;
  const intent = latestBaseIntentForRoot(tree.anchorIntents, root);
  const useNonce = nonce === undefined ? intent?.nonce : nonce;
  tree.anchorState.base[root] = {
    status: 'anchored',
    tx: useTx,
    from: useFrom,
    chain_id: chainId,
    nonce: useNonce ?? null,
    calldata: base.calldata || null,
    receipt_confirmed: receipt === true,
    ...(blockTs != null ? { block_ts: blockTs } : {}),
  };
  if (intent && status) {
    tree._markIntent(intent, status, {
      tx: useTx,
      from: useFrom,
      ...(blockTs != null ? { block_ts: blockTs } : {}),
    });
  }
  if (tree.dir) tree._writeSnapshot();
  return intent;
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

async function listen(tree) {
  resetReceiptMerkleTree();
  const live = getReceiptMerkleTree();
  Object.assign(live, tree);
  live.heads = tree.heads;
  live.leaves = tree.leaves;
  live.byTask = tree.byTask;
  live.meta = tree.meta;
  live.anchorState = tree.anchorState;
  live.anchorIntents = tree.anchorIntents;
  live.closedEpochs = tree.closedEpochs;
  live.quarantinedHeads = tree.quarantinedHeads;
  live.epoch = tree.epoch;
  live.prevEpochRoot = tree.prevEpochRoot;
  live.prevEpochSize = tree.prevEpochSize;
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('T1 tracker-confirmed broadcast head is the default inclusion', async () => {
  await withAnchorKey(async () => {
    const dir = tmp('chit-t1-');
    const tree = treeAt(dir);
    grow(tree, 4, 't1');
    const anchored = await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    assert.equal(anchored.tree_size, 4);
    assert.equal(headAnchorFacts(anchored).anchored, true);
    grow(tree, 11, 't1');
    const publishedAt = '2026-10-09T10:23:55.863Z';
    const broadcast = await publishBroadcast(tree, publishedAt, 5);
    assert.equal(broadcast.tree_size, 11);
    assert.equal(broadcast.anchors.base.status, 'broadcast');
    const before = JSON.stringify(broadcast);
    const blockTs = Math.floor(Date.parse(publishedAt) / 1000) + 1;
    stampUpgrade(tree, broadcast, { blockTs });
    assert.equal(JSON.stringify(broadcast), before);
    assert.equal(broadcast.anchors.base.status, 'broadcast');
    const inc = tree.inclusion('t1-0');
    assert.equal(inc.tree_size, 11);
    assert.equal(inc.status, 'anchored');
    assert.equal(inc.anchor_confirmed_by, 'anchor_state');
    assert.equal(inc.anchors.base.status, 'broadcast');
    assert.equal(inc.head.anchored, true);
    assert.equal(inc.head.anchored_signed, false);
    const leaf = tree.leaves[inc.leaf_index];
    assert.equal(verifyInclusion(leaf, inc.leaf_index, inc.tree_size, inc.root, inc.proof), true);
    assert.equal(inc.root, broadcast.root);
  });
});

test('T2 a tracker row without receipt_confirmed is not upgraded', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t2-'));
    grow(tree, 4, 't2');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't2');
    const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
    const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000);
    stampUpgrade(tree, broadcast, { blockTs, receipt: false });
    const inc = tree.inclusion('t2-0');
    assert.equal(inc.tree_size, 4);
    assert.equal(inc.anchor_confirmed_by, 'signed_head');
  });
});

test('T3 broadcast, signed, blocked, and mempool-only intents stay at size 4', async () => {
  await withAnchorKey(async () => {
    for (const status of ['broadcast', 'signed', 'blocked']) {
      const tree = treeAt(tmp('chit-t3-'));
      grow(tree, 4, 't3');
      await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
      grow(tree, 11, 't3');
      const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
      const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000);
      stampUpgrade(tree, broadcast, { blockTs, status });
      if (status !== 'anchored') {
        const inc = tree.inclusion('t3-0');
        assert.equal(inc.tree_size, 4, status);
      }
    }
    const tree = treeAt(tmp('chit-t3b-'));
    grow(tree, 4, 't3b');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't3b');
    await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
    assert.equal(tree.inclusion('t3b-0').tree_size, 4);
  });
});

test('T4 reverted and replaced transactions are not anchored', async () => {
  await withAnchorKey(async () => {
    assert.equal(confirmAnchor({
      receiptStatus: '0x0',
      root: 'ab'.repeat(32),
      from: '0x1',
      to: '0x1',
      wantRoot: 'ab'.repeat(32),
      wantFrom: '0x1',
      wantTo: '0x1',
      tx: '0xabc',
    }), null);
    for (const found of [
      { receiptStatus: '0x0', reason: 'receipt_failed' },
      { replaced: true, reason: 'nonce_replaced' },
    ]) {
      const tree = treeAt(tmp('chit-t4-'));
      grow(tree, 4, 't4');
      await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
      grow(tree, 11, 't4');
      const head = await tree.publishHead({
        force: true,
        now: '2026-10-09T10:23:55.863Z',
        nonce: 5,
        sleep: async () => {},
        lookup: async (intent) => ({
          ...found,
          tx: intent.tx,
          root: intent.root,
          from: intent.from,
          to: intent.to,
          nonce: intent.nonce,
        }),
        send: async (args) => args.hash,
      });
      assert.equal(head.anchor_status, 'broadcast');
      assert.equal(headAnchorFacts(head).anchored, false);
      const root = String(head.root).replace(/^0x/, '');
      const intent = latestBaseIntentForRoot(tree.anchorIntents, root);
      assert.equal(intent.status, 'replaced');
      assert.equal(tree.inclusion('t4-0').tree_size, 4);
      assert.notEqual(tree.anchorState.base[root]?.receipt_confirmed, true);
    }
  });
});

test('T5 tx, from, nonce, and chain must match the signed head', async () => {
  await withAnchorKey(async () => {
    const cases = [
      { name: 'tx', patch: { tx: `0x${'12'.repeat(32)}` } },
      { name: 'from', patch: { from: `0x${'22'.repeat(20)}` } },
      { name: 'nonce', patch: { nonce: 99 } },
      { name: 'chain', patch: { chainId: 1 } },
    ];
    for (const item of cases) {
      const tree = treeAt(tmp('chit-t5-'));
      grow(tree, 4, 't5');
      await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
      grow(tree, 11, 't5');
      const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
      const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000);
      stampUpgrade(tree, broadcast, { blockTs, ...item.patch });
      assert.equal(tree.inclusion('t5-0').tree_size, 4, item.name);
      assert.equal(headChainFacts(broadcast, tree.anchorState, tree.anchorIntents).anchored, false, item.name);
    }
  });
});

test('T6 a tracker entry for a different root is not this head', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t6-'));
    grow(tree, 4, 't6');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't6');
    const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
    const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000);
    const intent = latestBaseIntentForRoot(tree.anchorIntents, broadcast.root);
    tree.anchorState.base['cd'.repeat(32)] = {
      status: 'anchored',
      tx: broadcast.anchors.base.tx,
      from: broadcast.anchors.base.from,
      chain_id: 8453,
      nonce: intent.nonce,
      receipt_confirmed: true,
      block_ts: blockTs,
    };
    tree._markIntent(intent, 'anchored', { tx: intent.tx, from: intent.from, block_ts: blockTs });
    assert.equal(tree.inclusion('t6-0').tree_size, 4);

    const mismatch = await tree.publishHead({
      force: true,
      now: '2026-10-09T11:00:00.000Z',
      nonce: 6,
      sleep: async () => {},
      lookup: async (intentRow) => ({
        receiptOk: true,
        receiptStatus: '0x1',
        tx: intentRow.tx,
        root: 'ab'.repeat(32),
        from: intentRow.from,
        to: intentRow.to,
        nonce: intentRow.nonce,
      }),
      send: async (args) => args.hash,
    });
    assert.notEqual(mismatch.anchor_status, 'anchored');
    assert.equal(confirmAnchor({
      receiptStatus: '0x1',
      root: 'ab'.repeat(32),
      wantRoot: broadcast.root,
      from: '0xabc',
      to: '0xabc',
      wantFrom: '0xabc',
      wantTo: '0xabc',
      tx: '0x1',
    }), null);
  });
});

test('T7 block time is required and boot can backfill it', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t7-'));
    grow(tree, 4, 't7');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't7');
    const publishedAt = '2026-10-09T10:23:55.863Z';
    const broadcast = await publishBroadcast(tree, publishedAt, 5);
    const published = Math.floor(Date.parse(publishedAt) / 1000);
    stampUpgrade(tree, broadcast, { blockTs: published + 301 });
    assert.equal(tree.inclusion('t7-0').tree_size, 4);
    const root = String(broadcast.root).replace(/^0x/, '');
    delete tree.anchorState.base[root].block_ts;
    const intent = latestBaseIntentForRoot(tree.anchorIntents, root);
    assert.equal(headChainFacts(broadcast, tree.anchorState, tree.anchorIntents).anchored, false);

    const prod = treeAt(tmp('chit-t7b-'));
    grow(prod, 4, 't7b');
    await publishAnchored(prod, '2026-10-08T05:32:00.000Z', 4);
    grow(prod, 11, 't7b');
    const sized = await publishBroadcast(prod, publishedAt, 5);
    stampUpgrade(prod, sized, { blockTs: null });
    const key = String(sized.root).replace(/^0x/, '');
    delete prod.anchorState.base[key].block_ts;
    assert.equal(prod.inclusion('t7b-0').tree_size, 4);
    const blockTs = published + 2;
    await prod.reconcileAnchorIntents({
      readBlockTs: async () => blockTs,
    });
    assert.equal(prod.anchorState.base[key].block_ts, blockTs);
    assert.equal(latestBaseIntentForRoot(prod.anchorIntents, key).block_ts, blockTs);
    const inc = prod.inclusion('t7b-0');
    assert.equal(inc.tree_size, 11);
    assert.equal(inc.anchor_confirmed_by, 'anchor_state');
    assert.equal(intent == null, false);
  });
});

test('T8 a quarantined size is never served beside a valid head of that size', async () => {
  await withAnchorKey(async () => {
    const dir = tmp('chit-t8-');
    const tree = treeAt(dir);
    grow(tree, 4, 't8');
    const small = await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't8');
    const publishedAt = '2026-10-09T10:23:55.863Z';
    const valid = await publishBroadcast(tree, publishedAt, 5);
    const blockTs = Math.floor(Date.parse(publishedAt) / 1000) + 1;
    stampUpgrade(tree, valid, { blockTs });
    const prefix = hex(rootOf(tree.leaves.slice(0, 10)));
    const raced = signHead({
      schema: 'chit402.tree_head.v2',
      payload_version: 2,
      epoch: tree.epoch,
      prev_epoch_root: tree.prevEpochRoot,
      prev_epoch_size: tree.prevEpochSize,
      prev_root: '0'.repeat(64),
      tree_size: 11,
      root: prefix,
      anchor_status: 'anchored',
      anchor_tx: `0x${'cd'.repeat(32)}`,
      anchor_from: valid.anchors.base.from,
      published_at: publishedAt,
      anchors: {
        base: {
          status: 'anchored',
          tx: `0x${'cd'.repeat(32)}`,
          chain_id: 8453,
          from: valid.anchors.base.from,
        },
        solana: { status: 'pending', signature: null },
      },
    });
    tree.anchorState.base[prefix] = {
      status: 'anchored',
      tx: raced.anchors.base.tx,
      from: raced.anchors.base.from,
      chain_id: 8453,
      receipt_confirmed: true,
      block_ts: blockTs,
    };
    tree._writeSnapshot();
    appendJournal(dir, { v: 1, op: 'head', epoch: tree.epoch, head: raced });
    const loaded = new ReceiptMerkleTree();
    loaded.load(dir);
    assert.equal(loaded.quarantinedHeads.length, 1);
    assert.equal(loaded.heads.some((head) => head.root === prefix), false);
    const inc = loaded.inclusion('t8-0');
    assert.equal(inc.tree_size, 11);
    assert.equal(inc.root, valid.root);
    assert.equal(JSON.stringify(inc).includes(prefix), false);
    assert.equal(loaded.signedHeadAt(11).root, valid.root);
    const http = await listen(loaded);
    try {
      const sized = await fetch(`${http.base}/v1/receipts/tree/head?tree_size=11`);
      const body = await sized.json();
      assert.equal(sized.status, 200);
      assert.equal(body.root, valid.root);
      assert.equal(JSON.stringify(body).includes(prefix), false);
      const incl = await fetch(`${http.base}/v1/receipts/t8-0/inclusion`);
      const inclBody = await incl.json();
      assert.equal(inclBody.root, valid.root);
      assert.equal(JSON.stringify(inclBody).includes(prefix), false);
    } finally {
      await http.close();
    }

    const only = treeAt(tmp('chit-t8b-'));
    grow(only, 4, 't8b');
    await publishAnchored(only, '2026-10-08T05:32:00.000Z', 4);
    grow(only, 11, 't8b');
    const racedOnly = signHead({
      schema: 'chit402.tree_head.v2',
      payload_version: 2,
      epoch: only.epoch,
      prev_epoch_root: only.prevEpochRoot,
      prev_epoch_size: only.prevEpochSize,
      prev_root: small.prev_root || '0'.repeat(64),
      tree_size: 11,
      root: hex(rootOf(only.leaves.slice(0, 10))),
      anchor_status: 'anchored',
      anchor_tx: `0x${'ef'.repeat(32)}`,
      anchor_from: `0x${'11'.repeat(20)}`,
      published_at: publishedAt,
      anchors: {
        base: { status: 'anchored', tx: `0x${'ef'.repeat(32)}`, chain_id: 8453, from: `0x${'11'.repeat(20)}` },
        solana: { status: 'pending', signature: null },
      },
    });
    appendJournal(only.dir, { v: 1, op: 'head', epoch: only.epoch, head: racedOnly });
    const quarantined = new ReceiptMerkleTree();
    quarantined.load(only.dir);
    assert.equal(quarantined.heads.some((head) => head.tree_size === 11), false);
    assert.throws(() => quarantined.signedHeadAt(11), (err) => err.code === 'no_signed_head');
    assert.throws(
      () => quarantined.inclusion('t8b-1', { treeSize: 11 }),
      (err) => err.code === 'no_signed_head',
    );
    assert.equal(JSON.stringify(quarantined.inclusion('t8b-0')).includes(racedOnly.root), false);
  });
});

test('T9 a bad upgraded head is refused with no fallback', async () => {
  await withAnchorKey(async () => {
    async function sized() {
      const tree = treeAt(tmp('chit-t9-'));
      grow(tree, 4, 't9');
      await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
      grow(tree, 11, 't9');
      const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
      const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000) + 1;
      stampUpgrade(tree, broadcast, { blockTs });
      return tree;
    }
    const badSig = await sized();
    const head = badSig.heads[badSig.heads.length - 1];
    head.issuer_signature = { ...head.issuer_signature, jws: `${head.issuer_signature.jws.slice(0, -4)}AAAA` };
    assert.throws(() => badSig.inclusion('t9-0'), (err) => err.code === 'head_rejected');
    assert.equal(badSig.laneHeadsFor('t9-0').frontierRejected, true);
    assert.deepEqual(badSig.laneHeadsFor('t9-0').heads, []);

    const badRoot = await sized();
    const rootHead = badRoot.heads[badRoot.heads.length - 1];
    rootHead.tree_size = 4;
    assert.throws(() => badRoot.inclusion('t9-0'), (err) => err.code === 'head_mismatch' || err.code === 'head_rejected');
    assert.equal(badRoot.laneHeadsFor('t9-0').frontierRejected, true);

    const tooBig = await sized();
    tooBig.heads[tooBig.heads.length - 1].tree_size = 99;
    assert.throws(() => tooBig.inclusion('t9-0'), (err) => err.code === 'head_mismatch' || err.code === 'head_rejected');
    assert.equal(tooBig.laneHeadsFor('t9-0').frontierRejected, true);
  });
});

test('T10 reads do not rewrite the head, the journal, or the anchor file', async () => {
  await withAnchorKey(async () => {
    const dir = tmp('chit-t10-');
    const tree = treeAt(dir);
    grow(tree, 4, 't10');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't10');
    const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
    const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000) + 1;
    stampUpgrade(tree, broadcast, { blockTs });
    const headsBefore = tree.heads.map((head) => JSON.stringify(head));
    const journal = sha256File(path.join(dir, JOURNAL_NAME));
    const anchorFile = path.join(dir, ANCHOR_STATE_NAME);
    const anchorBefore = fs.readFileSync(anchorFile);
    for (let i = 0; i < 1000; i += 1) tree.inclusion('t10-0');
    assert.deepEqual(tree.heads.map((head) => JSON.stringify(head)), headsBefore);
    assert.equal(sha256File(path.join(dir, JOURNAL_NAME)), journal);
    assert.equal(fs.readFileSync(anchorFile).equals(anchorBefore), true);
  });
});

test('T11 the upgrade survives reboot and fails closed without the tracker', async () => {
  await withAnchorKey(async () => {
    const dir = tmp('chit-t11-');
    const tree = treeAt(dir);
    grow(tree, 4, 't11');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't11');
    const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
    const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000) + 1;
    stampUpgrade(tree, broadcast, { blockTs });
    const reloaded = new ReceiptMerkleTree();
    reloaded.load(dir);
    assert.equal(reloaded.inclusion('t11-0').tree_size, 11);
    assert.equal(reloaded.inclusion('t11-0').anchor_confirmed_by, 'anchor_state');

    const stripped = tmp('chit-t11b-');
    cpSync(dir, stripped, { recursive: true });
    const state = JSON.parse(fs.readFileSync(path.join(stripped, ANCHOR_STATE_NAME), 'utf8'));
    state.base = {};
    fs.writeFileSync(path.join(stripped, ANCHOR_STATE_NAME), `${JSON.stringify(state)}\n`);
    const closed = new ReceiptMerkleTree();
    closed.load(stripped);
    assert.equal(closed.inclusion('t11-0').tree_size, 4);

    const replacedDir = tmp('chit-t11c-');
    cpSync(dir, replacedDir, { recursive: true });
    const root = String(broadcast.root).replace(/^0x/, '');
    appendJournal(replacedDir, {
      v: 1,
      op: 'anchor_intent',
      chain: 'base',
      root,
      day: '2026-10-09',
      nonce: 5,
      tx: broadcast.anchors.base.tx,
      from: broadcast.anchors.base.from,
      status: 'replaced',
      reason: 'reorg',
    });
    const after = new ReceiptMerkleTree();
    after.load(replacedDir);
    assert.equal(after.inclusion('t11-0').tree_size, 4);
  });
});

const ROLLBACK_COMMIT = '484c5b7e6657aed4a56a78f2a3b4b5c1ff0271b2';

function gitResult(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

/** Actions checkout is depth 1, so the rollback commit is not in the clone. */
function ensureRollbackCommit() {
  if (gitResult(['cat-file', '-e', `${ROLLBACK_COMMIT}^{commit}`]).status === 0) return;
  const fetched = gitResult(['fetch', '--depth=1', 'origin', ROLLBACK_COMMIT]);
  if (gitResult(['cat-file', '-e', `${ROLLBACK_COMMIT}^{commit}`]).status !== 0) {
    throw new Error(`commit ${ROLLBACK_COMMIT} is not in this clone\n${fetched.stderr || fetched.stdout || ''}`);
  }
}

function extractRollback(pathspec, dest) {
  ensureRollbackCommit();
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['archive', ROLLBACK_COMMIT, pathspec], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const extract = spawn('tar', ['-x', '-C', dest], { stdio: ['pipe', 'pipe', 'pipe'] });
    let gitErr = '';
    let tarErr = '';
    let gitCode = null;
    let tarCode = null;
    const finish = () => {
      if (gitCode === null || tarCode === null) return;
      if (gitCode !== 0) reject(new Error(`git archive ${gitCode}: ${gitErr}`));
      else if (tarCode !== 0) reject(new Error(`tar ${tarCode}: ${tarErr}`));
      else resolve();
    };
    child.stderr.on('data', (chunk) => { gitErr += chunk; });
    extract.stderr.on('data', (chunk) => { tarErr += chunk; });
    child.stdout.pipe(extract.stdin);
    child.on('error', reject);
    extract.on('error', reject);
    child.on('exit', (code) => { gitCode = code ?? 1; finish(); });
    extract.on('exit', (code) => { tarCode = code ?? 1; finish(); });
  });
}

test('T12 a log with block_ts still boots on 484c5b7e', async () => {
  await withAnchorKey(async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const issuerPem = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
    process.env.ISSUER_PRIVATE_KEY = issuerPem;
    _resetIssuerKey();
    const dir = tmp('chit-t12-');
    const tree = treeAt(dir);
    grow(tree, 4, 't12');
    const head = await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    const blockTs = Math.floor(Date.parse(head.published_at) / 1000);
    const root = String(head.root).replace(/^0x/, '');
    tree.anchorState.base[root] = {
      ...(tree.anchorState.base[root] || {}),
      block_ts: blockTs,
      receipt_confirmed: true,
    };
    tree._markIntent(latestBaseIntentForRoot(tree.anchorIntents, root), 'anchored', {
      tx: head.anchors.base.tx,
      from: head.anchors.base.from,
      block_ts: blockTs,
    });
    tree._writeSnapshot();
    const self = new ReceiptMerkleTree();
    self.load(dir);
    const selfHead = self.heads[self.heads.length - 1];
    const { verifyTreeHead } = await import('../src/receipt-merkle.js');
    const selfCheck = verifyTreeHead(selfHead);
    if (!selfCheck.valid) throw new Error(`parent ${selfCheck.reason}`);
    const plain = tmp('chit-t12-plain-');
    cpSync(dir, plain, { recursive: true });
    const strip = (value, keep = false) => {
      if (Array.isArray(value)) return value.map((item) => strip(item, keep));
      if (!value || typeof value !== 'object') return value;
      const signedHead = keep || value.op === 'head' || Boolean(value.issuer_signature);
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === 'block_ts' && !signedHead) continue;
        out[key] = strip(item, signedHead);
      }
      return out;
    };
    for (const name of fs.readdirSync(plain)) {
      const file = path.join(plain, name);
      if (!name.endsWith('.json') && !name.endsWith('.jsonl')) continue;
      if (name.endsWith('.jsonl')) {
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.stringify(strip(JSON.parse(line))));
        fs.writeFileSync(file, `${lines.join('\n')}\n`);
      } else {
        fs.writeFileSync(file, `${JSON.stringify(strip(JSON.parse(fs.readFileSync(file, 'utf8'))))}\n`);
      }
    }
    const oldRoot = tmp('chit-t12-old-');
    fs.mkdirSync(oldRoot, { recursive: true });
    await extractRollback('services/gateway/src', oldRoot);
    if (!fs.existsSync(path.join(oldRoot, 'services', 'gateway', 'src', 'receipt-merkle.js'))) {
      throw new Error('484c5b7e archive did not contain services/gateway/src');
    }
    const pkgDir = path.join(oldRoot, 'services', 'gateway');
    fs.symlinkSync(path.join(repoRoot, 'services', 'gateway', 'node_modules'), path.join(pkgDir, 'node_modules'));
    const runner = path.join(oldRoot, 't12-run.mjs');
    fs.writeFileSync(runner, [
      "const dir = process.argv[2];",
      "const task = process.argv[3];",
      "const { ReceiptMerkleTree } = await import('./services/gateway/src/receipt-merkle.js');",
      "const tree = new ReceiptMerkleTree();",
      "tree.load(dir);",
      "const inc = tree.inclusion(task);",
      "if (!inc) throw new Error('old inclusion missing');",
      "const rest = { ...inc };",
      "delete rest.verified_at;",
      "process.stdout.write(JSON.stringify(rest));",
    ].join('\n'));
    const run = (logDir) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runner, logDir, 't12-0'], {
        cwd: oldRoot,
        env: { ...process.env, ISSUER_PRIVATE_KEY: issuerPem, NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(err || out || `old gateway exited ${code}`));
          return;
        }
        const line = out.split('\n').map((row) => row.trim()).filter((row) => row.startsWith('{')).pop();
        try {
          resolve(JSON.parse(line));
        } catch (parseErr) {
          reject(new Error(`${parseErr.message}\n${out}\n${err}`));
        }
      });
    });
    const withField = await run(dir);
    const withoutField = await run(plain);
    assert.deepEqual(withField, withoutField);
    assert.equal(withField.tree_size, 4);
  });
});

test('T13 reopen drops the upgrade in process and after reboot', async () => {
  await withAnchorKey(async () => {
    const dir = tmp('chit-t13-');
    const tree = treeAt(dir);
    grow(tree, 4, 't13');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 11, 't13');
    const broadcast = await publishBroadcast(tree, '2026-10-09T10:23:55.863Z', 5);
    const blockTs = Math.floor(Date.parse(broadcast.published_at) / 1000) + 1;
    stampUpgrade(tree, broadcast, { blockTs });
    assert.equal(tree.inclusion('t13-0').tree_size, 11);
    tree._reopenAnchored(broadcast.root, broadcast.anchors.base.tx, 'reorg');
    assert.equal(tree.inclusion('t13-0').tree_size, 4);
    const loaded = new ReceiptMerkleTree();
    loaded.load(dir);
    assert.equal(loaded.inclusion('t13-0').tree_size, 4);
    const root = String(broadcast.root).replace(/^0x/, '');
    assert.notEqual(loaded.anchorState.base[root]?.receipt_confirmed, true);
    assert.notEqual(latestBaseIntentForRoot(loaded.anchorIntents, root)?.status, 'anchored');
  });
});

test('T14 a closed epoch pairs with its pinned head, not the open size', async () => {
  await withAnchorKey(async () => {
    const pair = closedEpochAnchorPair(readReceiptLogPin(), 1, EPOCH1_FINAL_ROOT, 4);
    const historical = signPinnedClosedHead({
      epoch: 1,
      root: EPOCH1_FINAL_ROOT,
      treeSize: 4,
      prevEpochRoot: null,
      prevEpochSize: 0,
      base: pair.base,
      solana: pair.solana,
    });
    assert.equal(historical.root.startsWith('dd20'), true);
    assert.equal(inclusionHeadUrl({ status: 'closed', epoch: 1 }, 4), '/v1/receipts/tree/epoch/1/head');

    const rows = [
      { task_id: EPOCH1_ANCHOR_TASK, row_hash: 'row-1' },
      { task_id: 'leaf-2', row_hash: 'row-2' },
      { task_id: 'leaf-3', row_hash: 'row-3' },
    ];
    const preimages = [
      genesisBytes(EPOCH1_GENESIS_DIGEST),
      ...rows.map((row) => Buffer.from(`${row.task_id}|${row.row_hash}`)),
    ];
    const want = hex(rootOf(preimages.map((body) => epochLeafHash(body))));
    const rebuilt = rebuildEpoch1FromRows(rows, { expectRoot: want });
    assert.notEqual(rebuilt.root, EPOCH1_FINAL_ROOT);
    const dir = tmp('chit-t14-');
    const tree = treeAt(dir);
    const meta = rebuilt.preimages.map((body, index) => ({
      task_id: index === 0 ? 'genesis' : String(rebuilt.rows[index - 1].task_id),
      index,
      kind: index === 0 ? 'genesis' : 'receipt',
      preimage_b64: Buffer.from(body).toString('base64'),
      epoch: 1,
    }));
    const byTask = new Map(meta.map((item, index) => [String(item.task_id), index]));
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
    tree.byTask = new Map();
    tree.heads = [];
    assert.equal(hex(rootOf(tree.leaves)), EPOCH2_OPENING_ROOT);
    grow(tree, 4, 'e2');
    const openHead = await publishAnchored(tree, '2026-10-09T12:00:00.000Z', 4);
    assert.equal(openHead.tree_size, 4);
    assert.notEqual(openHead.root, rebuilt.root);
    const pinPath = path.join(dir, 'pin.json');
    fs.writeFileSync(pinPath, JSON.stringify({
      epochs: [{ epoch: 1, root: want, tree_size: 4 }],
      anchors: [
        { chain: 'base', root: want, tx: `0x${'ab'.repeat(32)}`, epoch: 1, tree_size: 4, in_journal: true },
        { chain: 'solana', root: want, tx: 'SyntheticSig111111111111111111111111111111111111111111111111111111111111111111111111111', slot: 7, epoch: 1, tree_size: 4, in_journal: true },
      ],
    }));
    process.env.RECEIPT_LOG_PIN_FILE = pinPath;
    const inc = tree.inclusion(EPOCH1_ANCHOR_TASK);
    assert.equal(inc.epoch, 1);
    assert.equal(inc.tree_size, 4);
    assert.equal(inc.root, want);
    assert.notEqual(inc.root, openHead.root);
    assert.equal(inc.head_url, '/v1/receipts/tree/epoch/1/head');
    assert.equal(inc.head_url.includes('tree_size=4'), false);
    assert.equal(inc.head.root, want);
  });
});

test('T15 tree_size on /tree/head is strict and uncached', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t15-'));
    grow(tree, 4, 't15');
    const head = await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    const http = await listen(tree);
    try {
      const bad = ['0', '01', '+1', '-1', '1e1', '1.0', '0x4', '9'.repeat(40), '4&tree_size=5'];
      for (const value of bad) {
        const url = value.includes('&')
          ? `${http.base}/v1/receipts/tree/head?tree_size=${value}`
          : `${http.base}/v1/receipts/tree/head?tree_size=${encodeURIComponent(value)}`;
        const res = await fetch(url);
        const body = await res.json();
        assert.equal(res.status, 400, value);
        assert.deepEqual(body, { error: 'bad_tree_size' });
      }
      const empty = await fetch(`${http.base}/v1/receipts/tree/head?tree_size=`);
      const emptyBody = await empty.json();
      assert.equal(empty.status, 200);
      assert.equal(empty.headers.get('cache-control'), null);
      const { receipt_log: emptyLog, ...emptyRest } = emptyBody;
      assert.equal(emptyLog == null, false);
      assert.deepEqual(emptyRest, head);
      const plain = await fetch(`${http.base}/v1/receipts/tree/head`);
      const plainBody = await plain.json();
      assert.equal(plain.headers.get('cache-control'), null);
      const { receipt_log: plainLog, ...plainRest } = plainBody;
      assert.deepEqual(plainRest, head);
      assert.equal(Object.prototype.hasOwnProperty.call(plainRest, 'anchor_confirmed_by'), false);
      const over = await fetch(`${http.base}/v1/receipts/tree/head?tree_size=5`);
      assert.equal(over.status, 400);
      assert.deepEqual(await over.json(), { error: 'bad_tree_size' });
      const sized = await fetch(`${http.base}/v1/receipts/tree/head?tree_size=4`);
      const sizedBody = await sized.json();
      assert.equal(sized.status, 200);
      assert.equal(sized.headers.get('cache-control'), 'private, no-store');
      assert.equal(sizedBody.root, head.root);
      assert.equal(sizedBody.anchor_confirmed_by, 'signed_head');
      assert.equal(sizedBody.issuer_signature.jws, head.issuer_signature.jws);
    } finally {
      await http.close();
    }
  });
});

test('T16 page links name one inclusion and one head', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t16-'));
    grow(tree, 4, 't16');
    const head = await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 5, 't16');
    const included = tree.inclusion('t16-0');
    const pending = tree.inclusion('t16-4');
    const shell = toPublicShell({ task_id: 't16-0', issuer_signature: { jws: head.issuer_signature.jws } }, {
      inclusion: included,
      signedHead: head,
    });
    const html = renderReceiptShellHtml(shell, {
      publicBaseUrl: 'https://evil.example',
      inclusion: included,
    });
    assert.match(html, new RegExp(`href="/v1/receipts/t16-0/inclusion\\?tree_size=${included.tree_size}"`));
    assert.match(html, new RegExp(`href="${included.head_url.replace('?', '\\?')}"`));
    assert.equal(html.includes('evil.example/v1/'), false);
    assert.equal(shellProofLinks('t16-4', pending).inclusion, `/v1/receipts/t16-4/inclusion?tree_size=${pending.tree_size}`);
    assert.equal(shellProofLinks('t16-4', pending).head, pending.head_url);
    const http = await listen(tree);
    try {
      const reflected = await fetch(`${http.base}/v1/receipts/t16-0/inclusion`, {
        headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
      });
      const body = await reflected.json();
      assert.equal(JSON.stringify(body).includes('evil.example'), false);
      assert.equal(body.head_url, included.head_url);
      const proofRes = await fetch(`${http.base}${body.head_url}`);
      const proofHead = await proofRes.json();
      const leaf = tree.leaves[body.leaf_index];
      assert.equal(verifyInclusion(leaf, body.leaf_index, body.tree_size, proofHead.root, body.proof), true);
      const pendingRes = await fetch(`${http.base}/v1/receipts/t16-4/inclusion`);
      const pendingBody = await pendingRes.json();
      assert.equal(pendingBody.head_url, `/v1/receipts/tree/head?tree_size=${pendingBody.tree_size}`);
      const pendingHead = await (await fetch(`${http.base}${pendingBody.head_url}`)).json();
      assert.equal(pendingHead.root, pendingBody.root);
      assert.equal(pendingHead.tree_size, pendingBody.tree_size);
    } finally {
      await http.close();
    }
  });
});

test('T17 the confirm poll commits on the third lookup', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t17-'));
    grow(tree, 4, 't17');
    let sleeps = 0;
    let tries = 0;
    const now = '2026-10-09T10:23:55.863Z';
    const blockTimestamp = Math.floor(Date.parse(now) / 1000);
    const head = await tree.publishHead({
      force: true,
      now,
      nonce: 4,
      blockTimestamp,
      sleep: async () => { sleeps += 1; },
      lookup: async (intent) => {
        tries += 1;
        if (tries < 3) return visibleFor(intent);
        return receiptFor(intent, { blockTimestamp });
      },
      send: async (args) => args.hash,
    });
    assert.equal(tries, 3);
    assert.equal(sleeps, 2);
    assert.equal(head.anchor_status, 'anchored');
    assert.equal(head.anchors.base.receipt_confirmed, true);
  });
});

test('T18 the poll stops on the deadline and a hung lookup', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t18-'));
    grow(tree, 4, 't18');
    let now = 1_000_000;
    let lookups = 0;
    const hungClock = await tree.publishHead({
      force: true,
      now: '2026-10-09T10:23:55.863Z',
      nonce: 4,
      sleep: async (ms) => { now += ms; },
      nowMs: () => now,
      lookup: async (intent) => {
        lookups += 1;
        now += 10_000;
        return visibleFor(intent);
      },
      send: async (args) => args.hash,
    });
    assert.equal(hungClock.anchor_status, 'broadcast');
    assert.ok(lookups < 6, `lookups ${lookups}`);
    assert.equal(tree._publishActive, false);

    const hungTree = treeAt(tmp('chit-t18b-'));
    grow(hungTree, 4, 't18b');
    hungTree.anchorRpcTimeoutMs = 30;
    const started = Date.now();
    const hung = await hungTree.publishHead({
      force: true,
      now: '2026-10-09T11:23:55.863Z',
      nonce: 4,
      sleep: async () => {},
      lookup: () => new Promise(() => {}),
      send: async (args) => args.hash,
    });
    assert.equal(hung.anchor_status, 'broadcast');
    assert.ok(Date.now() - started < 2000);
    assert.equal(hungTree._publishActive, false);
    const next = await publishAnchored(hungTree, '2026-10-09T12:23:55.863Z', 5);
    assert.equal(next.anchor_status, 'anchored');
  });
});

test('T19 a mempool tx keeps polling and does not stick the nonce', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t19-'));
    grow(tree, 4, 't19');
    let tries = 0;
    const head = await tree.publishHead({
      force: true,
      now: '2026-10-09T10:23:55.863Z',
      nonce: 4,
      sleep: async () => {},
      lookup: async (intent) => {
        tries += 1;
        return visibleFor(intent);
      },
      send: async (args) => args.hash,
    });
    assert.equal(tries, 6);
    assert.equal(head.anchor_status, 'broadcast');
    assert.equal(tree.lastAnchorError ?? null, null);
    assert.equal(tree.stuckPendingAt ?? null, null);
    assert.equal(tree.bundleStatus().last_error == null || tree.bundleStatus().last_error !== 'prior_nonce_pending', true);
    assert.notEqual(tree.bundleStatus().last_error, 'prior_nonce_pending');
  });
});

test('T20 an append during the poll does not change the signed snapshot', async () => {
  await withAnchorKey(async () => {
    const tree = treeAt(tmp('chit-t20-'));
    grow(tree, 4, 't20');
    await publishAnchored(tree, '2026-10-08T05:32:00.000Z', 4);
    grow(tree, 6, 't20');
    const snapshotSize = tree.leaves.length;
    const snapshotRoot = hex(rootOf(tree.leaves));
    let sends = 0;
    const now = '2026-10-09T10:23:55.863Z';
    const blockTimestamp = Math.floor(Date.parse(now) / 1000);
    const head = await tree.publishHead({
      force: true,
      now,
      nonce: 5,
      blockTimestamp,
      sleep: async () => {},
      lookup: async (intent) => {
        if (String(intent.root).replace(/^0x/, '') !== snapshotRoot) return { replaced: true, reason: 'unexpected_root', tx: intent.tx };
        for (let i = 0; i < 10; i += 1) {
          tree.appendReceipt(`t20-late-${i}`, `row-${i}`, { publish: true });
        }
        return receiptFor(intent, { blockTimestamp });
      },
      send: async (args) => {
        sends += 1;
        return args.hash;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(head.tree_size, snapshotSize);
    assert.equal(head.root, snapshotRoot);
    assert.equal(head.anchor_status, 'anchored');
    assert.equal(sends, 1);
    const late = tree.inclusion('t20-late-0');
    assert.equal(late.status, 'pending_anchor');
    assert.equal(late.proof, null);
    assert.equal(late.tree_size, snapshotSize);
    assert.equal(late.root, snapshotRoot);
  });
});

test('T21 a restart mid-poll reconciles the journaled raw', async () => {
  await withAnchorKey(async () => {
    const dir = tmp('chit-t21-');
    const tree = treeAt(dir);
    grow(tree, 4, 't21');
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let opened;
    const started = new Promise((resolve) => { opened = resolve; });
    const now = '2026-10-09T10:23:55.863Z';
    const blockTimestamp = Math.floor(Date.parse(now) / 1000);
    const pending = tree.publishHead({
      force: true,
      now,
      nonce: 4,
      blockTimestamp,
      sleep: async () => {},
      lookup: async (intent) => {
        opened();
        await hold;
        return receiptFor(intent, { blockTimestamp });
      },
      send: async (args) => args.hash,
    });
    await started;
    const lines = fs.readFileSync(path.join(dir, JOURNAL_NAME), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const broadcast = lines.filter((row) => row.op === 'anchor_intent' && row.status === 'broadcast');
    assert.equal(broadcast.length >= 1, true);
    assert.ok(broadcast.some((row) => row.raw && row.tx));
    const copy = tmp('chit-t21-copy-');
    cpSync(dir, copy, { recursive: true });
    release();
    await pending;
    const restored = new ReceiptMerkleTree();
    restored.load(copy);
    const beforeNonce = restored.anchorIntents.find((row) => row.status === 'broadcast' && row.raw);
    assert.ok(beforeNonce?.tx);
    await restored.reconcileAnchorIntents({
      lookup: async (intent) => receiptFor(intent, { blockTimestamp }),
      readBlockTs: async () => blockTimestamp,
    });
    const after = latestBaseIntentForRoot(restored.anchorIntents, beforeNonce.root);
    assert.equal(after.status, 'anchored');
    assert.equal(after.nonce, beforeNonce.nonce);
    assert.equal(restored.anchorIntents.some((row) => Number(row.nonce) === Number(beforeNonce.nonce) + 1), false);
  });
});
