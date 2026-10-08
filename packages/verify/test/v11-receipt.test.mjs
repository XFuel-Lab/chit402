import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, hkdfSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReceipt, verifyReceiptUpToV10 } from '../dist/index.js';
import { v11SaltRejection } from '../dist/v11-receipt.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function jwkAndKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig' };
  return { privateKey, jwk };
}

function signPayload(privateKey, payload, kid) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${header}.${body}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function commit(saltHex, label, message) {
  const sub = Buffer.from(hkdfSync('sha256', Buffer.from(saltHex, 'hex'), Buffer.alloc(0), Buffer.from(label), 32));
  const bytes = Buffer.isBuffer(message) ? message : Buffer.from(message);
  return createHmac('sha256', sub).update(bytes).digest('hex');
}

function receiptFor(privateKey, jwk, claims) {
  const kid = 'test-kid';
  jwk.kid = kid;
  return {
    v: 11,
    ...claims,
    issuer_signature: { alg: 'ES256', kid, jws: signPayload(privateKey, claims, kid) },
    verify_url: 'https://example.test/receipt/r1',
  };
}

function baseClaims(salt) {
  const output = Buffer.from('ok');
  return {
    v: 11,
    receipt_id: 'xfuel-v11-test',
    iss: 'chit402',
    kid: 'test-kid',
    issued_at: '2026-09-26T17:27Z',
    asset: 'USDC',
    chain: 'base',
    pay_to: '0x2222222222222222222222222222222222222222',
    amount_gross: '2000',
    amount_settled: '2000',
    payment_tx: `0x${'ab'.repeat(32)}`,
    payer: '0x1111111111111111111111111111111111111111',
    book_ref: 'ab'.repeat(16),
    seq: 1,
    request_digest: '11'.repeat(32),
    output_commitment: commit(salt, 'v11/output', output),
    accounting_commitment: commit(salt, 'v11/accounting', '{"floor":null,"internal_breakdown":null,"margin":null,"per_call_cost":null}'),
    routing_commitment: commit(salt, 'v11/routing', '{"model":"m","provider":"p"}'),
    product: 'completions',
    proof_tier: null,
    covers: ['payment'],
  };
}

test('deploy gate: publish the v11 verifier before the gateway issues v11', async () => {
  const salt = '0123456789abcdef'.repeat(4);
  const { privateKey, jwk } = jwkAndKey();
  const claims = baseClaims(salt);
  const receipt = receiptFor(privateKey, jwk, claims);
  // A verifier published before v11 checks the ES256 signature and can report
  // it verified. It does not return unsupported_version. That CLI exits 3.
  // Ship this package first, then the gateway. verifyReceiptUpToV10 in this
  // tree is the v10 entry, not that older library.
  const header = receipt.issuer_signature.jws.split('.').slice(0, 2).join('.');
  const sig = Buffer.from(receipt.issuer_signature.jws.split('.')[2], 'base64url');
  const { createPublicKey, verify } = await import('node:crypto');
  const signatureOnly = verify('sha256', Buffer.from(header), {
    key: createPublicKey({ key: jwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }, sig);
  assert.equal(signatureOnly, true);
  const old = await verifyReceiptUpToV10(receipt, { jwks: { keys: [jwk] }, trustedKids: [] });
  assert.equal(old.overall, 'failed');
  assert.equal(old.errors.includes('unsupported_version'), true);
  const opened = await verifyReceipt(receipt, {
    jwks: { keys: [jwk] },
    trustedKids: [],
    salt,
    open: {
      output: Buffer.from('ok'),
      accounting: '{"internal_breakdown":null,"per_call_cost":null,"floor":null,"margin":null}',
      routing: '{"provider":"p","model":"m"}',
    },
  });
  assert.equal(opened.overall, 'verified', opened.errors.join(','));
});

test('malformed salts and a wrong salt fail with distinct reasons', async () => {
  assert.equal(v11SaltRejection('ab'.repeat(31) + 'a'), 'salt_length');
  assert.equal(v11SaltRejection('AB'.repeat(32)), 'salt_uppercase');
  assert.equal(v11SaltRejection(`0x${'ab'.repeat(32)}`), 'salt_prefix');
  const salt = 'cd'.repeat(32);
  const { privateKey, jwk } = jwkAndKey();
  const receipt = receiptFor(privateKey, jwk, baseClaims(salt));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v11-verify-'));
  const file = path.join(dir, 'receipt.json');
  fs.writeFileSync(file, JSON.stringify(receipt));
  const jwks = path.join(dir, 'jwks.json');
  fs.writeFileSync(jwks, JSON.stringify({ keys: [jwk] }));
  const out = path.join(dir, 'ok.txt');
  fs.writeFileSync(out, 'ok');
  const cases = [
    ['ab'.repeat(31) + 'a', 'salt_length'],
    ['AB'.repeat(32), 'salt_uppercase'],
    [`0x${'ab'.repeat(32)}`, 'salt_prefix'],
    ['ff'.repeat(32), 'commitment_mismatch'],
  ];
  for (const [bad, reason] of cases) {
    const run = spawnSync(process.execPath, [cli, file, '--jwks-file', jwks, '--no-trusted-kid', '--salt', bad, '--open', `output=${out}`, '--json'], { encoding: 'utf8' });
    assert.notEqual(run.status, 0, reason);
    assert.match(`${run.stdout}\n${run.stderr}`, new RegExp(reason));
  }
  const injected = receiptFor(privateKey, jwk, { ...baseClaims(salt), provider: 'leak' });
  const badFile = path.join(dir, 'bad.json');
  fs.writeFileSync(badFile, JSON.stringify(injected));
  const denied = spawnSync(process.execPath, [cli, badFile, '--jwks-file', jwks, '--no-trusted-kid', '--json'], { encoding: 'utf8' });
  assert.notEqual(denied.status, 0);
  assert.match(`${denied.stdout}\n${denied.stderr}`, /v11_disallowed_field/);
});

test('settled below the quote and a swapped commitment are payment_unbound or commitment_mismatch', async () => {
  const salt = 'ab'.repeat(32);
  const { privateKey, jwk } = jwkAndKey();
  const short = baseClaims(salt);
  short.amount_settled = '1999';
  const shortReceipt = receiptFor(privateKey, jwk, short);
  const shortResult = await verifyReceipt(shortReceipt, { jwks: { keys: [jwk] }, trustedKids: [] });
  assert.equal(shortResult.overall, 'failed');
  assert.equal(shortResult.errors.includes('payment_unbound'), true);
  assert.equal(shortResult.errors.includes('payment_unbound:amount_settled'), true);

  const swapped = baseClaims(salt);
  const output = swapped.output_commitment;
  swapped.output_commitment = swapped.accounting_commitment;
  swapped.accounting_commitment = output;
  const swappedReceipt = receiptFor(privateKey, jwk, swapped);
  const opened = await verifyReceipt(swappedReceipt, {
    jwks: { keys: [jwk] },
    trustedKids: [],
    salt,
    open: { output: Buffer.from('ok') },
  });
  assert.equal(opened.overall, 'failed');
  assert.equal(opened.errors.includes('commitment_mismatch'), true);
});
