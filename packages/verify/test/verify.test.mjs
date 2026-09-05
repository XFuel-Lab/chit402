/**
 * Offline receipt verification tests.
 *
 * Tests that third parties can verify Chit402 receipts without calling the API.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

// Build the package first
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');

// Build TypeScript before importing
try {
  execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });
} catch {
  // Build might fail if deps not installed; skip in CI
}

// Import from built dist
const {
  verifyBinding,
  verifyReceipt,
  verifyIssuerSignature,
  verifyIssuerSignatureWithJwks,
  canonicalIssuerPayload,
  canonicalSignedPayload,
  computePaymentCommitment,
  computeInferenceBinding,
} = await import('../dist/index.js');

// Test ES256 key pair (P-256/secp256r1) - generated for testing only
const TEST_PRIVATE_KEY_JWK = {
  kty: 'EC',
  x: 'V1xKWqioBmw69_jnYTbv2Gy--J38UWU4Obd2m7OtWVw',
  y: '4dRM8qoYJ45L3qq4jaUSKISao55tum8ZfwbJUu_w09M',
  crv: 'P-256',
  d: 'XqAuVfmVw0T3ivTRLyBdgJk4YS9Pda00sx32nT1zDiA',
  kid: 'test-key-1',
  alg: 'ES256',
};

const TEST_PUBLIC_KEY_JWK = {
  kty: 'EC',
  x: 'V1xKWqioBmw69_jnYTbv2Gy--J38UWU4Obd2m7OtWVw',
  y: '4dRM8qoYJ45L3qq4jaUSKISao55tum8ZfwbJUu_w09M',
  crv: 'P-256',
  kid: 'test-key-1',
  alg: 'ES256',
};

// Generate a different valid key for "wrong key" tests
import { generateKeyPairSync } from 'node:crypto';
const { publicKey: wrongPubKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const WRONG_PUBLIC_KEY_JWK = {
  ...wrongPubKey.export({ format: 'jwk' }),
  kid: 'wrong-key',
  alg: 'ES256',
};

/**
 * Sign a receipt with the test private key.
 */
