/**
 * XFuel Sidecar Middleware Tests
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createSidecarFetch, wrapFetchWithSidecar } from '../../dist/middleware.js';

const MOCK_CHAT_RESPONSE = {
  id: 'chatcmpl-123',
  object: 'chat.completion',
  created: 1700000000,
  model: 'gpt-4-turbo',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'Hello! How can I help you today?',
      },
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 8,
    total_tokens: 18,
  },
};

function createMockFetch(responseBody, status = 200) {
  return async () =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}

test('createSidecarFetch attaches receipt to chat completions response', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = createMockFetch(MOCK_CHAT_RESPONSE);

    const sidecarFetch = createSidecarFetch();
    const response = await sidecarFetch('https://api.openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4', messages: [] }),
    });

    assert.ok(response.xfuelReceipt);
    assert.match(response.xfuelReceipt.task_id, /^sidecar-/);
    assert.equal(response.xfuelReceipt.route.hub, 'api.openrouter.ai');
    assert.equal(response.xfuelReceipt.route.model, 'gpt-4-turbo');
    assert.equal(response.xfuelReceipt.sidecar, true);
    assert.ok(response.xfuelReceipt.output);
    assert.equal(response.xfuelReceipt.usage.prompt_tokens, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createSidecarFetch passes through non-chat endpoints unchanged', async () => {
  const originalFetch = globalThis.fetch;

  try {
    const modelsResponse = { data: [{ id: 'gpt-4' }] };
    globalThis.fetch = createMockFetch(modelsResponse);

    const sidecarFetch = createSidecarFetch();
    const response = await sidecarFetch('https://api.openrouter.ai/api/v1/models');

    assert.equal(response.xfuelReceipt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createSidecarFetch passes through error responses unchanged', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = createMockFetch({ error: 'Bad request' }, 400);

    const sidecarFetch = createSidecarFetch();
    const response = await sidecarFetch('https://api.openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
    });

    assert.equal(response.status, 400);
    assert.equal(response.xfuelReceipt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createSidecarFetch with signing secret adds signature', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = createMockFetch(MOCK_CHAT_RESPONSE);

    const sidecarFetch = createSidecarFetch({ signingSecret: 'test-secret' });
    const response = await sidecarFetch('https://api.groq.com/v1/chat/completions', {
      method: 'POST',
    });

    assert.ok(response.xfuelReceipt.signature);
    assert.equal(response.xfuelReceipt.signature.alg, 'HMAC-SHA256');
    assert.match(response.xfuelReceipt.signature.value, /^sha256=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createSidecarFetch calls onReceipt callback', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = createMockFetch(MOCK_CHAT_RESPONSE);

    let capturedReceipt = null;
    const sidecarFetch = createSidecarFetch({
      onReceipt: (receipt) => {
        capturedReceipt = receipt;
      },
    });

    await sidecarFetch('https://api.openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
    });

    assert.ok(capturedReceipt);
    assert.match(capturedReceipt.task_id, /^sidecar-/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createSidecarFetch handles tool calls in output hash', async () => {
  const originalFetch = globalThis.fetch;

  try {
    const toolCallResponse = {
      ...MOCK_CHAT_RESPONSE,
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_123',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
              },
            ],
          },
        },
      ],
    };
    globalThis.fetch = createMockFetch(toolCallResponse);

    const sidecarFetch = createSidecarFetch();
    const response = await sidecarFetch('https://api.openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
    });

    assert.ok(response.xfuelReceipt.output);
    assert.ok(response.xfuelReceipt.output.hash);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('wrapFetchWithSidecar wraps existing fetch', async () => {
  const mockFetch = createMockFetch(MOCK_CHAT_RESPONSE);
  const wrappedFetch = wrapFetchWithSidecar(mockFetch);

  const response = await wrappedFetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
  });

  assert.ok(response.xfuelReceipt);
  assert.equal(response.xfuelReceipt.route.hub, 'api.together.xyz');
});

test('wrapFetchWithSidecar with pricing estimates amount', async () => {
  const mockFetch = createMockFetch(MOCK_CHAT_RESPONSE);
  const wrappedFetch = wrapFetchWithSidecar(mockFetch, {
    pricing: {
      'gpt-4-turbo': {
        promptPrice: 10_000_000,
        completionPrice: 30_000_000,
      },
    },
  });

  const response = await wrappedFetch('https://api.openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
  });

  const receipt = response.xfuelReceipt;
  assert.ok(receipt);
  assert.notEqual(receipt.payment.gross_amount, '0');
});

test('createSidecarFetch extracts hub from various URL formats', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = createMockFetch(MOCK_CHAT_RESPONSE);

    const sidecarFetch = createSidecarFetch();

    const r1 = await sidecarFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
    });
    assert.equal(r1.xfuelReceipt.route.hub, 'openrouter.ai');

    const r2 = await sidecarFetch('https://api.groq.com/v1/chat/completions', {
      method: 'POST',
    });
    assert.equal(r2.xfuelReceipt.route.hub, 'api.groq.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
