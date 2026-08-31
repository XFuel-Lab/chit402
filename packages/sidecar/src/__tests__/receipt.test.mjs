/**
 * XFuel Sidecar Receipt Tests
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSidecarReceipt,
  generateSidecarTaskId,
  hashOutput,
  canonicalSidecarPayload,
  verifySidecarSignature,
  SIDECAR_RECEIPT_SCHEMA,
} from '../../dist/receipt.js';

test('generateSidecarTaskId creates unique IDs with sidecar- prefix', () => {
  const id1 = generateSidecarTaskId();
  const id2 = generateSidecarTaskId();

  assert.match(id1, /^sidecar-[a-z0-9]+-[a-f0-9]+$/);
  assert.match(id2, /^sidecar-[a-z0-9]+-[a-f0-9]+$/);
  assert.notEqual(id1, id2);
});

test('hashOutput produces 0x-prefixed SHA-256 hex', () => {
  const hash = hashOutput('hello world');

  assert.match(hash, /^0x[a-f0-9]{64}$/);
  assert.equal(hash, '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
});

test('hashOutput is deterministic', () => {
  const content = 'The quick brown fox jumps over the lazy dog.';
  const hash1 = hashOutput(content);
  const hash2 = hashOutput(content);

  assert.equal(hash1, hash2);
});

test('buildSidecarReceipt creates valid receipt for uncollected payment', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.openrouter.ai',
    model: 'openai/gpt-4',
    amount: '10000',
    output: 'Hello, world!',
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });

  assert.equal(receipt.schema, SIDECAR_RECEIPT_SCHEMA);
  assert.match(receipt.task_id, /^sidecar-/);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.proof_outcome, 'signed');
  assert.equal(receipt.sidecar, true);

  assert.equal(receipt.payment.rail, 'uncollected');
  assert.equal(receipt.payment.ref, null);
  assert.equal(receipt.payment.gross_amount, '10000');
  assert.equal(receipt.payment.collected, false);

  assert.equal(receipt.route.hub, 'api.openrouter.ai');
  assert.equal(receipt.route.model, 'openai/gpt-4');
  assert.equal(receipt.route.provider, 'api.openrouter.ai');

  assert.ok(receipt.output);
  assert.equal(receipt.output.kind, 'sha256');
  assert.match(receipt.output.hash, /^0x[a-f0-9]{64}$/);

  assert.equal(receipt.usage.prompt_tokens, 10);
  assert.equal(receipt.usage.completion_tokens, 5);
  assert.equal(receipt.usage.total_tokens, 15);
});

test('buildSidecarReceipt creates valid receipt for collected payment', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.groq.com',
    model: 'llama-3.1-70b',
    amount: '50000',
    output: 'Test output',
    paymentRef: 'base:0x1234567890abcdef',
    payer: '0xPayerAddress',
    payTo: '0xPayToAddress',
  });

  assert.equal(receipt.payment.rail, 'usdc');
  assert.equal(receipt.payment.ref, 'base:0x1234567890abcdef');
  assert.equal(receipt.payment.gross_amount, '50000');
  assert.equal(receipt.payment.collected, true);
  assert.equal(receipt.payment.payer, '0xPayerAddress');
  assert.equal(receipt.payment.payTo, '0xPayToAddress');
  assert.ok(receipt.payment.collected_at);
});

test('buildSidecarReceipt handles null output', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.together.ai',
    model: 'mistral-7b',
    amount: '5000',
    output: null,
  });

  assert.equal(receipt.output, null);
});

test('buildSidecarReceipt with signingSecret adds signature', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.openrouter.ai',
    model: 'gpt-4',
    amount: '10000',
    output: 'Signed output',
    signingSecret: 'test-secret-key',
  });

  assert.ok(receipt.signature);
  assert.equal(receipt.signature.alg, 'HMAC-SHA256');
  assert.equal(receipt.signature.scope, 'sidecar');
  assert.equal(receipt.signature.payload_version, 1);
  assert.match(receipt.signature.value, /^sha256=[a-f0-9]+$/);
});

test('verifySidecarSignature validates correct signature', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.openrouter.ai',
    model: 'gpt-4',
    amount: '10000',
    output: 'Test',
    signingSecret: 'my-secret',
  });

  const result = verifySidecarSignature(receipt, 'my-secret');

  assert.equal(result.checked, true);
  assert.equal(result.valid, true);
});

test('verifySidecarSignature rejects wrong signature', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.openrouter.ai',
    model: 'gpt-4',
    amount: '10000',
    output: 'Test',
    signingSecret: 'my-secret',
  });

  const result = verifySidecarSignature(receipt, 'wrong-secret');

  assert.equal(result.checked, true);
  assert.equal(result.valid, false);
});

test('verifySidecarSignature returns unchecked for unsigned receipt', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.openrouter.ai',
    model: 'gpt-4',
    amount: '10000',
    output: 'Test',
  });

  const result = verifySidecarSignature(receipt, 'any-secret');

  assert.equal(result.checked, false);
  assert.equal(result.valid, null);
});

test('canonicalSidecarPayload is deterministic', () => {
  const receipt = buildSidecarReceipt({
    hub: 'api.openrouter.ai',
    model: 'gpt-4',
    amount: '10000',
    output: 'Test',
  });

  const payload1 = canonicalSidecarPayload(receipt);
  const payload2 = canonicalSidecarPayload(receipt);

  assert.equal(payload1, payload2);
  const parsed = JSON.parse(payload1);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 8);
});
