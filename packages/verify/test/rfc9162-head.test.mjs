/**
 * Pardal 2026-10-07: a rewritten tree_size and a rewritten (index, size)
 * must not verify. The live inclusion proof is index 1 of size 3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const { verifyMerkleInclusion, verifyAnchoredRoot } = await import('../dist/anchor-witness.js');
const { verifyTreeHeadTrust } = await import('../dist/anchor-trust.js');
const { verifyReceipt } = await import('../dist/index.js');

const fixtureDir = path.join(pkgDir, 'test', 'fixtures');
const honestHead = JSON.parse(readFileSync(path.join(fixtureDir, 'pardal-head-honest.json'), 'utf8'));
const tamperedHead = JSON.parse(readFileSync(path.join(fixtureDir, 'pardal-head-tampered.json'), 'utf8'));
const honestInclusion = JSON.parse(readFileSync(path.join(fixtureDir, 'pardal-inclusion-honest.json'), 'utf8'));
const tamperedInclusion = JSON.parse(readFileSync(path.join(fixtureDir, 'pardal-inclusion-tampered.json'), 'utf8'));

const leaf = Buffer.from(honestInclusion.leaf, 'hex');
const root = honestInclusion.root;
const proof = honestInclusion.proof;

test('the live inclusion proof verifies only at index 1 of size 3', () => {
  assert.equal(verifyMerkleInclusion(leaf, 1, 3, root, proof), true);
  const flipped = proof.map((step) => ({
    hash: step.hash,
    position: step.position === 'left' ? 'right' : 'left',
  }));
  assert.equal(verifyMerkleInclusion(leaf, 1, 3, root, flipped), true);
  for (const [index, size] of [[0, 3], [2, 3], [1, 1000], [999, 1000], [0, 1], [500, 999]]) {
    assert.equal(verifyMerkleInclusion(leaf, index, size, root, proof), false, `${index} of ${size}`);
  }
  assert.equal(verifyMerkleInclusion(leaf, 1, 3, root, proof.slice(0, 1)), false);
  assert.equal(
    verifyMerkleInclusion(leaf, 1, 3, root, proof.concat([{ hash: 'ab'.repeat(32), position: 'left' }])),
    false,
  );
});

test('a tree head whose size was rewritten fails closed', () => {
  const honest = verifyTreeHeadTrust(honestHead);
  assert.equal(honest.ok, true, honest.reason || honest.message);
  const tampered = verifyTreeHeadTrust(tamperedHead);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'head_claims_mismatch');
  assert.match(tampered.message, /tree_size/);
});

test('offline verifyReceipt rejects the tampered head and the tampered inclusion', async () => {
  const receipt = {
    task_id: honestInclusion.task_id,
    status: 'completed',
    book_chain: { row_hash: '6eaa2c1599fb5e3b9e2dc5b0e64ccf609277c4d893aa03ebd310c3584ce5cf9b' },
  };
  const badHead = await verifyReceipt(receipt, {
    head: tamperedHead,
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(badHead.overall, 'failed');
  assert.ok(badHead.errors.includes('head_claims_mismatch'), badHead.errors.join(','));

  const badInclusion = await verifyReceipt(receipt, {
    head: honestHead,
    inclusion: tamperedInclusion,
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(badInclusion.overall, 'failed');
  assert.ok(
    badInclusion.errors.includes('tree_size_mismatch') || badInclusion.errors.includes('inclusion_failed'),
    badInclusion.errors.join(','),
  );

  const ok = await verifyReceipt(receipt, {
    head: honestHead,
    inclusion: honestInclusion,
    requirePreimages: false,
    skipIssuerHistory: true,
  });
  assert.equal(ok.errors.includes('head_claims_mismatch'), false, ok.errors.join(','));
  assert.equal(ok.errors.includes('inclusion_failed'), false, ok.errors.join(','));
  assert.equal(ok.errors.includes('tree_size_mismatch'), false, ok.errors.join(','));
});

test('anchor mode does not accept the five false index and size claims', async () => {
  let calls = 0;
  const run = (inclusion) => verifyAnchoredRoot({
    receipt: {
      task_id: honestInclusion.task_id,
      row_hash: '6eaa2c1599fb5e3b9e2dc5b0e64ccf609277c4d893aa03ebd310c3584ce5cf9b',
    },
    inclusion,
    head: honestHead,
    fetchSolanaTx: async () => { calls += 1; return null; },
    fetchBaseTx: async () => { calls += 1; return null; },
    fetchGenesis: async () => { calls += 1; return ''; },
  });
  const ok = await run(honestInclusion);
  assert.equal(ok.inclusion.valid, true, ok.inclusion.reason);
  for (const [index, size] of [[0, 3], [2, 3], [1, 1000], [999, 1000], [0, 1]]) {
    calls = 0;
    const claimed = { ...honestInclusion, leaf_index: index, tree_size: size };
    const result = await run(claimed);
    assert.equal(result.overall, 'failed', `${index} of ${size}`);
    assert.equal(result.inclusion.valid, false);
    assert.equal(calls, 0, `${index} of ${size} reached RPC`);
  }
  const rewritten = await run(tamperedInclusion);
  assert.equal(rewritten.overall, 'failed');
  assert.equal(rewritten.inclusion.valid, false);
});

test('xfuel-verify without --rpc rejects a rewritten tree size', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xfuel-offline-head-'));
  const receiptPath = path.join(dir, 'receipt.json');
  const headPath = path.join(dir, 'head.json');
  writeFileSync(receiptPath, JSON.stringify({
    task_id: honestInclusion.task_id,
    status: 'completed',
  }));
  writeFileSync(headPath, JSON.stringify(tamperedHead));
  const cli = path.join(pkgDir, 'dist', 'cli.js');
  const run = spawnSync(process.execPath, [
    cli,
    receiptPath,
    headPath,
    '--no-issuer-history',
    '--no-preimage',
  ], { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /head_claims_mismatch/);
  assert.doesNotMatch(run.stdout, /Overall: VERIFIED/);
});
