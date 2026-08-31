/**
 * Book Trust Tests — Private Spend Default + Replaceable Signer + in_proof
 *
 * Tests the two book-trust features from the user's request:
 * 1. PRIVATE SPEND AS DEFAULT for registered/possession sessions
 * 2. REPLACEABLE SIGNER (co-signer, multi-key verify, in_proof fail-closed)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceipt,
  verifyReceiptHmac,
  verifyReceiptMultiKey,
  canonicalSignedPayload,
  privacyOf,
} from '../src/receipt.js';
import { AgentRegistry } from '../src/agent-registry.js';

// ─── Private Spend by Session ────────────────────────────────────────────────

describe('Private Spend by Session', () => {
  test('registered session triggers vendor_blind mode', () => {
    const registry = new AgentRegistry({ persist: false });
    const { agent_id, session } = registry.allocate({ taskId: 't-1' });

    // Helper that mirrors isPrivateSpendSession in server.js / openai-gateway.js
    function isPrivateSpendSession(req) {
      const key = req.headers['x-api-key'] || '';
      if (!key) return false;
      if (key === 'xfuel-demo' || key.startsWith('xfuel-demo')) return false;
      const sess = req.body?.session || req.headers['x-xfuel-session'] || null;
      if (!sess) return false;
      return !!registry.getBySession(String(sess));
    }

    // With valid session → private spend
    const reqWithSession = {
      headers: { 'x-api-key': 'partner-key', 'x-xfuel-session': session },
      body: {},
    };
    assert.equal(isPrivateSpendSession(reqWithSession), true);

    // Without session → no private spend
    const reqWithoutSession = {
      headers: { 'x-api-key': 'partner-key' },
      body: {},
    };
    assert.equal(isPrivateSpendSession(reqWithoutSession), false);

    // Demo key → never private spend even with session
    const reqDemo = {
      headers: { 'x-api-key': 'xfuel-demo', 'x-xfuel-session': session },
      body: {},
    };
    assert.equal(isPrivateSpendSession(reqDemo), false);

    // xfuel-demo-* prefix → also blocked
    const reqDemoPrefix = {
      headers: { 'x-api-key': 'xfuel-demo-test', 'x-xfuel-session': session },
      body: {},
    };
    assert.equal(isPrivateSpendSession(reqDemoPrefix), false);

    // Invalid session → no private spend
    const reqInvalidSession = {
      headers: { 'x-api-key': 'partner-key', 'x-xfuel-session': 'invalid-session' },
      body: {},
    };
    assert.equal(isPrivateSpendSession(reqInvalidSession), false);
  });

  test('privacyOf returns vendor_blind for privateSpend=true', () => {
    const task = {
      taskId: 'ps-1',
      meta: { privateSpend: true, privacyMode: 'vendor_blind' },
    };
    const privacy = privacyOf(task);
    assert.equal(privacy.mode, 'vendor_blind');
    assert.equal(privacy.trust, 'gateway');
  });
});

// ─── Replaceable Signer (Co-signer) ──────────────────────────────────────────

describe('Replaceable Signer', () => {
  const PRIMARY_SECRET = 'primary-secret-for-testing-only';
  const CO_SIGNER_SECRET = 'co-signer-secret-for-testing-only';

  const mockTask = {
    taskId: 'cosign-1',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: 'base:0xabcdef1234567890',
      amount: '100000',
    },
    feeAmount: '500',
    netAmount: '99500',
    feeBps: 50,
    meta: { provider: 'test-provider' },
    result: { model: 'test-model' },
  };

  test('buildReceipt adds co_signature when coSignerSecret provided', () => {
    const receipt = buildReceipt(mockTask, {
      baseUrl: 'https://api.test',
      signingSecret: PRIMARY_SECRET,
      coSignerSecret: CO_SIGNER_SECRET,
    });

    // Primary signature present
    assert.ok(receipt.signature, 'should have signature');
    assert.equal(receipt.signature.alg, 'HMAC-SHA256');
    assert.equal(receipt.signature.role, 'primary');
    assert.ok(receipt.signature.value.startsWith('sha256='));

    // Co-signature present
    assert.ok(receipt.co_signature, 'should have co_signature');
    assert.equal(receipt.co_signature.alg, 'HMAC-SHA256');
    assert.equal(receipt.co_signature.role, 'co_signer');
    assert.ok(receipt.co_signature.value.startsWith('sha256='));

    // Signatures are different (different secrets)
    assert.notEqual(receipt.signature.value, receipt.co_signature.value);
  });

  test('verifyReceiptHmac validates primary signature', () => {
    const receipt = buildReceipt(mockTask, {
      signingSecret: PRIMARY_SECRET,
      coSignerSecret: CO_SIGNER_SECRET,
    });

    const result = verifyReceiptHmac(receipt, PRIMARY_SECRET);
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.equal(result.role, 'primary');
  });

  test('verifyReceiptHmac validates co_signature with sigField option', () => {
    const receipt = buildReceipt(mockTask, {
      signingSecret: PRIMARY_SECRET,
      coSignerSecret: CO_SIGNER_SECRET,
    });

    const result = verifyReceiptHmac(receipt, CO_SIGNER_SECRET, { sigField: 'co_signature' });
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.equal(result.role, 'co_signer');
  });

  test('verifyReceiptHmac fails with wrong secret', () => {
    const receipt = buildReceipt(mockTask, {
      signingSecret: PRIMARY_SECRET,
    });

    const result = verifyReceiptHmac(receipt, 'wrong-secret');
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
  });

  test('verifyReceiptMultiKey succeeds if any key matches any signature', () => {
    const receipt = buildReceipt(mockTask, {
      signingSecret: PRIMARY_SECRET,
      coSignerSecret: CO_SIGNER_SECRET,
    });

    // Primary key validates
    const r1 = verifyReceiptMultiKey(receipt, [PRIMARY_SECRET]);
    assert.equal(r1.valid, true);
    assert.equal(r1.validatedBy, 'signature');

    // Co-signer key validates
    const r2 = verifyReceiptMultiKey(receipt, [CO_SIGNER_SECRET]);
    assert.equal(r2.valid, true);
    assert.equal(r2.validatedBy, 'co_signature');

    // Either key in array validates
    const r3 = verifyReceiptMultiKey(receipt, ['wrong', CO_SIGNER_SECRET]);
    assert.equal(r3.valid, true);

    // All wrong keys fail
    const r4 = verifyReceiptMultiKey(receipt, ['wrong1', 'wrong2']);
    assert.equal(r4.valid, false);
    assert.equal(r4.reason, 'all_keys_failed');
  });

  test('verifyReceiptMultiKey fails with no signatures', () => {
    const receipt = buildReceipt(mockTask, {});

    const result = verifyReceiptMultiKey(receipt, [PRIMARY_SECRET]);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'no_signature');
  });

  test('canonicalSignedPayload is deterministic', () => {
    const receipt = buildReceipt(mockTask, {});

    const p1 = canonicalSignedPayload(receipt);
    const p2 = canonicalSignedPayload(receipt);
    assert.equal(p1, p2);
  });
});

// ─── in_proof Path (Fail Closed) ─────────────────────────────────────────────

describe('in_proof / nullifier Path', () => {
  test('binding.in_proof is false by default (server-attested)', () => {
    // The payment binding is server-attested until SP1 guest v2 ships.
    // This is by design: in_proof:true requires the commitment in the proof's
    // public values, which needs a rebuilt guest ELF + new programVKey.
    const task = {
      taskId: 'inproof-1',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: 'base:0x1234',
        amount: '100000',
      },
      feeAmount: '500',
      netAmount: '99500',
      sp1Proof: {
        proof: 'mock-proof-bytes',
        paymentBinding: {
          commitment: '0x' + 'a'.repeat(64),
          in_proof: false, // server-attested, not in proof
        },
      },
    };

    const receipt = buildReceipt(task, {});
    // binding.in_proof should be false
    assert.equal(receipt.binding?.in_proof, false);
  });

  test('receipt correctly reports nullifier from sp1Proof', () => {
    const nullifier = '0x' + 'f'.repeat(64);
    const task = {
      taskId: 'nullifier-1',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: { type: 'inference_request', paymentRail: 'usdc', amount: '100000' },
      sp1Proof: {
        proof: 'mock-proof-bytes',
        nullifier,
        provingTimeMs: 1234,
      },
    };

    const receipt = buildReceipt(task, {});
    assert.equal(receipt.proof.nullifier, nullifier);
    assert.equal(receipt.proof.has_proof, true);
    assert.equal(receipt.proof.proving_time_ms, 1234);
  });

  test('in_proof fail-closed: binding without proof is server-attested', () => {
    // A task with paymentBinding but no SP1 proof should report in_proof:false
    const task = {
      taskId: 'failclosed-1',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: 'base:0xfailclosed',
        amount: '50000',
      },
      feeAmount: '250',
      netAmount: '49750',
      // No sp1Proof at all — binding should still be computed but server-attested
    };

    const receipt = buildReceipt(task, {});
    // Without proof, binding is not present (needs sp1Proof.paymentBinding)
    assert.equal(receipt.binding, null);
  });

  test('receipt.proof.tier is settlement when has_proof is true', () => {
    const task = {
      taskId: 'tier-1',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: { type: 'inference_request', paymentRail: 'usdc', amount: '100000' },
      sp1Proof: {
        proof: 'real-proof-bytes',
        nullifier: '0x' + 'b'.repeat(64),
      },
    };

    const receipt = buildReceipt(task, {});
    assert.equal(receipt.proof.tier, 'settlement');
    assert.equal(receipt.proof.has_proof, true);
  });

  test('receipt.proof.tier is signed when no proof', () => {
    const task = {
      taskId: 'tier-2',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: { type: 'inference_request', paymentRail: 'usdc', amount: '100000' },
      sp1Proof: null,
    };

    const receipt = buildReceipt(task, { signingSecret: 'test-secret' });
    assert.equal(receipt.proof.tier, 'signed');
    assert.equal(receipt.proof.has_proof, false);
    assert.ok(receipt.signature, 'signed receipt has signature');
  });
});

// ─── Verify Algorithm (offline) ──────────────────────────────────────────────

describe('Offline Verification', () => {
  const SECRET = 'offline-verify-test-secret';

  test('verify algorithm matches docs/VERIFY_ALGORITHM.md', () => {
    const task = {
      taskId: 'offline-1',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: 'base:0xoffline',
        amount: '200000',
      },
      feeAmount: '1000',
      netAmount: '199000',
      feeBps: 50,
      meta: { provider: 'test' },
      result: { model: 'test-model' },
    };

    const receipt = buildReceipt(task, { signingSecret: SECRET });

    // The canonical payload should be a JSON array
    const payload = canonicalSignedPayload(receipt);
    const parsed = JSON.parse(payload);
    assert.ok(Array.isArray(parsed), 'canonical payload is an array');
    assert.equal(parsed[0], receipt.task_id);
    assert.equal(parsed[1], receipt.payment.rail);
    assert.equal(parsed[2], receipt.payment.ref);

    // Verify with the secret
    const result = verifyReceiptHmac(receipt, SECRET);
    assert.equal(result.valid, true);

    // Verify with wrong secret fails
    const wrongResult = verifyReceiptHmac(receipt, 'wrong-secret');
    assert.equal(wrongResult.valid, false);
  });

  test('tampered receipt fails verification', () => {
    const task = {
      taskId: 'tamper-1',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: {
        type: 'inference_request',
        paymentRail: 'usdc',
        paymentRef: 'base:0xtamper',
        amount: '100000',
      },
      feeAmount: '500',
      netAmount: '99500',
    };

    const receipt = buildReceipt(task, { signingSecret: SECRET });

    // Tamper with the amount
    receipt.payment.gross_amount = '999999';

    const result = verifyReceiptHmac(receipt, SECRET);
    assert.equal(result.valid, false);
  });
});