function signReceipt(receipt) {
  const privateKey = createPrivateKey({ key: TEST_PRIVATE_KEY_JWK, format: 'jwk' });
  const payload = canonicalIssuerPayload(receipt);
  const signature = sign('sha256', Buffer.from(payload, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return signature.toString('base64url');
}

describe('computePaymentCommitment', () => {
  test('computes deterministic commitment', () => {
    const result = computePaymentCommitment({
      paymentRef: 'base:0xabcdef',
      taskId: 'xfuel-test-123',
      rail: 'usdc',
      amount: '10000',
    });

    assert.ok(result.commitment.startsWith('0x'));
    assert.equal(result.commitment.length, 66); // 0x + 64 hex chars
    assert.equal(result.railDiscriminant, 1);
    assert.equal(result.amount, '10000');
  });

  test('same inputs produce same commitment', () => {
    const input = {
      paymentRef: 'solana:xyz123',
      taskId: 'xfuel-test-456',
      rail: 'usdc',
      amount: '20000',
    };

    const result1 = computePaymentCommitment(input);
    const result2 = computePaymentCommitment(input);

    assert.equal(result1.commitment, result2.commitment);
  });

  test('different inputs produce different commitments', () => {
    const base = {
      paymentRef: 'base:0x123',
      taskId: 'xfuel-test',
      rail: 'usdc',
      amount: '10000',
    };

    const result1 = computePaymentCommitment(base);
    const result2 = computePaymentCommitment({ ...base, amount: '10001' });

    assert.notEqual(result1.commitment, result2.commitment);
  });

  test('handles null paymentRef (pre-settlement)', () => {
    const result = computePaymentCommitment({
      paymentRef: null,
      taskId: 'xfuel-presettled',
      rail: 'usdc',
      amount: '10000',
    });

    assert.ok(result.commitment);
    // paymentRefHash should be zero bytes32
    assert.equal(result.paymentRefHash, '0x' + '0'.repeat(64));
  });
});

describe('computeInferenceBinding', () => {
  test('includes model and output hash in commitment', () => {
    const modelCommitment = '0x' + 'ab'.repeat(32);
    const outputHash = '0x' + 'cd'.repeat(32);

    const result = computeInferenceBinding({
      paymentRef: 'base:0xabc',
      taskId: 'xfuel-pbr-test',
      rail: 'usdc',
      amount: '50000',
      modelCommitment,
      outputHash,
    });

    assert.ok(result.commitment);
    assert.equal(result.modelCommitment, modelCommitment);
    assert.equal(result.outputHash, outputHash);
  });

  test('uses zero bytes32 for missing model/output', () => {
    const result = computeInferenceBinding({
      paymentRef: 'base:0xdef',
      taskId: 'xfuel-no-pbr',
      rail: 'usdc',
      amount: '10000',
    });

    assert.equal(result.modelCommitment, '0x' + '0'.repeat(64));
    assert.equal(result.outputHash, '0x' + '0'.repeat(64));
  });
});

describe('verifyBinding', () => {
  test('returns verified:false when no binding present', () => {
    const receipt = {
      task_id: 'xfuel-no-binding',
      status: 'completed',
      payment: { rail: 'unmetered' },
    };

    const result = verifyBinding(receipt);

    assert.equal(result.verified, false);
    assert.ok(result.reason?.includes('No binding'));
  });

  test('returns matches:true for correctly bound receipt', () => {
    const taskId = 'xfuel-test-verify';
    const paymentRef = 'base:0x' + 'ab'.repeat(32);
    const amount = '10000';

    // Compute the expected commitment
    const { commitment } = computePaymentCommitment({
      paymentRef,
      taskId,
      rail: 'usdc',
      amount,
    });

    const receipt = {
      task_id: taskId,
      status: 'completed',
      payment: {
        rail: 'usdc',
        ref: paymentRef,
        net_amount: amount,
      },
      binding: {
        expected_commitment: commitment,
        amount,
        rail: 'usdc',
        covers: ['payment', 'settlement'],
      },
    };

    const result = verifyBinding(receipt);

    assert.equal(result.verified, true);
    assert.equal(result.matches, true);
    assert.equal(result.expected, commitment);
    assert.equal(result.recomputed, commitment);
  });

  test('returns matches:false for tampered receipt', () => {
    const taskId = 'xfuel-tampered';
    const paymentRef = 'base:0x' + 'ab'.repeat(32);
    const amount = '10000';

    // Use wrong commitment (tampered)
    const wrongCommitment = '0x' + 'ff'.repeat(32);

    const receipt = {
      task_id: taskId,
      status: 'completed',
      payment: {
        rail: 'usdc',
        ref: paymentRef,
        net_amount: amount,
      },
      binding: {
        expected_commitment: wrongCommitment,
        amount,
        rail: 'usdc',
        covers: ['payment', 'settlement'],
      },
    };

    const result = verifyBinding(receipt);

    assert.equal(result.verified, true);
    assert.equal(result.matches, false);
    assert.notEqual(result.expected, result.recomputed);
    assert.ok(result.reason?.includes('mismatch'));
  });

  test('handles PBR binding with model and output', () => {
    const taskId = 'xfuel-pbr';
    const paymentRef = 'solana:xyz123';
    const amount = '50000';
    const modelCommitment = '0x' + 'ab'.repeat(32);
    const outputHash = '0x' + 'cd'.repeat(32);

    const { commitment } = computeInferenceBinding({
      paymentRef,
      taskId,
      rail: 'usdc',
      amount,
      modelCommitment,
      outputHash,
    });

    const receipt = {
      task_id: taskId,
      status: 'completed',
      payment: {
        rail: 'usdc',
        ref: paymentRef,
        net_amount: amount,
      },
      binding: {
        expected_commitment: commitment,
        amount,
        rail: 'usdc',
        covers: ['payment', 'settlement', 'model', 'inference'],
        model_commitment: modelCommitment,
        output_hash: outputHash,
      },
    };

    const result = verifyBinding(receipt);

    assert.equal(result.verified, true);
    assert.equal(result.matches, true);
    assert.deepEqual(result.covers, ['payment', 'settlement', 'model', 'inference']);
  });
});

describe('verifyIssuerSignature (ES256)', () => {
  test('verifies valid ES256 signature', () => {
    const receipt = {
      task_id: 'xfuel-issuer-test',
      status: 'completed',
      payment: { rail: 'usdc', ref: 'base:0x123', gross_amount: '10000' },
      route: { model: 'test/model', provider: 'test-hub' },
      output: { hash: '0x' + 'ab'.repeat(32) },
    };

    // Sign the receipt
    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = {
      alg: 'ES256',
      value: signatureValue,
      kid: 'test-key-1',
    };

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);

    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.equal(result.kid, 'test-key-1');
  });

  test('rejects signature with wrong key', () => {
    const receipt = {
      task_id: 'xfuel-wrong-key',
      status: 'completed',
      payment: { rail: 'usdc' },
    };

    const signatureValue = signReceipt(receipt);
    // Use no kid to avoid kid mismatch check, force signature verification
    receipt.issuer_signature = {
      alg: 'ES256',
      value: signatureValue,
    };

    // Use a key without kid too so verification happens
    const wrongKeyNoKid = { ...WRONG_PUBLIC_KEY_JWK };
    delete wrongKeyNoKid.kid;

    const result = verifyIssuerSignature(receipt, wrongKeyNoKid);

    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
  });

  test('rejects tampered receipt', () => {
    const receipt = {
      task_id: 'xfuel-tampered-sig',
      status: 'completed',
      payment: { rail: 'usdc', gross_amount: '10000' },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = {
      alg: 'ES256',
      value: signatureValue,
      kid: 'test-key-1',
    };

    // Tamper with the receipt after signing
    receipt.payment.gross_amount = '99999';

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);

    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
  });

  test('returns not checked when no signature present', () => {
    const receipt = {
      task_id: 'xfuel-no-sig',
      status: 'completed',
    };

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);

    assert.equal(result.checked, false);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'no_issuer_signature');
  });

  test('rejects kid mismatch', () => {
    const receipt = {
      task_id: 'xfuel-kid-mismatch',
      status: 'completed',
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = {
      alg: 'ES256',
      value: signatureValue,
      kid: 'different-kid',
    };

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);

    assert.equal(result.checked, false);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'kid_mismatch');
  });
});

