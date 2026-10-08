/**
 * output_commitment.kind is explicit. A 0x prefix is not a keccak256 guess.
 * Gateway-hashed deliverables are sha256. Sender hashes must name an allowlisted kind.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  OutputCommitmentError,
  buildFulfillmentEnvelope,
  fulfillmentFieldsFromIngestBody,
  hashDeliverablePayload,
  outputCommitmentOf,
} = await import('../src/fulfillment-receipt.js');
const { buildForeignReceipt, normalizeIngestInput } = await import('../src/foreign-x402-ingest.js');
const { buildReceipt, decodeReceiptClaims } = await import('../src/receipt.js');

const KECCAK = `0x${'ab'.repeat(32)}`;
const SHORT = `0x${'ab'.repeat(31)}`;
const LONG = `0x${'ab'.repeat(33)}`;

function invoice(extra = {}) {
  return {
    fulfillment_invoice: {
      amount: '1000',
      payer: '0xp',
      payTo: '0xt',
      tx: '0x1',
      hub: 'jobs.example',
      job_kind: 'research',
      ...extra,
    },
  };
}

describe('output commitment kind', () => {
  test('a gateway-hashed deliverable is sha256', () => {
    const payload = '{"report":"kestrel"}';
    const fields = fulfillmentFieldsFromIngestBody(invoice({ deliverable: payload }));
    assert.equal(fields.commitmentError, undefined);
    assert.equal(fields.hashKind, 'sha256');
    assert.equal(fields.deliverableHash, hashDeliverablePayload(payload));
    const receipt = buildForeignReceipt({
      taskId: 'foreign-kind-sha',
      paymentRequired: { resource: 'https://research.example/run', amount: '1000', payTo: '0xt' },
      paymentResponse: { tx: '0xabc', payer: '0xp', network: 'base' },
      rail: 'usdc',
      fulfillmentMeta: fields,
    });
    assert.equal(receipt.fulfillment.output_commitment.kind, 'sha256');
    assert.equal(receipt.fulfillment.output_commitment.hash, hashDeliverablePayload(payload));
    const claims = decodeReceiptClaims(receipt);
    assert.equal(claims.fulfillment.output_commitment.kind, 'sha256');
  });

  test('a sender keccak256 kind is preserved', () => {
    const fields = fulfillmentFieldsFromIngestBody(invoice({
      deliverable_hash: KECCAK,
      deliverable_kind: 'keccak256',
    }));
    assert.equal(fields.hashKind, 'keccak256');
    const env = buildFulfillmentEnvelope({
      jobKind: 'swap',
      deliverableHash: fields.deliverableHash,
      hashKind: fields.hashKind,
    });
    assert.equal(env.output_commitment.kind, 'keccak256');
    assert.equal(env.output_commitment.hash, KECCAK);

    const viaObject = outputCommitmentOf({
      outputCommitment: { status: 'committed', hash: KECCAK, kind: 'keccak256' },
    });
    assert.equal(viaObject.kind, 'keccak256');
    assert.equal(viaObject.hash, KECCAK);
  });

  test('a kind-less commitment object keeps the sibling hash kind', () => {
    const direct = outputCommitmentOf({
      outputCommitment: { status: 'committed', hash: KECCAK },
      hashKind: 'keccak256',
    });
    assert.equal(direct.kind, 'keccak256');
    assert.equal(direct.hash, KECCAK);

    const explicit = outputCommitmentOf({
      outputCommitment: { status: 'committed', hash: KECCAK, kind: 'sha256' },
      hashKind: 'keccak256',
    });
    assert.equal(explicit.kind, 'sha256');

    const normalized = normalizeIngestInput(invoice({
      output_commitment: { status: 'committed', hash: KECCAK },
      deliverable_kind: 'keccak256',
    }));
    assert.equal(normalized.ok, true, normalized.reason);
    assert.equal(normalized.fulfillmentMeta.hashKind, 'keccak256');
    assert.equal(normalized.fulfillmentMeta.outputCommitment.kind, 'keccak256');
    const receipt = buildForeignReceipt({
      taskId: 'foreign-kind-sibling',
      paymentRequired: { resource: 'https://research.example/run', amount: '1000', payTo: '0xt' },
      paymentResponse: { tx: '0xsibling', payer: '0xp', network: 'base' },
      rail: 'usdc',
      fulfillmentMeta: normalized.fulfillmentMeta,
    });
    assert.equal(receipt.fulfillment.output_commitment.kind, 'keccak256');
    assert.equal(receipt.fulfillment.output_commitment.hash, KECCAK);
    assert.match(receipt.issuer_signature.jws, /^[^.]+\.[^.]+\.[^.]+$/);

    const clash = normalizeIngestInput(invoice({
      output_commitment: { status: 'committed', hash: KECCAK, kind: 'sha256' },
      deliverable_kind: 'keccak256',
    }));
    assert.equal(clash.ok, false);
    assert.equal(clash.error, 'invalid_output_commitment');
  });

  test('a labeled commitment hash that disagrees with deliverable_kind is rejected before signing', () => {
    const hex = 'cd'.repeat(32);
    const clash = normalizeIngestInput(invoice({
      output_commitment: { status: 'committed', hash: `sha256:${hex}` },
      deliverable_kind: 'keccak256',
    }));
    assert.equal(clash.ok, false);
    assert.equal(clash.error, 'invalid_output_commitment');
    assert.match(clash.reason, /does not match the sha256/);

    const agreed = normalizeIngestInput(invoice({
      output_commitment: { status: 'committed', hash: `sha256:${hex}` },
      deliverable_kind: 'sha256',
    }));
    assert.equal(agreed.ok, true, agreed.reason);
    const receipt = buildForeignReceipt({
      taskId: 'foreign-kind-label',
      paymentRequired: { resource: 'https://research.example/run', amount: '1000', payTo: '0xt' },
      paymentResponse: { tx: '0xlabel', payer: '0xp', network: 'base' },
      rail: 'usdc',
      fulfillmentMeta: agreed.fulfillmentMeta,
    });
    assert.equal(receipt.fulfillment.output_commitment.kind, 'sha256');
    assert.equal(receipt.fulfillment.output_commitment.hash, `0x${hex}`);
    assert.match(receipt.issuer_signature.jws, /^[^.]+\.[^.]+\.[^.]+$/);
  });

  test('output_commitment.kind applies when the digest is only on deliverable_hash', () => {
    const split = normalizeIngestInput(invoice({
      output_commitment: { kind: 'keccak256' },
      deliverable_hash: KECCAK,
    }));
    assert.equal(split.ok, true, split.reason);
    assert.equal(split.fulfillmentMeta.hashKind, 'keccak256');
    const receipt = buildForeignReceipt({
      taskId: 'foreign-kind-split',
      paymentRequired: { resource: 'https://research.example/run', amount: '1000', payTo: '0xt' },
      paymentResponse: { tx: '0xsplit', payer: '0xp', network: 'base' },
      rail: 'usdc',
      fulfillmentMeta: split.fulfillmentMeta,
    });
    assert.equal(receipt.fulfillment.output_commitment.kind, 'keccak256');
    assert.equal(receipt.fulfillment.output_commitment.hash, KECCAK);
    assert.match(receipt.issuer_signature.jws, /^[^.]+\.[^.]+\.[^.]+$/);

    const labeledClash = normalizeIngestInput(invoice({
      output_commitment: { kind: 'sha256' },
      deliverable_hash: `keccak256:${'ab'.repeat(32)}`,
    }));
    assert.equal(labeledClash.ok, false);
    assert.match(labeledClash.reason, /does not match the keccak256/);
  });

  test('a missing or unknown kind is rejected', () => {
    assert.throws(
      () => outputCommitmentOf({ hash: KECCAK }),
      (err) => err instanceof OutputCommitmentError && /sha256 or keccak256/.test(err.message),
    );
    assert.throws(
      () => outputCommitmentOf({ hash: KECCAK, kind: 'md5' }),
      (err) => err instanceof OutputCommitmentError && /not md5/.test(err.message),
    );
    const missing = normalizeIngestInput(invoice({ deliverable_hash: KECCAK }));
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'invalid_output_commitment');
    assert.match(missing.reason, /kind is required/);
    const unknown = normalizeIngestInput(invoice({
      deliverable_hash: KECCAK,
      deliverable_kind: 'blake3',
    }));
    assert.equal(unknown.ok, false);
    assert.match(unknown.reason, /not blake3/);
  });

  test('a kind mismatch cannot be smuggled onto a gateway sha256', () => {
    const payload = 'page-body';
    const fields = fulfillmentFieldsFromIngestBody(invoice({
      deliverable: payload,
      deliverable_kind: 'keccak256',
      output_commitment: {
        status: 'committed',
        hash: hashDeliverablePayload(payload),
        kind: 'keccak256',
      },
    }));
    assert.match(fields.commitmentError, /sha256/);
    assert.throws(
      () => buildForeignReceipt({
        taskId: 'foreign-kind-smuggle',
        paymentRequired: { resource: 'https://research.example/run', amount: '1000', payTo: '0xt' },
        paymentResponse: { tx: '0xabc', payer: '0xp', network: 'base' },
        rail: 'usdc',
        fulfillmentMeta: fields,
      }),
      (err) => err instanceof OutputCommitmentError,
    );
    const rejected = normalizeIngestInput(invoice({
      deliverable: payload,
      output_commitment: { status: 'committed', hash: '0x' + '11'.repeat(32), kind: 'keccak256' },
    }));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, 'invalid_output_commitment');
  });

  test('a labeled hash cannot wear a different kind, and length is checked', () => {
    const hex = 'cd'.repeat(32);
    assert.throws(
      () => outputCommitmentOf({ hash: `sha256:${hex}`, kind: 'keccak256' }),
      (err) => err instanceof OutputCommitmentError && /does not match the sha256/.test(err.message),
    );
    assert.throws(
      () => outputCommitmentOf({ hash: `keccak256:${hex}`, kind: 'sha256' }),
      (err) => err instanceof OutputCommitmentError && /does not match the keccak256/.test(err.message),
    );
    for (const hash of [SHORT, LONG, '0xzzzz', 'sha256:abcd', 'not-a-hash']) {
      assert.throws(
        () => outputCommitmentOf({ hash, kind: 'sha256' }),
        (err) => err instanceof OutputCommitmentError && /32 bytes/.test(err.message),
      );
    }
    const labeled = normalizeIngestInput(invoice({
      deliverable_hash: `sha256:${hex}`,
      deliverable_kind: 'keccak256',
    }));
    assert.equal(labeled.ok, false);
    assert.match(labeled.reason, /does not match the sha256/);
    const kept = outputCommitmentOf({ hash: `sha256:${hex}`, kind: 'sha256' });
    assert.equal(kept.kind, 'sha256');
    assert.equal(kept.hash, `0x${hex}`);
  });

  test('the listener keccak256 and the sha256 fallback are labeled explicitly', () => {
    const committed = buildReceipt({
      taskId: 'task-kind-keccak',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: { paymentRail: 'usdc', paymentRef: 'base:0x1', amount: '1000' },
      result: { content: 'hello', outputHash: KECCAK },
    }, { persistSignature: false });
    assert.equal(committed.fulfillment.output_commitment.kind, 'keccak256');
    assert.equal(decodeReceiptClaims(committed).fulfillment.output_commitment.kind, 'keccak256');

    const hashed = buildReceipt({
      taskId: 'task-kind-sha',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: { paymentRail: 'usdc', paymentRef: 'base:0x2', amount: '1000' },
      result: { content: 'hello-without-output-hash' },
    }, { persistSignature: false });
    assert.equal(hashed.fulfillment.output_commitment.kind, 'sha256');
    assert.equal(hashed.fulfillment.output_commitment.hash, hashDeliverablePayload('hello-without-output-hash'));
  });
});
