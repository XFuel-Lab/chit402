/**
 * Dated carry-forward. Times and epoch ids come from signed tree heads.
 * An unsigned receipt field is not a date source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const {
  verifyReceipt,
  verifyCarryForward,
  computePaymentCommitment,
  leafHash,
  PINNED_ANCHOR_EPOCHS,
} = await import('../dist/index.js');

const ISSUED_AT = '2026-10-03T11:33:37.000Z';
const LOGGED_AT = '2026-10-05T11:22:57.000Z';
const BACKDATED = '1999-01-01T00:00:00.000Z';

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}
function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}
function b64url(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(json).toString('base64url');
}
function rootOf(leaves) {
  let level = leaves.map((row) => Buffer.from(row));
  if (level.length === 0) return sha256(Buffer.from([0x00]));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(nodeHash(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}
function inclusionProof(leaves, index) {
  const proof = [];
  let idx = index;
  let level = leaves.map((row) => Buffer.from(row));
  while (level.length > 1) {
    const sibling = idx ^ 1;
    if (sibling < level.length) {
      proof.push({
        hash: level[sibling].toString('hex'),
        position: sibling < idx ? 'left' : 'right',
      });
    }
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(nodeHash(level[i], level[i + 1]));
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: exported.crv, kty: exported.kty, x: exported.x, y: exported.y });
  const kid = createHash('sha256').update(canonical).digest('base64url');
  const publicJwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, publicJwk };
}

function signHead(claims, keys) {
  const header = { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: keys.kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      jws: `${signingInput}.${signature.toString('base64url')}`,
      kid: keys.kid,
      issuer_jwk: keys.publicJwk,
    },
  };
}

function treeHead(leaves, index, epoch, publishedAt, keys) {
  const root = rootOf(leaves).toString('hex');
  const proof = inclusionProof(leaves, index);
  const head = signHead({
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch,
    root,
    tree_size: leaves.length,
    published_at: publishedAt,
  }, keys);
  const inclusion = {
    leaf: Buffer.from(leaves[index]).toString('hex'),
    leaf_index: index,
    tree_size: leaves.length,
    proof,
  };
  return { head, inclusion, root };
}

function receiptFor(taskId) {
  const paymentRef = `base:0x${'ab'.repeat(32)}`;
  const amount = '10000';
  const { commitment } = computePaymentCommitment({
    paymentRef,
    taskId,
    rail: 'usdc',
    amount,
  });
  return {
    task_id: taskId,
    status: 'completed',
    created_at: BACKDATED,
    issued_at: BACKDATED,
    payment: { rail: 'usdc', ref: paymentRef, net_amount: amount },
    binding: { expected_commitment: commitment, amount, rail: 'usdc', covers: ['payment'] },
    book_chain: { row_hash: 'row-1' },
  };
}

function carryFixture() {
  const keys = keypair();
  const taskId = 'task-carried';
  const receiptLeaf = leafHash(Buffer.from(`${taskId}|row-1`));
  const other = leafHash(Buffer.from('other|row'));
  const old = treeHead([other, receiptLeaf], 1, 1, ISSUED_AT, keys);
  const current = treeHead([other, receiptLeaf], 1, 2, LOGGED_AT, keys);
  return {
    keys,
    taskId,
    receiptLeaf,
    old,
    current,
    receipt: receiptFor(taskId),
  };
}

function carryOf(fx, patch = {}) {
  return {
    oldHead: patch.oldHead ?? fx.old.head,
    oldInclusion: patch.oldInclusion ?? fx.old.inclusion,
    currentHead: patch.currentHead ?? fx.current.head,
    currentInclusions: patch.currentInclusions ?? [fx.current.inclusion],
    row_hash: 'row-1',
    issued_at: BACKDATED,
    logged_at: BACKDATED,
  };
}

test('pinned anchor epochs are 1 and 2', () => {
  const pinPath = fileURLToPath(new URL('../../../services/gateway/receipt-log-pin.json', import.meta.url));
  const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
  const ids = new Set(PINNED_ANCHOR_EPOCHS);
  for (const row of [...(pin.anchors || []), ...(pin.epochs || [])]) {
    if (row.epoch == null) continue;
    assert.equal(ids.has(Number(row.epoch)), true, `epoch ${row.epoch} is not pinned`);
  }
  assert.equal(ids.has(9), false);
});

test('a receipt in the current epoch stays verified', async () => {
  const fx = carryFixture();
  const plain = await verifyReceipt(fx.receipt, { trustedKids: [fx.keys.kid] });
  assert.equal(plain.overall, 'verified');
  assert.equal(plain.carry_forward, undefined);
  assert.equal(JSON.stringify(plain).includes('VERIFIED_CARRIED_FORWARD'), false);

  const sameEpoch = treeHead(
    [leafHash(Buffer.from('other|row')), fx.receiptLeaf],
    1,
    2,
    LOGGED_AT,
    fx.keys,
  );
  const current = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { oldHead: sameEpoch.head, oldInclusion: sameEpoch.inclusion }),
  });
  assert.equal(current.overall, 'verified');
  assert.equal(current.carry_forward, undefined);
});

test('a carried-forward receipt is dated from the signed heads', async () => {
  const fx = carryFixture();
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx),
  });
  assert.equal(result.overall, 'verified_carried_forward');
  assert.equal(result.carry_forward.status, 'VERIFIED_CARRIED_FORWARD');
  assert.equal(result.carry_forward.issued_at, ISSUED_AT);
  assert.equal(result.carry_forward.issued_epoch, 1);
  assert.equal(result.carry_forward.logged_at, LOGGED_AT);
  assert.equal(result.carry_forward.logged_epoch, 2);
  assert.equal(result.carry_forward.leaf_index, 1);
  assert.notEqual(result.carry_forward.issued_at, BACKDATED);
  assert.equal(result.errors.length, 0);
});

test('a receipt that was never logged fails closed with not_in_tree', async () => {
  const fx = carryFixture();
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { oldInclusion: { error: 'not_in_tree' } }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('not_in_tree'));
});

test('a broken carry-forward proof fails closed with inclusion_failed', async () => {
  const fx = carryFixture();
  const broken = {
    ...fx.current.inclusion,
    proof: fx.current.inclusion.proof.map((step, i) => (i === 0 ? { ...step, hash: 'ab'.repeat(32) } : step)),
  };
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { currentInclusions: [broken] }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('inclusion_failed'));
});

test('a backdated unsigned receipt field is not the issued time', async () => {
  const fx = carryFixture();
  const oldHead = { ...fx.old.head, published_at: BACKDATED };
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { oldHead }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('head_mismatch'));
  assert.equal(JSON.stringify(result).includes(BACKDATED), false);
});

test('a forged old head fails closed with signature_invalid', async () => {
  const fx = carryFixture();
  const forgedKeys = keypair();
  const forged = signHead({
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: 1,
    root: fx.old.root,
    tree_size: 2,
    published_at: BACKDATED,
  }, forgedKeys);
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { oldHead: forged }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('signature_invalid'));
  assert.equal(JSON.stringify(result).includes(BACKDATED), false);
});

test('a swapped epoch id fails closed with head_mismatch', async () => {
  const fx = carryFixture();
  const swapped = { ...fx.old.head, epoch: 2 };
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { oldHead: swapped }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('head_mismatch'));
  assert.equal(result.carry_forward?.issued_epoch, undefined);
});

test('a current head dated before the old head fails closed', async () => {
  const fx = carryFixture();
  const early = treeHead(
    [leafHash(Buffer.from('other|row')), fx.receiptLeaf],
    1,
    2,
    '2026-10-01T00:00:00.000Z',
    fx.keys,
  );
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { currentHead: early.head, currentInclusions: [early.inclusion] }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('head_mismatch'));
});

test('an epoch id outside the pinned anchor list fails closed with bad_epoch', async () => {
  const fx = carryFixture();
  const foreign = treeHead(
    [leafHash(Buffer.from('other|row')), fx.receiptLeaf],
    1,
    9,
    ISSUED_AT,
    fx.keys,
  );
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { oldHead: foreign.head, oldInclusion: foreign.inclusion }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('bad_epoch'));
});

test('one old leaf carried to two current indexes fails closed', async () => {
  const fx = carryFixture();
  const leaves = [fx.receiptLeaf, fx.receiptLeaf];
  const first = treeHead(leaves, 0, 2, LOGGED_AT, fx.keys);
  const secondProof = inclusionProof(leaves, 1);
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, {
      currentHead: first.head,
      currentInclusions: [
        first.inclusion,
        {
          leaf: fx.receiptLeaf.toString('hex'),
          leaf_index: 1,
          tree_size: 2,
          proof: secondProof,
        },
      ],
    }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('inclusion_failed'));
});

test('an unsigned date field is not accepted as the issued time', async () => {
  const fx = carryFixture();
  const claims = {
    schema: 'chit402.tree_head.v2',
    payload_version: 2,
    epoch: 1,
    root: fx.old.root,
    tree_size: 2,
  };
  const unsigned = { ...signHead(claims, fx.keys), published_at: BACKDATED };
  const direct = verifyCarryForward({
    leaf: fx.receiptLeaf,
    oldHead: unsigned,
    oldInclusion: fx.old.inclusion,
    currentHead: fx.current.head,
    currentInclusions: [fx.current.inclusion],
    trustedKids: [fx.keys.kid],
  });
  assert.equal(direct.ok, false);
  assert.equal(direct.reason, 'head_mismatch');
  assert.equal(direct.issued_at, undefined);
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, { oldHead: unsigned }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('head_mismatch'));
  assert.equal(JSON.stringify(result).includes(BACKDATED), false);
});

test('a leaf hash that differs between epochs fails closed with tree_head_mismatch', async () => {
  const fx = carryFixture();
  const otherLeaf = leafHash(Buffer.from('different|row')).toString('hex');
  const result = await verifyReceipt(fx.receipt, {
    trustedKids: [fx.keys.kid],
    carry: carryOf(fx, {
      currentInclusions: [{ ...fx.current.inclusion, leaf: otherLeaf }],
    }),
  });
  assert.equal(result.overall, 'failed');
  assert.equal(result.carry_forward, undefined);
  assert.ok(result.errors.includes('tree_head_mismatch'));
});

test('CLI JSON and text report VERIFIED_CARRIED_FORWARD', () => {
  const fx = carryFixture();
  const dir = mkdtempSync(join(tmpdir(), 'chit-carry-'));
  writeFileSync(join(dir, 'receipt.json'), JSON.stringify(fx.receipt));
  writeFileSync(join(dir, 'old-head.json'), JSON.stringify(fx.old.head));
  writeFileSync(join(dir, 'old-inclusion.json'), JSON.stringify(fx.old.inclusion));
  writeFileSync(join(dir, 'head.json'), JSON.stringify(fx.current.head));
  writeFileSync(join(dir, 'inclusion.json'), JSON.stringify(fx.current.inclusion));
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const args = [
    cli,
    join(dir, 'receipt.json'),
    '--carry-old-head', join(dir, 'old-head.json'),
    '--carry-old-inclusion', join(dir, 'old-inclusion.json'),
    '--carry-head', join(dir, 'head.json'),
    '--carry-inclusion', join(dir, 'inclusion.json'),
    '--trusted-kid', fx.keys.kid,
    '--no-issuer-history',
    '--no-preimage',
  ];
  const jsonRun = spawnSync(process.execPath, [...args, '--json'], { encoding: 'utf8' });
  assert.equal(jsonRun.status, 0, `${jsonRun.stdout}\n${jsonRun.stderr}`);
  const parsed = JSON.parse(jsonRun.stdout);
  assert.equal(parsed.overall, 'verified_carried_forward');
  assert.equal(parsed.carry_forward.issued_at, ISSUED_AT);
  assert.equal(parsed.carry_forward.issued_epoch, 1);
  assert.equal(parsed.carry_forward.logged_at, LOGGED_AT);
  assert.equal(parsed.carry_forward.logged_epoch, 2);
  assert.equal(parsed.carry_forward.leaf_index, 1);
  assert.equal(parsed.carry_forward.status, 'VERIFIED_CARRIED_FORWARD');

  const textRun = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(textRun.status, 0, `${textRun.stdout}\n${textRun.stderr}`);
  assert.match(textRun.stdout, /VERIFIED_CARRIED_FORWARD/);
  assert.ok(textRun.stdout.includes(ISSUED_AT));
  assert.ok(textRun.stdout.includes('Issued epoch:  1'));
  assert.ok(textRun.stdout.includes(LOGGED_AT));
  assert.ok(textRun.stdout.includes('Logged epoch:  2'));
  assert.ok(textRun.stdout.includes('Leaf index:    1'));
  assert.equal(textRun.stdout.includes(BACKDATED), false);
});
