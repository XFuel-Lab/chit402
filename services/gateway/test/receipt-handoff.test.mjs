/**
 * Receipt Handoff Tests — wallet-move delegation for Chit receipts
 *
 * Tests the handoff feature that allows proving possession transfer:
 * 1. Origin holder attaches a delegation signature
 * 2. Destination wallet attaches an acknowledgment signature
 * 3. Both are stored on the receipt and verifiable by any agent
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  buildReceipt,
  mergeReceiptView,
  renderReceiptHtml,
  canonicalOriginHandoffMessage,
  canonicalDestAckMessage,
  verifyOriginHandoff,
  verifyDestAck,
  handoffOf,
} from '../src/receipt.js';

// ─── Test Wallets ────────────────────────────────────────────────────────────

const ORIGIN_WALLET = Wallet.createRandom();
const DEST_WALLET = Wallet.createRandom();
const WRONG_WALLET = Wallet.createRandom();

// ─── Unit Tests: Canonical Messages ──────────────────────────────────────────

describe('Canonical Handoff Messages', () => {
  const taskId = 'xfuel-test-task-123';
  const timestamp = 1725379200; // Fixed timestamp for tests

  test('canonicalOriginHandoffMessage produces expected format', () => {
    const msg = canonicalOriginHandoffMessage(taskId, DEST_WALLET.address, timestamp);
    assert.ok(msg.startsWith('chit.handoff.origin|'));
    assert.ok(msg.includes(taskId));
    assert.ok(msg.includes(DEST_WALLET.address));
    assert.ok(msg.includes(String(timestamp)));
  });

  test('canonicalDestAckMessage produces expected format', () => {
    const msg = canonicalDestAckMessage(taskId, ORIGIN_WALLET.address, timestamp);
    assert.ok(msg.startsWith('chit.handoff.dest.ack|'));
    assert.ok(msg.includes(taskId));
    assert.ok(msg.includes(ORIGIN_WALLET.address));
    assert.ok(msg.includes(String(timestamp)));
  });

  test('canonical messages are deterministic', () => {
    const msg1 = canonicalOriginHandoffMessage(taskId, DEST_WALLET.address, timestamp);
    const msg2 = canonicalOriginHandoffMessage(taskId, DEST_WALLET.address, timestamp);
    assert.equal(msg1, msg2);
  });

  test('canonical messages normalize addresses to checksum', () => {
    const lowerAddr = DEST_WALLET.address.toLowerCase();
    const msg = canonicalOriginHandoffMessage(taskId, lowerAddr, timestamp);
    assert.ok(msg.includes(DEST_WALLET.address)); // Should be checksummed
    assert.ok(!msg.includes(lowerAddr) || lowerAddr === DEST_WALLET.address);
  });
});

// ─── Unit Tests: Origin Signature Verification ──────────────────────────────

describe('Origin Handoff Verification', () => {
  const taskId = 'xfuel-origin-test-456';
  const timestamp = Math.floor(Date.now() / 1000);

  test('verifyOriginHandoff accepts valid signature', async () => {
    const message = canonicalOriginHandoffMessage(taskId, DEST_WALLET.address, timestamp);
    const signature = await ORIGIN_WALLET.signMessage(message);

    const result = verifyOriginHandoff({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      destAddress: DEST_WALLET.address,
      timestamp,
      signature,
    });

    assert.equal(result.valid, true);
    assert.equal(result.recoveredAddress.toLowerCase(), ORIGIN_WALLET.address.toLowerCase());
  });

  test('verifyOriginHandoff rejects wrong signer', async () => {
    const message = canonicalOriginHandoffMessage(taskId, DEST_WALLET.address, timestamp);
    const signature = await WRONG_WALLET.signMessage(message); // Signed by wrong wallet

    const result = verifyOriginHandoff({
      taskId,
      originAddress: ORIGIN_WALLET.address, // Claims to be origin
      destAddress: DEST_WALLET.address,
      timestamp,
      signature,
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'signer_mismatch');
    assert.equal(result.recoveredAddress.toLowerCase(), WRONG_WALLET.address.toLowerCase());
  });

  test('verifyOriginHandoff rejects missing fields', () => {
    const result = verifyOriginHandoff({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      // Missing destAddress, timestamp, signature
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'missing_required_fields');
  });

  test('verifyOriginHandoff rejects invalid signature format', () => {
    const result = verifyOriginHandoff({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      destAddress: DEST_WALLET.address,
      timestamp,
      signature: 'not-a-valid-signature',
    });

    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('verification_error'));
  });
});

// ─── Unit Tests: Destination Ack Verification ───────────────────────────────

describe('Destination Ack Verification', () => {
  const taskId = 'xfuel-dest-test-789';
  const timestamp = Math.floor(Date.now() / 1000);

  test('verifyDestAck accepts valid signature', async () => {
    const message = canonicalDestAckMessage(taskId, ORIGIN_WALLET.address, timestamp);
    const signature = await DEST_WALLET.signMessage(message);

    const result = verifyDestAck({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      destAddress: DEST_WALLET.address,
      timestamp,
      signature,
    });

    assert.equal(result.valid, true);
    assert.equal(result.recoveredAddress.toLowerCase(), DEST_WALLET.address.toLowerCase());
  });

  test('verifyDestAck rejects wrong signer', async () => {
    const message = canonicalDestAckMessage(taskId, ORIGIN_WALLET.address, timestamp);
    const signature = await WRONG_WALLET.signMessage(message); // Signed by wrong wallet

    const result = verifyDestAck({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      destAddress: DEST_WALLET.address, // Claims to be dest
      timestamp,
      signature,
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'signer_mismatch');
    assert.equal(result.recoveredAddress.toLowerCase(), WRONG_WALLET.address.toLowerCase());
  });

  test('verifyDestAck rejects missing fields', () => {
    const result = verifyDestAck({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      // Missing destAddress, timestamp, signature
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, 'missing_required_fields');
  });
});

// ─── Unit Tests: handoffOf extractor ─────────────────────────────────────────

describe('handoffOf extractor', () => {
  test('handoffOf returns null for task without handoff', () => {
    const task = {
      taskId: 'xfuel-no-handoff',
      status: 'completed',
      intent: { paymentRail: 'usdc', amount: '10000' },
    };
    assert.equal(handoffOf(task), null);
  });

  test('handoffOf extracts origin-only handoff', () => {
    const now = Date.now();
    const task = {
      taskId: 'xfuel-origin-only',
      status: 'completed',
      handoff: {
        origin: {
          address: ORIGIN_WALLET.address,
          destAddress: DEST_WALLET.address,
          timestamp: 1725379200,
          signature: '0xsig',
          createdAt: now,
        },
      },
    };

    const h = handoffOf(task);
    assert.ok(h);
    assert.equal(h.status, 'pending_dest_ack');
    assert.equal(h.origin.address, ORIGIN_WALLET.address);
    assert.equal(h.origin.dest_address, DEST_WALLET.address);
    assert.equal(h.dest, null);
  });

  test('handoffOf extracts complete handoff', () => {
    const now = Date.now();
    const task = {
      taskId: 'xfuel-complete-handoff',
      status: 'completed',
      handoff: {
        origin: {
          address: ORIGIN_WALLET.address,
          destAddress: DEST_WALLET.address,
          timestamp: 1725379200,
          signature: '0xorigsig',
          createdAt: now - 1000,
        },
        dest: {
          address: DEST_WALLET.address,
          timestamp: 1725379300,
          signature: '0xdestsig',
          createdAt: now,
        },
      },
    };

    const h = handoffOf(task);
    assert.ok(h);
    assert.equal(h.status, 'complete');
    assert.equal(h.origin.address, ORIGIN_WALLET.address);
    assert.ok(h.dest);
    assert.equal(h.dest.address, DEST_WALLET.address);
  });
});

// ─── Integration Tests: buildReceipt with handoff ────────────────────────────

describe('buildReceipt with handoff', () => {
  const baseTask = {
    taskId: 'xfuel-receipt-handoff',
    status: 'completed',
    createdAt: Date.now() - 10000,
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      amount: '100000',
      model: 'test-model',
    },
    result: { provider: 'test-provider' },
    sp1Proof: null,
  };

  test('buildReceipt includes null handoff when not present', () => {
    const receipt = buildReceipt(baseTask, {});
    assert.equal(receipt.handoff, null);
    assert.equal(receipt.task_id, baseTask.taskId);
  });

  test('buildReceipt includes pending handoff with origin only', () => {
    const now = Date.now();
    const task = {
      ...baseTask,
      handoff: {
        origin: {
          address: ORIGIN_WALLET.address,
          destAddress: DEST_WALLET.address,
          timestamp: 1725379200,
          signature: '0xorigsig',
          createdAt: now,
        },
      },
    };

    const receipt = buildReceipt(task, {});
    assert.ok(receipt.handoff);
    assert.equal(receipt.handoff.status, 'pending_dest_ack');
    assert.ok(receipt.handoff.origin);
    assert.equal(receipt.handoff.origin.address, ORIGIN_WALLET.address);
    assert.equal(receipt.handoff.dest, null);
  });

  test('buildReceipt includes complete handoff', () => {
    const now = Date.now();
    const task = {
      ...baseTask,
      handoff: {
        origin: {
          address: ORIGIN_WALLET.address,
          destAddress: DEST_WALLET.address,
          timestamp: 1725379200,
          signature: '0xorigsig',
          createdAt: now - 1000,
        },
        dest: {
          address: DEST_WALLET.address,
          timestamp: 1725379300,
          signature: '0xdestsig',
          createdAt: now,
        },
      },
    };

    const receipt = buildReceipt(task, {});
    assert.ok(receipt.handoff);
    assert.equal(receipt.handoff.status, 'complete');
    assert.ok(receipt.handoff.origin);
    assert.ok(receipt.handoff.dest);
    assert.equal(receipt.handoff.dest.address, DEST_WALLET.address);
  });
});

// ─── Integration Tests: renderReceiptHtml with handoff ──────────────────────

describe('renderReceiptHtml with handoff', () => {
  test('HTML does not show handoff section when no handoff', () => {
    const receipt = buildReceipt({
      taskId: 'xfuel-html-no-handoff',
      status: 'completed',
      intent: { paymentRail: 'usdc', amount: '10000' },
    }, {});

    const html = renderReceiptHtml(receipt);
    assert.ok(!html.includes('Handoff'));
    assert.ok(!html.includes('wallet-move delegation'));
  });

  test('HTML shows pending handoff section', () => {
    const now = Date.now();
    const receipt = buildReceipt({
      taskId: 'xfuel-html-pending',
      status: 'completed',
      intent: { paymentRail: 'usdc', amount: '10000' },
      handoff: {
        origin: {
          address: '0x1234567890123456789012345678901234567890',
          destAddress: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
          timestamp: 1725379200,
          signature: '0xsig',
          createdAt: now,
        },
      },
    }, {});

    const html = renderReceiptHtml(receipt);
    assert.ok(html.includes('Handoff'));
    assert.ok(html.includes('wallet-move delegation'));
    assert.ok(html.includes('pending destination ack') || html.includes('pending'));
    assert.ok(html.includes('Origin'));
    assert.ok(html.includes('Destination'));
  });

  test('HTML shows complete handoff section', () => {
    const now = Date.now();
    const receipt = buildReceipt({
      taskId: 'xfuel-html-complete',
      status: 'completed',
      intent: { paymentRail: 'usdc', amount: '10000' },
      handoff: {
        origin: {
          address: '0x1234567890123456789012345678901234567890',
          destAddress: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
          timestamp: 1725379200,
          signature: '0xorigsig',
          createdAt: now - 1000,
        },
        dest: {
          address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
          timestamp: 1725379300,
          signature: '0xdestsig',
          createdAt: now,
        },
      },
    }, {});

    const html = renderReceiptHtml(receipt);
    assert.ok(html.includes('Handoff'));
    assert.ok(html.includes('complete') || html.includes('Complete'));
    assert.ok(html.includes('Acknowledged'));
  });

  test('HTML escapes hostile input in handoff addresses', () => {
    const now = Date.now();
    const receipt = buildReceipt({
      taskId: 'xfuel-html-escape',
      status: 'completed',
      intent: { paymentRail: 'usdc', amount: '10000' },
      handoff: {
        origin: {
          address: '<script>alert(1)</script>',
          destAddress: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
          timestamp: 1725379200,
          signature: '0xsig',
          createdAt: now,
        },
      },
    }, {});

    const html = renderReceiptHtml(receipt);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });
});

// ─── Backwards Compatibility Tests ───────────────────────────────────────────

describe('Backwards Compatibility', () => {
  test('existing receipt without handoff still returns 200 JSON', () => {
    const task = {
      taskId: 'xfuel-1e57cdd7',
      status: 'completed',
      createdAt: Date.now() - 100000,
      updatedAt: Date.now(),
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: 'base:0x123',
        amount: '50000',
      },
      feeAmount: '250',
      netAmount: '49750',
      result: { provider: 'test' },
    };

    const receipt = buildReceipt(task, { signingSecret: 'test-secret' });

    assert.ok(receipt.task_id);
    assert.ok(receipt.issuer_signature);
    assert.equal(receipt.handoff, null);
    assert.equal(receipt.status, 'completed');
    assert.ok(receipt.verification?.source_of_truth);
    assert.ok(mergeReceiptView(receipt).payment);
  });

  test('receipt JSON schema is stable (v3)', () => {
    const task = {
      taskId: 'xfuel-schema-check',
      status: 'completed',
      intent: { paymentRail: 'usdc', amount: '10000' },
    };

    const receipt = buildReceipt(task, {});
    assert.equal(receipt.schema, 'xfuel.receipt.v4');
  });

  test('handoff is additive — does not remove existing fields', () => {
    const now = Date.now();
    const task = {
      taskId: 'xfuel-additive',
      status: 'completed',
      createdAt: now - 10000,
      updatedAt: now,
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: 'base:0xabc',
        amount: '100000',
      },
      feeAmount: '500',
      netAmount: '99500',
      result: { provider: 'test' },
      meta: { provider: 'test', privacyMode: 'vendor_blind' },
      handoff: {
        origin: {
          address: ORIGIN_WALLET.address,
          destAddress: DEST_WALLET.address,
          timestamp: 1725379200,
          signature: '0xsig',
          createdAt: now,
        },
      },
    };

    const receipt = buildReceipt(task, { signingSecret: 'test-secret' });

    // All existing fields still present
    assert.ok(receipt.task_id);
    assert.ok(receipt.verification?.source_of_truth);
    assert.ok(mergeReceiptView(receipt).payment);
    assert.ok(receipt.privacy);
    assert.ok(receipt.issuer_signature);

    // Handoff is added
    assert.ok(receipt.handoff);
    assert.equal(receipt.handoff.status, 'pending_dest_ack');
  });
});

// ─── End-to-End Signature Flow ───────────────────────────────────────────────

describe('End-to-End Signature Flow', () => {
  test('full handoff flow: origin delegates, dest acknowledges', async () => {
    const taskId = 'xfuel-e2e-flow';
    const timestamp = Math.floor(Date.now() / 1000);

    // Step 1: Origin signs delegation
    const originMessage = canonicalOriginHandoffMessage(taskId, DEST_WALLET.address, timestamp);
    const originSig = await ORIGIN_WALLET.signMessage(originMessage);

    const originVerify = verifyOriginHandoff({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      destAddress: DEST_WALLET.address,
      timestamp,
      signature: originSig,
    });

    assert.equal(originVerify.valid, true);

    // Step 2: Dest signs acknowledgment
    const destMessage = canonicalDestAckMessage(taskId, ORIGIN_WALLET.address, timestamp);
    const destSig = await DEST_WALLET.signMessage(destMessage);

    const destVerify = verifyDestAck({
      taskId,
      originAddress: ORIGIN_WALLET.address,
      destAddress: DEST_WALLET.address,
      timestamp,
      signature: destSig,
    });

    assert.equal(destVerify.valid, true);

    // Step 3: Build receipt with both signatures
    const now = Date.now();
    const task = {
      taskId,
      status: 'completed',
      createdAt: now - 10000,
      updatedAt: now,
      intent: { paymentRail: 'usdc', amount: '100000' },
      handoff: {
        origin: {
          address: ORIGIN_WALLET.address,
          destAddress: DEST_WALLET.address,
          timestamp,
          signature: originSig,
          createdAt: now - 1000,
        },
        dest: {
          address: DEST_WALLET.address,
          timestamp,
          signature: destSig,
          createdAt: now,
        },
      },
    };

    const receipt = buildReceipt(task, {});

    assert.ok(receipt.handoff);
    assert.equal(receipt.handoff.status, 'complete');
    assert.ok(receipt.handoff.origin.signature);
    assert.ok(receipt.handoff.dest.signature);

    // Step 4: Any agent can verify by re-checking signatures
    const reVerifyOrigin = verifyOriginHandoff({
      taskId,
      originAddress: receipt.handoff.origin.address,
      destAddress: receipt.handoff.origin.dest_address,
      timestamp: receipt.handoff.origin.timestamp,
      signature: task.handoff.origin.signature,
    });
    assert.equal(reVerifyOrigin.valid, true);

    const reVerifyDest = verifyDestAck({
      taskId,
      originAddress: receipt.handoff.origin.address,
      destAddress: receipt.handoff.dest.address,
      timestamp: receipt.handoff.dest.timestamp,
      signature: task.handoff.dest.signature,
    });
    assert.equal(reVerifyDest.valid, true);
  });
});
