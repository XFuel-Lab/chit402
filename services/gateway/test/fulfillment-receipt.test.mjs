import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  normalizeJobKind,
  outputCommitmentOf,
  buildFulfillmentEnvelope,
  fulfillmentFieldsFromIngestBody,
  hashDeliverablePayload,
  bookFulfillmentRowOf,
  FULFILLMENT_JOB_KINDS,
} = await import('../src/fulfillment-receipt.js');

const {
  buildForeignReceipt,
  buildPublicForeignIngestReceipt,
  normalizeIngestInput,
} = await import('../src/foreign-x402-ingest.js');

const { buildReceipt, RECEIPT_PAYLOAD_VERSION } = await import('../src/receipt.js');
const { UsageSettledLedger } = await import('../src/usage-settled.js');

describe('fulfillment-receipt v1', () => {
  test('normalizeJobKind infers completions from resource', () => {
    assert.equal(
      normalizeJobKind(null, { resource: 'https://api.example/v1/chat/completions' }),
      'completions',
    );
    assert.equal(normalizeJobKind('acp_job', {}), 'acp_job');
    assert.ok(FULFILLMENT_JOB_KINDS.includes('scrape'));
  });

  test('outputCommitmentOf: hash vs UNVERIFIED omission', () => {
    const committed = outputCommitmentOf({ hash: '0x' + 'ab'.repeat(32) });
    assert.equal(committed.status, 'committed');
    assert.ok(committed.hash);

    const missing = outputCommitmentOf({});
    assert.equal(missing.status, 'UNVERIFIED');
    assert.equal(missing.omission_rule, 'missing_deliverable_at_stamp');
  });

  test('fulfillmentFieldsFromIngestBody reads scrape job + deliverable', () => {
    const payload = 'report-json-v1';
    const fields = fulfillmentFieldsFromIngestBody({
      fulfillment_invoice: {
        amount: '1000',
        payer: '0xp',
        payTo: '0xt',
        tx: '0xabc',
        hub: 'research.example',
        model: '/run',
        job_kind: 'research',
        deliverable: payload,
        intent_id: 'intent-r1',
        attempt_index: 2,
      },
    });
    assert.equal(fields.jobKind, 'research');
    assert.equal(fields.intentId, 'intent-r1');
    assert.equal(fields.attemptIndex, 2);
    assert.equal(fields.deliverableHash, hashDeliverablePayload(payload));
  });

  test('buildForeignReceipt attaches fulfillment envelope', () => {
    const hash = hashDeliverablePayload('swap-output');
    const receipt = buildForeignReceipt({
      taskId: 'foreign-x402-test',
      paymentRequired: {
        resource: 'https://swap.example/v1/execute',
        amount: '5000',
        payTo: '0xpay',
      },
      paymentResponse: { tx: '0xdead', payer: '0xpayer', network: 'base' },
      rail: 'usdc',
      fulfillmentMeta: {
        jobKind: 'swap',
        deliverableHash: hash,
        intentId: 'intent-swap-1',
      },
    });
    assert.equal(receipt.fulfillment.intent.job_kind, 'swap');
    assert.equal(receipt.fulfillment.output_commitment.hash, hash);
    assert.equal(receipt.fulfillment.authorization.payer_wallet, '0xpayer');
    assert.match(receipt.fulfillment.authorization.payment_ref, /^base:0xdead$/);
  });

  test('foreign ingest ledger row + book row expose fulfillment', () => {
    const ledger = new UsageSettledLedger();
    const receipt = buildForeignReceipt({
      taskId: 'foreign-x402-book',
      paymentRequired: {
        resource: 'https://scrape.example/page',
        amount: '2000',
        payTo: '0xpay',
      },
      paymentResponse: { tx: '0xbeef', payer: '0xpayer', network: 'base' },
      rail: 'usdc',
      fulfillmentMeta: { jobKind: 'scrape', omitDeliverable: true },
    });
    const appended = ledger.append(receipt, { payer: '0xpayer', agentId: 42 });
    assert.equal(appended.ok, true);
    const row = bookFulfillmentRowOf(appended.entry);
    assert.equal(row.job_kind, 'scrape');
    assert.equal(row.output_commitment.status, 'UNVERIFIED');
  });

  test('buildReceipt includes fulfillment for completions task', () => {
    const outputHash = '0x' + 'cd'.repeat(32);
    const receipt = buildReceipt({
      taskId: 'task-fulfill-1',
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      intent: { paymentRail: 'usdc', paymentRef: 'base:0x1', amount: '10000', model: 'gpt-test' },
      result: { content: 'hello', outputHash, model: 'gpt-test', provider: 'mock' },
      feeBps: 50,
      feeAmount: '50',
      netAmount: '9950',
    }, { baseUrl: 'https://api.chit402.com', persistSignature: false });
    assert.equal(receipt.fulfillment.intent.job_kind, 'completions');
    assert.equal(receipt.fulfillment.output_commitment.hash, outputHash);
    assert.equal(receipt.verify_url, 'https://api.chit402.com/receipt/task-fulfill-1');
    assert.equal(receipt.issuer_signature.payload_version, RECEIPT_PAYLOAD_VERSION);
  });

  test('buildPublicForeignIngestReceipt preserves fulfillment for stranger verify', () => {
    const snapshot = buildForeignReceipt({
      taskId: 'foreign-x402-verify',
      paymentRequired: {
        resource: 'https://acp.example/job/1',
        amount: '1000',
        payTo: '0xpay',
      },
      paymentResponse: { tx: '0xacp', payer: '0xpayer', network: 'base' },
      rail: 'usdc',
      fulfillmentMeta: { jobKind: 'acp_job', deliverableHash: hashDeliverablePayload('done') },
    });
    const pub = buildPublicForeignIngestReceipt(snapshot, {
      baseUrl: 'https://api.chit402.com',
    });
    assert.equal(pub.fulfillment.intent.job_kind, 'acp_job');
    assert.equal(pub.verify_url, 'https://api.chit402.com/receipt/foreign-x402-verify');
    assert.equal(pub.evidence, 'foreign_ingest');
  });

  test('normalizeIngestInput passes fulfillment meta from fulfillment_invoice', () => {
    const n = normalizeIngestInput({
      session: 'ignored-here',
      fulfillment_invoice: {
        amount: '1000',
        payer: '0xp',
        payTo: '0xt',
        tx: '0x1',
        hub: 'jobs.example',
        job_kind: 'review',
        deliverable_hash: '0x' + 'ee'.repeat(32),
      },
    });
    assert.equal(n.ok, true);
    assert.equal(n.fulfillmentMeta.jobKind, 'review');
    assert.ok(n.fulfillmentMeta.deliverableHash);
  });

  test('bookFulfillmentRowOf compact export', () => {
    const env = buildFulfillmentEnvelope({ jobKind: 'other', paymentRef: 'base:0x1' });
    const row = bookFulfillmentRowOf({ fulfillment: env });
    assert.equal(row.job_kind, 'other');
    assert.equal(row.output_commitment.status, 'UNVERIFIED');
  });
});
