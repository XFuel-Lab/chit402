import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { IAgentRuntime } from '../eliza-types.js';
import { registerChitAgentAction, showChitBookAction } from '../actions.js';
import { formatRemoteBook } from '../receipts.js';
import { peekRuntimeState, resetRuntimeState, setRuntimeState } from '../state.js';
import type { CachedReceipt, ChitPluginConfig, RuntimeState } from '../types.js';

function makeRuntime(overrides: Partial<IAgentRuntime> = {}): IAgentRuntime {
  const settings: Record<string, string> = {};
  return {
    character: { settings: {} },
    logger: { info: () => {}, warn: () => {} },
    getSetting: (key: string) => settings[key] ?? null,
    setSetting: async (key: string, value: string) => {
      settings[key] = value;
    },
    ...overrides,
  };
}

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  const config: ChitPluginConfig = {
    apiUrl: 'https://api.chit402.com',
    apiKey: 'demo',
    smallModel: 'xfuel/auto',
    largeModel: 'xfuel/auto',
    network: 'base',
    sender: '0x1111111111111111111111111111111111111111',
    bookLimit: 5,
    ...overrides.config,
  };
  return {
    config,
    client: {} as RuntimeState['client'],
    sender: config.sender,
    receipts: overrides.receipts ?? [],
    sessionSpendUsd: overrides.sessionSpendUsd ?? 0,
    payer: overrides.payer,
  };
}

function memory(text: string) {
  return { content: { text } };
}

describe('formatRemoteBook', () => {
  it('formats gateway entries with verify_url and spend summary', () => {
    const text = formatRemoteBook(
      {
        agent_id: 7,
        entries: [
          {
            task_id: 'task-paid-1',
            route: { model: 'xfuel/auto', hub: 'openrouter' },
            payment: { amount: '2000', rail: 'usdc' },
          },
        ],
        totals: { count: 1, usdc_sum: '2000' },
        cap: '10000',
        spent: '2000',
        remaining: '8000',
      },
      10,
      'https://api.chit402.com',
    );
    assert.match(text, /agent_id=7/);
    assert.match(text, /spent \$0\.0020/);
    assert.match(text, /receipt\/task-paid-1/);
    assert.match(text, /hub=openrouter/);
  });
});

describe('REGISTER_CHIT_AGENT', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registers via gateway and persists agent_id + session', async () => {
    const runtime = makeRuntime();
    const state = makeState({
      receipts: [
        {
          task_id: 'task-paid-1',
          verify_url: 'https://api.chit402.com/receipt/task-paid-1',
          gross_amount: '2000',
          rail: 'usdc',
          collected_at: Date.now(),
        },
      ],
    });
    setRuntimeState(runtime, state);

    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert.match(url, /\/v1\/agents\/register$/);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.agentWallet, state.sender);
      assert.equal(body.task_id, 'task-paid-1');
      return new Response(
        JSON.stringify({
          agent_id: 7,
          agentWallet: state.sender,
          session: 'sess-secret',
          task_id: 'task-paid-1',
          validate_score: 100,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await registerChitAgentAction.handler!(
      runtime,
      memory('please register my chit agent'),
    );
    assert.equal(result?.success, true);
    assert.match(String(result?.text), /agent_id=7/);

    const updated = peekRuntimeState(runtime);
    assert.equal(updated?.config.agentId, 7);
    assert.equal(updated?.config.bookSession, 'sess-secret');
    assert.equal(runtime.character.settings?.CHIT_AGENT_ID, '7');
    assert.equal(runtime.character.settings?.CHIT_BOOK_SESSION, 'sess-secret');
  });

  it('fails without a qualifying receipt task_id', async () => {
    const runtime = makeRuntime();
    setRuntimeState(runtime, makeState({ receipts: [] }));

    const result = await registerChitAgentAction.handler!(
      runtime,
      memory('register chit agent'),
    );
    assert.equal(result?.success, false);
    assert.match(String(result?.text), /task_id/);
  });
});

describe('SHOW_CHIT_BOOK', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetRuntimeState(makeRuntime());
  });

  it('fetches possession-gated book when registered', async () => {
    const runtime = makeRuntime();
    const state = makeState({
      config: {
        apiUrl: 'https://api.chit402.com',
        apiKey: 'demo',
        smallModel: 'xfuel/auto',
        largeModel: 'xfuel/auto',
        network: 'base',
        sender: '0x1111111111111111111111111111111111111111',
        bookLimit: 5,
        agentId: 7,
        bookSession: 'sess-secret',
      },
    });
    setRuntimeState(runtime, state);

    globalThis.fetch = mock.fn(async (input: RequestInfo | URL) => {
      assert.match(String(input), /\/v1\/agents\/7\/book$/);
      return new Response(
        JSON.stringify({
          agent_id: 7,
          entries: [
            {
              task_id: 'task-paid-1',
              route: { model: 'xfuel/auto' },
              payment: { amount: '5000' },
            },
          ],
          totals: { count: 1, usdc_sum: '5000' },
          spent: '5000',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await showChitBookAction.handler!(runtime, memory('show my chit book'));
    assert.equal(result?.success, true);
    assert.match(String(result?.text), /spent \$0\.0050/);
    assert.match(String(result?.text), /receipt\/task-paid-1/);
    assert.equal((result?.data as { source?: string })?.source, 'book_api');
  });

  it('falls back to runtime cache when not registered', async () => {
    const runtime = makeRuntime();
    const receipt: CachedReceipt = {
      task_id: 'cached-1',
      verify_url: 'https://api.chit402.com/receipt/cached-1',
      model: 'xfuel/auto',
      gross_amount: '3000',
      collected_at: Date.now(),
    };
    setRuntimeState(runtime, makeState({ receipts: [receipt] }));

    const result = await showChitBookAction.handler!(runtime, memory('show spend receipts'));
    assert.equal(result?.success, true);
    assert.match(String(result?.text), /cached-1/);
    assert.match(String(result?.text), /not registered yet/);
    assert.equal((result?.data as { source?: string })?.source, 'runtime_cache');
  });
});
