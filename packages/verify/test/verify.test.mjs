/**
 * Offline receipt verification tests.
 *
 * Tests that third parties can verify XFuel receipts without calling the API.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

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
  computePaymentCommitment,
  computeInferenceBinding,
} = await import('../dist/index.js');

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
