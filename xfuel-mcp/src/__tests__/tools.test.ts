import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { XFuelClient } from 'xfuel-sdk';
import type { McpConfig } from '../config.js';
import { registerTools } from '../tools.js';

/**
 * Minimal fake McpServer that captures each tool's handler so we can invoke it
 * directly. We only exercise deterministic, no-network branches here.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}>;

function captureTools(config: Partial<McpConfig>): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const fakeServer = {
    registerTool(name: string, _def: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  };
  const fullConfig: McpConfig = {
    apiUrl: 'https://api-testnet.xfuel.app',
    apiKey: 'xfuel-demo',
    transport: 'stdio',
    port: 3033,
    ...config,
  };
  // The client is never called on the branches under test.
  const client = {} as XFuelClient;
  registerTools(fakeServer as never, { client, config: fullConfig });
  return handlers;
}

test('all eight tools are registered', () => {
  const handlers = captureTools({});
  for (const name of [
    'submit_inference',
    'pay_with_usdc',
    'get_task_status',
    'get_proof',
    'verify_proof',
    'quote_task',
    'get_health',
    'list_models',
  ]) {
    assert.ok(handlers.has(name), `missing tool: ${name}`);
  }
  assert.equal(handlers.size, 8);
});

test('pay_with_usdc without a payer key returns a clear "not configured" error', async () => {
  const handlers = captureTools({ payerPrivateKey: undefined });
  const res = await handlers.get('pay_with_usdc')!({ model: 'llama-3-70b', amount: '10000', chain_id: 'theta' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not configured/);
  assert.match(res.content[0].text, /XFUEL_PAYER_PRIVATE_KEY/);
});

test('pay_with_usdc with an invalid payer key is rejected before any network call', async () => {
  const handlers = captureTools({ payerPrivateKey: 'not-a-valid-key' });
  const res = await handlers.get('pay_with_usdc')!({ model: 'llama-3-70b', amount: '10000', chain_id: 'theta' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not a valid private key/);
});