describe('verifyIssuerSignatureWithJwks', () => {
  test('finds matching key by kid and verifies', () => {
    const receipt = {
      task_id: 'xfuel-jwks-test',
      status: 'completed',
      payment: { rail: 'usdc' },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = {
      alg: 'ES256',
      value: signatureValue,
      kid: 'test-key-1',
    };

    const jwks = {
      keys: [WRONG_PUBLIC_KEY_JWK, TEST_PUBLIC_KEY_JWK],
    };

    const result = verifyIssuerSignatureWithJwks(receipt, jwks);

    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
  });

  test('returns no_matching_key when kid not in JWKS', () => {
    const receipt = {
      task_id: 'xfuel-no-key',
      status: 'completed',
      issuer_signature: {
        alg: 'ES256',
        value: 'dummy',
        kid: 'nonexistent-key',
      },
    };

    const jwks = {
      keys: [TEST_PUBLIC_KEY_JWK],
    };

    const result = verifyIssuerSignatureWithJwks(receipt, jwks);

    assert.equal(result.checked, false);
    assert.equal(result.reason, 'no_matching_key');
  });

  test('returns empty_jwks for empty key set', () => {
    const receipt = {
      task_id: 'xfuel-empty-jwks',
      status: 'completed',
      issuer_signature: { alg: 'ES256', value: 'dummy' },
    };

    const result = verifyIssuerSignatureWithJwks(receipt, { keys: [] });

    assert.equal(result.checked, false);
    assert.equal(result.reason, 'empty_jwks');
  });
});

describe('canonicalIssuerPayload with fee/COGS fields', () => {
  test('includes all 15 signed fields in canonical order', () => {
    const receipt = {
      task_id: 'task-full-fields',
      payment: {
        rail: 'usdc',
        ref: 'base:0x123abc',
        gross_amount: '100000',
        net_amount: '90000',
        fee_amount: '5000',
        protocol_fee_bps: 500,
        platform_fee: '3000',
        platform_fee_bps: 300,
      },
      provider_cogs: {
        actual: '85000',
      },
      route: {
        model: 'theta/glm-4',
        model_commitment: { commitment: '0x' + 'ab'.repeat(32) },
        provider: 'theta-edgecloud',
      },
      output: { hash: '0x' + 'cd'.repeat(32) },
      binding: { expected_commitment: '0x' + 'ef'.repeat(32) },
    };

    const payload = canonicalIssuerPayload(receipt);
    const parsed = JSON.parse(payload);

    assert.equal(parsed.length, 15);
    assert.equal(parsed[0], 'task-full-fields');
    assert.equal(parsed[1], 'usdc');
    assert.equal(parsed[2], 'base:0x123abc');
    assert.equal(parsed[3], '100000');
    assert.equal(parsed[4], '90000');
    assert.equal(parsed[5], '5000'); // fee_amount
    assert.equal(parsed[6], 500); // protocol_fee_bps
    assert.equal(parsed[7], '3000'); // platform_fee
    assert.equal(parsed[8], 300); // platform_fee_bps
    assert.equal(parsed[9], '85000'); // provider_cogs.actual
    assert.equal(parsed[10], 'theta/glm-4');
    assert.equal(parsed[11], '0x' + 'ab'.repeat(32));
    assert.equal(parsed[12], 'theta-edgecloud');
    assert.equal(parsed[13], '0x' + 'cd'.repeat(32));
    assert.equal(parsed[14], '0x' + 'ef'.repeat(32));
  });

  test('uses fee_bps fallback when protocol_fee_bps is missing', () => {
    const receipt = {
      task_id: 'task-fee-bps',
      payment: {
        rail: 'usdc',
        fee_bps: 250, // legacy field
      },
    };

    const payload = canonicalIssuerPayload(receipt);
    const parsed = JSON.parse(payload);

    assert.equal(parsed[6], 250); // should use fee_bps
  });

  test('canonicalSignedPayload is identical to canonicalIssuerPayload', () => {
    const receipt = { task_id: 't', payment: { fee_amount: '100', protocol_fee_bps: 50, platform_fee: '10', platform_fee_bps: 5 }, provider_cogs: { actual: '80' } };
    assert.equal(canonicalSignedPayload(receipt), canonicalIssuerPayload(receipt));
  });

  test('verifies signature with all fee/COGS fields present', () => {
    const receipt = {
      task_id: 'task-full-verify',
      status: 'completed',
      payment: {
        rail: 'usdc',
        ref: 'base:0xabc',
        gross_amount: '50000',
        net_amount: '45000',
        fee_amount: '2500',
        protocol_fee_bps: 500,
        platform_fee: '1500',
        platform_fee_bps: 300,
      },
      provider_cogs: {
        actual: '42000',
      },
      route: {
        model: 'openai/gpt-4',
        model_commitment: { commitment: '0x' + '11'.repeat(32) },
        provider: 'openrouter',
      },
      output: { hash: '0x' + '22'.repeat(32) },
      binding: { expected_commitment: '0x' + '33'.repeat(32) },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = {
      alg: 'ES256',
      value: signatureValue,
      kid: 'test-key-1',
    };

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);

    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
  });

  test('tampered fee_amount invalidates signature', () => {
    const receipt = {
      task_id: 'task-tamper-fee-amount',
      status: 'completed',
      payment: {
        rail: 'usdc',
        fee_amount: '5000',
        protocol_fee_bps: 500,
        platform_fee: '3000',
        platform_fee_bps: 300,
      },
      provider_cogs: { actual: '10000' },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = { alg: 'ES256', value: signatureValue, kid: 'test-key-1' };

    // Tamper with fee_amount
    receipt.payment.fee_amount = '9999';

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);
    assert.equal(result.valid, false);
  });

  test('tampered protocol_fee_bps invalidates signature', () => {
    const receipt = {
      task_id: 'task-tamper-protocol-fee',
      status: 'completed',
      payment: {
        rail: 'usdc',
        fee_amount: '5000',
        protocol_fee_bps: 500,
        platform_fee: '3000',
        platform_fee_bps: 300,
      },
      provider_cogs: { actual: '10000' },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = { alg: 'ES256', value: signatureValue, kid: 'test-key-1' };

    // Tamper with protocol_fee_bps
    receipt.payment.protocol_fee_bps = 999;

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);
    assert.equal(result.valid, false);
  });

  test('tampered platform_fee invalidates signature', () => {
    const receipt = {
      task_id: 'task-tamper-platform-fee',
      status: 'completed',
      payment: {
        rail: 'usdc',
        fee_amount: '5000',
        protocol_fee_bps: 500,
        platform_fee: '3000',
        platform_fee_bps: 300,
      },
      provider_cogs: { actual: '10000' },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = { alg: 'ES256', value: signatureValue, kid: 'test-key-1' };

    // Tamper with platform_fee
    receipt.payment.platform_fee = '9999';

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);
    assert.equal(result.valid, false);
  });

  test('tampered provider_cogs.actual invalidates signature', () => {
    const receipt = {
      task_id: 'task-tamper-cogs',
      status: 'completed',
      payment: {
        rail: 'usdc',
        fee_amount: '5000',
        protocol_fee_bps: 500,
        platform_fee: '3000',
        platform_fee_bps: 300,
      },
      provider_cogs: { actual: '10000' },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = { alg: 'ES256', value: signatureValue, kid: 'test-key-1' };

    // Tamper with provider_cogs.actual
    receipt.provider_cogs.actual = '99999';

    const result = verifyIssuerSignature(receipt, TEST_PUBLIC_KEY_JWK);
    assert.equal(result.valid, false);
  });
});

describe('verifyReceipt overall status semantics', () => {
  test('overall=partial when receipt has issuer_signature but no JWKS provided', async () => {
    const receipt = {
      task_id: 'task-sig-no-jwks',
      status: 'completed',
      payment: { rail: 'usdc' },
      issuer_signature: { alg: 'ES256', value: 'some-sig', kid: 'key-1' },
    };

    const result = await verifyReceipt(receipt, {}); // No JWKS

    assert.equal(result.overall, 'partial');
    assert.equal(result.issuer_signature.checked, false);
    assert.ok(result.issuer_signature.reason.includes('JWKS not provided'));
  });

  test('overall=failed when JWKS provided but signature invalid', async () => {
    const receipt = {
      task_id: 'task-invalid-sig',
      status: 'completed',
      payment: { rail: 'usdc' },
    };

    // Sign with test key
    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = { alg: 'ES256', value: signatureValue, kid: 'test-key-1' };

    // Tamper with receipt after signing
    receipt.payment.rail = 'tfuel';

    const jwks = { keys: [TEST_PUBLIC_KEY_JWK] };
    const result = await verifyReceipt(receipt, { jwks });

    assert.equal(result.overall, 'failed');
    assert.equal(result.issuer_signature.valid, false);
  });

  test('overall=failed when JWKS provided but no matching key', async () => {
    const receipt = {
      task_id: 'task-no-match',
      status: 'completed',
      payment: { rail: 'usdc' },
      issuer_signature: { alg: 'ES256', value: 'some-sig', kid: 'nonexistent-key' },
    };

    const jwks = { keys: [TEST_PUBLIC_KEY_JWK] }; // kid='test-key-1', not 'nonexistent-key'
    const result = await verifyReceipt(receipt, { jwks });

    assert.equal(result.overall, 'failed');
  });

  test('overall=verified when unsigned receipt has valid binding', async () => {
    const taskId = 'task-unsigned';
    const paymentRef = 'base:0x' + 'ab'.repeat(32);
    const amount = '10000';

    const { commitment } = computePaymentCommitment({
      paymentRef,
      taskId,
      rail: 'usdc',
      amount,
    });

    const receipt = {
      task_id: taskId,
      status: 'completed',
      payment: { rail: 'usdc', ref: paymentRef, net_amount: amount },
      binding: { expected_commitment: commitment, amount, rail: 'usdc', covers: ['payment'] },
      // No issuer_signature
    };

    const result = await verifyReceipt(receipt, {});

    assert.equal(result.overall, 'verified');
  });

  test('overall=verified when signed receipt with valid JWKS and binding', async () => {
    const taskId = 'task-signed-valid';
    const paymentRef = 'base:0x' + 'cd'.repeat(32);
    const amount = '20000';

    const { commitment } = computePaymentCommitment({
      paymentRef,
      taskId,
      rail: 'usdc',
      amount,
    });

    const receipt = {
      task_id: taskId,
      status: 'completed',
      payment: { rail: 'usdc', ref: paymentRef, net_amount: amount },
      binding: { expected_commitment: commitment, amount, rail: 'usdc', covers: ['payment'] },
    };

    // Sign
    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = { alg: 'ES256', value: signatureValue, kid: 'test-key-1' };

    const jwks = { keys: [TEST_PUBLIC_KEY_JWK] };
    const result = await verifyReceipt(receipt, { jwks });

    assert.equal(result.overall, 'verified');
    assert.equal(result.issuer_signature.valid, true);
    assert.equal(result.binding.matches, true);
  });

  test('overall=partial for unmetered receipt with no binding or signature', async () => {
    const receipt = {
      task_id: 'task-unmetered',
      status: 'completed',
      payment: { rail: 'unmetered' },
      // No binding, no signature
    };

    const result = await verifyReceipt(receipt, {});

    assert.equal(result.overall, 'partial');
  });

  test('verifyReceipt verifies JWS with pinned issuer_jwk and no JWKS file', async () => {
    const receipt = await buildPinnedJwsReceipt();
    const result = await verifyReceipt(receipt, {});
    assert.equal(result.issuer_signature.valid, true);
    assert.equal(result.issuer_signature.checked, true);
    assert.equal(result.overall, 'partial');
  });

  test('pinned receipt fails when JWS is tampered', async () => {
    const receipt = await buildPinnedJwsReceipt();
    const parts = receipt.issuer_signature.jws.split('.');
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A');
    receipt.issuer_signature.jws = parts.join('.');

    const result = await verifyReceipt(receipt, {});
    assert.equal(result.issuer_signature.valid, false);
    assert.equal(result.overall, 'failed');
  });

  test('legacy receipt without issuer_jwk still verifies with JWKS option', async () => {
    const receipt = {
      task_id: 'xfuel-legacy-jwks',
      status: 'completed',
      payment: { rail: 'usdc' },
    };

    const signatureValue = signReceipt(receipt);
    receipt.issuer_signature = {
      alg: 'ES256',
      value: signatureValue,
      kid: 'test-key-1',
      // no issuer_jwk — legacy detached signature
    };

    const jwks = { keys: [TEST_PUBLIC_KEY_JWK] };
    const result = await verifyReceipt(receipt, { jwks });

    assert.equal(result.issuer_signature.valid, true);
    assert.equal(result.issuer_signature.checked, true);
    assert.equal(result.overall, 'partial');
  });
});

/**
 * Build a receipt with pinned issuer_jwk + compact JWS (no JWKS file needed).
 */
async function buildPinnedJwsReceipt() {
  const { generateKeyPairSync, sign, createHash } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkExport = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: jwkExport.crv, kty: jwkExport.kty, x: jwkExport.x, y: jwkExport.y });
  const kid = createHash('sha256').update(canonical).digest('base64url');
  const issuer_jwk = { ...jwkExport, kid, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };

  const payload = {
    task_id: 'xfuel-pin-test',
    iss: 'chit402',
    iat: 1,
    payload_version: 6,
    payment: {
      rail: 'usdc',
      ref: 'base:0xabc',
      asset: 'USDC',
      payee: '0x2222222222222222222222222222222222222222',
      gross_amount: '1000',
      net_amount: '900',
      fee_amount: '100',
      protocol_fee_bps: 50,
      platform_fee: null,
      platform_fee_bps: null,
    },
    caller_binding: {
      payer_wallet: '0x1111111111111111111111111111111111111111',
      agent_pubkey: null,
      api_key_hash: null,
    },
  };
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const jws = `${signingInput}.${signature}`;

  return {
    task_id: 'xfuel-pin-test',
    status: 'completed',
    payment: {
      rail: 'usdc',
      ref: 'base:0xabc',
      asset: 'USDC',
      payee: '0x2222222222222222222222222222222222222222',
      gross_amount: '1000',
      net_amount: '900',
    },
    caller_binding: { payer_wallet: '0x1111111111111111111111111111111111111111' },
    issuer_signature: { alg: 'ES256', jws, kid, issuer_jwk, payload_version: 6 },
  };
}
