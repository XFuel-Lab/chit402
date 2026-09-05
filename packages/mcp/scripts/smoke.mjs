#!/usr/bin/env node
/**
 * Smoke check for chit402-mcp / xfuel-mcp — no live API required.
 *
 * Usage: npm run smoke --prefix packages/mcp
 */
import assert from 'node:assert/strict';
import { parseArgs } from '../src/config.js';
import { registerTools } from '../src/tools.js';
import { withReceiptFields } from '../src/receipt-fields.js';

const REQUIRED = [
  'chat_completions',
  'list_models',
  'submit_inference',
  'register_agent',
  'get_agent_book',
  'get_book',
  'verify_receipt',
  'get_task_status',
  'get_proof',
  'verify_proof',
];

const handlers = new Map();
const fakeServer = {
  registerTool(name, _def, handler) {
    handlers.set(name, handler);
  },
};

const { config } = parseArgs([]);
registerTools(fakeServer, {
  client: {
    chatCompletions: async () => ({
      model: 'xfuel/auto',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      xfuel: { task_id: 'smoke-1', verify_url: `${config.apiUrl}/receipt/smoke-1` },
    }),
    getReceipt: async () => ({
      task_id: 'smoke-1',
      status: 'completed',
      binding: { expected_commitment: '0x' + 'aa'.repeat(32), matches: true },
    }),
  },
  config,
});

for (const name of REQUIRED) {
  assert.ok(handlers.has(name), `missing tool: ${name}`);
}
assert.equal(handlers.has('pay_with_usdc'), false, 'MCP must not expose payer private keys');

const sample = withReceiptFields(
  { xfuel: { task_id: 'smoke-1', verify_url: `${config.apiUrl}/receipt/smoke-1` } },
  config.apiUrl,
);
assert.ok(sample.verify_url, 'structuredContent must carry verify_url');

console.log(`smoke ok — ${handlers.size} tools registered, verify_url preserved`);
