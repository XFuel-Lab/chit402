/**
 * Offline receipt verification tests.
 *
 * Tests that third parties can verify Chit402 receipts without calling the API.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
  verifyIssuerJws,
  reconcileSettledTransfer,
  ERC20_TRANSFER_TOPIC,
  verifyBasePayer,
  jwkThumbprint,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  diffOuterClaims,
  USDC_ADDRESSES,
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

  test('embedded issuer_jwk is not a trust root without a pin or JWKS', async () => {
    const receipt = await buildPinnedJwsReceipt();
    const result = await verifyReceipt(receipt, { trustedKids: [] });
    assert.equal(result.issuer_signature.valid, false);
    assert.equal(result.issuer_signature.key_trusted, false);
    assert.equal(result.issuer_signature.reason, 'key untrusted');
    assert.equal(result.amount_usdc, null);
    assert.equal(result.overall, 'failed');
  });

  test('JWS verifies when the embedded key thumbprint is an explicit trusted kid', async () => {
    const receipt = await buildPinnedJwsReceipt();
    const result = await verifyReceipt(receipt, { trustedKids: [receipt.issuer_signature.kid] });
    assert.equal(result.issuer_signature.valid, true);
    assert.equal(result.issuer_signature.trust, 'pinned_kid');
    assert.equal(result.amount_usdc, '1000');
    assert.equal(result.overall, 'verified');
  });

  test('pinned receipt fails when JWS is tampered', async () => {
    const receipt = await buildPinnedJwsReceipt();
    const parts = receipt.issuer_signature.jws.split('.');
    const mid = Math.floor(parts[2].length / 2);
    // Last base64url char can decode identically (~29%); middle char always corrupts bytes.
    parts[2] = parts[2].slice(0, mid) + (parts[2][mid] === 'A' ? 'B' : 'A') + parts[2].slice(mid + 1);
    receipt.issuer_signature.jws = parts.join('.');

    const result = await verifyReceipt(receipt, { trustedKids: [receipt.issuer_signature.kid] });
    assert.equal(result.issuer_signature.valid, false);
    assert.equal(result.issuer_signature.reason, 'signature_invalid');
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
    assert.equal(result.issuer_signature.trust, 'jwks');
    assert.equal(result.overall, 'verified');
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

describe('payload v7 still verifies; v8 reconciles with the on-chain transfer', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/chit-5d775d12.v7.json', import.meta.url), 'utf8'));
  const chain = JSON.parse(readFileSync(new URL('./fixtures/chit-5d775d12.base-logs.json', import.meta.url), 'utf8'));

  test('listing-55 v7 JWS still verifies and is not rewritten', () => {
    assert.equal(fixture.issuer_signature.payload_version, 7);
    assert.equal(fixture.issuer_signature.kid, 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q');
    const result = verifyIssuerJws(fixture.issuer_signature.jws, fixture.issuer_signature.issuer_jwk);
    assert.equal(result.valid, true, result.reason);
    assert.equal(result.payload.payment.net_amount, '1990');
    assert.equal(result.payload.payment.gross_amount, '2000');
    assert.equal(result.payload.payment.protocol_fee_bps, 50);
    assert.equal(result.payload.payload_version, 7);
  });

  test('v7 net_amount 1990 does not match the 2000 USDC Transfer to the payee', () => {
    const recon = reconcileSettledTransfer(fixture, chain.logs, { usdcAddress: chain.usdc });
    assert.equal(recon.checked, true);
    assert.equal(recon.matches, false);
    assert.equal(recon.payload_version, 7);
    assert.equal(recon.signed_field, 'net_amount');
    assert.equal(recon.signed_amount, '1990');
    assert.equal(recon.transfer_amount, '2000');
    assert.match(recon.reason, /1990/);
    assert.match(recon.reason, /2000/);
  });

  test('v8 settled_amount matches Transfer 2000 and does not sign a 50 bps fee', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwkExport = publicKey.export({ format: 'jwk' });
    const canonical = JSON.stringify({ crv: jwkExport.crv, kty: jwkExport.kty, x: jwkExport.x, y: jwkExport.y });
    const kid = createHash('sha256').update(canonical).digest('base64url');
    const issuer_jwk = { ...jwkExport, kid, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };
    const payee = fixture.payment.payee;
    const payload = {
      task_id: 'chit-v8-settle',
      iss: 'chit402',
      iat: 1,
      payload_version: 8,
      payment: {
        rail: 'usdc',
        ref: fixture.payment.ref,
        asset: fixture.payment.asset,
        payee,
        gross_amount: '2000',
        settled_amount: '2000',
        accounting: {
          kind: 'internal',
          scope: 'inside_settled_amount',
          note: 'Internal accounting inside the settled amount. Not an on-chain deduction; the payee received settled_amount in full.',
          internal_breakdown: {
            route_margin_bps: 100,
            route_margin_amount: '1',
            receipt_floor_amount: '1993',
            provider_cogs_amount: '6',
            tier2_proof_amount: '0',
          },
        },
      },
    };
    assert.equal('protocol_fee_bps' in payload.payment, false);
    assert.equal('net_amount' in payload.payment, false);
    const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = sign('sha256', Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    const receipt = {
      task_id: payload.task_id,
      status: 'completed',
      payment: payload.payment,
      issuer_signature: {
        alg: 'ES256',
        jws: `${signingInput}.${signature}`,
        kid,
        issuer_jwk,
        payload_version: 8,
      },
    };
    const verified = verifyIssuerJws(receipt.issuer_signature.jws, issuer_jwk);
    assert.equal(verified.valid, true, verified.reason);
    assert.equal(verified.payload.payload_version, 8);
    assert.equal(verified.payload.payment.settled_amount, '2000');
    assert.equal(verified.payload.payment.accounting.internal_breakdown.route_margin_bps, 100);

    const recon = reconcileSettledTransfer(receipt, chain.logs, {
      usdcAddress: chain.usdc,
      trustedKids: [kid],
    });
    assert.equal(recon.matches, true, recon.reason);
    assert.equal(recon.signed_field, 'settled_amount');
    assert.equal(recon.signed_amount, '2000');
    assert.equal(recon.transfer_amount, '2000');
    assert.equal(chain.logs.some((log) => log.topics?.[0] === ERC20_TRANSFER_TOPIC), true);
  });

  test('an untrusted JWS is not reconciled and does not fall back to the outer payment', () => {
    const forged = forgeReceipt(fixture, '2000000');
    const recon = reconcileSettledTransfer(forged, chain.logs, { usdcAddress: chain.usdc });
    assert.equal(recon.checked, false);
    assert.equal(recon.matches, false);
    assert.equal(recon.reason, 'key untrusted');
    assert.equal(recon.signed_amount, null);
    assert.equal(recon.signed_field, null);
    assert.equal(recon.transfer_amount, null);
    assert.equal(recon.payee, null);
  });

  test('a pinned key with a broken signature does not fall back to the outer payment', () => {
    const parts = fixture.issuer_signature.jws.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    payload.payment.net_amount = '1';
    const tampered = {
      ...fixture,
      issuer_signature: {
        ...fixture.issuer_signature,
        jws: `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`,
      },
    };
    const recon = reconcileSettledTransfer(tampered, chain.logs, { usdcAddress: chain.usdc });
    assert.equal(recon.checked, false);
    assert.equal(recon.matches, false);
    assert.equal(recon.reason, 'signature_invalid');
    assert.equal(recon.signed_amount, null);
    assert.equal(recon.transfer_amount, null);
  });
});

describe('issuer key trust', () => {
  const live = JSON.parse(readFileSync(new URL('./fixtures/chit-4d6e8331.json', import.meta.url), 'utf8'));
  const liveJwks = JSON.parse(readFileSync(new URL('./fixtures/chit402-jwks.json', import.meta.url), 'utf8'));

  test('production kid is the RFC 7638 thumbprint of the published key', () => {
    const jwk = live.issuer_signature.issuer_jwk;
    assert.equal(jwkThumbprint(jwk), DEFAULT_TRUSTED_ISSUER_KIDS[0]);
    assert.equal(jwk.kid, DEFAULT_TRUSTED_ISSUER_KIDS[0]);
    assert.equal(liveJwks.keys[0].kid, jwk.kid);
    assert.equal(liveJwks.keys[0].x, jwk.x);
  });

  test('live receipt verifies under the default offline pin', async () => {
    const result = await verifyReceipt(live, {});
    assert.equal(result.issuer_signature.valid, true);
    assert.equal(result.issuer_signature.key_trusted, true);
    assert.equal(result.issuer_signature.trust, 'pinned_kid');
    assert.equal(result.issuer_signature.kid, DEFAULT_TRUSTED_ISSUER_KIDS[0]);
    assert.equal(result.amount_usdc, '2000');
    assert.equal(result.tx, live.payment.ref);
    assert.equal(result.hub, 'akash-network');
    assert.deepEqual(result.claim_mismatches, []);
    assert.match(result.binding.reason, /expected_commitment is null/);
    assert.doesNotMatch(result.binding.reason, /unmetered|TFUEL/);
    assert.equal(result.overall, 'verified');
  });

  test('live receipt still verifies when a real JWKS file is supplied', async () => {
    const result = await verifyReceipt(live, { jwks: liveJwks, trustedKids: [] });
    assert.equal(result.issuer_signature.valid, true);
    assert.equal(result.issuer_signature.trust, 'jwks');
    assert.equal(result.amount_usdc, '2000');
  });

  test('forged re-sign with an arbitrary P-256 key is key untrusted, with and without JWKS', async () => {
    const forged = forgeReceipt(live, '2000000');
    assert.notEqual(forged.issuer_signature.kid, live.issuer_signature.kid);
    assert.equal(forged.payment.gross_amount, '2000');

    const offline = await verifyReceipt(forged, {});
    assert.equal(offline.issuer_signature.valid, false);
    assert.equal(offline.issuer_signature.reason, 'key untrusted');
    assert.equal(offline.amount_usdc, null, 'unsigned outer amount is not a fact');
    assert.equal(offline.overall, 'failed');
    assert.ok(offline.claim_mismatches.some((m) => m.field === 'payment.gross_amount' && m.signed === '2000000' && m.outer === '2000'));

    const withJwks = await verifyReceipt(forged, { jwks: liveJwks });
    assert.equal(withJwks.issuer_signature.valid, false);
    assert.equal(withJwks.issuer_signature.reason, 'key untrusted');
    assert.equal(withJwks.amount_usdc, null);
    assert.equal(withJwks.overall, 'failed');

    const mismatches = diffOuterClaims(forged, JSON.parse(Buffer.from(forged.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8')));
    assert.ok(mismatches.some((m) => m.field === 'payment.gross_amount'));
  });

  test('spoofing the production kid on a different key is still untrusted', async () => {
    const forged = forgeReceipt(live, '2000000', { headerKid: DEFAULT_TRUSTED_ISSUER_KIDS[0] });
    assert.equal(forged.issuer_signature.kid, DEFAULT_TRUSTED_ISSUER_KIDS[0]);
    assert.notEqual(jwkThumbprint(forged.issuer_signature.issuer_jwk), DEFAULT_TRUSTED_ISSUER_KIDS[0]);
    const result = await verifyReceipt(forged, { jwks: liveJwks });
    assert.equal(result.issuer_signature.valid, false);
    assert.equal(result.issuer_signature.reason, 'key untrusted');
  });
});

describe('Base payer confirms payee and asset', () => {
  const payer = '0x9F8951CB8b060f52fdf87297b3c5B00f7aa18f52';
  const payee = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
  const asset = USDC_ADDRESSES.base;
  const other = '0x1111111111111111111111111111111111111111';

  function transferLog(from, to, token = asset, amount = 2000n) {
    const pad = (addr) => '0x' + addr.slice(2).toLowerCase().padStart(64, '0');
    return {
      address: token,
      topics: [
        ERC20_TRANSFER_TOPIC,
        pad(from),
        pad(to),
      ],
      data: '0x' + amount.toString(16).padStart(64, '0'),
    };
  }

  function fetcher(logs) {
    return async () => ({ status: 1, logs });
  }

  test('accepts a USDC transfer from payer to payee of the claimed asset', async () => {
    const result = await verifyBasePayer({
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      payerWallet: payer,
      payee,
      asset,
      grossAmount: '2000',
      fetchReceipt: fetcher([transferLog(payer, payee)]),
    });
    assert.equal(result.valid, true, result.reason);
    assert.equal(result.transferredAmount, '2000');
    assert.equal(result.payee, payee);
  });

  test('rejects a transfer to a different payee', async () => {
    const result = await verifyBasePayer({
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      payerWallet: payer,
      payee,
      asset,
      grossAmount: '2000',
      fetchReceipt: fetcher([transferLog(payer, other)]),
    });
    assert.equal(result.valid, false);
    assert.match(result.reason, /payee_mismatch/);
  });

  test('rejects a claimed asset that is not network USDC', async () => {
    const result = await verifyBasePayer({
      paymentRef: 'base:0x' + 'ab'.repeat(32),
      payerWallet: payer,
      payee,
      asset: other,
      grossAmount: '2000',
      fetchReceipt: fetcher([transferLog(payer, payee, other)]),
    });
    assert.equal(result.valid, false);
    assert.match(result.reason, /asset_mismatch/);
  });
});

function signClaims(payload) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkExport = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: jwkExport.crv, kty: jwkExport.kty, x: jwkExport.x, y: jwkExport.y });
  const kid = createHash('sha256').update(canonical).digest('base64url');
  const issuer_jwk = { ...jwkExport, kid, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    kid,
    issuer_jwk,
    jws: `${signingInput}.${signature}`,
  };
}

describe('claim_id stranger rule', () => {
  const basePayment = { rail: 'usdc', ref: 'base:0x' + 'ab'.repeat(32), gross_amount: '2000', settled_amount: '2000' };

  test('a v8 payload without the claim_id key still verifies', async () => {
    const payload = { task_id: 'legacy-v8', payload_version: 8, payment: basePayment };
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'claim_id'), false);
    const signed = signClaims(payload);
    const result = await verifyReceipt({
      task_id: payload.task_id,
      payment: basePayment,
      issuer_signature: {
        alg: 'ES256',
        jws: signed.jws,
        kid: signed.kid,
        issuer_jwk: signed.issuer_jwk,
        payload_version: 8,
      },
    }, { trustedKids: [signed.kid], jwks: { keys: [signed.issuer_jwk] } });
    assert.equal(result.claim_id, 'not_present_legacy');
    assert.equal(result.errors.some((e) => String(e).includes('claim_id')), false);
    assert.notEqual(result.overall, 'failed');
  });

  test('claim_id null with a payment ref fails', async () => {
    const payload = { task_id: 'era-missing', payload_version: 8, payment: basePayment, claim_id: null };
    const signed = signClaims(payload);
    const result = await verifyReceipt({
      task_id: payload.task_id,
      payment: basePayment,
      claim_id: null,
      issuer_signature: {
        alg: 'ES256',
        jws: signed.jws,
        kid: signed.kid,
        issuer_jwk: signed.issuer_jwk,
        payload_version: 8,
      },
    }, { trustedKids: [signed.kid], jwks: { keys: [signed.issuer_jwk] } });
    assert.equal(result.claim_id, 'refused');
    assert.equal(result.overall, 'failed');
    assert.equal(result.errors.some((e) => String(e).includes('claim_id')), true);
  });

  test('claim_id bound to the book is ok, and an outer mismatch fails', async () => {
    const payload = { task_id: 'era-bound', payload_version: 8, payment: basePayment, claim_id: '15' };
    const signed = signClaims(payload);
    const receipt = {
      task_id: payload.task_id,
      payment: basePayment,
      claim_id: '15',
      issuer_signature: {
        alg: 'ES256',
        jws: signed.jws,
        kid: signed.kid,
        issuer_jwk: signed.issuer_jwk,
        payload_version: 8,
      },
    };
    const ok = await verifyReceipt(receipt, { trustedKids: [signed.kid], jwks: { keys: [signed.issuer_jwk] } });
    assert.equal(ok.claim_id, 'ok');
    assert.notEqual(ok.overall, 'failed');
    const mismatches = diffOuterClaims({ ...receipt, claim_id: '99' }, payload);
    assert.equal(mismatches.some((m) => m.field === 'claim_id'), true);
  });
});

describe('package exports', () => {
  test('dist/cli.js is an exported subpath so chit402-verify can resolve it', async () => {
    const { createRequire } = await import('node:module');
    const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(path.join(tmpdir(), 'xfuel-verify-export-'));
    const scope = path.join(dir, 'node_modules', '@xfuel');
    mkdirSync(scope, { recursive: true });
    symlinkSync(pkgDir, path.join(scope, 'verify'));
    writeFileSync(path.join(dir, 'probe.cjs'), '');
    const require = createRequire(path.join(dir, 'probe.cjs'));
    const resolved = require.resolve('@xfuel/verify/dist/cli.js');
    assert.match(resolved, /cli\.js$/);
    const viaAlias = require.resolve('@xfuel/verify/cli');
    assert.equal(viaAlias, resolved);
  });
});

/**
 * Copy a live receipt, replace the signed gross_amount, and re-sign with a fresh P-256 key
 * embedded as issuer_jwk. Outer payment.gross_amount stays at the original value.
 */
