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

const { _resetIssuerKey, getJwks, initIssuerKey, signWithIssuerKey, signJws, verifyWithJwk, verifyJws, verifyJwsWithJwks } = await import('../src/issuer-key.js');
const {
  buildReceipt,
  verifyReceiptHmac,
  verifyReceiptEcdsa,
  verifyReceiptEcdsaWithJwks,
  verifyReceiptJws,
  verifyReceiptJwsWithJwks,
  callerBindingOf,
  canonicalSignedPayload,
  mergeReceiptView,
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
  test('buildReceipt includes issuer_signature with compact JWS', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: 'test-secret',
    });

    assert.ok(receipt.issuer_signature, 'receipt should have issuer_signature');
    assert.equal(receipt.issuer_signature.alg, 'ES256');
    assert.equal(receipt.issuer_signature.payload_version, 6);
    assert.ok(receipt.issuer_signature.jws, 'should have compact JWS');
    assert.ok(receipt.issuer_signature.kid, 'should have kid');
    assert.equal(receipt.verification.jwks_uri, 'https://api.test/.well-known/jwks.json');
    assert.equal(receipt.issuer_signature.jwks_uri, undefined);
    
    // JWS should have 3 parts
    const parts = receipt.issuer_signature.jws.split('.');
    assert.equal(parts.length, 3, 'JWS should have header.payload.signature');
    
    // Header should have correct typ
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    assert.equal(header.typ, 'chit402-receipt+jwt');
    
    // Payload should be an object with named claims
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    assert.ok(!Array.isArray(payload), 'payload must be an object, not array');
    assert.equal(payload.task_id, receipt.task_id);
    assert.equal(payload.iss, 'chit402');
  });

  test('buildReceipt includes HMAC attestations and ECDSA signature', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: 'primary-secret',
      coSignerSecret: 'co-signer-secret',
    });

    // HMAC attestations (secondary role)
    assert.ok(receipt.hmac_attestation, 'should have HMAC attestation');
    assert.equal(receipt.hmac_attestation.alg, 'HMAC-SHA256');
    assert.equal(receipt.hmac_attestation.role, 'attestor');
    assert.ok(receipt.co_attestation, 'should have co-signer attestation');
    assert.equal(receipt.co_attestation.alg, 'HMAC-SHA256');
    assert.equal(receipt.co_attestation.role, 'co_attestor');

    // ECDSA signature (primary)
    assert.ok(receipt.issuer_signature, 'should have ECDSA signature');
    assert.equal(receipt.issuer_signature.alg, 'ES256');
  });
});

describe('Receipt ECDSA Verification', () => {
  test('verifyReceiptEcdsa validates correct JWS signature', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const { publicKeyJwk: jwk } = initIssuerKey();

    const result = verifyReceiptEcdsa(receipt, jwk);
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.ok(result.kid);
    assert.ok(result.payload, 'should return parsed payload');
    assert.equal(result.payload.task_id, receipt.task_id);
  });

  test('verifyReceiptEcdsa rejects tampered task_id', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const { publicKeyJwk: jwk } = initIssuerKey();

    // Tamper with the task_id (which is in the signed claims)
    const tampered = {
      ...receipt,
      task_id: 'tampered-task-id',
    };

    const result = verifyReceiptEcdsa(tampered, jwk);
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'task_id_mismatch');
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
    assert.ok(result.payload, 'should return parsed payload');
  });

  test('verifyReceiptEcdsaWithJwks rejects when no matching key', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    // Legacy receipts without pin fall back to JWKS lookup.
    delete receipt.issuer_signature.issuer_jwk;

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
    delete receipt.issuer_signature.issuer_jwk;

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

  test('verify fails with tampered receipt (task_id mismatch)', async () => {
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

    // 3. Tamper with task_id (which is a signed claim)
    receipt.task_id = 'tampered-task-id';

    // 4. Fetch the JWKS
    const jwksRes = await fetch(`${base}/.well-known/jwks.json`);
    const jwks = await jwksRes.json();

    // 5. Verify should fail because task_id mismatch
    const result = verifyReceiptEcdsaWithJwks(receipt, jwks);
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'task_id_mismatch');
  });
});

