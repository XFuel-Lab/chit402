import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferAkashML } from '../src/akashml-infer.js';

test('inferAkashML: missing api key', async () => {
  const r = await inferAkashML({
    model: 'zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: '',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_api_key');
});

test('inferAkashML: success via injected fetchFn', async () => {
  const fetchFn = async (url, init) => {
    assert.match(url, /\/chat\/completions$/);
    assert.equal(init.method, 'POST');
    assert.match(init.headers.Authorization, /^Bearer test-key$/);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'zai-org/GLM-5.2');
    assert.equal(body.messages[0].content, 'hello');
    return {
      ok: true,
      async text() {
        return JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'world' } }],
        });
      },
    };
  };
  const r = await inferAkashML({
    model: 'zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'hello' }],
    apiKey: 'test-key',
    fetchFn,
  });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'world');
  assert.equal(r.provider, 'akash-network');
  assert.ok(typeof r.elapsed_ms === 'number');
});

test('inferAkashML: HTTP error surfaces status', async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 429,
    async text() { return 'rate limited'; },
  });
  const r = await inferAkashML({
    model: 'zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'k',
    fetchFn,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http_429');
});
