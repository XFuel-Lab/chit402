/**
 * tree_head_hash is recomputed from this receipt's leaf and the audit path.
 * A saved response that still lists every leaf body still verifies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { verifyPublishedPreimages } = await import('../dist/preimage.js');
const { verifyReceipt } = await import('../dist/index.js');

function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}

function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function rootOf(leaves) {
  let level = leaves.map((row) => Buffer.from(row));
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
    if (sibling < level.length) proof.push({ hash: level[sibling].toString('hex') });
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

function leafHash(text) {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'utf8')]));
}

function treeOf(bodies) {
  const hashes = bodies.map((body) => leafHash(body));
  return {
    bodies,
    hashes,
    root: rootOf(hashes).toString('hex'),
  };
}

function auditField(tree, index) {
  return {
    field: 'tree_head_hash',
    alg: 'sha256',
    encoding: 'binary',
    merkle: 'rfc6962',
    recomputable: true,
    leaf: {
      index,
      kind: 'receipt',
      task_id: 'xfuel-own',
      preimage_utf8: tree.bodies[index],
    },
    audit_path: {
      index,
      tree_size: tree.bodies.length,
      siblings: inclusionProof(tree.hashes, index),
      root: tree.root,
    },
    hash: tree.root,
  };
}

function leavesField(tree) {
  return {
    field: 'tree_head_hash',
    alg: 'sha256',
    encoding: 'binary',
    merkle: 'rfc6962',
    recomputable: true,
    leaves: tree.bodies.map((preimage_utf8, index) => ({
      index,
      task_id: index === tree.bodies.length - 1 ? 'xfuel-own' : `xfuel-foreign-${index}`,
      preimage_utf8,
    })),
    hash: tree.root,
  };
}

function wrap(field) {
  return {
    task_id: 'xfuel-own',
    tree_head_hash: field.hash,
    preimages: { fields: { tree_head_hash: field } },
  };
}

const bodies = [
  'genesis-body-not-this-receipt',
  'xfuel-546baa6c|foreign-row',
  'xfuel-other-payer|foreign-row-2',
  'xfuel-own|own-row',
];
const tree = treeOf(bodies);
const ownIndex = 3;

test('an audit path recomputes the prefix root, and the old leaves array still does', async () => {
  const audit = await verifyPublishedPreimages(wrap(auditField(tree, ownIndex)), { requirePreimages: true });
  assert.equal(audit.ok, true, audit.errors.join('; '));

  const saved = await verifyPublishedPreimages(wrap(leavesField(tree)), { requirePreimages: true });
  assert.equal(saved.ok, true, saved.errors.join('; '));

  const mixed = auditField(tree, ownIndex);
  mixed.leaves = [{ index: 0, task_id: 'xfuel-injected', preimage_utf8: 'forged-foreign-body' }];
  const preferred = await verifyPublishedPreimages(wrap(mixed), { requirePreimages: true });
  assert.equal(preferred.ok, true, preferred.errors.join('; '));
});

test('a lying position label does not change the audit', async () => {
  const field = auditField(tree, ownIndex);
  field.audit_path.siblings = field.audit_path.siblings.map((step) => ({
    hash: step.hash,
    position: 'left',
  }));
  const result = await verifyPublishedPreimages(wrap(field), { requirePreimages: true });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('a tampered sibling, swapped index, wrong tree size, or forged leaf fails', async () => {
  const sibling = auditField(tree, ownIndex);
  sibling.audit_path.siblings[0].hash = 'ab'.repeat(32);
  const badSibling = await verifyPublishedPreimages(wrap(sibling), { requirePreimages: true });
  assert.equal(badSibling.ok, false);

  const swapped = auditField(tree, ownIndex);
  swapped.audit_path.index = ownIndex - 1;
  swapped.leaf.index = ownIndex - 1;
  const badIndex = await verifyPublishedPreimages(wrap(swapped), { requirePreimages: true });
  assert.equal(badIndex.ok, false);

  const sized = auditField(tree, ownIndex);
  sized.audit_path.tree_size = tree.bodies.length + 3;
  const badSize = await verifyPublishedPreimages(wrap(sized), { requirePreimages: true });
  assert.equal(badSize.ok, false);

  const forged = auditField(tree, ownIndex);
  forged.leaf.preimage_utf8 = 'xfuel-own|forged-row';
  const badLeaf = await verifyPublishedPreimages(wrap(forged), { requirePreimages: true });
  assert.equal(badLeaf.ok, false);

  const disagree = auditField(tree, ownIndex);
  disagree.leaf.index = 0;
  const badLeafIndex = await verifyPublishedPreimages(wrap(disagree), { requirePreimages: true });
  assert.equal(badLeafIndex.ok, false);
});

function signReceiptClaims(payload) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkExport = publicKey.export({ format: 'jwk' });
  const thumb = createHash('sha256').update(JSON.stringify({
    crv: jwkExport.crv, kty: jwkExport.kty, x: jwkExport.x, y: jwkExport.y,
  })).digest('base64url');
  const issuer_jwk = { ...jwkExport, kid: thumb, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid: thumb };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    kid: thumb,
    issuer_jwk,
    jws: `${headerB64}.${payloadB64}.${signature}`,
  };
}

function signedAuditReceipt() {
  const field = auditField(tree, ownIndex);
  const claims = {
    task_id: 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    iss: 'chit402',
    iat: 1,
    payload_version: 9,
    tree_head_hash: field.hash,
    tolerance: { base: 300, solana: 150 },
    payment: {
      rail: 'usdc',
      ref: 'base:0x' + '11'.repeat(32),
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payee: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334',
      gross_amount: '2000',
      settled_amount: '2000',
    },
    caller_binding: { payer_wallet: '0x9F8951CB8b060f52fdf87297b3c5B00f7aa18f52' },
  };
  const signed = signReceiptClaims(claims);
  return {
    task_id: claims.task_id,
    status: 'completed',
    payment: claims.payment,
    caller_binding: claims.caller_binding,
    tree_head_hash: claims.tree_head_hash,
    tolerance: claims.tolerance,
    preimages: { fields: { tree_head_hash: field } },
    issuer_signature: {
      alg: 'ES256',
      jws: signed.jws,
      kid: signed.kid,
      issuer_jwk: signed.issuer_jwk,
      payload_version: 9,
    },
  };
}

test('a chit-1ebc5616 style receipt with an audit path verifies offline and with --rpc', async () => {
  const receipt = signedAuditReceipt();
  assert.equal(JSON.stringify(receipt).includes('xfuel-546baa6c'), false);
  assert.equal(JSON.stringify(receipt).includes('genesis-body-not-this-receipt'), false);
  const checked = await verifyReceipt(receipt, {
    trustedKids: [receipt.issuer_signature.kid],
    skipIssuerHistory: true,
    requirePreimages: true,
  });
  assert.equal(checked.overall, 'verified', checked.errors.join('; '));
  assert.equal(checked.preimages.ok, true);

  const dir = mkdtempSync(join(tmpdir(), 'chit-audit-'));
  const path = join(dir, 'receipt.json');
  writeFileSync(path, JSON.stringify(receipt));
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const args = [
    '--json',
    '--no-issuer-history',
    '--trusted-kid',
    receipt.issuer_signature.kid,
  ];
  for (const extra of [[], ['--rpc', 'http://127.0.0.1:9']]) {
    const run = spawnSync(process.execPath, [cli, path, ...args, ...extra], { encoding: 'utf8' });
    assert.equal(run.status, 0, `status=${run.status} stderr=${run.stderr} stdout=${run.stdout}`);
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.overall, 'verified', (parsed.errors || []).join('; '));
    assert.equal(parsed.preimages.ok, true);
  }

  const tampered = structuredClone(receipt);
  tampered.preimages.fields.tree_head_hash.leaf.preimage_utf8 = 'xfuel-own|forged-row';
  const failed = await verifyReceipt(tampered, {
    trustedKids: [tampered.issuer_signature.kid],
    skipIssuerHistory: true,
    requirePreimages: true,
  });
  assert.equal(failed.overall, 'failed');
  assert.match(failed.errors.join(' '), /preimage/);
});
