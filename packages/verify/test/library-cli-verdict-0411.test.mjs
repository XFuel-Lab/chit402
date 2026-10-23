/**
 * 0.4.11: the library verdict is never more generous than the CLI.
 * A document without a trusted issuer signature is could_not_check (exit 2).
 * Binding and nullifier facts come from signed claims only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLibraryPass } from './library-pass.mjs';
import { tempDir } from './tmp-dirs.mjs';

const lib = await import('../dist/index.js');
const { verifyReceipt, computePaymentCommitment, verdictFromVerification, unsignedDocumentVerdict } = lib;

const here = fileURLToPath(new URL('.', import.meta.url));
const fixtures = join(here, 'fixtures');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const read = (rel) => JSON.parse(readFileSync(join(fixtures, rel), 'utf8'));
const JWKS = read('chit402-jwks.json');
const REAL = read('chit-4d6e8331.json');

function runCli(doc) {
  const dir = tempDir('v0411-');
  const file = join(dir, 'receipt.json');
  writeFileSync(file, JSON.stringify(doc));
  const proc = spawnSync(process.execPath, [cli, file, '--json'], { encoding: 'utf8', timeout: 20000 });
  return { status: proc.status, json: JSON.parse(proc.stdout) };
}

function notVerified(result) {
  assert.notEqual(result.overall, 'verified');
  assert.notEqual(result.overall, 'verified_carried_forward');
  assert.notEqual(result.verdict.exit_code, 0);
}

function selfBound(doc) {
  const copy = structuredClone(doc);
  delete copy.issuer_signature;
  const amount = String(copy.payment?.net_amount ?? copy.payment?.gross_amount ?? '0');
  const { commitment } = computePaymentCommitment({
    paymentRef: copy.payment.ref,
    taskId: copy.task_id,
    rail: 'usdc',
    amount,
  });
  copy.binding = { rail: 'usdc', amount, expected_commitment: commitment, covers: ['payment', 'settlement'] };
  return copy;
}

test('unsigned document with a self-computed binding is could_not_check in the library and the CLI', async () => {
  const doc = read('unsigned-self-binding.json');
  for (const opts of [{}, { offline: true }, { jwks: JWKS }]) {
    const result = await verifyReceipt(doc, opts);
    notVerified(result);
    assert.equal(result.overall, 'partial');
    assert.equal(result.binding.matches, false);
    assert.equal(result.binding.expected, null);
    assert.equal(result.verdict.result, 'could_not_check');
    assert.equal(result.verdict.exit_code, 2);
    assert.equal(result.verdict.reason, 'signed_receipt_unavailable');
    assert.equal(result.amount_usdc, null);
    assert.equal(result.tx, null);
  }
  const run = runCli(doc);
  assert.equal(run.status, 2);
  assert.equal(run.json.exit_code, 2);
  assert.equal(run.json.reason, 'signed_receipt_unavailable');
});

test('real receipt with its signature removed is not verified', async () => {
  // Removed signature plus a binding computed over the document's own fields.
  const rebound = selfBound(REAL);
  const result = await verifyReceipt(rebound, { jwks: JWKS });
  notVerified(result);
  assert.equal(result.overall, 'partial');
  assert.equal(result.verdict.exit_code, 2);
  assert.equal(result.receipt_id, null);

  // Same, with the amount raised before the binding is computed.
  const raised = structuredClone(REAL);
  raised.payment = { ...raised.payment, gross_amount: '999000000', net_amount: '999000000' };
  const edited = await verifyReceipt(selfBound(raised), { jwks: JWKS });
  notVerified(edited);
  assert.equal(edited.amount_usdc, null);

  // Signature removed and nothing else changed (already partial before 0.4.11).
  const stripped = structuredClone(REAL);
  delete stripped.issuer_signature;
  const plain = await verifyReceipt(stripped, { jwks: JWKS });
  notVerified(plain);
  assert.equal(plain.verdict.exit_code, 2);
});

test('the signed receipt itself still passes every library check', async () => {
  const result = await verifyReceipt(REAL, { jwks: JWKS });
  // The library does not fetch the log, so `overall` follows verdict exit 2.
  assertLibraryPass(result);
  assert.equal(result.issuer_signature.valid, true);
});

async function withNullifierRpc(fn) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const answer = (msg) => {
        calls.push(msg.method);
        if (msg.method === 'eth_chainId') return { jsonrpc: '2.0', id: msg.id, result: '0x2105' };
        if (msg.method === 'net_version') return { jsonrpc: '2.0', id: msg.id, result: '8453' };
        if (msg.method === 'eth_call') {
          return { jsonrpc: '2.0', id: msg.id, result: `0x${'0'.repeat(63)}1` };
        }
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not here' } };
      };
      const out = Array.isArray(parsed) ? parsed.map(answer) : answer(parsed);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('real receipt with its outer nullifier swapped does not report that nullifier', async () => {
  const swapped = structuredClone(REAL);
  const other = `0x${'ee'.repeat(32)}`;
  swapped.proof = { ...(swapped.proof || {}), nullifier: other };

  const plain = await verifyReceipt(swapped, { jwks: JWKS });
  assert.equal(plain.nullifier.nullifier, null);
  assert.notEqual(plain.nullifier.anchored, true);
  assert.ok(plain.unsigned_fields.includes('proof.nullifier'));

  await withNullifierRpc(async (rpcUrl, calls) => {
    const checked = await verifyReceipt(swapped, { jwks: JWKS, checkNullifier: true, rpcUrl });
    assert.equal(checked.nullifier.nullifier, null);
    assert.equal(checked.nullifier.anchored, null);
    assert.notEqual(checked.overall, 'verified');
    assert.equal(calls.includes('eth_call'), false);
  });
});

function receiptFixtures() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith('.json')) {
        try {
          const doc = JSON.parse(readFileSync(full, 'utf8'));
          if (doc && typeof doc === 'object' && !Array.isArray(doc) && (doc.task_id || doc.receipt_id)) out.push([full, doc]);
        } catch {
          // not JSON
        }
      }
    }
  };
  walk(fixtures);
  return out;
}

test('overall and the shared verdict agree on every receipt fixture', async () => {
  const docs = receiptFixtures();
  assert.ok(docs.length >= 5);
  for (const [name, doc] of docs) {
    for (const opts of [{}, { jwks: JWKS }]) {
      const result = await verifyReceipt(doc, opts);
      const label = `${name}: exit ${result.verdict.exit_code} vs ${result.overall}`;
      assert.equal(result.verdict.exit_code === 0, result.overall === 'verified' || result.overall === 'verified_carried_forward', label);
      assert.equal(result.verdict.exit_code === 1, result.overall === 'failed', label);
      assert.equal(result.verdict.exit_code === 2, result.overall === 'partial', label);
    }
  }
});

test('the shared verdict maps unchecked checks to exit 2 and failures to exit 1', () => {
  const base = {
    errors: [],
    issuer_signature: { valid: true, checked: true, key_trusted: true },
    issuer_history: { checked: true, ok: true, reason: null, document: {} },
    binding: { expected: null, matches: false },
    claim_mismatches: [],
    payer: { checked: true, valid: true, outcome: 'pass' },
  };
  const ctx = { version: 'test', payerRequired: true, logInclusion: 'pass', anchor: 'pass' };
  assert.equal(verdictFromVerification(base, ctx).exit_code, 0);
  assert.equal(verdictFromVerification(base, { ...ctx, anchor: 'unclaimed' }).exit_code, 2);
  assert.equal(verdictFromVerification({ ...base, payer: { checked: false, valid: false, outcome: 'unchecked' } }, ctx).exit_code, 2);
  assert.equal(verdictFromVerification({ ...base, issuer_signature: { valid: false, checked: false } }, ctx).exit_code, 2);
  assert.equal(verdictFromVerification({ ...base, issuer_signature: { valid: false, checked: true } }, ctx).exit_code, 1);
  assert.equal(verdictFromVerification({ ...base, claim_mismatches: [{}] }, ctx).exit_code, 1);
  assert.equal(verdictFromVerification(base, { ...ctx, failureReason: 'invalid' }).exit_code, 1);
  assert.equal(unsignedDocumentVerdict({ version: 'test' }).exit_code, 2);
  assert.equal(unsignedDocumentVerdict({ version: 'test', logInclusion: 'fail', anchor: 'pass', notInLog: true }).reason, 'not_in_log');
});
