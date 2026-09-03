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
  verifyIssuerSignature,
  verifyIssuerSignatureWithJwks,
  canonicalIssuerPayload,
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
