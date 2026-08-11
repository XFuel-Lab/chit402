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

test('inferAkashML: reasoning model starved of max_tokens reports truncated, not empty', async () => {
  // Shape observed live from zai-org/GLM-5.2 at max_tokens=24: the whole budget is
  // spent on reasoning_content, so content is '' with finish_reason 'length'.
  const fetchFn = async () => new Response(JSON.stringify({
    choices: [{
      finish_reason: 'length',
      message: { role: 'assistant', content: '', reasoning_content: '1. **Analyze the Request:**' },
    }],
    usage: { prompt_tokens: 20, completion_tokens: 24, total_tokens: 44 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const r = await inferAkashML({
    model: 'zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 24,
    apiKey: 'akml-test',
    fetchFn,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'truncated', 'truncation is distinct from a provider fault');
  assert.equal(r.finish_reason, 'length');
  assert.equal(r.usage.completion_tokens, 24, 'usage is surfaced for COGS accounting');
  assert.match(r.detail, /raise max_tokens/);
});

test('inferAkashML: a genuinely empty answer is still empty_output', async () => {
  const fetchFn = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
    usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const r = await inferAkashML({
    model: 'zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'akml-test',
    fetchFn,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty_output', 'finish_reason stop → not a truncation');
});

test('inferAkashML: success surfaces usage + finish_reason for COGS', async () => {
  const fetchFn = async () => new Response(JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'AkashML online', reasoning_content: '1. ...' },
    }],
    usage: { prompt_tokens: 20, completion_tokens: 132, total_tokens: 152 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const r = await inferAkashML({
    model: 'zai-org/GLM-5.2',
    messages: [{ role: 'user', content: 'hi' }],
    apiKey: 'akml-test',
    fetchFn,
  });
  assert.equal(r.ok, true);
  assert.equal(r.output, 'AkashML online');
  assert.equal(r.finish_reason, 'stop');
  // 132 output tokens for a two-word answer — the reasoning tax the float must cover.
  assert.equal(r.usage.completion_tokens, 132);
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