function forgeReceipt(source, forgedAmount, { headerKid } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkExport = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: jwkExport.crv, kty: jwkExport.kty, x: jwkExport.x, y: jwkExport.y });
  const thumbprint = createHash('sha256').update(canonical).digest('base64url');
  const kid = headerKid || thumbprint;
  const issuer_jwk = { ...jwkExport, kid, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };
  const payload = JSON.parse(Buffer.from(source.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));
  payload.payment = { ...payload.payment, gross_amount: forgedAmount, settled_amount: forgedAmount };
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    ...source,
    issuer_signature: {
      ...source.issuer_signature,
      jws: `${headerB64}.${payloadB64}.${signature}`,
      kid,
      issuer_jwk,
    },
  };
}

function signHeadClaims(payload) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkExport = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: jwkExport.crv, kty: jwkExport.kty, x: jwkExport.x, y: jwkExport.y });
  const kid = createHash('sha256').update(canonical).digest('base64url');
  const issuer_jwk = { ...jwkExport, kid, alg: 'ES256', use: 'sig', kty: 'EC', crv: 'P-256' };
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return {
    kid,
    issuer_jwk,
    jws: `${headerB64}.${payloadB64}.${signature}`,
  };
}

describe('payload v9 binds tree_head_hash and tolerance inside the JWS', () => {
  const tolerance = { base: 300, solana: 150 };
  const tree_head_hash = 'ab'.repeat(32);
  const payload = {
    task_id: 'chit-v9-head',
    iss: 'chit402',
    iat: 1,
    payload_version: 9,
    tree_head_hash,
    tolerance,
    payment: {
      rail: 'usdc',
      ref: 'base:0x' + '11'.repeat(32),
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payee: '0x2222222222222222222222222222222222222222',
      gross_amount: '2000',
      settled_amount: '2000',
    },
    caller_binding: { payer_wallet: '0x1111111111111111111111111111111111111111' },
  };

  function envelope(extra = {}, claims = payload) {
    const signed = signHeadClaims(claims);
    return {
      task_id: claims.task_id,
      status: 'completed',
      payment: claims.payment,
      caller_binding: claims.caller_binding,
      tree_head_hash: claims.tree_head_hash,
      tolerance: claims.tolerance,
      issuer_signature: {
        alg: 'ES256',
        jws: signed.jws,
        kid: signed.kid,
        issuer_jwk: signed.issuer_jwk,
        payload_version: claims.payload_version,
      },
      ...extra,
    };
  }

  test('a v9 receipt verifies and the pair comes from the signed claims', async () => {
    const receipt = envelope();
    const result = await verifyReceipt(receipt, { trustedKids: [receipt.issuer_signature.kid] });
    assert.equal(result.overall, 'verified', result.errors.join('; '));
    assert.equal(result.issuer_signature.valid, true);
    assert.equal(result.head_binding.tree_head_hash, tree_head_hash);
    assert.deepEqual(result.head_binding.tolerance, tolerance);
  });

  test('a tampered outer tolerance fails and is not the value that was read', async () => {
    const receipt = envelope();
    receipt.tolerance = { base: 999999, solana: 999999 };
    const result = await verifyReceipt(receipt, { trustedKids: [receipt.issuer_signature.kid] });
    assert.equal(result.overall, 'failed');
    assert.ok(result.claim_mismatches.some((row) => row.field === 'tolerance'));
    assert.deepEqual(result.head_binding.tolerance, tolerance);
    assert.notDeepEqual(result.head_binding.tolerance, receipt.tolerance);
  });

  test('a tampered outer head hash fails', async () => {
    const receipt = envelope();
    receipt.tree_head_hash = 'ff'.repeat(32);
    const result = await verifyReceipt(receipt, { trustedKids: [receipt.issuer_signature.kid] });
    assert.equal(result.overall, 'failed');
    assert.ok(result.claim_mismatches.some((row) => row.field === 'tree_head_hash'));
    assert.equal(result.head_binding.tree_head_hash, tree_head_hash);
  });

  test('a v9 payload missing the pair fails', async () => {
    const { tree_head_hash: _hash, tolerance: _tol, ...bare } = payload;
    const receipt = envelope({}, bare);
    delete receipt.tree_head_hash;
    delete receipt.tolerance;
    const result = await verifyReceipt(receipt, { trustedKids: [receipt.issuer_signature.kid] });
    assert.equal(result.overall, 'failed');
    assert.equal(result.head_binding, null);
    assert.ok(result.errors.some((line) => /tree_head_hash and tolerance/.test(line)));
  });

  test('a signed head hash that does not match the supplied head fails', async () => {
    const receipt = envelope();
    const result = await verifyReceipt(receipt, {
      trustedKids: [receipt.issuer_signature.kid],
      head: { root: 'cd'.repeat(32) },
    });
    assert.equal(result.overall, 'failed');
    assert.ok(result.errors.some((line) => /tree_head_hash/.test(line)));
    assert.equal(result.head_binding.tree_head_hash, tree_head_hash);
  });

  test('a v8 receipt without the pair still verifies', async () => {
    const legacy = {
      ...payload,
      payload_version: 8,
      task_id: 'chit-v8-still',
    };
    delete legacy.tree_head_hash;
    delete legacy.tolerance;
    const receipt = envelope({}, legacy);
    delete receipt.tree_head_hash;
    delete receipt.tolerance;
    const result = await verifyReceipt(receipt, { trustedKids: [receipt.issuer_signature.kid] });
    assert.equal(result.overall, 'verified', result.errors.join('; '));
    assert.equal(result.issuer_signature.payload.payload_version, 8);
    assert.equal(result.head_binding, null);
  });
});
