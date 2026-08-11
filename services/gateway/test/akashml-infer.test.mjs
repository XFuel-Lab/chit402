import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferAkashML, akashmlApiKey } from '../src/akashml-infer.js';

test('akashmlApiKey selects on key prefix, not variable name', () => {
  const saved = [process.env.AKASHML_API_KEY, process.env.AKASH_API_KEY];
  const restore = () => {
    for (const [i, name] of ['AKASHML_API_KEY', 'AKASH_API_KEY'].entries()) {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    }
  };
  try {
    delete process.env.AKASHML_API_KEY;
    delete process.env.AKASH_API_KEY;
    assert.equal(akashmlApiKey(), '', 'no credential → disabled');

    // Akash Console key (deployments/leases) must never reach the inference endpoint.
    process.env.AKASH_API_KEY = 'ac.sk.production.0d6598deadbeef';
    assert.equal(akashmlApiKey(), '', 'Console key in AKASH_API_KEY is not an inference key');

    process.env.AKASHML_API_KEY = 'ac.sk.production.0d6598deadbeef';
    assert.equal(akashmlApiKey(), '', 'Console key in the AkashML slot is rejected, not forwarded');
    delete process.env.AKASHML_API_KEY;

    // An unambiguous inference key is honoured under either name.
    process.env.AKASH_API_KEY = '  akml-borrowed  ';
    assert.equal(akashmlApiKey(), 'akml-borrowed', 'akml- key borrowed from AKASH_API_KEY, trimmed');

    process.env.AKASHML_API_KEY = 'akml-canonical';
    assert.equal(akashmlApiKey(), 'akml-canonical', 'canonical variable wins');
  } finally {
    restore();
  }
});

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
