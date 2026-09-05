import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IAgentRuntime } from '../eliza-types.js';
import type { Receipt } from 'xfuel-sdk';
import { buildMessages } from '../models.js';
import {
  formatCachedBook,
  pushReceipt,
  receiptFromChatXfuel,
  receiptFromTaskStatus,
  usdcMicroToUsd,
} from '../receipts.js';
import { enforceSpendCaps } from '../state.js';
import type { CachedReceipt, ChitPluginConfig, RuntimeState } from '../types.js';

describe('receipt cache', () => {
  it('maps chat xfuel receipt fields', () => {
    const xfuel: Receipt = {
      task_id: 'task-1',
      verify_url: 'https://api.chit402.com/receipt/task-1',
      payment: { rail: 'unmetered', gross_amount: '0' },
      route: { model: 'xfuel/auto', provider: 'openrouter' },
    };
    const cached = receiptFromChatXfuel(xfuel, 'xfuel/auto', 'https://api.chit402.com');
    assert.ok(cached);
    assert.equal(cached!.task_id, 'task-1');
    assert.equal(cached!.hub, 'openrouter');
    assert.match(cached!.verify_url, /task-1$/);
  });

  it('dedupes and caps cached receipts', () => {
    const a: CachedReceipt = {
      task_id: 'a',
      verify_url: 'https://example/a',
      collected_at: 1,
    };
    const b: CachedReceipt = {
      task_id: 'b',
      verify_url: 'https://example/b',
      collected_at: 2,
    };
    const updated = pushReceipt([a], b);
    assert.deepEqual(updated.map((r) => r.task_id), ['b', 'a']);
    const replaced = pushReceipt(updated, { ...a, collected_at: 3 });
    assert.equal(replaced[0].collected_at, 3);
    assert.equal(replaced.length, 2);
  });

  it('formats cached book text', () => {
    const text = formatCachedBook(
      [
        {
          task_id: 't1',
          verify_url: 'https://api.chit402.com/receipt/t1',
          model: 'xfuel/auto',
          gross_amount: '2000',
          collected_at: Date.now(),
        },
      ],
      5,
    );
    assert.match(text, /Chit402 spend book/);
    assert.match(text, /verify_url|receipt\/t1/);
    assert.match(text, /\$0\.0020/);
  });
});

describe('model helpers', () => {
  it('builds system + user messages from runtime character', () => {
    const runtime = {
      character: { system: 'You are helpful.' },
    } as IAgentRuntime;
    const messages = buildMessages(runtime, 'Hello');
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].content, 'Hello');
  });

  it('maps settled task status to cached receipt', () => {
    const cached = receiptFromTaskStatus(
      {
        task_id: 'paid-1',
        status: 'completed',
        proof_outcome: 'pending',
        message_type: 'inference_request',
        chain_id: 'base',
        gross_amount: '5000',
        fee_amount: '500',
        net_amount: '4500',
        fee_bps: 1000,
        payment_rail: 'usdc',
        payment_ref: 'base:0xabc',
        verify_url: 'https://api.chit402.com/receipt/paid-1',
        result: { content: 'done', model: 'xfuel/auto', provider: 'akash' },
        created_at: 1,
        updated_at: 2,
      },
      'xfuel/auto',
      'https://api.chit402.com',
    );
    assert.equal(cached.hub, 'akash');
    assert.equal(usdcMicroToUsd('5000'), 0.005);
  });
});

describe('spend caps', () => {
  const baseConfig: ChitPluginConfig = {
    apiUrl: 'https://api.chit402.com',
    apiKey: 'demo',
    smallModel: 'xfuel/auto',
    largeModel: 'xfuel/auto',
    network: 'base',
    sender: '0x0',
    bookLimit: 10,
    maxUsdPerCall: 0.01,
    maxUsdSession: 0.05,
  };

  it('rejects per-call cap', async () => {
    const state: RuntimeState = {
      config: baseConfig,
      client: {} as RuntimeState['client'],
      sender: '0x0',
      receipts: [],
      sessionSpendUsd: 0,
    };
    await assert.rejects(
      () => enforceSpendCaps(state, '20000'),
      /CHIT_MAX_USD_PER_CALL/,
    );
  });

  it('rejects session cap', async () => {
    const state: RuntimeState = {
      config: baseConfig,
      client: {} as RuntimeState['client'],
      sender: '0x0',
      receipts: [],
      sessionSpendUsd: 0.042,
    };
    await assert.rejects(
      () => enforceSpendCaps(state, '9000'),
      /CHIT_MAX_USD_SESSION/,
    );
  });
});
