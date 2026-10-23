/**
 * Holes found against @xfuel/verify 0.3.1 on two public receipts:
 * chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96 and
 * foreign-x402-muy1hh8y-66555d036df8.
 * Fixtures are the public JSON. Tamper copies are built in the test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLibraryPass } from './library-pass.mjs';
import { tempDir } from './tmp-dirs.mjs';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(pkgDir, 'test', 'fixtures', 'public');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const { verifyReceipt, diffOuterClaims, unsignedOuterFields } = await import('../dist/index.js');
const { verifyMerkleInclusion, verifyAnchoredRoot } = await import('../dist/anchor-witness.js');

const house = JSON.parse(readFileSync(path.join(fixtureDir, 'chit-1ebc5616.json'), 'utf8'));
const foreign = JSON.parse(readFileSync(path.join(fixtureDir, 'foreign-x402-muy1hh8y.json'), 'utf8'));
const inclusion = JSON.parse(readFileSync(path.join(fixtureDir, 'foreign-x402-muy1hh8y-inclusion.json'), 'utf8'));
const head = JSON.parse(readFileSync(path.join(fixtureDir, 'tree-head-size3.json'), 'utf8'));
const historyBytes = readFileSync(path.join(fixtureDir, 'issuer-history-v1.json'), 'utf8');
const history = JSON.parse(historyBytes);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function claimsOf(receipt) {
  const part = receipt.issuer_signature.jws.split('.')[1];
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function tamperSignature(receipt) {
  const next = clone(receipt);
  const parts = next.issuer_signature.jws.split('.');
  const sig = parts[2];
  const i = Math.floor(sig.length / 2);
  const ch = sig[i] === 'A' ? 'B' : 'A';
  parts[2] = sig.slice(0, i) + ch + sig.slice(i + 1);
  next.issuer_signature.jws = parts.join('.');
  return next;
}

const houseOpts = { skipIssuerHistory: true, requirePreimages: true };
const foreignOpts = {
  issuerHistory: history,
  issuerHistoryBytes: historyBytes,
  requirePreimages: true,
};

function runCli(args) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const detail = `status=${run.status} stderr=${run.stderr || ''} stdout=${(run.stdout || '').slice(0, 400)}`;
  assert.equal(run.error ?? null, null, detail);
  assert.equal(typeof run.status, 'number', detail);
  return run;
}

function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('both public receipts verify unmodified', async () => {
  const houseResult = await verifyReceipt(house, houseOpts);
  assertLibraryPass(houseResult, houseResult.errors.join('; '));
  assert.equal(houseResult.verified_scope, 'signed_claims');
  assert.equal(houseResult.issuer_signature.valid, true);
  assert.equal(houseResult.amount_usdc, '2000');
  assert.equal(houseResult.claim_mismatches.length, 0);
  for (const field of [
    'payment.network',
    'payment.fee_bps',
    'payment.collected',
    'payment.explorer_url',
    'verify_url',
    'route.resolved',
    'created_at',
    'usage.total_tokens',
  ]) {
    assert.ok(houseResult.unsigned_fields.includes(field), field);
  }
  assert.equal(houseResult.unsigned_fields.includes('payment.fee_amount'), false);
  assert.equal(houseResult.unsigned_fields.includes('payment.protocol_fee_bps'), false);
  assert.equal(houseResult.unsigned_fields.some((field) => field.startsWith('issuer_signature')), false);

  const foreignResult = await verifyReceipt(foreign, foreignOpts);
  assertLibraryPass(foreignResult, foreignResult.errors.join('; '));
  assert.equal(foreignResult.amount_usdc, '10000');
  assert.equal(foreignResult.claim_mismatches.length, 0);
  assert.ok(foreignResult.unsigned_fields.includes('schema'));
  assert.ok(foreignResult.unsigned_fields.includes('payment.network'));
  assert.ok(foreignResult.unsigned_fields.includes('payment.collected'));
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('NOT_IN_LOG needs a verified head, and a bad fetched proof exits 1', async () => {
  const signedHead = JSON.parse(readFileSync(path.join(pkgDir, 'test', 'fixtures', 'pardal-head-honest.json'), 'utf8'));
  let mode = 'unsigned-404';
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.includes('/inclusion')) {
      if (mode === 'bad') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          status: 'anchored',
          leaf_index: 0,
          tree_size: 1,
          root: 'ab'.repeat(32),
          proof: [],
          head_url: '/v1/receipts/tree/head?tree_size=1',
        }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_in_tree' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (mode === 'signed-head') res.end(JSON.stringify(signedHead));
    else res.end(JSON.stringify({ schema: 'chit402.tree_head.v2', tree_size: 1, root: 'cd'.repeat(32) }));
  });
  const port = await listen(server);
  try {
    const dir = tempDir('chit-honest-');
    const missing = clone(house);
    if (missing.verification) delete missing.verification.jwks_uri;
    missing.verify_url = `http://127.0.0.1:${port}/receipt/${house.task_id}`;
    const missingPath = path.join(dir, 'missing.json');
    writeFileSync(missingPath, JSON.stringify(missing));
    const unsigned = await runCliAsync([missingPath, '--json']);
    assert.equal(unsigned.status, 2, unsigned.stderr + unsigned.stdout);
    const unsignedBody = JSON.parse(unsigned.stdout);
    assert.equal(unsignedBody.result, 'could_not_check');
    assert.notEqual(unsignedBody.reason, 'not_in_log');
    const unsignedText = await runCliAsync([missingPath]);
    assert.equal(unsignedText.status, 2, unsignedText.stderr + unsignedText.stdout);
    assert.match(unsignedText.stdout, /The receipt could not be checked\./);
    assert.doesNotMatch(unsignedText.stdout, /invalid/i);

    mode = 'signed-head';
    const run = await runCliAsync([missingPath, '--json']);
    assert.equal(run.status, 1, run.stderr + run.stdout);
    const parsed = JSON.parse(run.stdout);
    assert.equal(parsed.result, 'invalid');
    assert.equal(parsed.reason, 'not_in_log');
    assert.equal(parsed.checks.log_inclusion, 'fail');

    const text = await runCliAsync([missingPath]);
    assert.equal(text.status, 1, text.stderr);
    assert.match(text.stdout, /^NOT_IN_LOG\n/);
    assert.match(text.stdout, /payment row in the book is unchanged/);
    assert.doesNotMatch(text.stdout, /INCLUDED_SHELL/);
    assert.doesNotMatch(text.stdout, /NOT found invalid/);

    mode = 'bad';
    const bad = clone(house);
    if (bad.verification) delete bad.verification.jwks_uri;
    bad.verify_url = `http://127.0.0.1:${port}/receipt/${house.task_id}`;
    const badPath = path.join(dir, 'bad-proof.json');
    writeFileSync(badPath, JSON.stringify(bad));
    const failed = await runCliAsync([badPath, '--json']);
    assert.equal(failed.status, 1, failed.stderr + failed.stdout);
    const body = JSON.parse(failed.stdout);
    assert.equal(body.result, 'invalid');
    assert.notEqual(body.reason, 'log_unreachable');
    const human = await runCliAsync([badPath]);
    assert.equal(human.status, 1, human.stderr);
    assert.doesNotMatch(human.stdout, /NOT found invalid/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('signed fee_amount and protocol_fee_bps mismatches fail', async () => {
  const fee = clone(house);
  fee.payment.fee_amount = '0';
  const feeResult = await verifyReceipt(fee, houseOpts);
  assert.equal(feeResult.overall, 'failed');
  assert.ok(feeResult.claim_mismatches.some((row) => row.field === 'payment.fee_amount' && row.outer === '0' && row.signed === '10'));

  const bps = clone(house);
  bps.payment.protocol_fee_bps = 0;
  const bpsResult = await verifyReceipt(bps, houseOpts);
  assert.equal(bpsResult.overall, 'failed');
  assert.ok(bpsResult.claim_mismatches.some((row) => row.field === 'payment.protocol_fee_bps' && row.outer === '0' && row.signed === '50'));
});

test('unsigned outer edits stay unverified and do not become the verified facts', async () => {
  const edits = [
    ['payment.network', 'solana'],
    ['payment.fee_bps', 0],
    ['payment.collected', false],
    ['payment.explorer_url', 'https://solscan.io/tx/tampered'],
    ['verify_url', 'https://example.invalid/tampered'],
    ['route.resolved', 'tampered-model'],
    ['created_at', 1],
    ['usage.total_tokens', 999999],
  ];
  for (const [pathName, value] of edits) {
    const receipt = clone(house);
    const [headKey, child] = pathName.split('.');
    if (child) receipt[headKey][child] = value;
    else receipt[headKey] = value;
    const result = await verifyReceipt(receipt, houseOpts);
    assertLibraryPass(result, `${pathName} ${result.errors.join('; ')}`);
    assert.ok(result.unsigned_fields.includes(pathName), pathName);
    assert.equal(result.amount_usdc, '2000', pathName);
    assert.equal(result.model, 'akash/meta-llama/Llama-3.3-70B-Instruct', pathName);
    assert.equal(result.hub, 'akash-network', pathName);
    assert.equal(JSON.stringify(result).includes('https://solscan.io/tx/tampered'), false);
  }
});

test('fields that 0.3.1 already rejected still fail on the public receipt', async () => {
  const cases = [
    ['payment.gross_amount', '100000'],
    ['payment.payee', '0x0000000000000000000000000000000000000001'],
    ['payment.ref', 'base:0x' + 'ab'.repeat(32)],
    ['payment.asset', '0x0000000000000000000000000000000000000002'],
    ['payment.net_amount', '1'],
    ['payment.rail', 'sol'],
    ['route.model', 'tampered-model'],
    ['route.provider', 'tampered-provider'],
    ['output.hash', '0x' + 'cd'.repeat(32)],
    ['task_id', 'tampered-task'],
  ];
  for (const [pathName, value] of cases) {
    const receipt = clone(house);
    const parts = pathName.split('.');
    if (parts.length === 1) receipt[parts[0]] = value;
    else receipt[parts[0]][parts[1]] = value;
    const result = await verifyReceipt(receipt, houseOpts);
    assert.equal(result.overall, 'failed', pathName);
    assert.ok(result.claim_mismatches.some((row) => row.field === pathName), pathName);
  }

  const forged = tamperSignature(house);
  const signed = await verifyReceipt(forged, houseOpts);
  assert.equal(signed.overall, 'failed');
  assert.equal(signed.issuer_signature.valid, false);

  const foreignAmount = clone(foreign);
  foreignAmount.payment.gross_amount = '100000';
  const foreignResult = await verifyReceipt(foreignAmount, foreignOpts);
  assert.equal(foreignResult.overall, 'failed');
  assert.ok(foreignResult.claim_mismatches.some((row) => row.field === 'payment.gross_amount' && row.signed === '10000' && row.outer === '100000'));
});

test('a new signed field cannot skip the outer comparison', () => {
  const signed = claimsOf(house);
  signed.payment.future_fee = '7';
  const outer = clone(house);
  outer.payment.future_fee = '0';
  const mismatches = diffOuterClaims(outer, signed);
  assert.ok(mismatches.some((row) => row.field === 'payment.future_fee' && row.outer === '0' && row.signed === '7'));
  const unsigned = unsignedOuterFields(outer, signed);
  assert.equal(unsigned.includes('payment.future_fee'), false);
});

test('the public inclusion proof is bound to leaf index 1 of size 3', async () => {
  const leaf = Buffer.from(inclusion.leaf, 'hex');
  assert.equal(verifyMerkleInclusion(leaf, 1, 3, inclusion.root, inclusion.proof), true);
  assert.equal(verifyMerkleInclusion(leaf, 2, 3, inclusion.root, inclusion.proof), false);
  const flipped = inclusion.proof.map((step) => ({
    hash: step.hash,
    position: step.position === 'left' ? 'right' : 'left',
  }));
  assert.equal(verifyMerkleInclusion(leaf, 1, 3, inclusion.root, flipped), false);
  const omitted = inclusion.proof.map((step) => ({ hash: step.hash }));
  assert.equal(verifyMerkleInclusion(leaf, 1, 3, inclusion.root, omitted), true);

  const receipt = {
    task_id: foreign.task_id,
    book_chain: { row_hash: foreign.book_chain.row_hash },
  };
  const honest = await verifyAnchoredRoot({
    receipt,
    inclusion,
    head,
    fetchSolanaTx: async () => { throw new Error('rpc'); },
    fetchBaseTx: async () => { throw new Error('rpc'); },
    fetchGenesis: async () => { throw new Error('rpc'); },
  });
  assert.equal(honest.inclusion.valid, true, honest.inclusion.reason);

  const attacks = [
    ['leaf_index', { ...inclusion, leaf_index: 2 }, 'inclusion_failed'],
    ['swapped positions', { ...inclusion, proof: flipped }, 'inclusion_failed'],
    ['leaf_mismatch', { ...inclusion, leaf: 'ab'.repeat(32) }, 'leaf_mismatch'],
    ['root_mismatch', { ...inclusion, root: 'cd'.repeat(32) }, 'root_mismatch'],
    ['tree_size_mismatch', { ...inclusion, tree_size: 99 }, 'tree_size_mismatch'],
  ];
  for (const [name, bad, reason] of attacks) {
    const result = await verifyAnchoredRoot({
      receipt,
      inclusion: bad,
      head,
      fetchSolanaTx: async () => { throw new Error('rpc'); },
      fetchBaseTx: async () => { throw new Error('rpc'); },
      fetchGenesis: async () => { throw new Error('rpc'); },
    });
    assert.equal(result.inclusion.valid, false, name);
    assert.equal(result.inclusion.reason, reason, name);
    assert.equal(result.overall, 'failed', name);
  }
});

test('a tampered amount fails in the library and --rpc is not a verifier flag', async () => {
  const tampered = clone(foreign);
  tampered.payment.gross_amount = '100000';
  const result = await verifyReceipt(tampered, foreignOpts);
  assert.equal(result.overall, 'failed');
  assert.ok(result.claim_mismatches.some((row) => row.field === 'payment.gross_amount' && row.outer === '100000' && row.signed === '10000'));

  const dir = tempDir('chit-log-');
  const receiptPath = path.join(dir, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(tampered));
  const run = runCli([receiptPath, '--json', '--rpc']);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.exit_code, 1);
  assert.match(parsed.message, /removed in 0\.4: --rpc is not a verifier flag/);
});