describe('Standard Library Compatibility (jose)', () => {
  test('JWS can be verified with jose library', async () => {
    const jose = await import('jose');
    
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const jwks = getJwks();
    
    // Import the public key from our JWKS
    const key = await jose.importJWK(jwks.keys[0], 'ES256');
    
    // Verify the JWS using jose
    const { payload, protectedHeader } = await jose.jwtVerify(receipt.issuer_signature.jws, key, {
      algorithms: ['ES256'],
    });
    
    // Verify the header
    assert.equal(protectedHeader.alg, 'ES256');
    assert.equal(protectedHeader.typ, 'chit402-receipt+jwt');
    assert.equal(protectedHeader.kid, receipt.issuer_signature.kid);
    
    // Verify the payload is an object with named claims (not an array)
    assert.ok(!Array.isArray(payload), 'payload must be an object, not array');
    assert.equal(payload.task_id, receipt.task_id);
    assert.equal(payload.iss, 'chit402');
    assert.ok(payload.iat, 'iat claim present');
    assert.equal(payload.payload_version, 6);
    
      const view = mergeReceiptView(receipt);
    assert.equal(payload.payment.rail, view.payment.rail);
    assert.equal(payload.payment.ref, view.payment.ref);
    assert.equal(payload.route.model, view.route.model);
    assert.equal(payload.route.provider, view.route.provider);
  });
  
  test('jose rejects tampered JWS', async () => {
    const jose = await import('jose');
    
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const jwks = getJwks();
    const key = await jose.importJWK(jwks.keys[0], 'ES256');
    
    // Tamper with the JWS payload
    const parts = receipt.issuer_signature.jws.split('.');
    const originalPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const tamperedPayload = { ...originalPayload, task_id: 'tampered' };
    const tamperedJws = `${parts[0]}.${Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url')}.${parts[2]}`;
    
    // jose should reject the tampered JWS
    await assert.rejects(
      jose.jwtVerify(tamperedJws, key, { algorithms: ['ES256'] }),
      /signature verification failed/i
    );
  });
  
  test('JWS payload is self-contained (no external signed_fields needed)', async () => {
    const jose = await import('jose');
    
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const jwks = getJwks();
    const key = await jose.importJWK(jwks.keys[0], 'ES256');
    
    const { payload } = await jose.jwtVerify(receipt.issuer_signature.jws, key);
    
    // The payload itself contains all the signed fields with named keys
    // No external signed_fields array is needed to interpret the payload
    assert.ok('task_id' in payload);
    assert.ok('payment' in payload);
    assert.ok('route' in payload);
    assert.ok('output' in payload);
    assert.ok('binding' in payload);
    assert.ok('caller_binding' in payload);
    assert.ok('payload_version' in payload);
    
    // The signed_fields array should NOT exist in the issuer_signature
    // (it was only needed for the old array-based payload)
    assert.ok(!receipt.issuer_signature.signed_fields, 'signed_fields should not be in issuer_signature');
  });

  test('verifyReceiptJws validates receipt JWS', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const { publicKeyJwk: jwk } = initIssuerKey();

    const result = verifyReceiptJws(receipt, jwk);
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.ok(result.payload);
    assert.equal(result.payload.task_id, receipt.task_id);
  });

  test('verifyReceiptJwsWithJwks validates receipt JWS', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const jwks = getJwks();

    const result = verifyReceiptJwsWithJwks(receipt, jwks);
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.ok(result.payload);
    assert.ok(result.kid);
  });

  test('verifyReceiptJwsWithJwks validates with pinned issuer_jwk only', () => {
    const receipt = buildReceipt(mockTask, { baseUrl: 'https://api.test' });
    const result = verifyReceiptJwsWithJwks(receipt, { keys: [] });
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.ok(receipt.issuer_signature.issuer_jwk);
  });
});

