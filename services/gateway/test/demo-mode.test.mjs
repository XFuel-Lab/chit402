import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Configure public demo mode BEFORE importing the server (module reads env at
// load). node --test runs each file in its own process, so this is isolated.
process.env.M2M_DEMO_MODE = 'true';
process.env.M2M_DEMO_API_KEY = 'xfuel-demo';
process.env.M2M_DEMO_RATE_PER_MIN = '2'; // tiny window so we can trip it fast
process.env.M2M_DEMO_RATE_PER_DAY = '1000';
process.env.M2M_API_KEYS = 'private-key-1'; // not open mode → auth enforced

const { createApp } = await import('../src/server.js');

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('demo key is accepted (via Authorization: Bearer)', async () => {
  const res = await fetch(`${base}/v1/models`, {
    headers: { Authorization: 'Bearer xfuel-demo' },
  });
  assert.equal(res.status, 200);
});

test('no key is rejected when not in open mode', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 401);
});

test('private key is accepted and NOT subject to the demo limit', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${base}/v1/models`, {
      headers: { 'X-API-Key': 'private-key-1' },
    });
    assert.equal(res.status, 200);
  }
});

test('demo key is throttled after the per-minute window', async () => {
  // Fresh IP bucket is shared across this process; the private-key test above
  // did not touch the demo bucket. per-min = 2 → 3rd demo request is 429.
  const hits = [];
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${base}/v1/models`, {
      headers: { 'X-API-Key': 'xfuel-demo' },
    });
    hits.push(res.status);
  }
  // Note: one demo request was already spent in the first test → expect a 429
  // within these three.
  assert.ok(hits.includes(429), `expected a 429 among ${JSON.stringify(hits)}`);
  const limited = await fetch(`${base}/v1/models`, {
    headers: { 'X-API-Key': 'xfuel-demo' },
  });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  // /v1 is the OpenAI-compatible surface, so the throttle answers in the OpenAI
  // error envelope — a plain OpenAI client can read message/type off the error.
  const body = await limited.json();
  assert.equal(body.error.code, 'rate_limit_exceeded');
  assert.equal(body.error.type, 'rate_limit_error');
  assert.match(body.error.message, /Use your own X-API-Key/);
});

test('M2M routes keep the flat XFuel error shape', async () => {
  const res = await fetch(`${base}/task-status?task_id=nope`, {
    headers: { 'X-API-Key': 'not-a-real-key' },
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
  assert.equal(typeof body.message, 'string');
});
