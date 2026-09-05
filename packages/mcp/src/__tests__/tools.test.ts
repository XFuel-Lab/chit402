import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { XFuelClient } from 'xfuel-sdk';
import { PUBLIC_DEMO_API_KEY } from 'xfuel-sdk';
import type { McpConfig } from '../config.js';
import { SERVER_VERSION } from '../config.js';
import { registerTools } from '../tools.js';

const CORE_TOOLS = [
  'chat_completions',
  'submit_inference',
  'register_agent',
  'get_agent_book',
  'get_book',
  'verify_receipt',
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
] as const;

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
    apiKey: 'chit402-demo',
    transport: 'stdio',
    port: 3033,
    ...config,
  };
  registerTools(fakeServer as never, { client: client as XFuelClient, config: fullConfig });
  return handlers;
}

test('SERVER_VERSION matches package.json', () => {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  assert.equal(SERVER_VERSION, pkg.version);
});

test('seventeen tools; pay_with_usdc is absent', () => {
  const handlers = captureTools({});
  for (const name of CORE_TOOLS) {
    assert.ok(handlers.has(name), `missing tool: ${name}`);
  }
  assert.equal(handlers.has('pay_with_usdc'), false);
  assert.equal(handlers.size, 17);
});

test('a payer-key config field does not add pay_with_usdc', () => {
  const handlers = captureTools({
    // @ts-expect-error — payer-key path is removed
    payerPrivateKey: '0x' + '11'.repeat(32),
  });
  assert.equal(handlers.has('pay_with_usdc'), false);
  assert.equal(handlers.has('register_agent'), true);
});

test('chat_completions forwards messages and surfaces the receipt', async () => {
  const handlers = captureTools(
    {},
    {
      chatCompletions: async () =>
        ({
          id: 'chatcmpl-1',
          model: 'akash/meta-llama/Llama-3.3-70B-Instruct',
          choices: [{ message: { role: 'assistant', content: 'Hello there friend today.' } }],
          xfuel: {
            task_id: 'openai-abc',
            verify_url: 'https://api-testnet.xfuel.app/receipt/openai-abc',
            payment: { rail: 'unmetered' },
          },
        }) as never,
    },
  );
  const res = await handlers.get('chat_completions')!({
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
  });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Hello there friend today/);
  assert.match(res.content[0].text, /rail=unmetered/);
  assert.match(res.content[0].text, /task_id=openai-abc/);
  assert.match(res.content[0].text, /Verify\/share: https:\/\/api-testnet\.xfuel\.app\/receipt\/openai-abc/);
  assert.equal(
    (res.structuredContent as { verify_url?: string }).verify_url,
    'https://api-testnet.xfuel.app/receipt/openai-abc',
  );
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

test('get_book is an alias of get_agent_book', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      agent_id: 3,
      entries: [],
      totals: { count: 0, usdc_sum: '0', by_rail: {} },
    }), { status: 200 })) as typeof fetch;
  try {
    const handlers = captureTools({});
    const res = await handlers.get('get_book')!({ agent_id: 3, session: 'sess' });
    assert.equal(res.isError, undefined);
    assert.match(res.content[0].text, /agent_id=3/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verify_receipt requires task_id or verify_url', async () => {
  const handlers = captureTools({}, {});
  const res = await handlers.get('verify_receipt')!({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /task_id or verify_url/);
});

test('verify_receipt loads receipt via task_id', async () => {
  const handlers = captureTools(
    {},
    {
      getReceipt: async () =>
        ({
          task_id: 'paid-1',
          status: 'fee_collected',
          verify_url: 'https://api-testnet.xfuel.app/receipt/paid-1',
        }) as never,
    },
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes('jwks.json')) {
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    const res = await handlers.get('verify_receipt')!({ task_id: 'paid-1', fetch_jwks: true });
    assert.equal(res.isError, undefined);
    assert.match(res.content[0].text, /overall=/);
    assert.equal(
      (res.structuredContent as { verify_url?: string }).verify_url,
      'https://api-testnet.xfuel.app/receipt/paid-1',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('get_agent_book POSTs session to /v1/agents/:id/book', async () => {
  const originalFetch = globalThis.fetch;
  let seen: { url: string; body: unknown } | null = null;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body || '{}')) };
    return new Response(JSON.stringify({
      agent_id: 7,
      limit: 50,
      entries: [],
      totals: { count: 0, usdc_sum: '0', by_rail: {} },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const handlers = captureTools({});
    const res = await handlers.get('get_agent_book')!({
      agent_id: 7,
      session: 'held-by-the-founder',
    });
    assert.equal(res.isError, undefined);
    assert.match(res.content[0].text, /agent_id=7/);
    assert.ok(seen);
    assert.match(seen!.url, /\/v1\/agents\/7\/book$/);
    assert.deepEqual(seen!.body, { session: 'held-by-the-founder' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('register_agent POSTs agentWallet + task_id', async () => {
  const originalFetch = globalThis.fetch;
  let seen: { url: string; body: unknown } | null = null;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body || '{}')) };
    return new Response(JSON.stringify({ agent_id: 7, agentWallet: '0x' + '11'.repeat(20), validate_score: 100 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const handlers = captureTools({});
    const res = await handlers.get('register_agent')!({
      agent_wallet: '0x' + '11'.repeat(20),
      task_id: 'task-paid-1',
    });
    assert.equal(res.isError, undefined);
    assert.match(res.content[0].text, /agent_id=7/);
    assert.ok(seen);
    assert.match(seen!.url, /\/v1\/agents\/register$/);
    assert.deepEqual(seen!.body, {
      agentWallet: '0x' + '11'.repeat(20),
      task_id: 'task-paid-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('quote_task warns when priced_model is null', async () => {
  const handlers = captureTools(
    {},
    {
      quoteTask: async () =>
        ({ recommended: 'usdc', default_rail: 'usdc', priced_model: null, rails: {} }) as never,
    },
  );
  const res = await handlers.get('quote_task')!({ model: 'definitely/not-a-real-model-xyz' });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /priced_model=null/);
  assert.match(res.content[0].text, /not a real quote/);
});

test('get_my_stats warns that the demo key is shared', async () => {
  const handlers = captureTools(
    { apiKey: PUBLIC_DEMO_API_KEY },
    { getMyStats: async () => ({ north_star: { paid_tasks_7d: 21, usdc_fees_7d: '50' } }) as never },
  );
  const res = await handlers.get('get_my_stats')!({});
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /SHARED demo key/);
});

test('submit_inference surfaces the server-provided verify_url in the summary', async () => {
  const handlers = captureTools(
    {},
    {
      submitInference: async () =>
        ({
          task_id: 'task-xyz',
          status: 'accepted',
          payment_rail: 'usdc',
          verify_url: 'https://api-testnet.xfuel.app/receipt/task-xyz',
        }) as never,
    },
  );
  const res = await handlers.get('submit_inference')!({
    model: 'llama-3-70b',
    sender: '0xabc',
    amount: '10000',
    chain_id: 'theta',
  });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Verify\/share: https:\/\/api-testnet\.xfuel\.app\/receipt\/task-xyz/);
});

test('get_task_status falls back to a client-side verify_url when the server omits it', async () => {
  const handlers = captureTools(
    { apiUrl: 'https://api-testnet.xfuel.app/' },
    {
      getTaskStatus: async () =>
        ({ task_id: 'task-777', status: 'fee_collected', proof_outcome: 'regenerable' }) as never,
    },
  );
  const res = await handlers.get('get_task_status')!({ task_id: 'task-777' });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Verify\/share: https:\/\/api-testnet\.xfuel\.app\/receipt\/task-777/);
});