describe('Caller/Payer Binding', () => {
  test('callerBindingOf extracts binding from task meta', () => {
    const task = {
      meta: {
        payerWallet: '0x1234567890123456789012345678901234567890',
        agentPubkey: '0xabcdef1234567890abcdef1234567890abcdef12',
        agentId: 42,
        apiKeyHash: 'sha256-hash-of-api-key',
      },
    };

    const binding = callerBindingOf(task);

    assert.ok(binding, 'should return binding');
    assert.equal(binding.payer_wallet, '0x1234567890123456789012345678901234567890');
    assert.equal(binding.agent_pubkey, '0xabcdef1234567890abcdef1234567890abcdef12');
    assert.equal(binding.agent_id, 42);
    assert.equal(binding.api_key_hash, 'sha256-hash-of-api-key');
  });

  test('callerBindingOf returns null fields for task without binding data', () => {
    const task = { meta: { provider: 'test' } };
    const binding = callerBindingOf(task);
    assert.equal(binding.payer_wallet, null);
    assert.equal(binding.agent_pubkey, null);
    assert.equal(binding.agent_id, null);
    assert.equal(binding.api_key_hash, null);
  });

  test('callerBindingOf rejects intent.sender symbolic labels', () => {
    const task = {
      intent: { sender: 'openai-gateway' },
      meta: { provider: 'test' },
    };
    const binding = callerBindingOf(task);
    assert.equal(binding.payer_wallet, null, 'openai-gateway must never appear in payer_wallet');
  });

  test('callerBindingOf accepts opts for binding data', () => {
    const task = { meta: {} };
    const binding = callerBindingOf(task, {
      payerWallet: '0x1234567890123456789012345678901234567890',
      agentPubkey: '0xabcdef1234567890abcdef1234567890abcdef12',
      agentId: 123,
      apiKeyHash: 'hash123',
    });

    assert.ok(binding);
    assert.equal(binding.payer_wallet, '0x1234567890123456789012345678901234567890');
    assert.equal(binding.agent_pubkey, '0xabcdef1234567890abcdef1234567890abcdef12');
    assert.equal(binding.agent_id, 123);
    assert.equal(binding.api_key_hash, 'hash123');
  });

  test('buildReceipt includes caller_binding when data is present', () => {
    const payer = '0x1234567890123456789012345678901234567890';
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      payerWallet: payer,
      apiKeyHash: 'test-api-key-hash',
    });

    const binding = mergeReceiptView(receipt).caller_binding;
    assert.ok(binding, 'caller_binding should be in JWS claims');
    assert.equal(binding.payer_wallet, payer);
    assert.equal(binding.api_key_hash, 'test-api-key-hash');
  });

  test('caller_binding is included in JWS claims', () => {
    const payer = '0x1234567890123456789012345678901234567890';
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      payerWallet: payer,
      apiKeyHash: 'test-api-key-hash',
    });

    const parts = receipt.issuer_signature.jws.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    assert.equal(payload.caller_binding.payer_wallet, payer);
    assert.equal(payload.caller_binding.api_key_hash, 'test-api-key-hash');
  });

  test('tampering signed claims in JWS invalidates verification', () => {
    const payer = '0x1234567890123456789012345678901234567890';
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      payerWallet: payer,
    });
    const { publicKeyJwk: jwk } = initIssuerKey();

    let result = verifyReceiptEcdsa(receipt, jwk);
    assert.equal(result.valid, true, 'original should verify');

    const parts = receipt.issuer_signature.jws.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    payload.caller_binding.payer_wallet = '0xabcdef1234567890abcdef1234567890abcdef12';
    const tamperedJws = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
    const tampered = {
      ...receipt,
      issuer_signature: { ...receipt.issuer_signature, jws: tamperedJws },
    };

    result = verifyReceiptEcdsa(tampered, jwk);
    assert.equal(result.valid, false, 'tampered JWS payer_wallet should fail verification');
  });

  test('hmac attestation omits signed_fields from public JSON', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: 'test-secret',
    });

    assert.ok(receipt.hmac_attestation);
    assert.equal(receipt.hmac_attestation.signed_fields, undefined);
    assert.ok(receipt.hmac_attestation.value.startsWith('sha256='));
  });
});

