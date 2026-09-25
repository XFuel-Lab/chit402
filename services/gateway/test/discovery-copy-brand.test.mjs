// Locked brand rule for discovery copy (x402 indexes such as Agent402 and the
// CDP Bazaar show these strings verbatim): lead with the signed spend receipt,
// never lead with OpenAI. "OpenAI-compatible wire" may appear later as a how.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildX402Manifest, buildOpenApiSpec } = await import('../src/x402-discovery.js');

const LEAD = 'Signed spend receipts for agent x402 payments — who paid which call, verifiable by a third party.';
const PAID_LEAD = /^Signed spend receipt \/ x402 payment receipt/;
const firstSentence = (s) => String(s).split(/(?<=\.)\s/)[0];

test('manifest: top description leads with the spend-receipt line', () => {
  const m = buildX402Manifest('https://api.example.test');
  assert.ok(m.description.startsWith(LEAD), m.description);
});

test('manifest: every paid resource leads with signed spend receipt, no OpenAI in first sentence', () => {
  const m = buildX402Manifest('https://api.example.test');
  assert.ok(m.resources.length >= 4);
  for (const r of m.resources) {
    assert.match(r.description, PAID_LEAD, r.resource);
    assert.doesNotMatch(firstSentence(r.description), /openai/i, r.resource);
  }
});

test('openapi: info leads with the spend-receipt line; paid ops lead with receipt, never OpenAI', () => {
  const spec = buildOpenApiSpec('https://api.example.test');
  assert.ok(spec.info.description.startsWith(LEAD));
  assert.ok(spec.info['x-guidance'].startsWith(LEAD));
  let paid = 0;
  for (const ops of Object.values(spec.paths)) {
    for (const op of Object.values(ops)) {
      if (!op || typeof op !== 'object' || !op['x-payment-info']) continue;
      paid++;
      assert.match(op.summary, PAID_LEAD, op.operationId);
      assert.match(op.description, PAID_LEAD, op.operationId);
      assert.doesNotMatch(op.summary, /openai/i, op.operationId);
      assert.doesNotMatch(firstSentence(op.description), /openai/i, op.operationId);
      assert.equal(op['x-payment-info'].price.amount, '0.002', op.operationId);
    }
  }
  assert.ok(paid >= 4, `paid ops: ${paid}`);
});
