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

function captureTools(
  config: Partial<McpConfig>,
  client: Partial<XFuelClient> = {},
): Map<string, ToolHandler> {
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
  registerTools(fakeServer as never, { client: client as XFuelClient, config: fullConfig });
  return handlers;
}

test('all thirteen tools are registered', () => {
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
    'verify_model_commitment',
    'get_verified_quote',
    'get_validation_status',
    'get_provider_stake',
    'get_my_stats',
  ]) {
    assert.ok(handlers.has(name), `missing tool: ${name}`);
  }
  assert.equal(handlers.size, 13);
});

test('get_validation_status without RPC + registry returns a clear "not configured" error', async () => {
  const handlers = captureTools({});
  const res = await handlers.get('get_validation_status')!({ request_hash: '0x' + '11'.repeat(32) });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /ERC8004_VALIDATION_REGISTRY/);
});

test('get_provider_stake without RPC + staking address returns a clear "not configured" error', async () => {
  const handlers = captureTools({});
  const res = await handlers.get('get_provider_stake')!({ provider: '0x' + '11'.repeat(20) });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /PROVIDER_STAKING_ADDRESS/);
});

test('get_verified_quote returns pricing + tiers (PoMA unknown without registry)', async () => {
  const handlers = captureTools(
    {},
    { quoteTask: async () => ({ recommended: 'usdc', default_rail: 'usdc', rails: {} }) as never },
  );
  const res = await handlers.get('get_verified_quote')!({ model: 'llama-3-70b:q4_k_m' });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /tiers=signed\/settlement/);
});

test('verify_model_commitment without RPC + registry returns a clear "not configured" error', async () => {
  const handlers = captureTools({ rpcUrl: undefined, modelRegistryAddress: undefined });
  const res = await handlers.get('verify_model_commitment')!({ model: 'llama-3-70b:q4_k_m' });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /MODEL_REGISTRY_ADDRESS/);
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

test('submit_inference surfaces the server-provided verify_url in the summary', async () => {
  const handlers = captureTools(
    {},
    {
      submitInference: async () =>
        ({
          task_id: 'task-xyz',
          status: 'accepted',
          payment_rail: 'tfuel',
          verify_url: 'https://api-testnet.xfuel.app/receipt/task-xyz',
        }) as never,
    },
  );
  const res = await handlers.get('submit_inference')!({ model: 'llama-3-70b', sender: '0xabc', amount: '10000', chain_id: 'theta' });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Verify\/share: https:\/\/api-testnet\.xfuel\.app\/receipt\/task-xyz/);
});

test('get_task_status falls back to a client-side verify_url when the server omits it', async () => {
  const handlers = captureTools(
    { apiUrl: 'https://api-testnet.xfuel.app/' },
    {
      // No verify_url on the response → tool derives it from apiUrl + task_id.
      getTaskStatus: async () =>
        ({ task_id: 'task-777', status: 'fee_collected', proof_outcome: 'regenerable' }) as never,
    },
  );
  const res = await handlers.get('get_task_status')!({ task_id: 'task-777' });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Verify\/share: https:\/\/api-testnet\.xfuel\.app\/receipt\/task-777/);
});
