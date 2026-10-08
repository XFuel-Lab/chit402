/**
 * Public preimages for receipt hashes, and the signed issuer key history.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';

const { bookRowHash, bookRowPreimage } = await import('../src/book-seq.js');
const { computePaymentCommitment } = await import('../src/payment-binding.js');
const {
  paymentBindingPreimage,
  inclusionLeafPreimage,
  withPublicPreimages,
  jobSpecPreimage,
  NOT_RECOMPUTABLE_REASONS,
} = await import('../src/receipt-preimage.js');
const { resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const { emptyUniverseHash } = await import('../src/export-coverage.js');
const { issueRefusalReceipt, presentRefusal } = await import('../src/refusal-receipt.js');
const {
  buildIssuerHistory,
  verifyIssuerHistory,
  issuerKeyWindow,
  notBeforeForKid,
  PRODUCTION_KEY_NOT_BEFORE,
  PRODUCTION_ISSUER_KID,
} = await import('../src/issuer-history.js');
const { getIssuerKid, getJwks } = await import('../src/issuer-key.js');

test('book row preimage is the exact string that row_hash covers', () => {
  const row = {
    agent_id: 195,
    seq: 1,
    task_id: 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af',
    prev_hash: null,
    event: 'collected',
  };
  const line = bookRowPreimage(row);
  assert.equal(line, '195|1|xfuel-39af100b-23dd-4d86-a16b-4556ca6796af||collected');
  assert.equal(bookRowHash(row), bookRowHash({ ...row, book_id: 195 }));
  const receipt = {
    schema: 'xfuel.receipt.v4',
    task_id: row.task_id,
    book_chain: {
      book_id: 195,
      task_id: row.task_id,
      seq: 1,
      prev_hash: null,
      event: 'collected',
      row_hash: bookRowHash(row),
    },
    output: { hash: '0x' + 'ab'.repeat(32) },
  };
  const published = withPublicPreimages(receipt);
  const field = published.preimages.fields['book_chain.row_hash'];
  assert.equal(field.preimage_utf8, line);
  assert.equal(field.hash, receipt.book_chain.row_hash);
  assert.equal(published.preimages.links.preimage, `/receipt/${receipt.task_id}/preimage`);
  assert.equal(field.alg, 'sha256');
  const withheld = published.preimages.not_recomputable.find((row) => row.field === 'output.hash');
  assert.match(withheld.reason, /private/);
  assert.equal(JSON.stringify(published.preimages).includes('prompt'), false);
});

test('binding preimage is the abi.encodePacked bytes of the commitment', () => {
  const input = {
    paymentRef: 'base:0x' + 'cd'.repeat(32),
    taskId: 'xfuel-bind',
    rail: 'usdc',
    amount: '2000',
  };
  const { commitment } = computePaymentCommitment(input);
  const packed = paymentBindingPreimage(input);
  assert.equal(packed.hash.toLowerCase(), commitment.toLowerCase());
  assert.equal(packed.preimage_hex.startsWith('0x'), true);
  const receipt = {
    schema: 'xfuel.receipt.v4',
    task_id: input.taskId,
    payment: { rail: 'usdc', ref: input.paymentRef, gross_amount: '2000' },
    binding: {
      expected_commitment: commitment,
      amount: '2000',
      rail: 'usdc',
      covers: ['payment', 'settlement'],
    },
  };
  const published = withPublicPreimages(receipt);
  assert.equal(published.preimages.fields['binding.expected_commitment'].preimage_hex, packed.preimage_hex);
});

test('inclusion leaf and tree prefix preimages recompute the published hashes', () => {
  const tree = resetReceiptMerkleTree();
  const rowHash = 'bf'.repeat(32);
  tree.appendReceipt('task-other', 'aa'.repeat(32), { publish: false });
  tree.appendReceipt('task-leaf', rowHash, { publish: false });
  const inclusion = tree.inclusion('task-leaf');
  const audit = tree.publicPrefixAudit('task-leaf');
  assert.equal(audit.ok, true);
  assert.equal(audit.leaf.task_id, 'task-leaf');
  assert.equal(Object.prototype.hasOwnProperty.call(audit, 'leaves'), false);
  const leaf = inclusionLeafPreimage('task-leaf', rowHash);
  assert.equal(leaf.hash, inclusion.leaf);
  const receipt = {
    schema: 'xfuel.receipt.v4',
    task_id: 'task-leaf',
    tree_head_hash: audit.root,
    inclusion: { task_id: 'task-leaf', leaf: inclusion.leaf },
    book_chain: { row_hash: rowHash, task_id: 'task-leaf' },
  };
  const published = withPublicPreimages(receipt, { prefix: audit });
  const treeField = published.preimages.fields.tree_head_hash;
  assert.equal(published.preimages.fields['inclusion.leaf'].preimage_hex, leaf.preimage_hex);
  assert.equal(treeField.hash, audit.root);
  assert.equal(treeField.leaf.task_id, 'task-leaf');
  assert.equal(treeField.audit_path.index, audit.leaf_index);
  assert.equal(treeField.audit_path.tree_size, audit.tree_size);
  assert.equal(Object.prototype.hasOwnProperty.call(treeField, 'leaves'), false);
  assert.equal(JSON.stringify(published).includes('task-other'), false);

  const bundled = tree.prefixLeafPreimages('task-leaf');
  const withheld = withPublicPreimages(receipt, { prefix: bundled });
  assert.equal(withheld.preimages.fields.tree_head_hash, undefined);
  assert.equal(JSON.stringify(withheld).includes('task-other'), false);
  assert.match(
    withheld.preimages.not_recomputable.find((row) => row.field === 'tree_head_hash').reason,
    /sibling hashes/,
  );
});

test('coverage of book rows is not a public preimage; the empty set is', () => {
  const populated = withPublicPreimages({
    schema: 'xfuel.receipt.v4',
    task_id: 't',
    coverage: { universe_hash: 'ab'.repeat(32), enumerated_hash: 'ab'.repeat(32), universe_count: 2, enumerated_count: 2 },
  });
  assert.equal(populated.preimages.fields['coverage.universe_hash'], undefined);
  assert.match(
    populated.preimages.not_recomputable.find((row) => row.field === 'coverage.universe_hash').reason,
    /possession-gated/,
  );

  const empty = withPublicPreimages({
    schema: 'xfuel.receipt.v4',
    task_id: 't',
    coverage: {
      universe_hash: emptyUniverseHash(),
      enumerated_hash: emptyUniverseHash(),
      universe_count: 0,
      enumerated_count: 0,
    },
  });
  assert.equal(empty.preimages.fields['coverage.universe_hash'].preimage_utf8, '');
});

test('a refusal publishes the book row preimage and not the output', () => {
  const row = {
    agent_id: 9,
    task_id: 'xfuel-refused',
    seq: 2,
    prev_hash: 'aa'.repeat(32),
    event: 'policy_blocked',
    policy_code: 'budget_exhausted',
    collected_at: '2026-10-01T00:00:00.000Z',
  };
  row.row_hash = bookRowHash(row);
  const doc = presentRefusal(issueRefusalReceipt(row), 'https://api.chit402.com');
  const field = doc.preimages.fields['book_row.row_hash'];
  assert.equal(field.preimage_utf8, bookRowPreimage(row));
  assert.equal(field.hash, row.row_hash);
  assert.equal(
    doc.preimages.links.preimage,
    `https://api.chit402.com/refusal/${doc.refusal_id}/preimage`,
  );
  assert.equal(JSON.stringify(doc.preimages).includes('/receipt/'), false);
  assert.equal(JSON.stringify(doc.preimages).includes('secret prompt'), false);
});

test('job spec preimage is the JSON the board hash covers', () => {
  const text = 'do the thing';
  const preimage = jobSpecPreimage(text, '2000', '2026-10-05T00:00:00.000Z', 'looks done');
  assert.equal(JSON.parse(preimage).text, text);
  assert.equal(preimage.startsWith('{"text":'), true);
});

test('issuer history chains, signs, and rejects a rewritten entry', () => {
  const prevNotBefore = process.env.ISSUER_KEY_NOT_BEFORE;
  delete process.env.ISSUER_KEY_NOT_BEFORE;
  const doc = buildIssuerHistory();
  assert.equal(verifyIssuerHistory(doc).valid, true);
  assert.equal(doc.entries[0].prev_hash, null);
  assert.equal(doc.entries.at(-1).kid, getIssuerKid());
  assert.equal(doc.entries.at(-1).status, 'active');
  assert.equal(doc.entries.at(-1).not_after, null);
  assert.equal(Object.prototype.hasOwnProperty.call(doc.entries.at(-1), 'custody'), false);
  assert.equal(JSON.stringify(doc).includes('ISSUER_PRIVATE_KEY'), false);
  assert.equal(doc.issuer_signature.alg, 'ES256');
  const kid = getIssuerKid();
  if (kid === 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q') {
    assert.equal(doc.entries.at(-1).not_before, PRODUCTION_KEY_NOT_BEFORE);
    assert.equal(issuerKeyWindow(doc, kid, '2026-10-02T17:30:01.000Z').ok, true);
  } else {
    assert.equal(doc.entries.at(-1).not_before, null);
    const unknown = issuerKeyWindow(doc, kid, '2026-10-02T17:30:01.000Z');
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, 'not_before_missing');
  }

  const tampered = structuredClone(doc);
  tampered.entries[0].custody = 'rewritten';
  assert.equal(verifyIssuerHistory(tampered).valid, false);

  const revoked = buildIssuerHistory({
    entries: [{
      kid,
      jwk: getJwks().keys[0],
      alg: 'ES256',
      not_before: '2026-01-01T00:00:00.000Z',
      not_after: null,
      status: 'revoked',
      revoked_at: '2026-09-01T00:00:00.000Z',
      reason: 'test rotation',
      custody: 'rotated',
    }],
  });
  assert.equal(verifyIssuerHistory(revoked).valid, true);
  const late = issuerKeyWindow(revoked, kid, '2026-10-02T00:00:00.000Z');
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'kid_revoked_before_issuance');
  const early = issuerKeyWindow(revoked, kid, '2026-08-01T00:00:00.000Z');
  assert.equal(early.ok, true);
  if (prevNotBefore == null) delete process.env.ISSUER_KEY_NOT_BEFORE;
  else process.env.ISSUER_KEY_NOT_BEFORE = prevNotBefore;
});

test('a rotated kid does not inherit the production not_before', () => {
  const prev = process.env.ISSUER_KEY_NOT_BEFORE;
  delete process.env.ISSUER_KEY_NOT_BEFORE;
  try {
    const other = 'not-the-production-kid';
    assert.equal(notBeforeForKid(PRODUCTION_ISSUER_KID, null), PRODUCTION_KEY_NOT_BEFORE);
    assert.equal(notBeforeForKid(other, null), null);
    assert.equal(notBeforeForKid(other, '2026-10-01T00:00:00.000Z'), '2026-10-01T00:00:00.000Z');
    process.env.ISSUER_KEY_NOT_BEFORE = '2026-10-01T00:00:00.000Z';
    assert.equal(notBeforeForKid(other, null), '2026-10-01T00:00:00.000Z');
    assert.equal(notBeforeForKid(PRODUCTION_ISSUER_KID, null), PRODUCTION_KEY_NOT_BEFORE);
    const liveKid = getIssuerKid();
    if (liveKid !== PRODUCTION_ISSUER_KID) {
      const dated = buildIssuerHistory();
      assert.equal(dated.entries.at(-1).not_before, '2026-10-01T00:00:00.000Z');
      const early = issuerKeyWindow(dated, liveKid, '2026-09-04T08:52:05.000Z');
      assert.equal(early.ok, false);
      assert.equal(early.reason, 'issued_before_not_before');
    }
  } finally {
    if (prev == null) delete process.env.ISSUER_KEY_NOT_BEFORE;
    else process.env.ISSUER_KEY_NOT_BEFORE = prev;
  }
});

test('not_recomputable reasons name output and coverage', () => {
  assert.match(NOT_RECOMPUTABLE_REASONS.output, /private/);
  assert.match(NOT_RECOMPUTABLE_REASONS.coverage, /possession-gated/);
});
