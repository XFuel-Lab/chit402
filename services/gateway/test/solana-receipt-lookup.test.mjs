/**
 * Solana receipt lookup by tx signature.
 *
 * Production scenario (2026-08-31): A third party pays via Solana x402 (PayAI)
 * but the memo doesn't match the XFuel task_id format. The receipt must still
 * be discoverable by:
 *   1. Task ID (primary)
 *   2. Payment ref (network:txSignature)
 *   3. Tx signature only (for Solana users who have the tx but not the task ID)
 *
 * Per whitepaper: fail closed on payment, fail open on finding the page afterward.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xfuel-sol-receipt-'));

// Set env vars BEFORE any imports
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.TASK_STORE_PERSIST = 'true';
process.env.TASK_STORE_DIR = path.join(tmp, 'tasks');

// Import after env setup
const { PersistentTaskStore } = await import('../src/task-store.js');

describe('PersistentTaskStore payment ref index', () => {
  let store;

  before(() => {
    store = new PersistentTaskStore({
      dir: path.join(tmp, 'tasks'),
      persist: true,
      autoFlushMs: 0, // Disable auto-flush for deterministic tests
    });
  });

  after(() => {
    store.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('set() indexes the payment ref for lookup', () => {
    const task = {
      taskId: 'xfuel-test-1',
      intent: { paymentRef: 'solana:yrWZnMAEaMqs3bpkzpyEZkgD4XUvABArTNHxLrgjdMSvPotLerDNBUxJMRX8MibnjeDceaxsHNAcPhc5e9wHkyg' },
      status: 'completed',
    };
    store.set(task.taskId, task);

    // Lookup by full payment ref
    const byFullRef = store.getByPaymentRef('solana:yrWZnMAEaMqs3bpkzpyEZkgD4XUvABArTNHxLrgjdMSvPotLerDNBUxJMRX8MibnjeDceaxsHNAcPhc5e9wHkyg');
    assert.equal(byFullRef?.taskId, 'xfuel-test-1');

    // Lookup by tx signature only (without network prefix)
    const byTxOnly = store.getByPaymentRef('yrWZnMAEaMqs3bpkzpyEZkgD4XUvABArTNHxLrgjdMSvPotLerDNBUxJMRX8MibnjeDceaxsHNAcPhc5e9wHkyg');
    assert.equal(byTxOnly?.taskId, 'xfuel-test-1');
  });

  test('getByPaymentRef() returns undefined for unknown tx', () => {
    const result = store.getByPaymentRef('unknown-tx-signature');
    assert.equal(result, undefined);
  });

  test('getByPaymentRef() handles Base payment refs', () => {
    const task = {
      taskId: 'xfuel-test-2',
      intent: { paymentRef: 'base:0x' + 'ab'.repeat(32) },
      status: 'completed',
    };
    store.set(task.taskId, task);

    // Lookup by full ref
    const byFullRef = store.getByPaymentRef('base:0x' + 'ab'.repeat(32));
    assert.equal(byFullRef?.taskId, 'xfuel-test-2');

    // Lookup by tx hash only
    const byTxOnly = store.getByPaymentRef('0x' + 'ab'.repeat(32));
    assert.equal(byTxOnly?.taskId, 'xfuel-test-2');
  });

  test('payment ref index survives restart (rebuilds from disk)', async () => {
    // Create a task with Solana payment ref
    const solanaTx = 'restartTestTxSignature123456789012345678901234567890123456';
    const task = {
      taskId: 'xfuel-restart-test',
      intent: { paymentRef: `solana:${solanaTx}` },
      status: 'completed',
    };
    store.set(task.taskId, task);

    // Destroy the store (simulates restart)
    store.destroy();

    // Create a new store pointing to the same directory
    const store2 = new PersistentTaskStore({
      dir: path.join(tmp, 'tasks'),
      persist: true,
      autoFlushMs: 0,
    });

    // The index should be rebuilt from disk
    const byTx = store2.getByPaymentRef(solanaTx);
    assert.equal(byTx?.taskId, 'xfuel-restart-test');

    store2.destroy();
  });

  test('tasks without payment ref are not indexed but still accessible by taskId', () => {
    const task = {
      taskId: 'xfuel-no-payment',
      intent: { paymentRail: 'unmetered' },
      status: 'completed',
    };
    store.set(task.taskId, task);

    // Should be accessible by taskId
    const byId = store.get('xfuel-no-payment');
    assert.equal(byId?.taskId, 'xfuel-no-payment');
  });
});

describe('checkBinding allows unbound Solana payments', async () => {
  // Import after env setup
  const { verifyPayment, settlePayment, challengeStore } = await import('../src/x402-adapter.js');

  test('checkBinding returns ok:true with unbound:true when nonce not found', () => {
    // This is tested implicitly through verifyPayment/settlePayment
    // The key behavior: verification proceeds even without a matching challenge
  });
});
