/**
 * xfuel-verify accepts a chit402.refusal.v1 document and rejects a tampered
 * refusal_code or nonce. The same document is not a verified payment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });

const { verifyRefusal, verifyReceipt } = await import('../dist/index.js');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'test-refusal-kid';
jwk.alg = 'ES256';
jwk.use = 'sig';
const jwks = { keys: [jwk] };

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signRefusal(payload) {
  const header = { alg: 'ES256', typ: 'chit402-refusal+jwt', kid: jwk.kid };
  const input = `${b64(header)}.${b64(payload)}`;
  const signature = sign('sha256', Buffer.from(input), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${signature.toString('base64url')}`;
}

function document(overrides = {}) {
  const claims = {
    schema: 'chit402.refusal.v1',
    payload_version: 1,
    kind: 'refusal',
    refusal_id: 'rfs-abc',
    nonce: 'n'.repeat(32),
    issued_at: '2026-10-03T00:00:00.000Z',
    refusal_code: 'daily_cap_exceeded',
    reason: 'over the daily cap',
    agent_id: 7,
    book_id: 7,
    task_id: 'blocked-1',
    amount_requested: '2000',
    asset: 'USDC',
    model: 'theta/qwen3',
    hub: 'theta',
    chain_id: 8453,
    anchor: {
      status: 'observed',
      rail: 'base',
      chain_id: 8453,
      block_number: '16',
      block_hash: `0x${'ab'.repeat(32)}`,
      state_root: `0x${'cd'.repeat(32)}`,
      observed_at: '2026-10-03T00:00:00.000Z',
      reason: null,
    },
    book_row: {
      task_id: 'blocked-1',
      seq: 4,
      prev_hash: null,
      row_hash: 'a'.repeat(64),
      event: 'policy_blocked',
    },
    charged: false,
    amount_charged: '0',
    ...overrides,
  };
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-refusal+jwt',
      payload_version: 1,
      jws: signRefusal(claims),
      kid: jwk.kid,
      issuer_jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid: jwk.kid },
    },
    verify_url: 'https://api.chit402.com/refusal/rfs-abc',
  };
}

test('a signed refusal verifies and states the boundary', () => {
  const doc = document();
  const result = verifyRefusal(doc, { jwks });
  assert.equal(result.valid, true);
  assert.equal(result.refusal_code, 'daily_cap_exceeded');
  assert.equal(result.nonce, doc.nonce);
  assert.equal(result.chain_id, 8453);
  assert.equal(result.charged, false);
  assert.match(result.proves.join(' '), /issuer signed that it refused/);
  assert.match(result.does_not_prove.join(' '), /does not prove a payment/);
});

test('changing refusal_code or nonce fails', () => {
  const doc = document();
  const coded = { ...doc, refusal_code: 'kill_switch' };
  assert.equal(verifyRefusal(coded, { jwks }).reason, 'refusal_code_mismatch');

  const nonced = { ...doc, nonce: 'f'.repeat(32) };
  assert.equal(verifyRefusal(nonced, { jwks }).reason, 'nonce_mismatch');

  const parts = doc.issuer_signature.jws.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  payload.nonce = 'e'.repeat(32);
  payload.refusal_code = 'kill_switch';
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const rewritten = {
    ...doc,
    nonce: payload.nonce,
    refusal_code: payload.refusal_code,
    issuer_signature: { ...doc.issuer_signature, jws: parts.join('.') },
  };
  assert.equal(verifyRefusal(rewritten, { jwks }).reason, 'signature_invalid');
});

test('verifyReceipt does not accept a refusal as a payment', async () => {
  const doc = document();
  const payment = await verifyReceipt(doc, { jwks, trustedKids: [] });
  assert.equal(payment.overall, 'failed');
  assert.ok(payment.errors.some((line) => line.includes('not a payment receipt')));
});

test('a refusal with the outer schema removed is still not a payment', async () => {
  const doc = document();
  delete doc.schema;
  const payment = await verifyReceipt(doc, { jwks, trustedKids: [] });
  assert.equal(payment.overall, 'failed');
  assert.ok(payment.errors.some((line) => line.includes('not a payment receipt')));
  const refusal = verifyRefusal(doc, { jwks });
  assert.equal(refusal.valid, true);
  assert.equal(refusal.refusal_code, 'daily_cap_exceeded');
});

test('rewriting the outer schema to a receipt schema is not a verified payment', async () => {
  const doc = document();
  doc.schema = 'xfuel.receipt.v4';
  const payment = await verifyReceipt(doc, { jwks, trustedKids: [] });
  assert.equal(payment.overall, 'failed');
  assert.ok(payment.errors.some((line) => line.includes('not a payment receipt')));
  assert.equal(verifyRefusal(doc, { jwks }).reason, 'schema_mismatch');
});

test('UNAVAILABLE is a signed anchor, not a missing document', () => {
  const doc = document({
    chain_id: null,
    anchor: {
      status: 'UNAVAILABLE',
      rail: 'base',
      chain_id: null,
      block_number: null,
      block_hash: null,
      state_root: null,
      observed_at: '2026-10-03T00:00:00.000Z',
      reason: 'no_rpc',
    },
  });
  const result = verifyRefusal(doc, { jwks });
  assert.equal(result.valid, true);
  assert.equal(result.chain_id, null);
});