describe('JSON Suffix Content Negotiation', () => {
  test('GET /receipt/:taskId.json returns JSON', async () => {
    const chatRes = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'test json suffix' }],
        max_tokens: 1,
      }),
    });
    const { xfuel } = await chatRes.json();
    const taskId = xfuel.task_id;

    const receiptRes = await fetch(`${base}/receipt/${taskId}.json`);
    assert.equal(receiptRes.status, 200);

    const contentType = receiptRes.headers.get('content-type');
    assert.ok(contentType.includes('application/json'), 'should return JSON content type');

    const receipt = await receiptRes.json();
    assert.ok(receipt.issuer_signature, 'JSON response should have issuer_signature');
    assert.ok(receipt.issuer_signature.jws, 'issuer_signature should have jws');
  });

  test('Accept: application/json returns JSON', async () => {
    const chatRes = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'test accept header' }],
        max_tokens: 1,
      }),
    });
    const { xfuel } = await chatRes.json();
    const taskId = xfuel.task_id;

    const receiptRes = await fetch(`${base}/receipt/${taskId}`, {
      headers: { 'Accept': 'application/json' },
    });
    assert.equal(receiptRes.status, 200);

    const contentType = receiptRes.headers.get('content-type');
    assert.ok(contentType.includes('application/json'), 'should return JSON content type');

    const receipt = await receiptRes.json();
    assert.ok(receipt.issuer_signature.jws, 'JSON response should have JWS');
  });

  test('default Accept returns HTML', async () => {
    const chatRes = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'test default html' }],
        max_tokens: 1,
      }),
    });
    const { xfuel } = await chatRes.json();
    const taskId = xfuel.task_id;

    const receiptRes = await fetch(`${base}/receipt/${taskId}`);
    assert.equal(receiptRes.status, 200);

    const contentType = receiptRes.headers.get('content-type');
    assert.ok(contentType.includes('text/html'), 'should return HTML content type');

    const html = await receiptRes.text();
    assert.ok(html.includes('<!doctype html>'), 'should be HTML document');
    assert.ok(html.includes('Chit402'), 'should include Chit402 branding');
  });
});

describe('Agent E2E JWS Verification Flow', () => {
  test('agent can fetch JSON, extract JWS, verify against JWKS', async () => {
    const chatRes = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
      body: JSON.stringify({
        model: 'theta/qwen3',
        messages: [{ role: 'user', content: 'agent verification test' }],
        max_tokens: 1,
      }),
    });
    const { xfuel } = await chatRes.json();
    const taskId = xfuel.task_id;

    const receiptRes = await fetch(`${base}/receipt/${taskId}`, {
      headers: { 'Accept': 'application/json' },
    });
    assert.equal(receiptRes.status, 200);
    const receipt = await receiptRes.json();

    const jws = receipt.issuer_signature.jws;
    assert.ok(jws, 'receipt should have JWS');

    const jwksRes = await fetch(`${base}/.well-known/jwks.json`);
    const jwks = await jwksRes.json();

    const verifyResult = verifyJwsWithJwks(jws, jwks);
    assert.equal(verifyResult.valid, true, 'JWS should verify against JWKS');
    assert.equal(verifyResult.payload.task_id, receipt.task_id);
  });
});

describe('Backward Compatibility', () => {
  test('HMAC verification still works alongside ECDSA', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: 'test-secret',
    });

    // HMAC verify (uses hmac_attestation field now)
    const hmacResult = verifyReceiptHmac(receipt, 'test-secret', { sigField: 'hmac_attestation' });
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
    assert.equal(receipt.hmac_attestation, undefined);
    assert.equal(receipt.co_attestation, undefined);

    // But ECDSA signature is present
    assert.ok(receipt.issuer_signature);
    assert.equal(receipt.issuer_signature.alg, 'ES256');
    assert.ok(receipt.issuer_signature.jws, 'should have JWS');

    // And it verifies
    const { publicKeyJwk: jwk } = initIssuerKey();
    const result = verifyReceiptEcdsa(receipt, jwk);
    assert.equal(result.valid, true);
  });
});
