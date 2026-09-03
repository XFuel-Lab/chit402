/**
 * Issuer ECDSA signature tests.
 *
 * Tests the public-key verification path for receipts:
 *   1. Receipt carries issuer_signature (ES256)
 *   2. JWKS endpoint publishes the public key
 *   3. Any agent can verify without HMAC secret
 *   4. Legacy HMAC-only receipts still work
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

// Configure test env before imports
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.RECEIPT_CO_SIGNER_SECRET = 'test-co-signer-secret';

const { _resetIssuerKey, getJwks, initIssuerKey, signWithIssuerKey, verifyWithJwk } = await import('../src/issuer-key.js');
const {
  buildReceipt,
  verifyReceiptHmac,
  verifyReceiptEcdsa,
  verifyReceiptEcdsaWithJwks,
  canonicalSignedPayload,
} = await import('../src/receipt.js');
const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener } = await import('../src/ai-listener.js');

let server;
let base;

const mockTask = {
  taskId: 'xfuel-ecdsa-test-001',
  status: 'completed',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  intent: {
    type: 'inference_request',
    paymentRail: 'usdc',
    paymentRef: 'base:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    amount: '100000',
    model: 'test-model',
  },
  feeAmount: '500',
  netAmount: '99500',
  feeBps: 50,
  meta: { provider: 'test-provider' },
  result: { model: 'test-model', provider: 'test-provider' },
  outputHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
};

before(async () => {
  _resetIssuerKey();
  resetHubCatalogCache();
  await initAIListener();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  _resetIssuerKey();
});

describe('Issuer Key Management', () => {
  test('initIssuerKey generates a valid P-256 key', () => {
    _resetIssuerKey();
    const { publicKeyJwk, kid } = initIssuerKey();

    assert.equal(publicKeyJwk.kty, 'EC');
    assert.equal(publicKeyJwk.crv, 'P-256');
    assert.equal(publicKeyJwk.alg, 'ES256');
    assert.equal(publicKeyJwk.use, 'sig');
    assert.ok(publicKeyJwk.x, 'should have x coordinate');
    assert.ok(publicKeyJwk.y, 'should have y coordinate');
    assert.ok(kid, 'should have kid');
    assert.equal(publicKeyJwk.kid, kid);
  });

  test('signWithIssuerKey produces a valid signature', () => {
    const message = 'test message';
    const { value, kid } = signWithIssuerKey(message);

    assert.ok(value, 'should produce a signature');
    assert.ok(kid, 'should include kid');
    const sigBytes = Buffer.from(value, 'base64url');
    assert.equal(sigBytes.length, 64, 'P-256 signature should be 64 bytes (R||S)');
  });

  test('verifyWithJwk validates correct signature', () => {
    const message = 'test message';
    const { value: sig } = signWithIssuerKey(message);
    const { publicKeyJwk: jwk } = initIssuerKey();

    const valid = verifyWithJwk(message, sig, jwk);
    assert.equal(valid, true);
  });

  test('verifyWithJwk rejects wrong message', () => {
    const { value: sig } = signWithIssuerKey('original message');
    const { publicKeyJwk: jwk } = initIssuerKey();

    const valid = verifyWithJwk('tampered message', sig, jwk);
    assert.equal(valid, false);
  });

  test('verifyWithJwk rejects wrong key', () => {
    const message = 'test message';
    const { value: sig } = signWithIssuerKey(message);

    // Generate a different key
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const wrongJwk = publicKey.export({ format: 'jwk' });

    const valid = verifyWithJwk(message, sig, wrongJwk);
    assert.equal(valid, false);
  });
});

describe('Receipt ECDSA Signing', () => {
  test('buildReceipt includes issuer_signature', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: 'test-secret',
    });

    assert.ok(receipt.issuer_signature, 'receipt should have issuer_signature');
    assert.equal(receipt.issuer_signature.alg, 'ES256');
    assert.equal(receipt.issuer_signature.payload_version, 3);
    assert.ok(receipt.issuer_signature.value, 'should have signature value');
    assert.ok(receipt.issuer_signature.kid, 'should have kid');
    assert.equal(receipt.issuer_signature.jwks_uri, '/.well-known/jwks.json');
    assert.ok(Array.isArray(receipt.issuer_signature.signed_fields));
  });

  test('buildReceipt includes both HMAC and ECDSA signatures', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: 'primary-secret',
      coSignerSecret: 'co-signer-secret',
    });

    // HMAC signatures
    assert.ok(receipt.signature, 'should have primary HMAC signature');
    assert.equal(receipt.signature.alg, 'HMAC-SHA256');
    assert.ok(receipt.co_signature, 'should have co-signer HMAC signature');
    assert.equal(receipt.co_signature.alg, 'HMAC-SHA256');

    // ECDSA signature
    assert.ok(receipt.issuer_signature, 'should have ECDSA signature');
    assert.equal(receipt.issuer_signature.alg, 'ES256');
  });
});

describe('Receipt ECDSA Verification', () => {
  test('verifyReceiptEcdsa validates correct signature', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const { publicKeyJwk: jwk } = initIssuerKey();

    const result = verifyReceiptEcdsa(receipt, jwk);
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.ok(result.kid);
  });

  test('verifyReceiptEcdsa rejects tampered receipt', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const { publicKeyJwk: jwk } = initIssuerKey();

    // Tamper with the receipt
    const tampered = {
      ...receipt,
      payment: { ...receipt.payment, gross_amount: '999999' },
    };

    const result = verifyReceiptEcdsa(tampered, jwk);
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
  });

  test('verifyReceiptEcdsa rejects wrong key', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });

    // Generate a different key but use the same kid so we actually test crypto verification
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const wrongJwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid: receipt.issuer_signature.kid, // Use same kid to test crypto verify, not kid mismatch
      alg: 'ES256',
      use: 'sig',
    };

    const result = verifyReceiptEcdsa(receipt, wrongJwk);
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
  });

  test('verifyReceiptEcdsa rejects mismatched kid', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const { publicKeyJwk: jwk } = initIssuerKey();

    // Use correct key but wrong kid
    const wrongKidJwk = { ...jwk, kid: 'different-kid' };

    const result = verifyReceiptEcdsa(receipt, wrongKidJwk);
    assert.equal(result.checked, false);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'kid_mismatch');
  });

  test('verifyReceiptEcdsa returns error for missing signature', () => {
    const receipt = { task_id: 'test' };

    const result = verifyReceiptEcdsa(receipt, {});
    assert.equal(result.checked, false);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'no_issuer_signature');
  });

  test('verifyReceiptEcdsaWithJwks finds matching key', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const jwks = getJwks();

    const result = verifyReceiptEcdsaWithJwks(receipt, jwks);
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
  });

  test('verifyReceiptEcdsaWithJwks rejects when no matching key', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });

    // Generate a JWKS with a different kid - should fail to find matching key
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const wrongJwks = {
      keys: [{
        ...publicKey.export({ format: 'jwk' }),
        kid: 'wrong-key',
        alg: 'ES256',
        use: 'sig',
      }],
    };

    const result = verifyReceiptEcdsaWithJwks(receipt, wrongJwks);
    // No matching key found (kid mismatch in key selection)
    assert.equal(result.checked, false);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'no_matching_key');
  });

  test('verifyReceiptEcdsaWithJwks rejects wrong key with matching kid', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });

    // Generate a JWKS with a wrong key but matching kid
    const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const wrongJwks = {
      keys: [{
        ...publicKey.export({ format: 'jwk' }),
        kid: receipt.issuer_signature.kid, // Same kid, but different key
        alg: 'ES256',
        use: 'sig',
      }],
    };

    const result = verifyReceiptEcdsaWithJwks(receipt, wrongJwks);
    // Key found, but signature verification fails
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'signature_invalid');
  });
});

describe('JWKS Endpoint', () => {
  test('GET /.well-known/jwks.json returns valid JWKS', async () => {
    const res = await fetch(`${base}/.well-known/jwks.json`);
    assert.equal(res.status, 200);

    const jwks = await res.json();
    assert.ok(Array.isArray(jwks.keys), 'should have keys array');
    assert.ok(jwks.keys.length > 0, 'should have at least one key');

    const key = jwks.keys[0];
    assert.equal(key.kty, 'EC');
    assert.equal(key.crv, 'P-256');
    assert.equal(key.alg, 'ES256');
    assert.equal(key.use, 'sig');
    assert.ok(key.kid);
    assert.ok(key.x);
    assert.ok(key.y);
  });

  test('JWKS key matches receipt issuer_signature kid', async () => {
    // Get JWKS
    const jwksRes = await fetch(`${base}/.well-known/jwks.json`);
    const jwks = await jwksRes.json();

    // Get a receipt from /v1
    const chatRes = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      }),
    });
    const { xfuel } = await chatRes.json();

    assert.ok(xfuel.issuer_signature, 'receipt should have issuer_signature');
    assert.ok(xfuel.issuer_signature.kid, 'issuer_signature should have kid');

    const matchingKey = jwks.keys.find(k => k.kid === xfuel.issuer_signature.kid);
    assert.ok(matchingKey, 'JWKS should contain key matching receipt kid');
  });
});

describe('End-to-End Verification', () => {
  test('full verify flow: fetch receipt, fetch JWKS, verify signature', async () => {
    // 1. Make a request to get a receipt
    const chatRes = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'test verification' }],
        max_tokens: 1,
      }),
    });
    const { xfuel } = await chatRes.json();
    const taskId = xfuel.task_id;

    // 2. Fetch the receipt JSON
    const receiptRes = await fetch(`${base}/receipt/${taskId}?format=json`);
    assert.equal(receiptRes.status, 200);
    const receipt = await receiptRes.json();

    // 3. Fetch the JWKS
    const jwksRes = await fetch(`${base}/.well-known/jwks.json`);
    const jwks = await jwksRes.json();

    // 4. Verify the signature
    const result = verifyReceiptEcdsaWithJwks(receipt, jwks);
    assert.equal(result.checked, true, 'should check the signature');
    assert.equal(result.valid, true, 'signature should be valid');
  });

  test('verify fails with tampered receipt', async () => {
    // 1. Get a receipt
    const chatRes = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'test tamper' }],
        max_tokens: 1,
      }),
    });
    const { xfuel } = await chatRes.json();
    const taskId = xfuel.task_id;

    // 2. Fetch the receipt JSON
    const receiptRes = await fetch(`${base}/receipt/${taskId}?format=json`);
    const receipt = await receiptRes.json();

    // 3. Tamper with it
    receipt.route.provider = 'attacker-provider';

    // 4. Fetch the JWKS
    const jwksRes = await fetch(`${base}/.well-known/jwks.json`);
    const jwks = await jwksRes.json();

    // 5. Verify should fail
    const result = verifyReceiptEcdsaWithJwks(receipt, jwks);
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
  });
});

describe('Backward Compatibility', () => {
  test('HMAC verification still works alongside ECDSA', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: 'test-secret',
    });

    // HMAC verify
    const hmacResult = verifyReceiptHmac(receipt, 'test-secret');
    assert.equal(hmacResult.checked, true);
    assert.equal(hmacResult.valid, true);

    // ECDSA verify
    const { publicKeyJwk: jwk } = initIssuerKey();
    const ecdsaResult = verifyReceiptEcdsa(receipt, jwk);
    assert.equal(ecdsaResult.checked, true);
    assert.equal(ecdsaResult.valid, true);
  });

  test('receipt without HMAC secret still has ECDSA signature', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      // No signingSecret, no coSignerSecret
    });

    // No HMAC signatures
    assert.equal(receipt.signature, undefined);
    assert.equal(receipt.co_signature, undefined);

    // But ECDSA signature is present
    assert.ok(receipt.issuer_signature);
    assert.equal(receipt.issuer_signature.alg, 'ES256');

    // And it verifies
    const { publicKeyJwk: jwk } = initIssuerKey();
    const result = verifyReceiptEcdsa(receipt, jwk);
    assert.equal(result.valid, true);
  });
});
