/**
 * RFC 6962 consistency proofs, C2SP checkpoints, and the witness boot rule.
 * Inclusion proofs and the pinned epoch roots stay as they were.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const {
  ReceiptMerkleTree,
  finishReceiptLogBoot,
  leafHash,
  rootOf,
  inclusionProof,
  verifyInclusion,
  consistencyProof,
  verifyConsistency,
  consistencyPreview,
  consistencyProofLegacy,
  verifyConsistencyLegacy,
  EMPTY_TREE_ROOT,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');
const {
  signTreeCheckpoint,
  verifyCheckpointNote,
  checkpointOrigin,
  epochExtensionLine,
} = await import('../src/receipt-checkpoint.js');
const { initIssuerKey } = await import('../src/issuer-key.js');
const {
  journalExtendsHead,
  assertWitnessJournal,
  assertDistinctWitnessKey,
  receiptWitnessEnabled,
  encodeAppend,
  WITNESS_ABI,
} = await import('../src/receipt-log-witness.js');
const { ReceiptLogRefused } = await import('../src/receipt-log-store.js');
const { dailyAnchorDue, ANCHOR_RETRY_MS } = await import('../src/receipt-merkle.js');
const {
  EPOCH1_FINAL_ROOT,
  EPOCH1_SIZE1_ROOT,
  EPOCH1_SIZE2_ROOT,
  EPOCH2_OPENING_ROOT,
} = await import('../src/receipt-log-epoch.js');
const { Interface } = await import('ethers');

function leaves(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(leafHash(Buffer.from(`leaf-${String(i).padStart(2, '0')}`)));
  }
  return out;
}

test('empty tree root is SHA-256(0x00), not the RFC empty root, and size 0 is not a head', () => {
  const rfcEmpty = createHash('sha256').update(Buffer.from('')).digest('hex');
  assert.equal(EMPTY_TREE_ROOT.toString('hex'), '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d');
  assert.notEqual(EMPTY_TREE_ROOT.toString('hex'), rfcEmpty);
  assert.equal(rfcEmpty, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const tree = new ReceiptMerkleTree();
  tree.ensureGenesis();
  assert.equal(tree.leaves.length >= 1, true);
});

test('inclusion proofs keep left/right steps and the pinned epoch roots', () => {
  const a = leafHash(Buffer.from('inclusion-pin'));
  const b = leafHash(Buffer.from('inclusion-pin-2'));
  assert.equal(a.toString('hex'), '50a25408b5748570d50600286b1f58254493b8b8988c0fd0e6a05264f35c31bd');
  const root = rootOf([a, b]).toString('hex');
  assert.equal(root, '77e3c9667f156f4a6cb62d073640b2cae59b624b8047c363e4070fc3dbb5c3ef');
  const proof = inclusionProof([a, b], 0);
  assert.deepEqual(proof, [{
    hash: 'd8149cb4a04b818855761b7c966df9904cdeafbbcf3c685dd379718daf89b533',
    position: 'right',
  }]);
  assert.equal(verifyInclusion(a, 0, 2, root, proof), true);
  assert.equal(EPOCH1_SIZE1_ROOT, '8665a0fcb74c2cfeca3a356efe18fe878cf94c21cd38da6b19a2bb57629bc35c');
  assert.equal(EPOCH1_SIZE2_ROOT, 'ecf9a330a9e82d45e0887807261276fad2fbfb394189bb8f7f35b0e9163c70ae');
  assert.equal(EPOCH1_FINAL_ROOT, 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973');
  assert.equal(EPOCH2_OPENING_ROOT, 'f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286');
});

test('RFC consistency proofs omit the old root; the legacy proof still verifies as legacy', () => {
  const ls = leaves(4);
  const rfc = consistencyProof(ls, 1, 2);
  const legacy = consistencyProofLegacy(ls, 1, 2);
  assert.equal(rfc.length, 1);
  assert.equal(legacy.length, 2);
  const oldRoot = rootOf(ls.slice(0, 1)).toString('hex');
  const newRoot = rootOf(ls.slice(0, 2)).toString('hex');
  assert.equal(verifyConsistency(1, 2, oldRoot, newRoot, rfc), true);
  assert.equal(verifyConsistency(1, 2, oldRoot, newRoot, legacy), false);
  assert.equal(verifyConsistencyLegacy(1, 2, oldRoot, newRoot, legacy), true);
  assert.equal(verifyConsistencyLegacy(1, 2, oldRoot, newRoot, rfc), false);
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('a', '1');
  tree.appendReceipt('b', '2');
  const body = tree.consistency(1, tree.leaves.length);
  assert.equal(body.schema, 'chit402.consistency.v2');
  assert.equal(body.format, 'rfc6962');
  const old = tree.consistency(1, tree.leaves.length, null, 'legacy');
  assert.equal(old.schema, 'chit402.consistency.v1');
  assert.equal(old.format, 'legacy');
});

test('every (m, n) through 40 matches transparency-dev/merkle', () => {
  const fixturePath = join(here, 'fixtures/rfc6962-consistency-40.txt');
  const fixture = readFileSync(fixturePath, 'utf8').trim().split('\n');
  const lines = [];
  const max = 40;
  const ls = leaves(max);
  let strict = 0;
  for (let n = 1; n <= max; n += 1) {
    for (let m = 1; m <= n; m += 1) {
      const proof = consistencyProof(ls, m, n);
      const oldRoot = rootOf(ls.slice(0, m)).toString('hex');
      const newRoot = rootOf(ls.slice(0, n)).toString('hex');
      assert.equal(verifyConsistency(m, n, oldRoot, newRoot, proof), true);
      if (m < n) {
        strict += 1;
        const flipped = proof.slice();
        if (flipped.length) flipped[0] = '00'.repeat(32);
        else flipped.push('11'.repeat(32));
        assert.equal(verifyConsistency(m, n, oldRoot, newRoot, flipped), false);
      }
      lines.push(`${m} ${n} ${oldRoot} ${newRoot} ${proof.length ? proof.join(',') : '-'}`);
    }
  }
  assert.equal(strict, 780);
  assert.equal(lines.length, 820);
  assert.deepEqual(lines, fixture);
  const go = spawnSync('go', ['run', '.'], {
    cwd: join(here, 'rfc6962-ref'),
    encoding: 'utf8',
  });
  if (go.error && go.error.code === 'ENOENT') return;
  assert.equal(go.status, 0, go.stderr);
  assert.equal(go.stdout.trim().split('\n').length, 820);
  assert.deepEqual(go.stdout.trim().split('\n'), lines);
});

test('a checkpoint is a signed note with one epoch extension line', () => {
  const { privateKey, publicKeyJwk } = initIssuerKey();
  const note = signTreeCheckpoint({
    epoch: 2,
    treeSize: 1,
    root: EPOCH2_OPENING_ROOT,
    prevEpochSize: 4,
    prevEpochRoot: EPOCH1_FINAL_ROOT,
  }, privateKey);
  assert.equal(note.endsWith('\n'), true);
  assert.match(note, new RegExp(`^${checkpointOrigin(2)}\\n1\\n`));
  const blank = note.indexOf('\n\n');
  assert.equal(blank > 0, true);
  const extension = note.slice(0, blank).split('\n')[3];
  assert.equal(extension, extension.trim());
  assert.equal(extension.includes('\n'), false);
  assert.match(extension, /^epoch 2 4 [A-Za-z0-9+/]+=*$/);
  const parsed = verifyCheckpointNote(note, publicKeyJwk);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.equal(parsed.epoch, 2);
  assert.equal(parsed.prev_epoch_size, 4);
  assert.equal(parsed.prev_epoch_root, EPOCH1_FINAL_ROOT);
  assert.equal(parsed.root, EPOCH2_OPENING_ROOT);
  assert.equal(parsed.origin, 'chit402.com/receipt-log/2');
  const epoch1 = signTreeCheckpoint({ epoch: 1, treeSize: 4, root: EPOCH1_FINAL_ROOT, prevEpochSize: 0 }, privateKey);
  const parsed1 = verifyCheckpointNote(epoch1, publicKeyJwk);
  assert.equal(parsed1.ok, true, parsed1.reason);
  assert.equal(parsed1.extension, 'epoch 1 0');
  assert.throws(() => epochExtensionLine({ epoch: 2, prevEpochSize: 0, prevEpochRoot: null }), /missing_prev_size/);
  assert.throws(() => epochExtensionLine({ epoch: 3, prevEpochSize: 0, prevEpochRoot: EPOCH1_FINAL_ROOT }), /missing_prev_size/);
  assert.throws(() => epochExtensionLine({ epoch: 2, prevEpochSize: 4, prevEpochRoot: '0'.repeat(64) }), /zero_prev_root/);
});

test('the witness flag is off unless it is exactly 1, and a reset is not an extension', async () => {
  assert.equal(receiptWitnessEnabled({}), false);
  assert.equal(receiptWitnessEnabled({ RECEIPT_LOG_WITNESS: 'true' }), false);
  assert.equal(receiptWitnessEnabled({ RECEIPT_LOG_WITNESS: '1' }), true);
  const tree = new ReceiptMerkleTree();
  tree.epoch = 2;
  tree.prevEpochRoot = EPOCH1_FINAL_ROOT;
  tree.prevEpochSize = 4;
  tree.leaves = [leafHash(Buffer.from('oct-5'))];
  const refused = journalExtendsHead(tree, {
    epoch: 1,
    size: 4,
    root: EPOCH1_FINAL_ROOT,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'witness_epoch');
  await assert.rejects(
    () => assertWitnessJournal(tree, {
      enabled: true,
      address: `0x${'11'.repeat(20)}`,
      readHead: async () => ({ epoch: 1, size: 4, root: EPOCH1_FINAL_ROOT }),
    }),
    (err) => err instanceof ReceiptLogRefused && err.code === 'witness_epoch',
  );
  const shrunk = new ReceiptMerkleTree();
  shrunk.leaves = [leafHash(Buffer.from('only-one'))];
  const shrink = journalExtendsHead(shrunk, {
    epoch: 1,
    size: 4,
    root: EPOCH1_FINAL_ROOT,
  });
  assert.equal(shrink.reason, 'witness_shrink');
});

test('an RFC extension of the contract head is accepted, and the daily anchor sends append plus the bare root', async () => {
  const tree = new ReceiptMerkleTree();
  tree.appendReceipt('a', '1');
  tree.appendReceipt('b', '2');
  const full = tree.leaves.length;
  const prefix = rootOf(tree.leaves.slice(0, 2)).toString('hex');
  const extended = journalExtendsHead(tree, { epoch: 1, size: 2, root: prefix });
  assert.equal(extended.ok, true);
  assert.equal(verifyConsistency(2, full, prefix, rootOf(tree.leaves).toString('hex'), extended.proof), true);

  const prev = process.env.RECEIPT_LOG_WITNESS;
  const prevAddr = process.env.CHIT_LOG_WITNESS_ADDRESS;
  const prevKey = process.env.RECEIPT_WITNESS_PRIVATE_KEY;
  const prevAnchor = process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
  process.env.RECEIPT_LOG_WITNESS = '1';
  process.env.CHIT_LOG_WITNESS_ADDRESS = `0x${'22'.repeat(20)}`;
  process.env.RECEIPT_WITNESS_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'cd'.repeat(32)}`;
  const calls = [];
  let signedTx = null;
  const fullRoot = rootOf(tree.leaves).toString('hex');
  let mined = false;
  try {
    const head = await tree.publishHead({
      force: true,
      witnessReadNonce: async () => 3,
      send: async () => {
        calls.push('base');
        return `0x${'aa'.repeat(32)}`;
      },
      witnessSend: async (tx) => {
        signedTx = tx;
        calls.push(tx.data);
        mined = true;
        return tx.hash;
      },
      witnessReadHead: async () => (mined
        ? { epoch: 1, size: full, root: fullRoot }
        : { epoch: 1, size: 2, root: prefix }),
      witnessReadReceipt: async () => ({ status: '0x1' }),
    });
    assert.equal(calls.includes('base'), true);
    const appendCall = calls.find((item) => item !== 'base');
    const selector = new Interface(WITNESS_ABI).getFunction('append').selector;
    assert.equal(appendCall.slice(0, 10), selector);
    assert.equal(head.anchors.base.calldata, `0x${head.root}`);
    assert.equal(head.anchors.witness.status, 'witnessed');
    const { keccak256 } = await import('ethers');
    assert.equal(head.anchors.witness.tx, signedTx.hash);
    assert.equal(signedTx.hash, keccak256(signedTx.raw));
    assert.equal(head.checkpoint.includes('chit402.com/receipt-log/1'), true);
    const payload = JSON.parse(Buffer.from(head.issuer_signature.jws.split('.')[1], 'base64url').toString());
    assert.equal(payload.checkpoint, undefined);
    assert.equal(payload.anchors.witness.status, 'witnessed');
    const encoded = encodeAppend(full, head.root, extended.proof);
    assert.equal(head.anchors.witness.calldata, encoded);
  } finally {
    if (prev == null) delete process.env.RECEIPT_LOG_WITNESS;
    else process.env.RECEIPT_LOG_WITNESS = prev;
    if (prevAddr == null) delete process.env.CHIT_LOG_WITNESS_ADDRESS;
    else process.env.CHIT_LOG_WITNESS_ADDRESS = prevAddr;
    if (prevKey == null) delete process.env.RECEIPT_WITNESS_PRIVATE_KEY;
    else process.env.RECEIPT_WITNESS_PRIVATE_KEY = prevKey;
    if (prevAnchor == null) delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
    else process.env.RECEIPT_ANCHOR_PRIVATE_KEY = prevAnchor;
    resetReceiptMerkleTree();
  }
});

function witnessEnv() {
  const prev = {
    flag: process.env.RECEIPT_LOG_WITNESS,
    addr: process.env.CHIT_LOG_WITNESS_ADDRESS,
    key: process.env.RECEIPT_WITNESS_PRIVATE_KEY,
    anchor: process.env.RECEIPT_ANCHOR_PRIVATE_KEY,
  };
  process.env.RECEIPT_LOG_WITNESS = '1';
  process.env.CHIT_LOG_WITNESS_ADDRESS = `0x${'33'.repeat(20)}`;
  process.env.RECEIPT_WITNESS_PRIVATE_KEY = `0x${'ab'.repeat(32)}`;
  process.env.RECEIPT_ANCHOR_PRIVATE_KEY = `0x${'cd'.repeat(32)}`;
  return () => {
    const restore = (name, value) => {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    };
    restore('RECEIPT_LOG_WITNESS', prev.flag);
    restore('CHIT_LOG_WITNESS_ADDRESS', prev.addr);
    restore('RECEIPT_WITNESS_PRIVATE_KEY', prev.key);
    restore('RECEIPT_ANCHOR_PRIVATE_KEY', prev.anchor);
    resetReceiptMerkleTree();
  };
}

test('an unmined append is not signed, and the retry records it once head() matches', async () => {
  const restore = witnessEnv();
  try {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('a', '1');
    tree.appendReceipt('b', '2');
    const full = tree.leaves.length;
    const fullRoot = rootOf(tree.leaves).toString('hex');
    const prefix = rootOf(tree.leaves.slice(0, 2)).toString('hex');
    let chain = { epoch: 1, size: 2, root: prefix };
    let receipt = null;
    const sends = [];
    const first = await tree.publishHead({
      force: true,
      witnessReadNonce: async () => 3,
      send: async () => `0x${'aa'.repeat(32)}`,
      witnessSend: async () => {
        sends.push('send');
        return `0x${'bb'.repeat(32)}`;
      },
      witnessReadHead: async () => chain,
      witnessReadReceipt: async () => receipt,
    });
    const unsigned = JSON.parse(Buffer.from(first.issuer_signature.jws.split('.')[1], 'base64url').toString());
    assert.equal(first.witness_pending.status, 'broadcast');
    assert.equal(unsigned.anchors.witness, undefined);
    assert.equal(dailyAnchorDue(first, new Date(Date.parse(first.published_at) + 1000)), false);
    assert.equal(dailyAnchorDue(first, new Date(Date.parse(first.published_at) + ANCHOR_RETRY_MS)), true);

    chain = { epoch: 1, size: full, root: fullRoot };
    receipt = { status: '0x1' };
    const caught = await tree.publishHead({
      force: true,
      send: async () => `0x${'aa'.repeat(32)}`,
      witnessLookup: async () => ({ receiptOk: true }),
      witnessSend: async () => {
        sends.push('again');
        return `0x${'cc'.repeat(32)}`;
      },
      witnessReadHead: async () => chain,
      witnessReadReceipt: async () => receipt,
    });
    assert.deepEqual(sends, ['send']);
    assert.equal(caught.anchors.witness.status, 'witnessed');
    assert.equal(caught.witness_pending, undefined);
    const payload = JSON.parse(Buffer.from(caught.issuer_signature.jws.split('.')[1], 'base64url').toString());
    assert.equal(payload.anchors.witness.status, 'witnessed');
    assert.equal(payload.anchors.witness.root, fullRoot);
  } finally {
    restore();
  }
});

test('a reverted append is not a signed witness', async () => {
  const restore = witnessEnv();
  try {
    const tree = new ReceiptMerkleTree();
    tree.appendReceipt('a', '1');
    tree.appendReceipt('b', '2');
    const prefix = rootOf(tree.leaves.slice(0, 2)).toString('hex');
    const head = await tree.publishHead({
      force: true,
      witnessReadNonce: async () => 3,
      send: async () => `0x${'aa'.repeat(32)}`,
      witnessSend: async () => `0x${'bb'.repeat(32)}`,
      witnessReadHead: async () => ({ epoch: 1, size: 2, root: prefix }),
      witnessReadReceipt: async () => ({ status: '0x0' }),
    });
    assert.equal(head.witness_pending.status, 'reverted');
    assert.equal(head.anchors.witness, undefined);
    const payload = JSON.parse(Buffer.from(head.issuer_signature.jws.split('.')[1], 'base64url').toString());
    assert.equal(payload.anchors.witness, undefined);
  } finally {
    restore();
  }
});

test('a failed bare-root send does not advance the witness nonce', async () => {
  const restore = witnessEnv();
  const dir = mkdtempSync(`${tmpdir()}/witness-nonce-`);
  try {
    const tree = new ReceiptMerkleTree();
    tree.dir = dir;
    tree.appendReceipt('a', '1');
    const seen = {};
    await tree.publishHead({
      force: true,
      nonce: 4,
      send: async (tx) => {
        seen.base = tx.nonce;
        throw new Error('bare root not broadcast');
      },
      witnessSend: async (tx) => {
        seen.witness = tx.nonce;
        return `0x${'ee'.repeat(32)}`;
      },
      witnessReadNonce: async () => 4,
      witnessReadHead: async () => ({ epoch: 1, size: 1, root: rootOf(tree.leaves.slice(0, 1)).toString('hex') }),
      witnessReadReceipt: async () => null,
    });
    assert.equal(seen.base, 4);
    assert.equal(seen.witness, 4);
  } finally {
    restore();
  }
});

test('a crash after the witness raw tx is fsynced rebroadcasts those same bytes', async () => {
  const restore = witnessEnv();
  const dir = mkdtempSync(`${tmpdir()}/witness-crash-`);
  try {
    const tree = new ReceiptMerkleTree();
    tree.dir = dir;
    tree.appendReceipt('a', '1', { publish: false });
    tree.appendReceipt('b', '2', { publish: false });
    const prefix = rootOf(tree.leaves.slice(0, 2)).toString('hex');
    let persisted = null;
    await tree.publishHead({
      force: true,
      witnessReadNonce: async () => 7,
      witnessReadHead: async () => ({ epoch: 1, size: 2, root: prefix }),
      witnessSend: async (tx) => {
        persisted = tree.anchorIntents.find((row) => row.chain === 'base-witness' && row.status === 'signed');
        assert.equal(tx.raw, persisted.raw);
        assert.equal(tx.hash, persisted.tx);
        assert.equal(tx.nonce, 7);
        throw new Error('crash_before_broadcast');
      },
    });
    const { keccak256 } = await import('ethers');
    assert.equal(persisted.tx, keccak256(persisted.raw));
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    let resent = null;
    await restored.publishHead({
      force: true,
      witnessReadNonce: async () => 99,
      witnessLookup: async (intent) => {
        assert.equal(intent.raw, persisted.raw);
        assert.equal(intent.tx, persisted.tx);
        assert.equal(intent.nonce, 7);
        return { rebroadcast: true, missing: true, tx: intent.tx, nonce: 7 };
      },
      witnessSend: async (tx) => {
        resent = tx.raw;
        assert.equal(tx.hash, persisted.tx);
        assert.equal(tx.nonce, 7);
        return tx.hash;
      },
      witnessReadHead: async () => ({ epoch: 1, size: 2, root: prefix }),
      witnessReadReceipt: async () => null,
    });
    assert.equal(resent, persisted.raw);
    const raws = new Set(restored.anchorIntents.filter((row) => row.chain === 'base-witness').map((row) => row.raw).filter(Boolean));
    assert.deepEqual([...raws], [persisted.raw]);
  } finally {
    restore();
  }
});

test('a witness nonce consumed by something else is replaced and the old raw is not sent again', async () => {
  const restore = witnessEnv();
  const dir = mkdtempSync(`${tmpdir()}/witness-replaced-`);
  try {
    const tree = new ReceiptMerkleTree();
    tree.dir = dir;
    tree.appendReceipt('a', '1', { publish: false });
    tree.appendReceipt('b', '2', { publish: false });
    const prefix = rootOf(tree.leaves.slice(0, 2)).toString('hex');
    await tree.publishHead({
      force: true,
      witnessReadNonce: async () => 7,
      witnessReadHead: async () => ({ epoch: 1, size: 2, root: prefix }),
      witnessSend: async () => {
        throw new Error('crash_before_broadcast');
      },
    });
    const first = tree.anchorIntents.find((row) => row.chain === 'base-witness' && row.status === 'signed');
    const restored = new ReceiptMerkleTree();
    restored.load(dir);
    let resent = false;
    const head = await restored.publishHead({
      force: true,
      witnessLookup: async () => ({ replaced: true, reason: 'nonce_consumed', tx: first.tx }),
      witnessSend: async () => {
        resent = true;
        return `0x${'ff'.repeat(32)}`;
      },
      witnessReadHead: async () => ({ epoch: 1, size: 2, root: prefix }),
    });
    assert.equal(resent, false);
    assert.equal(head.witness_pending.status, 'replaced');
    assert.equal(head.anchors.witness, undefined);
    const payload = JSON.parse(Buffer.from(head.issuer_signature.jws.split('.')[1], 'base64url').toString());
    assert.equal(payload.anchors.witness, undefined);
    assert.equal(restored.anchorIntents.some((row) => row.chain === 'base-witness' && row.status === 'replaced' && row.nonce === 7), true);
  } finally {
    restore();
  }
});

test('boot refuses a witness contract that is not this build', async () => {
  const tree = new ReceiptMerkleTree();
  tree.leaves = [leafHash(Buffer.from('genesis-only'))];
  await assert.rejects(
    () => assertWitnessJournal(tree, {
      enabled: true,
      address: `0x${'11'.repeat(20)}`,
      readHead: async () => ({ epoch: 1, size: 1, root: tree.leaves[0].toString('hex') }),
      readCode: async () => '0x1234',
    }),
    (err) => err instanceof ReceiptLogRefused && err.code === 'witness_code',
  );
});

test('boot refuses a witness when the creation transaction is not pinned', async () => {
  const restore = witnessEnv();
  try {
    const tree = new ReceiptMerkleTree();
    await assert.rejects(
      () => finishReceiptLogBoot(tree, { witness: true }),
      (err) => err instanceof ReceiptLogRefused && err.code === 'witness_creation_unpinned',
    );
  } finally {
    restore();
  }
});

test('boot refuses a witness key that is also the anchor key', () => {
  const key = `0x${'11'.repeat(32)}`;
  assert.throws(
    () => assertDistinctWitnessKey({
      RECEIPT_LOG_WITNESS: '1',
      RECEIPT_WITNESS_PRIVATE_KEY: key,
      RECEIPT_ANCHOR_PRIVATE_KEY: key,
    }),
    (err) => err instanceof ReceiptLogRefused && err.code === 'witness_same_key',
  );
  assert.equal(assertDistinctWitnessKey({ RECEIPT_LOG_WITNESS: '0' }).skipped, true);
});

test('consistency above 2^31 matches a safe fold and is not a 32-bit shift', () => {
  const m = 2 ** 31 + 3;
  const n = 2 ** 31 + 8;
  const proof = [0, 1, 2, 3, 4].map((i) => createHash('sha256').update(Buffer.from(`above-${i}`)).digest('hex'));
  const preview = consistencyPreview(m, n, proof);
  assert.ok(preview);
  assert.equal(verifyConsistency(m, n, preview.oldRoot, preview.newRoot, proof), true);
  assert.equal(verifyConsistencyInt32(m, n, preview.oldRoot, preview.newRoot, proof), false);
});

function verifyConsistencyInt32(m, n, oldRoot, newRoot, proof) {
  const old = Buffer.from(oldRoot, 'hex');
  const next = Buffer.from(newRoot, 'hex');
  const node = (left, right) => createHash('sha256').update(Buffer.concat([Buffer.from([0x01]), left, right])).digest();
  const nodes = proof.map((step) => Buffer.from(step, 'hex'));
  let fn = (m - 1) | 0;
  let sn = (n - 1) | 0;
  while ((fn & 1) === 1) {
    fn >>= 1;
    sn >>= 1;
  }
  let fr = nodes[0];
  let sr = nodes[0];
  for (let i = 1; i < nodes.length; i += 1) {
    if (sn === 0) return false;
    const c = nodes[i];
    if ((fn & 1) === 1 || fn === sn) {
      fr = node(c, fr);
      sr = node(c, sr);
      if ((fn & 1) === 0) {
        while ((fn & 1) === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else sr = node(sr, c);
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && fr.equals(old) && sr.equals(next);
}
