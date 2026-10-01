/**
 * Receipt-lane refusal fields beside book_seq.
 * Design by Turbo on 1F916 (post 6579, comments 88201 and 88403).
 * Settled + anchor change does not freeze. Unsettled + anchor change does.
 * anchor_changed alone does not freeze.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const {
  buildReceiptLane,
  receiptLaneDecision,
  deriveSettledBy,
  receiptLaneForEntry,
  RECEIPT_LANE_SCHEMA,
} = await import('../src/receipt-lane.js');
const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { verifyBookSeq } = await import('../src/book-seq.js');
const { readAgentBook, bindBookVerifier, buildBookExportCsv } = await import('../src/agent-book.js');

const ROOT_A = 'a'.repeat(64);
const ROOT_B = 'b'.repeat(64);

function headsChanged() {
  return [
    {
      root: ROOT_A,
      tree_size: 2,
      anchors: { base: { status: 'anchored', tx: '0xbind' }, solana: { status: 'pending', signature: null } },
    },
    {
      root: ROOT_B,
      tree_size: 6,
      anchors: { base: { status: 'anchored', tx: '0xlater' }, solana: { status: 'pending', signature: null } },
    },
  ];
}

test('settled receipt lane with anchor change does not freeze', () => {
  const lane = buildReceiptLane({
    entry: {
      seq: 4,
      evidence: 'collected',
      payment_ref: 'base:0xabc',
      collected: true,
      amount: '2000',
    },
    leafIndex: 1,
    heads: headsChanged(),
  });
  assert.equal(lane.schema, RECEIPT_LANE_SCHEMA);
  assert.equal(lane.signed, false);
  assert.equal(lane.book_seq, 4);
  assert.equal(lane.settled_by, 'receipt');
  assert.equal(lane.settled, true);
  assert.equal(lane.anchor_changed_since_binding, true);
  assert.equal(lane.freeze, false);
  assert.equal(lane.reason, null);
});

test('unsettled receipt lane with anchor change freezes', () => {
  const lane = buildReceiptLane({
    entry: {
      seq: 4,
      evidence: 'RECORDED_BY_SETTLE',
      payment_ref: 'base:0xabc',
      collected: false,
      amount: '2000',
    },
    leafIndex: 1,
    heads: headsChanged(),
  });
  assert.equal(lane.settled_by, 'receipt');
  assert.equal(lane.settled, false);
  assert.equal(lane.anchor_changed_since_binding, true);
  assert.equal(lane.freeze, true);
  assert.equal(lane.reason, 'unsettled_anchor_changed');
});

test('anchor change alone does not freeze a settled row or an observed transfer', () => {
  const settledOnly = receiptLaneDecision({
    book_seq: 8,
    settled_by: 'receipt',
    settled: true,
    anchor_changed_since_binding: true,
  });
  assert.equal(settledOnly.freeze, false);

  const observed = receiptLaneDecision({
    book_seq: 8,
    settled_by: 'observed_transfer',
    settled: false,
    anchor_changed_since_binding: true,
  });
  assert.equal(observed.freeze, false);

  const noSeq = receiptLaneDecision({
    book_seq: null,
    settled_by: 'receipt',
    settled: false,
    anchor_changed_since_binding: true,
  });
  assert.equal(noSeq.freeze, false);

  const unknown = receiptLaneDecision({
    book_seq: 8,
    settled_by: null,
    settled: false,
    anchor_changed_since_binding: true,
  });
  assert.equal(unknown.freeze, false);
});

test('settled_by is observed_transfer when the USDC check passed or ingress was recorded', () => {
  const payer = deriveSettledBy(
    { payment_ref: 'base:0xabc', collected: true },
    { payer: { checked: true, valid: true } },
  );
  assert.equal(payer, 'observed_transfer');

  const ingress = deriveSettledBy({
    payment_ref: 'solana:sig',
    arrival_status: 'confirmed',
    ingress_receipt: { ref: 'solana:sig' },
  });
  assert.equal(ingress, 'observed_transfer');

  const foreign = deriveSettledBy({
    evidence: 'foreign_ingest',
    source: 'foreign_ingest',
    payment_ref: 'base:0xforeign',
  });
  assert.equal(foreign, 'observed_transfer');
});

test('settled_by is receipt when only the issuer asserts settlement, and null when unknown', () => {
  const asserted = deriveSettledBy({
    evidence: 'collected',
    payment_ref: 'base:0xabc',
    collected: true,
  });
  assert.equal(asserted, 'receipt');

  const recorded = deriveSettledBy({
    evidence: 'RECORDED_BY_SETTLE',
    payment_ref: 'eip155:8453:0xabc',
  });
  assert.equal(recorded, 'receipt');

  const reported = deriveSettledBy({
    evidence: 'openrouter_reported',
    rail: 'reported',
    payment_ref: 'reported:gen',
  });
  assert.equal(reported, null);

  const blocked = deriveSettledBy({ evidence: 'policy_blocked' });
  assert.equal(blocked, null);
});

test('same head is not an anchor change, and a leaf with no covering head is unknown', () => {
  const same = buildReceiptLane({
    entry: { seq: 1, evidence: 'RECORDED_BY_SETTLE', payment_ref: 'base:0x1' },
    leafIndex: 0,
    heads: [headsChanged()[0]],
  });
  assert.equal(same.anchor_changed_since_binding, false);
  assert.equal(same.freeze, false);

  const unknown = buildReceiptLane({
    entry: { seq: 1, evidence: 'RECORDED_BY_SETTLE', payment_ref: 'base:0x1' },
    leafIndex: 9,
    heads: headsChanged(),
  });
  assert.equal(unknown.anchor_changed_since_binding, null);
  assert.equal(unknown.freeze, false);
});

test('book_seq signature stays verifiable; receipt_lane is not inside the JWS', () => {
  const ledger = new UsageSettledLedger();
  const registry = new AgentRegistry();
  const recorded = recordCollectedSpend({
    schema: 'xfuel.receipt.v4',
    task_id: 'lane-1',
    status: 'completed',
    payment: { rail: 'usdc', ref: 'base:0xlane', collected: true, gross_amount: '2000' },
    route: { model: 'xfuel/auto', hub: 'mock' },
  }, { ledger, registry });
  assert.equal(verifyBookSeq(recorded.entry.book_chain).valid, true);
  assert.equal(recorded.entry.book_chain.payload_version, 4);
  const payload = JSON.parse(Buffer.from(recorded.entry.book_chain.issuer_signature.jws.split('.')[1], 'base64url').toString());
  assert.equal(payload.payment_ref, 'base:0xlane');
  assert.equal(payload.settled_by, undefined);
  assert.equal(payload.anchor_changed_since_binding, undefined);
  assert.equal(payload.freeze, undefined);

  const book = readAgentBook(recorded.agent_id, { session: recorded.session }, {
    ledger,
    registry,
    verify: bindBookVerifier(registry),
  });
  const row = book.body.entries[0];
  assert.equal(row.seq, recorded.entry.seq);
  assert.equal(row.receipt_lane.book_seq, row.seq);
  assert.equal(row.receipt_lane.signed, false);
  assert.equal(row.receipt_lane.settled_by, 'receipt');
  assert.equal(row.receipt_lane.freeze, false);
  assert.equal(verifyBookSeq(row.book_chain).valid, true);

  const lane = receiptLaneForEntry(recorded.entry, { tree: null });
  assert.equal(lane.anchor_changed_since_binding, null);

  const csv = buildBookExportCsv(ledger.listByAgent(recorded.agent_id), recorded.agent_id, 'https://api.chit402.com');
  assert.match(csv.split('\n')[0], /settled_by,settled,anchor_changed_since_binding,freeze/);
  assert.match(csv, /receipt,/);
});
