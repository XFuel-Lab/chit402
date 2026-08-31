/**
 * XFuel Sidecar Import Tests
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  importUsageExport,
  parseOpenRouterExport,
  parseGroqExport,
  openRouterToReceipts,
  groqToReceipts,
} from '../../dist/import.js';

const OPENROUTER_JSON = JSON.stringify([
  {
    id: 'gen_abc123',
    created_at: '2024-12-01T10:00:00Z',
    model: 'openai/gpt-4-turbo',
    total_cost: 0.05,
    prompt_tokens: 1000,
    completion_tokens: 500,
    generation_id: 'gen_abc123',
  },
  {
    id: 'gen_def456',
    created_at: '2024-12-01T11:00:00Z',
    model: 'anthropic/claude-3-opus',
    total_cost: 0.10,
    prompt_tokens: 2000,
    completion_tokens: 1000,
    generation_id: 'gen_def456',
  },
]);

const OPENROUTER_CSV = `id,created_at,model,total_cost,prompt_tokens,completion_tokens
gen_abc123,2024-12-01T10:00:00Z,openai/gpt-4-turbo,0.05,1000,500
gen_def456,2024-12-01T11:00:00Z,anthropic/claude-3-opus,0.10,2000,1000`;

const GROQ_JSON = JSON.stringify([
  {
    request_id: 'req_xyz789',
    created_at: '2024-12-01T12:00:00Z',
    model: 'llama-3.1-70b-versatile',
    prompt_tokens: 500,
    completion_tokens: 200,
    total_tokens: 700,
  },
]);

test('parseOpenRouterExport parses JSON array', () => {
  const rows = parseOpenRouterExport(OPENROUTER_JSON);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, 'openai/gpt-4-turbo');
  assert.equal(rows[0].total_cost, 0.05);
  assert.equal(rows[0].prompt_tokens, 1000);
  assert.equal(rows[1].model, 'anthropic/claude-3-opus');
});

test('parseOpenRouterExport parses CSV', () => {
  const rows = parseOpenRouterExport(OPENROUTER_CSV);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, 'openai/gpt-4-turbo');
  assert.equal(rows[0].total_cost, 0.05);
  assert.equal(rows[0].prompt_tokens, 1000);
});

test('parseGroqExport parses JSON', () => {
  const rows = parseGroqExport(GROQ_JSON);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, 'llama-3.1-70b-versatile');
  assert.equal(rows[0].prompt_tokens, 500);
});

test('openRouterToReceipts creates valid receipts', () => {
  const rows = parseOpenRouterExport(OPENROUTER_JSON);
  const receipts = openRouterToReceipts(rows);

  assert.equal(receipts.length, 2);

  const r1 = receipts[0];
  assert.match(r1.task_id, /^sidecar-/);
  assert.equal(r1.route.hub, 'openrouter.ai');
  assert.equal(r1.route.model, 'openai/gpt-4-turbo');
  assert.equal(r1.payment.gross_amount, '50000');
  assert.equal(r1.payment.rail, 'uncollected');
  assert.equal(r1.usage.prompt_tokens, 1000);
  assert.equal(r1.usage.completion_tokens, 500);
  assert.ok(r1.imported);
  assert.equal(r1.imported.source, 'openrouter');
  assert.equal(r1.imported.original_id, 'gen_abc123');

  const r2 = receipts[1];
  assert.equal(r2.route.model, 'anthropic/claude-3-opus');
  assert.equal(r2.payment.gross_amount, '100000');
});

test('groqToReceipts creates valid receipts', () => {
  const rows = parseGroqExport(GROQ_JSON);
  const receipts = groqToReceipts(rows);

  assert.equal(receipts.length, 1);

  const r = receipts[0];
  assert.equal(r.route.hub, 'api.groq.com');
  assert.equal(r.route.model, 'llama-3.1-70b-versatile');
  assert.equal(r.payment.gross_amount, '0');
  assert.equal(r.usage.prompt_tokens, 500);
  assert.equal(r.usage.completion_tokens, 200);
  assert.equal(r.usage.total_tokens, 700);
  assert.ok(r.imported);
  assert.equal(r.imported.source, 'groq');
});

test('importUsageExport auto-detects OpenRouter', () => {
  const result = importUsageExport(OPENROUTER_JSON);

  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.receipts.length, 2);
  assert.equal(result.errors.length, 0);
});

test('importUsageExport auto-detects Groq', () => {
  const groqData = JSON.stringify([{ request_id: 'r1', model: 'llama-3.1-70b' }]);
  const result = importUsageExport(groqData);

  assert.equal(result.imported, 1);
  assert.equal(result.receipts.length, 1);
});

test('importUsageExport with explicit source', () => {
  const result = importUsageExport(OPENROUTER_JSON, { source: 'openrouter' });

  assert.equal(result.imported, 2);
  assert.equal(result.receipts[0].imported.source, 'openrouter');
});

test('importUsageExport handles invalid JSON gracefully', () => {
  // Invalid JSON triggers try/catch and returns errors
  const result = importUsageExport('{ invalid json }}}');

  // Generic parser falls through and may parse as CSV or return empty
  // The important thing is it doesn't throw
  assert.ok(Array.isArray(result.receipts));
  assert.ok(typeof result.imported === 'number');
});

test('openRouterToReceipts with signing secret', () => {
  const rows = parseOpenRouterExport(OPENROUTER_JSON);
  const receipts = openRouterToReceipts(rows, { signingSecret: 'test-key' });

  assert.ok(receipts[0].signature);
  assert.equal(receipts[0].signature.alg, 'HMAC-SHA256');
  assert.match(receipts[0].signature.value, /^sha256=/);
});

test('receipt amounts are in atomic USDC (6 decimals)', () => {
  const rows = [{ id: '1', model: 'gpt-4', total_cost: 0.000001 }];
  const receipts = openRouterToReceipts(rows);

  assert.equal(receipts[0].payment.gross_amount, '1');

  const rows2 = [{ id: '2', model: 'gpt-4', total_cost: 1.234567 }];
  const receipts2 = openRouterToReceipts(rows2);

  assert.equal(receipts2[0].payment.gross_amount, '1234567');
});
