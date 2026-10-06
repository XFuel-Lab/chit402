/**
 * RFC 6962 consistency proofs, C2SP checkpoints, and the witness boot rule.
 * Inclusion proofs and the pinned epoch roots stay as they were.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const {
  ReceiptMerkleTree,
  leafHash,
  rootOf,
  inclusionProof,
  verifyInclusion,
  consistencyProof,
  verifyConsistency,
  consistencyProofLegacy,
  verifyConsistencyLegacy,
  EMPTY_TREE_ROOT,
  resetReceiptMerkleTree,
} = await import('../src/receipt-merkle.js');
const {
  signTreeCheckpoint,
  verifyCheckpointNote,
  checkpointOrigin,
} = await import('../src/receipt-checkpoint.js');
const { initIssuerKey } = await import('../src/issuer-key.js');
const {
  journalExtendsHead,
  assertWitnessJournal,
  receiptWitnessEnabled,
  encodeAppend,
  WITNESS_ABI,
} = await import('../src/receipt-log-witness.js');
const { ReceiptLogRefused } = await import('../src/receipt-log-store.js');
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
  try {
    const head = await tree.publishHead({
      force: true,
      send: async () => {
        calls.push('base');
        return `0x${'aa'.repeat(32)}`;
      },
      witnessSend: async (tx) => {
        calls.push(tx.data);
        return `0x${'bb'.repeat(32)}`;
      },
      witnessReadHead: async () => ({ epoch: 1, size: 2, root: prefix }),
    });
    assert.deepEqual(calls[0] === 'base' || calls.includes('base'), true);
    assert.equal(calls.includes('base'), true);
    const appendCall = calls.find((item) => item !== 'base');
    const selector = new Interface(WITNESS_ABI).getFunction('append').selector;
    assert.equal(appendCall.slice(0, 10), selector);
    assert.equal(head.anchors.base.calldata, `0x${head.root}`);
    assert.equal(head.anchors.witness.status, 'anchored');
    assert.equal(head.anchors.witness.tx, `0x${'bb'.repeat(32)}`);
    assert.equal(head.checkpoint.includes('chit402.com/receipt-log/1'), true);
    assert.equal(head.issuer_signature.jws.split('.').length, 3);
    const payload = JSON.parse(Buffer.from(head.issuer_signature.jws.split('.')[1], 'base64url').toString());
    assert.equal(payload.checkpoint, undefined);
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
